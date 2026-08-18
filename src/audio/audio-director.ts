/**
 * Audio director (ARCHITECTURE_CONTRACT §26): the host between the pure
 * conductor and the instruments. It owns the scheduler (a small lookahead
 * pump), the listener model (the player's ear IS the real camera), the
 * water probe (real bridge cell inspections around the camera — babble
 * and muffle come from true water state, never guessed), alert watching,
 * the backend fan-out (WebAudio synth, OSC bridge, Web MIDI), and the
 * mixer. Like every presentation system here it OBSERVES the bridge; it
 * holds no sim reference and writes nothing back.
 */
import { Conductor } from "../presentation/audio/conductor.js";
import type { AudioBackend, MixState } from "../presentation/audio/backend.js";
import type { RenderFrame } from "../presentation/contracts/render-frame.js";
import type { SimBridge } from "../presentation/bridge/sim-bridge.js";
import type { LayerPatch, ListenerPose, SoundGesture, TransportState, WaterProbe } from "../presentation/audio/sound-gesture.js";

export interface ListenerProvider {
  (): { x: number; y: number; z: number; yaw: number; distance: number };
}

export interface AudioDirectorOptions {
  readonly seed: string | number;
  readonly bridge: SimBridge;
  readonly listener: ListenerProvider;
}

const PUMP_MS = 30;
const MAX_DT_SECONDS = 0.1;
const LAYER_EPSILON = 0.015;

export class AudioDirector {
  readonly conductor: Conductor;
  private readonly backends = new Map<string, AudioBackend>();
  private readonly enabled = new Set<string>();
  private pumpTimer: ReturnType<typeof setInterval> | undefined;
  private lastPump = 0;
  private lastAlertSignature = "";
  private alertCheckAccum = 0;
  private probeAccum = 0;
  private probe: WaterProbe = { wetness: 0, dx: 0, dz: 0, moving: false };
  private churnGlow = 0;
  private mix: MixState = { master: 0.9, music: 0.9, ambience: 0.9, sfx: 1, ui: 0.9 };
  private lastSentLayers = new Map<string, LayerPatch>();
  private startedAt = 0;
  private lastTransport: TransportState | undefined;
  private fullLayers: LayerPatch = {};
  /** Total gestures the pump has emitted since start — smoke-test and panel observability. */
  private emittedGestures = 0;

  constructor(private readonly options: AudioDirectorOptions) {
    this.conductor = new Conductor({ seed: options.seed });
  }

  registerBackend(backend: AudioBackend): void {
    this.backends.set(backend.name, backend);
  }

  backendNames(): string[] {
    return [...this.backends.keys()];
  }

  isBackendEnabled(name: string): boolean {
    return this.enabled.has(name);
  }

  async setBackendEnabled(name: string, on: boolean): Promise<void> {
    const backend = this.backends.get(name);
    if (backend === undefined) return;
    if (on && !this.enabled.has(name)) {
      this.enabled.add(name);
      try {
        await backend.start();
      } catch (error) {
        // A failed instrument (no MIDI device, denied permission, blocked
        // AudioContext) rolls back cleanly — the rest of the ensemble plays on.
        this.enabled.delete(name);
        throw error;
      }
      // A joining instrument receives the full continuous state at once.
      if (this.lastTransport !== undefined) backend.setTransport(this.lastTransport);
      backend.applyLayers(this.fullLayers, this.nowSec());
    } else if (!on && this.enabled.delete(name)) {
      backend.stop();
    }
  }

  setMix(mix: Partial<MixState>): void {
    Object.assign(this.mix, mix);
    try {
      globalThis.localStorage?.setItem("damn-beavers-mix", JSON.stringify(this.mix));
    } catch {
      // storage may be unavailable; the mix simply stays session-local
    }
    for (const name of this.enabled) {
      const backend = this.backends.get(name) as { setMix?: (m: MixState) => void } | undefined;
      backend?.setMix?.(this.mix);
    }
  }

  getMix(): MixState {
    return { ...this.mix };
  }

  /** Restore a persisted mix (called by the host before the panel renders). */
  restoreMix(): void {
    try {
      const raw = globalThis.localStorage?.getItem("damn-beavers-mix");
      if (raw !== null && raw !== undefined) this.setMix(JSON.parse(raw) as Partial<MixState>);
    } catch {
      // a corrupt stored mix is ignored — defaults hold
    }
  }

  /** Begin the pump. Idempotent. */
  start(): void {
    if (this.pumpTimer !== undefined) return;
    this.startedAt = performance.now();
    this.lastPump = performance.now();
    this.pumpTimer = setInterval(() => this.pump(), PUMP_MS);
  }

  stop(): void {
    if (this.pumpTimer !== undefined) clearInterval(this.pumpTimer);
    this.pumpTimer = undefined;
  }

  get running(): boolean {
    return this.pumpTimer !== undefined;
  }

  /** The render loop hands every merged frame here — the score's whole view of the world. */
  handleMergedFrame(frame: RenderFrame): void {
    this.conductor.ingestFrame(frame);
    if (frame.dirtyWaterChunks.length > 0) this.churnGlow = Math.min(1, this.churnGlow + 0.3);
  }

  uiSound(name: "ui-confirm" | "ui-tool" | "ui-error" | "ui-save" | "ui-toast"): void {
    this.conductor.ui(name);
  }

  private nowSec(): number {
    return performance.now() / 1000;
  }

