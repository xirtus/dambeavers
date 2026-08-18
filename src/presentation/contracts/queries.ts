/**
 * RENDER CONTRACT — queries (threejs_layer.md §3.5).
 *
 * Read-only, JSON-plain inspection results. Everything the entity/cell
 * inspector and the flagship "Why?" panel shows flows through here, all of
 * it grounded in the real DebugInspector / CausalExplanation systems.
 */
import type { StableEntityId } from "./render-entity.js";

export interface EntityInspectionView {
  readonly id: StableEntityId;
  readonly kind: string;
  readonly live: boolean;
  readonly position?: { readonly x: number; readonly y: number; readonly z: number };
  readonly name?: string;
  /** Flattened, JSON-plain component dump (type name -> value) for the inspector. */
  readonly components: Readonly<Record<string, unknown>>;
  /** Event-log entries mentioning this entity (oldest first). */
  readonly events: readonly { readonly tick: number; readonly type: string; readonly description: string }[];
}

export interface CellInspectionView {
  readonly x: number;
  readonly z: number;
  readonly groundY?: number;
  readonly material?: string;
  readonly waterDepth: number;
  readonly waterSurfaceY?: number;
  readonly occupantIds: readonly StableEntityId[];
}

export interface ExplanationStepView {
  readonly description: string;
  readonly tick: number;
  readonly location?: { readonly x: number; readonly z: number };
}

export interface ExplanationView {
  /** The question this explanation answers, from the real CausalExplanation. */
  readonly question: string;
  readonly steps: readonly ExplanationStepView[];
}

export interface AlertView {
  readonly kind: string;
  readonly entityId: StableEntityId;
  readonly message: string;
}
