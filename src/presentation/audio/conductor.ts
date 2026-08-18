/**
 * GENERATIVE SCORE — the conductor (ARCHITECTURE_CONTRACT §26).
 *
 * Turns observed simulation state (merged render frames, real bridge
 * probes, UI gestures) into ONE deterministic musical control stream:
 *
 *   transport   a beat clock that breathes with the sim: beats advance
 *               only while the world runs, quickening sub-linearly with
 *               game speed (speed^0.35 — 8× feels brisk, never frantic).
 *   beds        water babble, wind, rain hiss, pad — continuous layers
 *               mixed from real environment state (day phase, weather,
 *               zoom height, probed water, listener submersion).
 *   generators  rain as pentatonic music-box, birdsong by day, crickets
 *               by night, the colony work-song (one pluck voice per nearby
 *               beaver, walking the world's own seeded motif), work
 *               rhythms (gnawing, taps, paddles, footsteps) locked to the
 *               transport grid so simultaneous labor becomes polyrhythm.
 *   events      every render event voiced through the gesture-map
 *               scorecard, quantized to the grid — the world plays in time.
 *
 * Determinism: every stochastic choice draws from slotRandom(worldHash,
 * slot, salt) — a pure function of world seed and beat index — so the
 * score is reproducible and testable, and two runs of the same world
 * genuinely hear the same piece. The conductor never touches the sim,
 * the DOM, or any audio API; it composes, backends perform.
 */
import type { RenderFrame } from "../contracts/render-frame.js";
import type { RenderEvent } from "../contracts/render-events.js";
import type { RenderActivity } from "../contracts/render-entity.js";
import {
  activeScale,
  chordFor,
  daylightAmount,
  degreeToMidi,
  motifPhrase,
  quantizeToScale,
  slotRandom,
  worldMusicIdentity,
  type WorldMusicIdentity,
} from "./music-theory.js";
import { realizeRecipe, recipeFor } from "./gesture-map.js";
import type {
  LayerState,
  ListenerPose,
  NoteGesture,
  ScoreFrame,
  SfxGesture,
  SfxName,
  SoundGesture,
  TransportState,
  WaterProbe,
} from "./sound-gesture.js";

/** Salts keep each generator's slot-random stream independent. */
const SALT = {
  rain: 11,
  trickle: 23,
  bird: 37,
  cricket: 41,
  colony: 53,
  thunder: 67,
  crackle: 71,
  activity: 83,
  phrase: 97,
} as const;

/** Audibility reference distances (cells): gain = 1/(1+(dist/ref)^1.6). */
const AUDIBILITY = { event: 9, loop: 6, motif: 14, droplet: 12, wildlife: 16 } as const;
const MAX_LOOP_WORKERS = 6;
const MOTIF_VOICES = 5;
const BEATS_PER_BAR = 4;
const BEATS_PER_CHORD = 8;
/** How far ahead of the transport the conductor composes (beats). */
const HORIZON_BEATS = 1.5;

interface EntityState {
  kind: string;
  activity: RenderActivity;
  x: number;
  y: number;
  z: number;
}

interface QueuedEvent {
  readonly event: RenderEvent;
}

/** Work-rhythm patterns: beat-fraction offsets within one beat per activity. */
const ACTIVITY_PATTERNS: Readonly<Partial<Record<RenderActivity, { readonly sfx: SfxName; readonly steps: readonly number[]; readonly intensity: number }>>> = {
  "cutting-tree": { sfx: "gnaw", steps: [0, 0.5], intensity: 0.5 },
  building: { sfx: "wood-tap", steps: [0, 0.75], intensity: 0.55 },
  digging: { sfx: "scrape", steps: [0, 0.5], intensity: 0.4 },
  hauling: { sfx: "footstep", steps: [0, 0.5], intensity: 0.32 },
  swimming: { sfx: "paddle", steps: [0, 0.5], intensity: 0.34 },
  crafting: { sfx: "wood-tap", steps: [0.25, 0.75], intensity: 0.4 },
  eating: { sfx: "munch", steps: [0.25, 0.75], intensity: 0.25 },
  sleeping: { sfx: "breath", steps: [0], intensity: 0.22 },
  walking: { sfx: "footstep", steps: [0, 0.5], intensity: 0.18 },
};

export interface ConductorOptions {
  readonly seed: string | number;
}

