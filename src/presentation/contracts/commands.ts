/**
 * RENDER CONTRACT — commands (threejs_layer.md §3.6, Law R3).
 *
 * Every player action is one of these JSON-plain intents. The bridge maps
 * them onto REAL simulation mechanisms (designateTreeCut,
 * designateConstruction, SimulationClock, snapshot/restore). No command
 * ever carries a mutation closure across the boundary -- intents only.
 */
import type { StableEntityId } from "./render-entity.js";

export type PresentationCommand =
  | { readonly type: "designate-tree-cut"; readonly treeId: StableEntityId }
  | { readonly type: "designate-construction"; readonly kind: "wall" | "lodge-segment" | "bridge" | "dam-segment"; readonly x: number; readonly z: number }
  | { readonly type: "pause" }
  | { readonly type: "resume" }
  | { readonly type: "set-speed"; readonly speed: number }
  | { readonly type: "advance-ticks"; readonly ticks: number }
  | { readonly type: "save" }
  | { readonly type: "load"; readonly snapshot: unknown };

export interface CommandResult {
  readonly ok: boolean;
  /** Human-readable rejection reason from the real simulation validation (e.g. "already designated"). */
  readonly message?: string;
  /** E.g. the designation/construction id a designate command created. */
  readonly entityId?: StableEntityId;
}
