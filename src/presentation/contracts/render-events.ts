/**
 * RENDER CONTRACT — event patches (threejs_layer.md §3.1).
 *
 * Coarse, renderer-relevant happenings projected from the real EventLog so
 * the 3D layer can play honest feedback (a felled tree's fall, dust at a
 * dig, a splash) at the real location, in the same tick the sim recorded
 * the cause. Visual effects observe these; they never create them.
 */
import type { StableEntityId } from "./render-entity.js";

export type RenderEventKind =
  | "tree-felled"
  | "log-spawned"
  | "construction-complete"
  | "dam-segment-applied"
  | "item-picked-up"
  | "item-dropped"
  | "death"
  | "generic";

export interface RenderEvent {
  readonly kind: RenderEventKind;
  readonly tick: number;
  readonly entityIds: readonly StableEntityId[];
  /** Authoritative cell the event happened at (EventLog always records one). */
  readonly location: { readonly x: number; readonly y: number; readonly z: number };
}