export class Conductor {
  readonly identity: WorldMusicIdentity;
  private beat = 0;
  private generatedUntil = 0;
  private running = false;
  private speed = 1;
  private beatsPerSecond = 0;

  private dayPhase = 0.4;
  private daylight = 0.7;
  private weather = "clear";
  private prevWeather = "clear";
  private wasDaytime = true;
  private liveBeavers = 0;

  private listener: ListenerPose = { x: 20, y: 12, z: 30, yaw: 0.8, distance: 34, underwater: 0 };
  private probe: WaterProbe = { wetness: 0, dx: 0, dz: 0, moving: false };
  private readonly entities = new Map<number, EntityState>();
  private readonly queue: QueuedEvent[] = [];
  private readonly pendingUi: SoundGesture[] = [];
  private fireGlow = 0;
  private firePan = 0;
  private waterChurn = 0;
  private lastAlertBeat = -100;
  private alertQueued = false;
  private lastChordIndex = -1;

  constructor(options: ConductorOptions) {
    this.identity = worldMusicIdentity(options.seed);
  }

  setListener(listener: ListenerPose): void {
    this.listener = listener;
  }

  setWaterProbe(probe: WaterProbe): void {
    this.probe = probe;
  }

  /** A new HUD alert appeared — answered with a soft, rate-limited chime. */
  noteAlert(): void {
    this.alertQueued = true;
  }

  /** Immediate interface gestures (they answer the player's finger, not the world's pulse). */
  ui(name: "ui-confirm" | "ui-tool" | "ui-error" | "ui-save" | "ui-toast"): void {
    const scale = activeScale(this.identity, this.dayPhase, this.weather);
    const midi = (degree: number): number => quantizeToScale(degreeToMidi(this.identity.root, scale, degree + 7), this.identity.root, scale);
    const note = (degree: number, at: number, velocity: number): NoteGesture => ({
      kind: "note",
      voice: "pluck",
      beat: at,
      immediate: true,
      midi: midi(degree),
      velocity,
      durBeats: 0.5,
      pan: 0,
      gain: 0.8,
    });
    const sfx = (sfxName: SfxName, intensity: number): SfxGesture => ({
      kind: "sfx",
      name: sfxName,
      beat: 0,
      immediate: true,
      intensity,
      size: 0.5,
      pan: 0,
      gain: 0.8,
    });
    switch (name) {
      case "ui-confirm":
        this.pendingUi.push(note(0, 0, 0.3), note(4, 0.12, 0.34));
        break;
      case "ui-tool":
        this.pendingUi.push(sfx("wood-tap", 0.35), note(2, 0.05, 0.2));
        break;
      case "ui-error":
        this.pendingUi.push(note(1, 0, 0.22), note(0, 0.15, 0.18));
        break;
      case "ui-save":
        this.pendingUi.push(sfx("whoosh", 0.25), note(0, 0.05, 0.25), note(3, 0.2, 0.3));
        break;
      case "ui-toast":
        this.pendingUi.push(note(2, 0, 0.15));
        break;
    }
    // While sound is disabled the pump never drains this list — keep only
    // the latest few so enabling sound never bursts a backlog of clicks.
    if (this.pendingUi.length > 6) this.pendingUi.splice(0, this.pendingUi.length - 6);
  }

  /** Observe one merged frame: queue its events, refresh environment and entity state. Never writes back. */
  ingestFrame(frame: RenderFrame): void {
    const env = frame.environment;
    this.dayPhase = env.dayPhase;
    this.daylight = daylightAmount(env.dayPhase);
    this.weather = env.weatherCondition;
    this.running = !env.paused;
    this.speed = Math.max(0.01, env.speed);
    this.liveBeavers = frame.liveBeavers;
    if (frame.fullSync) {
      this.entities.clear();
      this.queue.length = 0;
    }
    if (frame.dirtyWaterChunks.length > 0) {
      this.waterChurn = Math.min(1, this.waterChurn + frame.dirtyWaterChunks.length * 0.15);
    }
    for (const id of frame.entityRemovals) this.entities.delete(id);
    for (const record of frame.entityUpserts) {
      const previous = this.entities.get(record.id);
      const next: EntityState = { kind: record.kind, activity: record.activity, x: record.x, y: record.y, z: record.z };
      this.entities.set(record.id, next);
      // A beaver breaking the surface is a real, observable splash — the same honest transition the particle system plays.
      if (
        record.kind === "beaver" &&
        previous !== undefined &&
        previous.activity !== "swimming" &&
        record.activity === "swimming"
      ) {
        this.queue.push({
          event: {
            kind: "generic",
            sourceType: "beaver-entered-water",
            tick: frame.tick,
            entityIds: [record.id],
            location: { x: record.x, y: record.y, z: record.z },
          },
        });
      }
    }
    for (const event of frame.events) this.queue.push({ event });
  }

