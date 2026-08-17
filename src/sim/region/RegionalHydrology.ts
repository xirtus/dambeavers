import { RegionMap } from "./RegionMap.js";
import { computeFlowDirections } from "./MacroTerrain.js";

/**
 * P6-03: rivers as a real D8 flow-accumulation network -- the standard
 * real terrain-hydrology algorithm (`computeFlowDirections`, P6-02,
 * reused unmodified) extended with upstream-area accumulation: every
 * cell's accumulation is `1 + sum of every cell that flows into it`,
 * computed by processing cells in DESCENDING elevation order (so every
 * upstream contributor is finalized before it's added downstream --
 * standard D8 accumulation ordering). A cell is a real river cell once
 * its accumulation crosses a threshold; two rivers "merge" exactly where
 * two such upstream chains flow into the same downstream cell (no
 * separate merge-detection needed -- it falls out of the same
 * accumulation array).
 */
export interface RiverNetwork {
  flowDirection: ReadonlyArray<number | undefined>;
  accumulation: Float64Array;
  riverCellIndices: readonly number[];
}

export function computeFlowAccumulation(regionMap: RegionMap, flowDirection: ReadonlyArray<number | undefined>): Float64Array {
  const cellCount = regionMap.sizeX * regionMap.sizeZ;
  const accumulation = new Float64Array(cellCount).fill(1);
  const order = Array.from({ length: cellCount }, (_, i) => i).sort((a, b) => {
    const az = Math.floor(a / regionMap.sizeX);
    const ax = a % regionMap.sizeX;
    const bz = Math.floor(b / regionMap.sizeX);
    const bx = b % regionMap.sizeX;
    return regionMap.elevationAt(bx, bz) - regionMap.elevationAt(ax, az);
  });
  for (const index of order) {
    const downstream = flowDirection[index];
    if (downstream !== undefined) accumulation[downstream] = accumulation[downstream]! + accumulation[index]!;
  }
  return accumulation;
}

/** Fraction of total cell count a cell's own accumulation must reach to count as a real river cell -- plausible, tunable threshold (a small fraction, since most of a region's own upstream area should be "just land," matching real drainage density). */
export const RIVER_ACCUMULATION_FRACTION = 0.02;

export function computeRiverNetwork(regionMap: RegionMap): RiverNetwork {
  const flowDirection = computeFlowDirections(regionMap);
  const accumulation = computeFlowAccumulation(regionMap, flowDirection);
  const threshold = regionMap.sizeX * regionMap.sizeZ * RIVER_ACCUMULATION_FRACTION;
  const riverCellIndices: number[] = [];
  for (let i = 0; i < accumulation.length; i++) {
    if (accumulation[i]! >= threshold) riverCellIndices.push(i);
  }
  return { flowDirection, accumulation, riverCellIndices };
}

export type RiverTermination = "region-edge" | "sink";

/** How a river cell's own flow chain ends -- real classification, not authored per-river metadata: follows `flowDirection` to its terminal cell, then reports whether that cell sits on the region's own boundary (real "flows off the map," a stand-in for a coastline/larger river system this region doesn't itself model) or is an interior local minimum (a real closed basin/lake sink). */
export function classifyTermination(regionMap: RegionMap, flowDirection: ReadonlyArray<number | undefined>, cellIndex: number): RiverTermination {
  let current = cellIndex;
  const visited = new Set<number>();
  while (flowDirection[current] !== undefined && !visited.has(current)) {
    visited.add(current);
    current = flowDirection[current]!;
  }
  const x = current % regionMap.sizeX;
  const z = Math.floor(current / regionMap.sizeX);
  const onEdge = x === 0 || z === 0 || x === regionMap.sizeX - 1 || z === regionMap.sizeZ - 1;
  return onEdge ? "region-edge" : "sink";
}

export function isRiverCell(network: RiverNetwork, x: number, z: number, regionMap: RegionMap): boolean {
  return network.riverCellIndices.includes(z * regionMap.sizeX + x);
}
