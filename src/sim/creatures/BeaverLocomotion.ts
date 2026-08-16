import type { ComponentStore } from "../core/ComponentStore.js";
import type { EntityId } from "../core/EntityId.js";
import type { WorldGrid } from "../world/WorldGrid.js";
import type { TerrainField } from "../world/TerrainField.js";
import type { WaterField, ColumnCoordinate } from "../hydrology/WaterField.js";
import type { MaterialRegistry } from "../materials/Material.js";
import { findPath, edgeCost } from "../navigation/Pathfinding.js";
import { getLocomotion, getSwimmer } from "./Beaver.js";

export type AdvanceOutcome =
  /** `goal` was already the entity's current column; nothing to do. */
  | "already-there"
  /** The entity reached `goal` this call. */
  | "arrived"
  /** The entity is closer to `goal` but did not reach it this call. */
  | "moved"
  /** No route to `goal` exists for this entity's `Swimmer` capability right now (P1-04's `findPath` returned `undefined`) -- e.g. deep water blocking a non-swimmer. Re-calling later after world state changes may succeed. */
  | "unreachable";

export interface AdvanceResult {
  outcome: AdvanceOutcome;
  /** Columns actually advanced this call (0 for "already-there"/"unreachable"). */
  columnsAdvanced: number;
}

/**
 * Moves one beaver up to one call's worth of `Locomotion.speed` budget
 * along the real shortest route to `goal` (P1-04's `findPath`, re-run
 * fresh every call -- no cached route, so a route that becomes blocked or
 * reopens between calls is discovered automatically, same as
 * `findPath`/`edgeCost` themselves). This is a movement PRIMITIVE, not an
 * AI: nothing here decides which beaver should go where or why -- that
 * remains P1-07's job (job/order architecture) once it exists. Calling
 * this repeatedly (e.g. once per simulation tick) with a caller-chosen
 * goal is what "moving" currently means for a beaver.
 *
 * Always advances at least one column when a route exists, however small
 * `speed` is relative to that first edge's cost -- so a beaver slower
 * than a single edge still makes real, visible progress every call rather
 * than stalling forever against the first step. Every subsequent column
 * beyond the first is only taken if it still fits within the remaining
 * budget.
 */
export function advanceTowards(
  grid: WorldGrid,
  terrain: TerrainField,
  water: WaterField,
  materials: MaterialRegistry,
  components: ComponentStore,
  id: EntityId,
  goal: ColumnCoordinate,
): AdvanceResult {
  const locomotion = getLocomotion(components, id);
  if (locomotion === undefined) {
    throw new RangeError(`entity ${id} has no Locomotion component -- cannot advance`);
  }
  const swimmer = getSwimmer(components, id);
  if (swimmer === undefined) {
    throw new RangeError(`entity ${id} has no Swimmer component -- cannot advance`);
  }
  const position = grid.positionOf(id);
  if (position === undefined) {
    throw new RangeError(`entity ${id} has no position in the grid -- cannot advance`);
  }

  const start: ColumnCoordinate = { x: position.x, z: position.z };
  if (start.x === goal.x && start.z === goal.z) {
    return { outcome: "already-there", columnsAdvanced: 0 };
  }

  const path = findPath(grid, terrain, water, materials, start, goal, swimmer);
  if (path === undefined) {
    return { outcome: "unreachable", columnsAdvanced: 0 };
  }

  let spent = 0;
  let lastIndex = 0;
  for (let i = 1; i < path.columns.length; i++) {
    // `path.columns[i - 1] -> path.columns[i]` is a step of `findPath`'s
    // own already-verified-passable route, so `edgeCost` here can never
    // return `undefined`.
    const step = edgeCost(grid, terrain, water, materials, path.columns[i - 1]!, path.columns[i]!, swimmer)!;
    if (i > 1 && spent + step > locomotion.speed) break; // budget exhausted -- stop here, but only after taking the mandatory first step
    spent += step;
    lastIndex = i;
  }

  const landingColumn = path.columns[lastIndex]!;
  // Defined: `landingColumn` is a column `findPath` already proved has
  // real ground (a passable edge landed on it).
  const landingFloor = grid.surfaceY(landingColumn.x, landingColumn.z)!;
  grid.setEntityPosition(id, landingColumn.x, landingFloor + 1, landingColumn.z);

  return {
    outcome: lastIndex === path.columns.length - 1 ? "arrived" : "moved",
    columnsAdvanced: lastIndex,
  };
}