  private spatial(x: number, y: number, z: number, ref: number): { pan: number; gain: number } {
    const dx = x - this.listener.x;
    const dz = z - this.listener.z;
    const dy = y - this.listener.y;
    const dist = Math.sqrt(dx * dx + dz * dz + dy * dy);
    let gain = 1 / (1 + Math.pow(dist / ref, 1.6));
    gain *= 1 - 0.45 * this.listener.underwater;
    if (dist < 0.5) return { pan: 0, gain };
    const rightX = Math.cos(this.listener.yaw);
    const rightZ = -Math.sin(this.listener.yaw);
    const pan = Math.max(-1, Math.min(1, (dx * rightX + dz * rightZ) / Math.max(1, Math.sqrt(dx * dx + dz * dz))));
    return { pan, gain };
  }

  /**
   * Advance the musical clock by real elapsed seconds and compose the
   * lookahead window. Returns everything due since the last call plus the
   * current bed state. Called by the host's scheduler (~every 25–50 ms).
   */
  produce(realDtSeconds: number): ScoreFrame {
    const gestures: SoundGesture[] = [];
    this.beatsPerSecond = this.running ? (this.identity.bpm / 60) * Math.pow(this.speed, 0.35) : 0;
    this.beat += this.beatsPerSecond * Math.max(0, realDtSeconds);
    this.fireGlow = Math.max(0, this.fireGlow - realDtSeconds * 0.05);
    this.waterChurn = Math.max(0, this.waterChurn - realDtSeconds * 0.25);

    const scale = activeScale(this.identity, this.dayPhase, this.weather);

    // 1. Immediate UI gestures, always first.
    gestures.push(...this.pendingUi.splice(0, this.pendingUi.length));

    // 2. World events, quantized onto the grid so the world's percussion lands in time.
    //    Capped per emission: a catastrophe frame (a flood taking five
    //    beavers at once) voices its loudest happenings, not a node flood.
    //    History itself is untouched — this mercy is presentation-only.
    const MAX_EVENTS_PER_PRODUCE = 48;
    const batch = this.queue.splice(0, this.queue.length);
    for (const queued of batch.length > MAX_EVENTS_PER_PRODUCE ? batch.slice(0, MAX_EVENTS_PER_PRODUCE) : batch) {
      const { event } = queued;
      const recipe = recipeFor(event, this.identity);
      const gridPoint = Math.max(this.beat + 0.02, this.generatedUntil);
      const downbeat = Math.ceil(gridPoint * recipe.grid - 1e-9) / recipe.grid;
      const { pan, gain } = this.spatial(event.location.x, event.location.y, event.location.z, AUDIBILITY.event);
      if (gain < 0.1) continue; // honestly out of earshot — not silently dropped from history, just not performed
      if (event.kind === "fire") {
        this.fireGlow = 1;
        this.firePan = pan;
      }
      for (const g of realizeRecipe(recipe, this.identity, scale, downbeat, pan, gain)) gestures.push(g);
    }

    // 3. Alert chime — one soft bell, at most one per eight beats.
    if (this.alertQueued && this.beat - this.lastAlertBeat >= 8) {
      this.alertQueued = false;
      this.lastAlertBeat = this.beat;
      const degree = this.daylight >= 0.5 ? 1 : 2;
      gestures.push({
        kind: "note",
        voice: "bell",
        beat: Math.max(this.beat + 0.02, this.generatedUntil),
        immediate: false,
        midi: quantizeToScale(degreeToMidi(this.identity.root, scale, 7 + degree), this.identity.root, scale),
        velocity: 0.3,
        durBeats: 1.5,
        pan: 0,
        gain: 0.7,
      });
    } else {
      this.alertQueued = false;
    }

    // 4. Generators fill [generatedUntil, beat + HORIZON).
    const windowEnd = Math.max(this.beat + HORIZON_BEATS, this.generatedUntil);
    const firstSlot = Math.ceil(this.generatedUntil - 1e-9);
    for (let slot = firstSlot; slot < windowEnd; slot++) {
      this.generateSlot(slot, scale, gestures);
    }
    this.generatedUntil = Math.max(this.generatedUntil, windowEnd);

    // 5. Weather/day transitions — one-shot motifs on real flips.
    this.composeTransitions(scale, gestures);

    const layers = this.computeLayers();
    const transport: TransportState = {
      bpm: this.identity.bpm,
      beat: this.beat,
      beatsPerSecond: this.beatsPerSecond,
      running: this.running,
    };
    return { gestures, layers, transport };
  }

