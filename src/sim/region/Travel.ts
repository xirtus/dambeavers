import type { RegionCoordinate, RegionMap } from "./RegionMap.js";
import { MACRO_ELEVATION_RANGE } from "./MacroTerrain.js";

/**
 * P6-09: real time/cost between two region cells, derived from actual
 * geography -- Chebyshev distance (matching `RegionMap`'s own 8-
 * connectivity) scaled by real elevation-difference terrain difficulty,
 * never a flat per-hop cost. The same "cost scales with a real physical
 * property" discipline `Hauling.ts`'s own `haulSpeedMultiplier` already
 * established at the detailed-simulation scale, applied here at the
 * regional one.
 */
export const TRAVEL_ELEVATION_DIFFICULTY = 1;

export function travelCost(regionMap: RegionMap, from: RegionCoordinate, to: RegionCoordinate): number {
  const distance = Math.max(Math.abs(to.regionX - from.regionX), Math.abs(to.regionZ - from.regionZ));
  const elevationDiff = Math.abs(regionMap.elevationAt(to.regionX, to.regionZ) - regionMap.elevationAt(from.regionX, from.regionZ));
  const difficulty = 1 + (elevationDiff / MACRO_ELEVATION_RANGE) * TRAVEL_ELEVATION_DIFFICULTY;
  return distance * difficulty;
}
