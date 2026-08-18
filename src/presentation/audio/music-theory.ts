/**
 * GENERATIVE SCORE — musical identity and theory (ARCHITECTURE_CONTRACT §26).
 *
 * Every world has a musical soul derived deterministically from its seed:
 * a root, a mode family (a bright day scale and a dark night scale), a
 * breathing tempo, a four-chord pastoral cycle, and a five-step "colony
 * motif" contour. Two worlds with different seeds genuinely sound
 * different; one world always sounds like itself.
 *
 * The palette is pentatonic-first because the score's contract with the
 * player is that ANY simultaneous combination of generative voices —
 * rain droplets, work knocks, bird calls, the colony motif — must
 * harmonize. Pentatonic fields make emergent polyphony consonant by
 * construction, the same trick as wind chimes and koto improvisation.
 *
 * Pure and headless: no DOM, no node, no three. Presentation may depend
 * on nothing here but math.
 */

/** Deterministic string -> uint32 hash (FNV-1a), same recipe as the sim's seed normalization so a world's music matches its world. */
export function hashString(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32 — tiny deterministic PRNG for score-side choices. Score randomness is presentation (Law 1.8: render nondeterminism is irrelevant), but seeding it makes the score reproducible and testable. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}

/** A stable per-(world, slot, generator) draw: the backbone of gapless generative scheduling — every beat slot's musical dice are a pure function of the world seed and the slot index, never of wall-clock call timing. */
export function slotRandom(worldHash: number, slot: number, salt: number): () => number {
  return mulberry32((worldHash ^ Math.imul(slot + 1, 0x9e3779b9) ^ Math.imul(salt + 1, 0x85ebca6b)) >>> 0);
}

/** Pentatonic interval sets (semitones from root). Bright = day, dark = night, tense = storm color. */
export interface ModeFamily {
  readonly id: string;
  readonly bright: readonly number[];
  readonly dark: readonly number[];
  readonly tense: readonly number[];
}

/**
 * The mode families, each a coherent landscape:
 *  - grove:  major pentatonic by day, hirajoshi by night — a Japanese garden.
 *  - river:  lydian pentatonic by day, minor pentatonic by night — pastoral Celtic water.
 *  - lodge:  yo (rustic major) by day, insen by night — wooden, hearth-like.
 * Storms borrow the night's flattened-second color in every family.
 */
export const MODE_FAMILIES: readonly ModeFamily[] = [
  { id: "grove", bright: [0, 2, 4, 7, 9], dark: [0, 2, 3, 7, 8], tense: [0, 1, 4, 7, 8] },
  { id: "river", bright: [0, 2, 4, 6, 9], dark: [0, 3, 5, 7, 10], tense: [0, 1, 5, 6, 10] },
  { id: "lodge", bright: [0, 2, 5, 7, 9], dark: [0, 1, 5, 7, 8], tense: [0, 1, 5, 6, 10] },
];

/** Earthy roots a pond civilization might tune its lodge drums to (midi). */
const ROOT_CHOICES = [43, 45, 48, 50, 52, 55] as const; // G2, A2, C3, D3, E3, G3

export interface WorldMusicIdentity {
  /** uint32 hash of the world seed — the source of every stable musical draw. */
  readonly worldHash: number;
  /** Tonic midi note (low, earthy). */
  readonly root: number;
  readonly family: ModeFamily;
  /** Resting tempo in beats per minute — a walking-beaver andante. */
  readonly bpm: number;
  /** Four chord roots as scale-degree indices into the bright scale — the slow pastoral cycle the pad breathes through (one chord per two bars). */
  readonly chordCycle: readonly number[];
  /** Five-step melodic contour in scale steps (the colony's little work-song; births rise with it, laments fall). */
  readonly motif: readonly number[];
  /** Per-world timbre tilt: where the wooden plucks sit (0 = duller/softer, 1 = brighter/harder). */
  readonly brightness: number;
}