  /** Every generator that speaks on integer beat slots. All draws are slot-seeded — gapless and reproducible regardless of call timing. */
  private generateSlot(slot: number, scale: readonly number[], out: SoundGesture[]): void {
    if (!this.running) return;
    const storm = this.weather === "storm";
    const raining = this.weather === "rain" || storm;

    // -- rain: the music-box. Each beat a seeded handful of pentatonic droplets. --
    if (raining) {
      const density = storm ? 1 : 0.55;
      const rng = slotRandom(this.identity.worldHash, slot, SALT.rain);
      const expected = density * 2.6;
      let count = Math.floor(expected);
      if (rng() < expected - count) count++;
      for (let i = 0; i < count; i++) {
        const degree = 7 + Math.floor(rng() * 7); // upper field
        out.push({
          kind: "note",
          voice: "droplet",
          beat: slot + rng(),
          immediate: false,
          midi: quantizeToScale(degreeToMidi(this.identity.root, scale, degree), this.identity.root, scale),
          velocity: 0.08 + rng() * 0.16,
          durBeats: 0.2,
          pan: rng() * 1.6 - 0.8,
          gain: 0.55,
        });
      }
    }

    // -- water trickle: the pond's own plinks, panned toward real probed water. --
    {
      const wet = this.probe.wetness;
      const moving = this.probe.moving || this.waterChurn > 0.2;
      const chance = wet * 0.75 + (moving ? 0.25 : 0);
      const rng = slotRandom(this.identity.worldHash, slot, SALT.trickle);
      if (rng() < chance) {
        const waterPan = Math.max(-1, Math.min(1, this.spatial(this.listener.x + this.probe.dx, this.listener.y, this.listener.z + this.probe.dz, 1).pan));
        const degree = 7 + Math.floor(rng() * 5);
        out.push({
          kind: "note",
          voice: "droplet",
          beat: slot + rng() * 0.8,
          immediate: false,
          midi: quantizeToScale(degreeToMidi(this.identity.root, scale, degree), this.identity.root, scale),
          velocity: 0.1 + rng() * 0.14,
          durBeats: 0.25,
          pan: waterPan + (rng() - 0.5) * 0.3,
          gain: Math.min(1, 0.3 + wet * 0.6),
        });
      }
    }

    // -- birdsong by day: seeded phrases, brighter mornings. --
    {
      const density = this.daylight > 0.35 ? this.daylight * (this.weather === "clear" ? 1 : 0.3) : 0;
      const rng = slotRandom(this.identity.worldHash, slot, SALT.bird);
      if (density > 0 && rng() < density * 0.3) {
        const pan = rng() * 1.8 - 0.9;
        const base = 19 + Math.floor(rng() * 5); // high field degrees
        const syllables = 2 + Math.floor(rng() * 4);
        let t = slot + rng() * 0.4;
        let degree = base;
        for (let s = 0; s < syllables; s++) {
          degree += Math.floor(rng() * 3) - 1;
          out.push({
            kind: "note",
            voice: "bird",
            beat: t,
            immediate: false,
            midi: quantizeToScale(degreeToMidi(this.identity.root, scale, degree), this.identity.root, scale),
            velocity: 0.1 + rng() * 0.12,
            durBeats: 0.09 + rng() * 0.07,
            pan,
            gain: 0.5,
          });
          t += 0.09 + rng() * 0.14;
        }
      }
    }

    // -- crickets by night: a per-night ostinato of dry ticks, plus an occasional peep. --
    {
      const density = this.daylight < 0.4 ? (1 - this.daylight) * (this.weather === "clear" ? 1 : 0.45) : 0;
      if (density > 0.1) {
        const rng = slotRandom(this.identity.worldHash, slot, SALT.cricket);
        const pattern = [0, 0.25, 0.5, 0.75];
        for (const step of pattern) {
          if (rng() < 0.62 * density) {
            out.push({
              kind: "note",
              voice: "cricket",
              beat: slot + step + (rng() - 0.5) * 0.03,
              immediate: false,
              midi: 91 + Math.floor(rng() * 8),
              velocity: 0.05 + rng() * 0.07,
              durBeats: 0.05,
              pan: rng() * 1.6 - 0.8,
              gain: 0.42,
            });
          }
        }
        if (rng() < 0.06) {
          out.push({
            kind: "note",
            voice: "cricket",
            beat: slot + rng(),
            immediate: false,
            midi: 88 + Math.floor(rng() * 4),
            velocity: 0.12,
            durBeats: 0.4,
            pan: rng() - 0.5,
            gain: 0.4,
          });
        }
      }
    }

    // -- the colony work-song: one wooden voice per nearby beaver, walking the world's motif over the current chord. --
    if (slot % BEATS_PER_BAR === 0 && this.liveBeavers > 0) {
      const bar = Math.floor(slot / BEATS_PER_BAR);
      const workers = this.nearestBeavers(MOTIF_VOICES);
      const cycleIndex = Math.floor(slot / BEATS_PER_CHORD);
      const chordDegree = this.identity.chordCycle[cycleIndex % this.identity.chordCycle.length]!;
      for (const [index, worker] of workers.entries()) {
        const rng = slotRandom(this.identity.worldHash ^ worker[0], bar, SALT.colony);
        const chance = this.daylight >= 0.4 ? 0.3 : 0.14;
        if (rng() >= chance) continue;
        const personality = (this.identity.worldHash ^ Math.imul(worker[0] + 1, 7919)) % 3 - 1; // -1..1 interval bias
        const phrase = motifPhrase(this.identity, scale, chordDegree + personality, 1);
        const noteCount = 1 + Math.floor(rng() * 3);
        let t = slot + Math.floor(rng() * 3) * 0.5;
        const { pan, gain } = this.spatial(worker[1].x, worker[1].y, worker[1].z, AUDIBILITY.motif);
        for (let n = 0; n < noteCount && n < phrase.length; n++) {
          out.push({
            kind: "note",
            voice: "pluck",
            beat: t,
            immediate: false,
            midi: phrase[(bar + n + index) % phrase.length]!,
            velocity: 0.22 + rng() * 0.18,
            durBeats: 0.5 + rng(),
            pan,
            gain: gain * 0.9,
          });
          t += 0.5 + Math.floor(rng() * 2) * 0.5;
          if (t >= slot + BEATS_PER_BAR) break;
        }
      }
    }

    // -- work rhythms: labor becomes percussion, locked to the grid. --
    {
      const workers = this.activeWorkers(MAX_LOOP_WORKERS);
      for (const [id, state] of workers) {
        const pattern = ACTIVITY_PATTERNS[state.activity];
        if (pattern === undefined) continue;
        const rng = slotRandom(this.identity.worldHash ^ id, slot, SALT.activity);
        const { pan, gain } = this.spatial(state.x, state.y, state.z, AUDIBILITY.loop);
        if (gain < 0.04) continue;
        for (const step of pattern.steps) {
          out.push({
            kind: "sfx",
            name: pattern.sfx,
            beat: slot + step + (rng() - 0.5) * 0.04,
            immediate: false,
            intensity: pattern.intensity * (0.75 + rng() * 0.5),
            size: 0.4 + rng() * 0.3,
            pan,
            gain,
          });
        }
        // Pitched shop-floor music: builders and gnawers knock the current chord tone every fourth beat.
        if ((state.activity === "building" || state.activity === "cutting-tree" || state.activity === "crafting") && slot % 4 === 0) {
          const cycleIndex = Math.floor(slot / BEATS_PER_CHORD);
          const chord = chordFor(this.identity, scale, cycleIndex);
          out.push({
            kind: "note",
            voice: "pluck",
            beat: slot,
            immediate: false,
            midi: chord[1 + ((id + slot) % (chord.length - 1))]! + 12,
            velocity: 0.2,
            durBeats: 0.4,
            pan,
            gain: gain * 0.8,
          });
        }
        // Drinkers add a soft plink every other beat — the pond answering.
        if (state.activity === "drinking" && slot % 2 === 0) {
          out.push({
            kind: "note",
            voice: "droplet",
            beat: slot + 0.5,
            immediate: false,
            midi: quantizeToScale(degreeToMidi(this.identity.root, scale, 9 + (id % 4)), this.identity.root, scale),
            velocity: 0.14,
            durBeats: 0.2,
            pan,
            gain,
          });
        }
      }
    }

    // -- thunder: rare, seeded, enormous. --
    if (storm) {
      const rng = slotRandom(this.identity.worldHash, slot, SALT.thunder);
      if (rng() < 1 / 18) {
        out.push({
          kind: "sfx",
          name: "thunder",
          beat: slot + rng() * 0.5,
          immediate: false,
          intensity: 0.55 + rng() * 0.45,
          size: 0.9,
          pan: rng() * 1.4 - 0.7,
          gain: 0.9,
        });
      }
      if (rng() < 1 / 9) {
        out.push({
          kind: "sfx",
          name: "gust",
          beat: slot + rng(),
          immediate: false,
          intensity: 0.4 + rng() * 0.4,
          size: 0.7,
          pan: rng() * 1.6 - 0.8,
          gain: 0.7,
        });
      }
    } else if (this.weather === "rain") {
      const rng = slotRandom(this.identity.worldHash, slot, SALT.thunder);
      if (rng() < 1 / 22) {
        out.push({
          kind: "sfx",
          name: "gust",
          beat: slot + rng(),
          immediate: false,
          intensity: 0.3 + rng() * 0.3,
          size: 0.6,
          pan: rng() * 1.6 - 0.8,
          gain: 0.55,
        });
      }
    }

    // -- fire crackle while a real burn glows. --
    if (this.fireGlow > 0.05) {
      const rng = slotRandom(this.identity.worldHash, slot, SALT.crackle);
      if (rng() < this.fireGlow * 0.8) {
        out.push({
          kind: "sfx",
          name: "crackle",
          beat: slot + rng(),
          immediate: false,
          intensity: 0.3 + rng() * 0.5,
          size: 0.4 + rng() * 0.3,
          pan: this.firePan + (rng() - 0.5) * 0.4,
          gain: 0.5 * this.fireGlow,
        });
      }
    }
  }

