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

/**
 * P7-03's own "physical inter-site trade flows" (and every later
 * Phase 7 traveller -- migration groups P7-05, raid parties P7-13):
 * a real shortest-cost route between two region cells over the SAME
 * 8-connected travel network `travelCost` prices (P6-09, unmodified --
 * real geography, never a flat hop count). Dijkstra over the region
 * grid; every returned route starts at `from` and ends at `to`, and the
 * empty route means exactly "no path exists between these two cells"
 * (region cells are only disconnected if bounds trap one of them, which
 * in a connected rectangle never happens -- but the contract is real,
 * not assumed).
 */
export function routeBetween(regionMap: RegionMap, from: RegionCoordinate, to: RegionCoordinate): RegionCoordinate[] {
  if (!regionMap.inBounds(from.regionX, from.regionZ)) throw new RangeError(`route origin (${from.regionX}, ${from.regionZ}) is out of bounds`);
  if (!regionMap.inBounds(to.regionX, to.regionZ)) throw new RangeError(`route destination (${to.regionX}, ${to.regionZ}) is out of bounds`);

  const startKey = from.regionZ * regionMap.sizeX + from.regionX;
  const goalKey = to.regionZ * regionMap.sizeX + to.regionX;
  if (startKey === goalKey) return [{ ...from }];

  // Real Dijkstra with a binary-heap-free O(V^2) scan -- region maps are
  // small (tens x tens), and a route lookup is O(sizeX*sizeZ) worst-case,
  // which is the same bound the region layer's own hydrology accepts.
  const total = regionMap.sizeX * regionMap.sizeZ;
  const dist = new Float64Array(total).fill(Infinity);
  const prev = new Int32Array(total).fill(-1);
  const done = new Uint8Array(total);
  dist[startKey] = 0;

  for (let iter = 0; iter < total; iter++) {
    let u = -1;
    let best = Infinity;
    for (let key = 0; key < total; key++) {
      if (done[key] === 0 && dist[key]! < best) {
        best = dist[key]!;
        u = key;
      }
    }
    if (u === -1 || u === goalKey) break;
    done[u] = 1;
    const ux = u % regionMap.sizeX;
    const uz = Math.floor(u / regionMap.sizeX);
    for (const neighbor of regionMap.neighbors8(ux, uz)) {
      const key = neighbor.regionZ * regionMap.sizeX + neighbor.regionX;
      if (done[key] === 1) continue;
      const cost = travelCost(regionMap, { regionX: ux, regionZ: uz }, neighbor);
      const candidate = dist[u]! + cost;
      if (candidate < dist[key]!) {
        dist[key] = candidate;
        prev[key] = u;
      }
    }
  }

  if (!Number.isFinite(dist[goalKey])) return [];
  const route: RegionCoordinate[] = [];
  let key = goalKey;
  while (key !== -1) {
    route.push({ regionX: key % regionMap.sizeX, regionZ: Math.floor(key / regionMap.sizeX) });
    if (key === startKey) break;
    key = prev[key]!;
  }
  route.reverse();
  return route;
}
