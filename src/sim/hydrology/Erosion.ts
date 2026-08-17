import type { WorldGrid } from "../world/WorldGrid.js";
import type { TerrainField } from "../world/TerrainField.js";
import type { WaterField, ColumnCoordinate } from "./WaterField.js";
import type { MaterialRegistry } from "../materials/Material.js";
import type { RandomStream } from "../core/Random.js";

/**
 * P4-10: real flow-driven terrain change -- high flow (the same
 * depth/head-difference proxy `WaterPower.ts`'s own `waterWheelPowerOutput`
 * already established for "how much real hydraulic force is here," since
 * `Flow.ts` exposes depth/head, never a per-column velocity field) can
 * remove real `TerrainField` material from a source column and deposit
 * it as real material at a downstream column -- mass-conserving sediment
 * transport (exactly one cell excavated, exactly one cell filled, never
 * material invented or destroyed), through the SAME "real terrain change,
 * `Flow.ts`'s own hydraulics see it automatically next step" mechanism
 * `Dam.ts`/`Gate.ts` already established. Erosion resistance is a real
 * formula over the source material's own `hardness` (soft material erodes
 * faster) -- never a per-material-name branch.
 */

/** Real erosive force at a source column, derived from its own depth and the head difference to a downstream neighbor -- zero for flat or dry water. Plausible, tunable coefficient, deliberately small (erosion should be a slow, cumulative process over many ticks, not visible in one). */
export const EROSION_STRESS_COEFFICIENT = 0.00005;

/**
 * `downstream`'s comparison elevation: its real water surface if it has
 * one, otherwise its real bare ground floor (`WorldGrid.surfaceY`) -- a
 * DRY downstream column is not "the same elevation as the source" (an
 * earlier version of this function substituted the source's OWN surface
 * for a dry downstream, which silently zeroed the head difference for
 * exactly the case with the LARGEST real drop -- water pouring onto dry
 * ground has nothing damming it at all). `grid` is only consulted when
 * the column is genuinely dry.
 */
function downstreamComparisonElevation(grid: WorldGrid, water: WaterField, downstream: ColumnCoordinate): number | undefined {
  const surface = water.waterSurfaceY(downstream.x, downstream.z);
  if (surface !== undefined) return surface;
  return grid.surfaceY(downstream.x, downstream.z);
}

export function erosionStress(grid: WorldGrid, water: WaterField, source: ColumnCoordinate, downstream: ColumnCoordinate): number {
  const sourceSurface = water.waterSurfaceY(source.x, source.z);
  if (sourceSurface === undefined) return 0;
  const downstreamElevation = downstreamComparisonElevation(grid, water, downstream);
  if (downstreamElevation === undefined) return 0;
  const headDiff = Math.max(0, sourceSurface - downstreamElevation);
  return water.depthAt(source.x, source.z) * headDiff * EROSION_STRESS_COEFFICIENT;
}

export type ErosionOutcome = "eroded" | "stable";

/**
 * One tick of possible erosion at `source`, depositing into `downstream`
 * (must be orthogonally adjacent -- real sediment moves to a real
 * physical neighbor, never teleports). Rolls against a real probability
 * (`erosionStress` divided by the source material's own `hardness + 1`,
 * so bare rock genuinely resists far longer than loose sand under
 * identical flow) -- on success, excavates exactly the source's topmost
 * cell and raises exactly one cell of the SAME material at the
 * downstream column's own current surface. No-op (`"stable"`) if the
 * source has no real terrain, no water, or the roll fails.
 */
export function tickErosion(
  grid: WorldGrid,
  terrain: TerrainField,
  water: WaterField,
  materials: MaterialRegistry,
  random: RandomStream,
  source: ColumnCoordinate,
  downstream: ColumnCoordinate,
): ErosionOutcome {
  const sourceY = grid.surfaceY(source.x, source.z);
  if (sourceY === undefined) return "stable";
  const materialId = terrain.materialAt(source.x, sourceY, source.z);
  if (materialId === undefined) return "stable";
  const stress = erosionStress(grid, water, source, downstream);
  if (stress <= 0) return "stable";
  const hardness = materials.get(materialId).hardness;
  const probability = Math.min(1, stress / (hardness + 1));
  if (!random.nextBool(probability)) return "stable";

  terrain.excavate(source.x, sourceY, source.z);
  const downstreamY = grid.surfaceY(downstream.x, downstream.z);
  if (downstreamY !== undefined) {
    terrain.setMaterial(downstream.x, downstreamY + 1, downstream.z, materialId);
  }
  return "eroded";
}