  /** Real environment flips composed as motifs: dawn runs up, dusk runs down, rain arrives with a breath, storms announce, clear skies answer. */
  private composeTransitions(scale: readonly number[], out: SoundGesture[]): void {
    const at = Math.max(this.beat + 0.02, this.generatedUntil);
    if (this.weather !== this.prevWeather) {
      const from = this.prevWeather;
      this.prevWeather = this.weather;
      if (this.weather === "storm") {
        out.push({ kind: "sfx", name: "thunder", beat: at, immediate: false, intensity: 0.85, size: 0.9, pan: 0, gain: 0.85 });
        out.push({ kind: "sfx", name: "gust", beat: at + 0.5, immediate: false, intensity: 0.7, size: 0.8, pan: -0.3, gain: 0.75 });
      } else if (this.weather === "rain" && from === "clear") {
        out.push({ kind: "sfx", name: "whoosh", beat: at, immediate: false, intensity: 0.4, size: 0.6, pan: 0, gain: 0.6 });
      } else if (this.weather === "clear") {
        // the sun breaks: a rising fourth, then the birds answer
        out.push({
          kind: "note", voice: "bell", beat: at, immediate: false,
          midi: quantizeToScale(degreeToMidi(this.identity.root, scale, 7), this.identity.root, scale),
          velocity: 0.3, durBeats: 1, pan: 0, gain: 0.6,
        });
        out.push({
          kind: "note", voice: "bell", beat: at + 1, immediate: false,
          midi: quantizeToScale(degreeToMidi(this.identity.root, scale, 11), this.identity.root, scale),
          velocity: 0.34, durBeats: 1.5, pan: 0, gain: 0.6,
        });
      }
    }
    const isDay = this.daylight >= 0.5;
    if (isDay !== this.wasDaytime) {
      this.wasDaytime = isDay;
      // dawn: ascending the scale home; dusk: descending to rest — five soft bells over two bars.
      const run = isDay ? [0, 2, 4, 7, 9] : [9, 7, 4, 2, 0];
      for (let i = 0; i < run.length; i++) {
        out.push({
          kind: "note",
          voice: "bell",
          beat: at + i,
          immediate: false,
          midi: quantizeToScale(degreeToMidi(this.identity.root, scale, 7 + run[i]!), this.identity.root, scale),
          velocity: 0.22,
          durBeats: 1.2,
          pan: (i - 2) * 0.15,
          gain: 0.5,
        });
      }
    }
  }