  private pump(): void {
    const now = performance.now();
    const dt = Math.min(MAX_DT_SECONDS, Math.max(0, (now - this.lastPump) / 1000));
    this.lastPump = now;

    // Listener + water probe at a gentle cadence (bridge queries, not per-pump).
    this.probeAccum += dt;
    this.churnGlow = Math.max(0, this.churnGlow - dt * 0.5);
    if (this.probeAccum >= 0.25) {
      this.probeAccum = 0;
      this.updateListener();
    }

    // Alert watching: a NEW alert line chimes once.
    this.alertCheckAccum += dt;
    if (this.alertCheckAccum >= 0.5) {
      this.alertCheckAccum = 0;
      const alerts = this.options.bridge.alerts();
      const signature = alerts.map((a) => `${a.kind}:${a.entityId}`).join("|");
      if (signature !== this.lastAlertSignature) {
        if (this.lastAlertSignature !== "" && alerts.length > 0) this.conductor.noteAlert();
        this.lastAlertSignature = signature;
      }
    }

    const score = this.conductor.produce(dt);
    this.lastTransport = score.transport;
    this.fullLayers = { ...this.fullLayers, ...score.layers };
    this.emittedGestures += score.gestures.length;

    const enabledBackends = [...this.enabled].map((name) => this.backends.get(name)).filter((b): b is AudioBackend => b !== undefined);
    if (enabledBackends.length === 0) return;

    const nowSec = this.nowSec();
    const bps = Math.max(0.2, score.transport.beatsPerSecond);
    for (const backend of enabledBackends) {
      backend.setTransport(score.transport);
      this.sendLayers(backend, score.layers, nowSec);
      for (const gesture of score.gestures) {
        backend.play(gesture, this.gestureTime(gesture, score.transport.beat, bps, nowSec));
      }
    }
  }

  /** Beat-time → host seconds. Immediate gestures' beat field is an offset from now. */
  private gestureTime(gesture: SoundGesture, beat: number, bps: number, nowSec: number): number {
    if (gesture.immediate) return nowSec + gesture.beat / bps;
    return nowSec + Math.max(0, gesture.beat - beat) / bps;
  }

  /** Layer fan-out with epsilon diffing — continuous truth, minimal chatter (the OSC socket stays quiet unless the world moves). */
  private sendLayers(backend: AudioBackend, layers: LayerPatch, nowSec: number): void {
    const previous = this.lastSentLayers.get(backend.name) ?? {};
    const delta: Record<string, number | readonly number[]> = {};
    let changed = false;
    for (const [key, value] of Object.entries(layers)) {
      if (value === undefined) continue;
      const old = (previous as Record<string, unknown>)[key];
      if (Array.isArray(value)) {
        if (JSON.stringify(old) !== JSON.stringify(value)) {
          delta[key] = value as readonly number[];
          changed = true;
        }
      } else if (typeof old !== "number" || Math.abs((value as number) - old) > LAYER_EPSILON) {
        delta[key] = value as number;
        changed = true;
      }
    }
    const heartbeat = nowSec - (this.lastLayerSendBy(backend.name)) > 2;
    if (!changed && !heartbeat) return;
    this.lastSentLayers.set(backend.name, { ...previous, ...delta } as LayerPatch);
    this.markLayerSend(backend.name, nowSec);
    backend.applyLayers(delta, nowSec);
  }

  private readonly layerSendTimes = new Map<string, number>();
  private lastLayerSendBy(name: string): number {
    return this.layerSendTimes.get(name) ?? -100;
  }
  private markLayerSend(name: string, nowSec: number): void {
    this.layerSendTimes.set(name, nowSec);
  }

  /** The ear is the camera; the water truth is probed from REAL bridge cell inspections around the camera target. */
  private updateListener(): void {
    const pose = this.options.listener();
    const bridge = this.options.bridge;
    // Submersion: is the camera itself below the real water surface?
    let underwater = 0;
    const columnX = Math.floor(pose.x);
    const columnZ = Math.floor(pose.z);
    try {
      const cell = bridge.inspectCell(columnX, columnZ);
      if (cell.waterSurfaceY !== undefined && pose.y < cell.waterSurfaceY) {
        underwater = Math.min(1, (cell.waterSurfaceY - pose.y) / 1.5);
      }
    } catch {
      // a column outside the world reads as dry air
    }
    const listener: ListenerPose = { x: pose.x, y: pose.y, z: pose.z, yaw: pose.yaw, distance: pose.distance, underwater };
    this.conductor.setListener(listener);

    // Wetness around the camera TARGET area (where the player is looking):
    // a small grid of real depth probes; direction of the wettest cell.
    let total = 0;
    let count = 0;
    let bestDepth = 0;
    let bestDx = 0;
    let bestDz = 0;
    const cx = Math.floor(pose.x);
    const cz = Math.floor(pose.z);
    for (let dz = -3; dz <= 3; dz += 2) {
      for (let dx = -3; dx <= 3; dx += 2) {
        try {
          const cell = bridge.inspectCell(cx + dx, cz + dz);
          const depth = cell.waterDepth;
          total += depth;
          count++;
          if (depth > bestDepth) {
            bestDepth = depth;
            bestDx = dx;
            bestDz = dz;
          }
        } catch {
          // outside-world columns stay dry
        }
      }
    }
    const wetness = Math.min(1, total / Math.max(1, count) / 1.2);
    this.probe = { wetness, dx: bestDx, dz: bestDz, moving: this.churnGlow > 0.15 };
    this.conductor.setWaterProbe(this.probe);
  }

  /** Debug observability: score + mixer + backend state for the panel and tests. */
  getDebugState(): Record<string, unknown> {
    return {
      conductor: this.conductor.getDebugState(),
      enabledBackends: [...this.enabled],
      mix: this.mix,
      probe: this.probe,
      running: this.running,
      emittedGestures: this.emittedGestures,
      uptimeSec: Math.round(this.nowSec() - this.startedAt / 1000),
    };
  }
}
