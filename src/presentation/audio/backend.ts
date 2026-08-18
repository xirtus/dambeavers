/**
 * GENERATIVE SCORE — backend contract (ARCHITECTURE_CONTRACT §26).
 *
 * A backend is an INSTRUMENT the conductor's stream is performed on.
 * Implementations: the built-in WebAudio synth (zero install), the OSC
 * bridge client (SuperCollider/Max/Pd), Web MIDI (any DAW/synth). The
 * conductor speaks gestures + layers + transport only; it cannot tell
 * which instruments are listening.
 */
import type { LayerPatch, SoundGesture, TransportState } from "./sound-gesture.js";

export interface AudioBackend {
  readonly name: string;
  /** Called once the user has explicitly enabled sound (browser autoplay policy: WebAudio needs a gesture). */
  start(): void | Promise<void>;
  stop(): void;
  /** Latest musical clock (backends convert beat deltas to their own timing). */
  setTransport(transport: TransportState): void;
  /** Continuous bed targets; `atSec` is the host's performance clock for smoothing. */
  applyLayers(layers: LayerPatch, atSec: number): void;
  /** One gesture; `atSec` is absolute on the host's performance clock (<= now means "immediately"). */
  play(gesture: SoundGesture, atSec: number): void;
}

/** Master section control every backend honors (mixed by the director before fan-out). */
export interface MixState {
  readonly master: number;
  readonly music: number;
  readonly ambience: number;
  readonly sfx: number;
  readonly ui: number;
}