  /** The continuous bed mix from real, observed state. */
  private computeLayers(): LayerState {
    const scale = activeScale(this.identity, this.dayPhase, this.weather);
    const cycleIndex = Math.floor(this.beat / BEATS_PER_CHORD);
    const chord = chordFor(this.identity, this.liveBeavers === 0 ? this.identity.family.dark : scale, cycleIndex);
    this.lastChordIndex = cycleIndex;
    const storm = this.weather === "storm";
    const raining = this.weather === "rain" || storm;
    const zoom = Math.max(0, Math.min(1, (this.listener.distance - 6) / 46)); // near..far
    const wet = this.probe.wetness;
    const empty = this.liveBeavers === 0;
    return {
      padGain: (0.1 + 0.08 * (1 - this.daylight) + (storm ? 0.05 : 0)) * (empty ? 0.55 : 1) * (this.running ? 1 : 0.4),
      padBrightness: Math.max(0.12, Math.min(1, 0.3 + 0.5 * this.daylight - (storm ? 0.25 : 0))),
      padChord: chord,
      waterGain: Math.min(1, wet * 0.85 + (this.probe.moving || this.waterChurn > 0.2 ? 0.18 : 0)) * (1 - 0.3 * this.listener.underwater),
      waterCutoff: 0.25 + 0.55 * wet,
      waterTrickle: wet,
      windGain: Math.min(1, 0.08 + zoom * 0.35 + (raining ? 0.2 : 0) + (storm ? 0.35 : 0)),
      windCutoff: 0.2 + 0.4 * zoom + (storm ? 0.3 : 0),
      rainGain: raining ? (storm ? 0.55 : 0.35) : 0,
      fireGain: this.fireGlow * 0.5,
      birdDensity: this.daylight > 0.35 && this.weather === "clear" ? this.daylight : 0,
      cricketDensity: this.daylight < 0.4 ? (1 - this.daylight) * (this.weather === "clear" ? 1 : 0.4) : 0,
      muffle: this.listener.underwater,
    };
  }