export function worldMusicIdentity(seed: string | number): WorldMusicIdentity {
  const worldHash = typeof seed === "string" ? hashString(seed) : seed >>> 0;
  const rng = mulberry32(worldHash ^ 0x51ab3e);
  const root = ROOT_CHOICES[Math.floor(rng() * ROOT_CHOICES.length)]!;
  const family = MODE_FAMILIES[Math.floor(rng() * MODE_FAMILIES.length)]!;
  const bpm = 58 + Math.floor(rng() * 14); // 58..71
  // A gentle cycle of four degrees: start on home, visit the soft fourth,
  // the low second, rest on the third — seeded permutations keep each
  // world's drift its own while every stop stays diatonic.
  const base = [0, 3, 1, 4];
  for (let i = base.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = base[i]!;
    base[i] = base[j]!;
    base[j] = tmp;
  }
  base[0] = 0; // always begin at home — the pond is home
  const motif: number[] = [];
  for (let i = 0; i < 5; i++) motif.push(Math.floor(rng() * 5) - 2); // -2..+2 scale steps
  return { worldHash, root, family, bpm, chordCycle: base, motif, brightness: rng() };
}

/** Which scale is active right now: storms always color-tense; otherwise day/night blend by phase with soft dawn/dusk shoulders. */
export function activeScale(identity: WorldMusicIdentity, dayPhase: number, weatherCondition: string): readonly number[] {
  if (weatherCondition === "storm") return identity.family.tense;
  // Daylight centered on phase 0.5 (noon); night wraps around midnight.
  const daylight = Math.max(0, Math.min(1, (Math.cos((dayPhase - 0.5) * 2 * Math.PI) + 1) / 2 * 1.4 - 0.2));
  return daylight >= 0.5 ? identity.family.bright : identity.family.dark;
}

/** How "bright" the current moment is 0..1 — drives pad openness and timbre, smooth across dawn/dusk. */
export function daylightAmount(dayPhase: number): number {
  return Math.max(0, Math.min(1, (Math.cos((dayPhase - 0.5) * 2 * Math.PI) + 1) / 2 * 1.4 - 0.2));
}

/** Snap a midi note to the nearest in-scale tone (ties round upward — the optimistic choice). */
export function quantizeToScale(midi: number, root: number, scale: readonly number[]): number {
  const rel = midi - root;
  const octave = Math.floor(rel / 12);
  const within = rel - octave * 12;
  let bestTone = scale[0]!;
  let bestDist = Infinity;
  for (const tone of scale) {
    for (const candidate of [tone, tone + 12, tone - 12]) {
      const dist = Math.abs(candidate - within);
      if (dist < bestDist) {
        bestDist = dist;
        bestTone = candidate;
      }
    }
  }
  return root + octave * 12 + bestTone;
}

/** Midi of a scale degree (negative/large degrees wrap across octaves). */
export function degreeToMidi(root: number, scale: readonly number[], degree: number): number {
  const n = scale.length;
  const octave = Math.floor(degree / n);
  const idx = ((degree % n) + n) % n;
  return root + octave * 12 + scale[idx]!;
}

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * The chord for cycle position `cycleIndex`: root a twelfth below the
 * motif register, plus fifth and octave, plus a color tone (the scale's
 * second degree by day, flattened second at night/storm) — an open,
 * spacious pastoral sonority, never a triad-clunk.
 */
export function chordFor(identity: WorldMusicIdentity, scale: readonly number[], cycleIndex: number): number[] {
  const degree = identity.chordCycle[((cycleIndex % identity.chordCycle.length) + identity.chordCycle.length) % identity.chordCycle.length]!;
  const rootMidi = degreeToMidi(identity.root, scale, degree);
  const fifth = quantizeToScale(rootMidi + 7, identity.root, scale);
  const color = degreeToMidi(identity.root, scale, degree + 1); // gentle 2nd/9th color
  return [rootMidi - 12, rootMidi, fifth, rootMidi + 12, color + 12];
}

/** The world's little work-song: absolute midi contour from the motif, in the register of the colony plucks. */
export function motifPhrase(identity: WorldMusicIdentity, scale: readonly number[], startDegree: number, registerOctave: number): number[] {
  let degree = startDegree;
  const out: number[] = [];
  for (const step of identity.motif) {
    degree += step;
    out.push(degreeToMidi(identity.root, scale, degree) + registerOctave * 12);
  }
  return out;
}
