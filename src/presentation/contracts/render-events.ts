/**
 * RENDER CONTRACT — event patches (threejs_layer.md §3.1).
 *
 * Coarse, renderer-relevant happenings projected from the real EventLog so
 * the 3D layer can play honest feedback (a felled tree's fall, dust at a
 * dig, a splash) at the real location, in the same tick the sim recorded
 * the cause. Visual effects observe these; they never create them.
 */
import type { StableEntityId } from "./render-entity.js";

/**
 * Coarse feedback families. The 3D layer branches on a few of these for
 * particle feedback; the audio score (ARCHITECTURE_CONTRACT §26) voices
 * ALL of them. `generic` is the honest fallback: every mapped sim event
 * keeps its exact EventLog type in `sourceType`, so a consumer that wants
 * finer distinction (audio timbre for a storm death vs. a starvation
 * death) reads the real type rather than an ever-growing kind union.
 */
export type RenderEventKind =
  | "tree-felled"
  | "log-spawned"
  | "construction-complete"
  | "dam-segment-applied"
  | "item-picked-up"
  | "item-dropped"
  | "item-moved"
  | "death"
  | "birth"
  | "life-stage"
  | "plant-died"
  | "fire"
  | "food"
  | "social"
  | "fight"
  | "infection"
  | "gate"
  | "generic";

export interface RenderEvent {
  readonly kind: RenderEventKind;
  /**
   * The exact authoritative EventLog event type this was projected from
   * (e.g. "drowning-death", "offspring-born", "plant-ignited"). Never
   * invented: it is the recorded history type string, carried verbatim so
   * fine-grained consumers (the generative score) voice what ACTUALLY
   * happened while coarse consumers (particles) keep branching on `kind`.
   */
  readonly sourceType: string;
  readonly tick: number;
  readonly entityIds: readonly StableEntityId[];
  /** Authoritative cell the event happened at (EventLog always records one). */
  readonly location: { readonly x: number; readonly y: number; readonly z: number };
}