  private nearestBeavers(cap: number): Array<[number, EntityState]> {
    const beavers: Array<[number, EntityState, number]> = [];
    for (const [id, state] of this.entities) {
      if (state.kind !== "beaver" || state.activity === "dead") continue;
      const { gain } = this.spatial(state.x, state.y, state.z, AUDIBILITY.motif);
      beavers.push([id, state, gain]);
    }
    beavers.sort((a, b) => b[2] - a[2] || a[0] - b[0]);
    return beavers.slice(0, cap).map(([id, state]) => [id, state]);
  }

  private activeWorkers(cap: number): Array<[number, EntityState]> {
    const workers: Array<[number, EntityState, number]> = [];
    for (const [id, state] of this.entities) {
      if (state.kind !== "beaver" || !(state.activity in ACTIVITY_PATTERNS)) continue;
      const { gain } = this.spatial(state.x, state.y, state.z, AUDIBILITY.loop);
      if (gain >= 0.04) workers.push([id, state, gain]);
    }
    workers.sort((a, b) => b[2] - a[2] || a[0] - b[0]);
    return workers.slice(0, cap).map(([id, state]) => [id, state]);
  }

  /** Debug observability (§3 workflow step 7): the score's live state, inspectable. */
  getDebugState(): Record<string, unknown> {
    return {
      beat: Math.round(this.beat * 100) / 100,
      running: this.running,
      beatsPerSecond: Math.round(this.beatsPerSecond * 1000) / 1000,
      root: this.identity.root,
      family: this.identity.family.id,
      bpm: this.identity.bpm,
      weather: this.weather,
      daylight: Math.round(this.daylight * 100) / 100,
      trackedEntities: this.entities.size,
      queuedEvents: this.queue.length,
      chordIndex: this.lastChordIndex,
      fireGlow: Math.round(this.fireGlow * 100) / 100,
    };
  }
}
