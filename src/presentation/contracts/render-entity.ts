/**
 * RENDER CONTRACT — entities (threejs_layer.md §3.3).
 *
 * A `RenderEntityRecord` is the ONLY shape the renderer may know about a
 * simulated entity: an immutable, JSON-plain projection of exactly the
 * authoritative facts needed to draw and inspect it. It is never a live
 * view into the ECS -- the renderer cannot mutate the simulation through
 * one of these, only re-request fresher ones (Law R1/R6).
 *
 * `position` is the authoritative integer cell (WorldGrid space, Y-up).
 * The renderer converts to local floats at its own boundary and may
 * interpolate visually between records (Law R4) without ever writing back.
 */
export type StableEntityId = number;

/** Mirror of sim entity kinds the 3D layer knows how to draw. Open string on purpose (new kinds must not require a contract edit), but these are the kinds the R1 renderer ships visuals for. */
export type RenderEntityKind = string;

/** Coarse, renderer-facing activity classification -- always derived from REAL components (job kind, locomotion, held items, water depth), never from animation state. Drives which animation the visual controller plays; the animation never drives the sim. */
export type RenderActivity =
  | "idle"
  | "walking"
  | "swimming"
  | "cutting-tree"
  | "hauling"
  | "building"
  | "digging"
  | "crafting"
  | "burying"
  | "eating"
  | "drinking"
  | "sleeping"
  | "dead";

export interface RenderEntityRecord {
  readonly id: StableEntityId;
  readonly kind: RenderEntityKind;
  /** Authoritative cell. Never a renderer-owned transform. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** True while the sim registry considers this entity live. Destroyed entities leave via `removals`, but a corpse kind stays. */
  readonly live: boolean;
  readonly activity: RenderActivity;
  /** Present for beavers: display name from the real Identity component. */
  readonly name?: string;
  /** Present for trees/plants: species id from the real Plant component, plus growth/health fractions for visual variation. */
  readonly speciesId?: string;
  readonly growthFraction?: number;
  readonly healthFraction?: number;
  /** Present for items: the real material id (logs -> wood). */
  readonly materialId?: string;
  readonly massKg?: number;
  /** Stable id of the beaver currently holding this item (real Held component), if any. The renderer attaches the item's visual to the carrier while preserving the item's own identity. */
  readonly heldBy?: StableEntityId;
  /** Present for constructions: real stage + progress for blueprint/partial/complete visuals. */
  readonly constructionKind?: string;
  readonly constructionStatus?: "awaiting-materials" | "awaiting-labor" | "complete" | "cancelled";
  readonly constructionProgress?: number;
  /** Present for dam segments: real height in cells. */
  readonly damHeightCells?: number;
  /** Monotonic per-entity projection revision; the renderer skips GPU work when unchanged. */
  readonly revision: number;
}

export interface RenderEntityPatch {
  readonly upserts: readonly RenderEntityRecord[];
  readonly removals: readonly StableEntityId[];
}
