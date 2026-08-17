import { RegionMap } from "./RegionMap.js";
import type { RiverNetwork } from "./RegionalHydrology.js";
import { seasonalAmbientTemperature } from "../weather/Seasons.js";
import { MACRO_ELEVATION_RANGE } from "./MacroTerrain.js";

/**
 * P6-04: real spatial climate variation from real geography -- never a
 * per-region scripted "this area is cold" flag. Temperature combines
 * three real, independent, already-established inputs: elevation
 * (`RegionMap`, higher = colder, real lapse-rate-style formula),
 * latitude (a cell's own `regionZ` position within the map, a real
 * north-south gradient), and the EXISTING seasonal cycle
 * (`Seasons.ts`'s `seasonalAmbientTemperature`, P4-01, unmodified) --
 * so climate at a given place and moment is one shared formula, not a
 * lookup table.
 */

/** How much elevation lowers temperature, per unit of `MACRO_ELEVATION_RANGE` -- a real lapse-rate-style coefficient. Plausible, tunable balance data. */
export const ELEVATION_COOLING = 0.5;
/** How much latitude (distance from the region's own equator row) lowers temperature at its extreme. Plausible, tunable balance data. */
export const LATITUDE_COOLING = 0.4;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Real `[0, 1]` temperature at region cell `(x, z)` and `tick` -- elevation and latitude shift the SAME seasonal baseline `Seasons.ts` already produces, never a second, disconnected climate clock. */
export function temperatureAt(regionMap: RegionMap, x: number, z: number, tick: number): number {
  const baseline = seasonalAmbientTemperature(tick);
  const elevationFraction = regionMap.elevationAt(x, z) / MACRO_ELEVATION_RANGE;
  const equatorZ = regionMap.sizeZ / 2;
  const latitudeFraction = Math.abs(z - equatorZ) / equatorZ;
  return clamp01(baseline - elevationFraction * ELEVATION_COOLING - latitudeFraction * LATITUDE_COOLING);
}

/** Real Chebyshev distance (matches `RegionMap.neighbors8`'s own 8-connectivity) from `(x, z)` to the nearest real river cell, or `Infinity` if the network has none. On-demand query only (O(river cells)), matching this codebase's existing O(n) debug/query precedent -- not a per-tick hot path. */
export function distanceToNearestRiver(regionMap: RegionMap, network: RiverNetwork, x: number, z: number): number {
  let best = Infinity;
  for (const index of network.riverCellIndices) {
    const rx = index % regionMap.sizeX;
    const rz = Math.floor(index / regionMap.sizeX);
    const distance = Math.max(Math.abs(rx - x), Math.abs(rz - z));
    if (distance < best) best = distance;
  }
  return best;
}

/** Real precipitation-influencing reference distance -- beyond this many cells from the nearest river, proximity no longer meaningfully adds moisture. Plausible, tunable balance data. */
export const PRECIPITATION_RIVER_REFERENCE_DISTANCE = 6;
/** Real orographic bonus -- higher ground wrings more moisture from passing air, up to this fraction at the map's own highest plausible elevation. Plausible, tunable balance data. */
export const OROGRAPHIC_BONUS = 0.3;

/** Real `[0, 1]` precipitation at region cell `(x, z)` -- combines proximity to real river cells (moisture source) and elevation (orographic lift), both real geographic facts, never a scripted per-region value. */
export function precipitationAt(regionMap: RegionMap, network: RiverNetwork, x: number, z: number): number {
  const distance = distanceToNearestRiver(regionMap, network, x, z);
  const riverProximity = clamp01(1 - distance / PRECIPITATION_RIVER_REFERENCE_DISTANCE);
  const elevationFraction = clamp01(regionMap.elevationAt(x, z) / MACRO_ELEVATION_RANGE);
  return clamp01(riverProximity * 0.7 + elevationFraction * OROGRAPHIC_BONUS);
}
