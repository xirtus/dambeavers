import { describe, expect, it } from "vitest";
import { createWorld } from "../../src/sim/runtime/SimulationRunner.js";
import { generateWatershed } from "../../src/sim/worldgen/WatershedGenerator.js";
import { PlantSpeciesRegistry } from "../../src/sim/ecology/PlantSpecies.js";
import { registerStandardPlantSpecies } from "../../src/sim/ecology/standardPlantSpecies.js";
import { getPlant } from "../../src/sim/ecology/Plant.js";

const DIMS = { sizeX: 41, sizeY: 14, sizeZ: 61 };

function makeSpecies(): PlantSpeciesRegistry {
  const species = new PlantSpeciesRegistry();
  registerStandardPlantSpecies(species);
  return species;
}

describe("generateWatershed input validation", () => {
  it("rejects a grid smaller than the minimum viable dimensions", () => {
    const world = createWorld({ seed: 1, dimensions: { sizeX: 5, sizeY: 5, sizeZ: 5 } });
    expect(() => generateWatershed(world, { species: makeSpecies() })).toThrow(RangeError);
  });

  it("rejects an out-of-range treeDensity", () => {
    const world = createWorld({ seed: 1, dimensions: DIMS });
    expect(() => generateWatershed(world, { species: makeSpecies(), treeDensity: 1.5 })).toThrow(RangeError);
    expect(() => generateWatershed(world, { species: makeSpecies(), treeDensity: -0.1 })).toThrow(RangeError);
  });
});

describe("generateWatershed terrain content", () => {
  it("produces a channel centerline defined for every z", () => {
    const world = createWorld({ seed: 1, dimensions: DIMS });
    const layout = generateWatershed(world, { species: makeSpecies() });
    expect(layout.channelCenterlineX).toHaveLength(DIMS.sizeZ);
    for (const x of layout.channelCenterlineX) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(DIMS.sizeX);
    }
  });

  it("classifies columns into channel, bank, floodplain, and upland -- all four appear", () => {
    const world = createWorld({ seed: 1, dimensions: DIMS });
    const layout = generateWatershed(world, { species: makeSpecies() });
    const seen = new Set<string>();
    for (let x = 0; x < DIMS.sizeX; x++) {
      for (let z = 0; z < DIMS.sizeZ; z++) {
        seen.add(layout.classify(x, z));
      }
    }
    expect(seen).toEqual(new Set(["channel", "bank", "floodplain", "upland"]));
  });

  it("the channel centerline is classified as channel", () => {
    const world = createWorld({ seed: 1, dimensions: DIMS });
    const layout = generateWatershed(world, { species: makeSpecies() });
    for (let z = 0; z < DIMS.sizeZ; z++) {
      expect(layout.classify(layout.channelCenterlineX[z]!, z)).toBe("channel");
    }
  });

  it("every column has soil at the surface and rock (stone) at bedrock", () => {
    const world = createWorld({ seed: 1, dimensions: DIMS });
    generateWatershed(world, { species: makeSpecies() });
    for (const [x, z] of [[0, 0], [20, 30], [40, 60]] as const) {
      const surfaceY = world.grid.surfaceY(x, z)!;
      expect(world.terrain.materialAt(x, surfaceY, z)).toBe("soil");
      expect(world.terrain.materialAt(x, 0, z)).toBe("stone");
    }
  });

  it("the stream source is on the centerline at z=0", () => {
    const world = createWorld({ seed: 1, dimensions: DIMS });
    const layout = generateWatershed(world, { species: makeSpecies() });
    expect(layout.streamSource.z).toBe(0);
    expect(layout.streamSource.x).toBe(layout.channelCenterlineX[0]);
  });

  it("the prospective dam site is a valid, ordered z-range within the map", () => {
    const world = createWorld({ seed: 1, dimensions: DIMS });
    const layout = generateWatershed(world, { species: makeSpecies() });
    expect(layout.prospectiveDamSite.zStart).toBeLessThan(layout.prospectiveDamSite.zEnd);
    expect(layout.prospectiveDamSite.zStart).toBeGreaterThanOrEqual(0);
    expect(layout.prospectiveDamSite.zEnd).toBeLessThan(DIMS.sizeZ);
  });

  it("elevation actually rises with lateral distance from the centerline, and plateaus beyond the upland cap", () => {
    // Every other test in this file walks a path held at a FIXED lateral
    // distance from the centerline (the centerline itself, or a constant
    // bank offset), which cancels the RISE_PER_DISTANCE term to a
    // constant and can never detect it being weakened or removed. This
    // test samples across varying distance specifically to close that gap.
    // A wide sizeX gives comfortable margin so centerX + 20 (well beyond
    // the upland cap distance) always stays in bounds regardless of where
    // this seed's meander happens to place the centerline.
    const wideDims = { sizeX: 101, sizeY: 14, sizeZ: 61 };
    const world = createWorld({ seed: 1, dimensions: wideDims });
    const layout = generateWatershed(world, { species: makeSpecies() });
    const z = 30;
    const centerX = layout.channelCenterlineX[z]!;
    const channelY = world.grid.surfaceY(centerX, z)!;
    const bankY = world.grid.surfaceY(centerX + 4, z)!;
    const floodplainY = world.grid.surfaceY(centerX + 8, z)!;
    const uplandY = world.grid.surfaceY(centerX + 15, z)!; // well beyond the upland cap distance (10)
    const farUplandY = world.grid.surfaceY(centerX + 20, z)!; // even farther -- must plateau, not keep rising

    expect(bankY).toBeGreaterThan(channelY);
    expect(floodplainY).toBeGreaterThan(bankY);
    expect(uplandY).toBeGreaterThan(floodplainY);
    expect(farUplandY).toBe(uplandY); // capped: no further rise past the upland distance cap
  });
});

describe("generateWatershed slope safety across map dimensions", () => {
  it("keeps the per-step channel/bank slope bounded (<=1 cell) for a range of valid sizeY/sizeZ combinations, not just one hardcoded map size", () => {
    const combos = [
      { sizeX: 41, sizeY: 200, sizeZ: 20 }, // tall, short -- the combination that broke the un-derived-from-sizeZ version
      { sizeX: 30, sizeY: 20, sizeZ: 20 },
      { sizeX: 50, sizeY: 25, sizeZ: 25 },
      { sizeX: 41, sizeY: 10, sizeZ: 100 },
    ];
    for (const dims of combos) {
      const world = createWorld({ seed: 1, dimensions: dims });
      const layout = generateWatershed(world, { species: makeSpecies(), treeDensity: 0 });
      let previous: number | undefined;
      for (let z = 0; z < dims.sizeZ; z++) {
        const y = world.grid.surfaceY(layout.channelCenterlineX[z]!, z)!;
        if (previous !== undefined) {
          expect(
            Math.abs(y - previous),
            `dims=${JSON.stringify(dims)} z=${z}: channel step exceeded 1 cell`,
          ).toBeLessThanOrEqual(1);
        }
        previous = y;
      }
    }
  });
});

describe("generateWatershed return-value alias safety", () => {
  it("mutating the returned channelCenterlineX array cannot change classify()'s answers", () => {
    const world = createWorld({ seed: 1, dimensions: DIMS });
    const layout = generateWatershed(world, { species: makeSpecies() });
    const z = 10;
    const realCenterlineX = layout.channelCenterlineX[z]!;
    expect(layout.classify(realCenterlineX, z)).toBe("channel"); // sanity: the real centerline is channel-classified

    // Simulate a caller mutating what it thinks is "its own" copy of the array.
    const mutable = layout.channelCenterlineX as unknown as number[];
    mutable[z] = realCenterlineX + 1000;

    // classify() must still answer based on the generator's own internal
    // state, not the (now-corrupted) value in the returned array -- the
    // REAL centerline column is still classified "channel" even though
    // the returned array no longer says so.
    expect(layout.classify(realCenterlineX, z)).toBe("channel");
  });
});

describe("generateWatershed trees", () => {
  it("spawns at least one tree with treeDensity high enough to guarantee it", () => {
    const world = createWorld({ seed: 1, dimensions: DIMS });
    const layout = generateWatershed(world, { species: makeSpecies(), treeDensity: 1 });
    expect(layout.treeIds.length).toBeGreaterThan(0);
  });

  it("spawns zero trees when treeDensity is 0", () => {
    const world = createWorld({ seed: 1, dimensions: DIMS });
    const layout = generateWatershed(world, { species: makeSpecies(), treeDensity: 0 });
    expect(layout.treeIds).toEqual([]);
  });

  it("never places a tree on a channel column", () => {
    const world = createWorld({ seed: 1, dimensions: DIMS });
    const layout = generateWatershed(world, { species: makeSpecies(), treeDensity: 1 });
    for (const id of layout.treeIds) {
      const pos = world.grid.positionOf(id)!;
      expect(layout.classify(pos.x, pos.z)).not.toBe("channel");
    }
  });

  it("every tree is a real entity with real Plant state and is rooted in soil", () => {
    const world = createWorld({ seed: 1, dimensions: DIMS });
    const layout = generateWatershed(world, { species: makeSpecies(), treeDensity: 1 });
    expect(layout.treeIds.length).toBeGreaterThan(0);
    for (const id of layout.treeIds.slice(0, 20)) {
      expect(world.entities.kindOf(id)).toBe("tree");
      const plant = getPlant(world.components, id);
      expect(plant).toBeDefined();
      expect(plant!.ageTicks).toBe(0);
      const pos = world.grid.positionOf(id)!;
      const below = world.terrain.materialAt(pos.x, pos.y - 1, pos.z);
      expect(below).toBe("soil");
    }
  });
});

describe("generateWatershed determinism", () => {
  it("the same seed produces an identical layout", () => {
    const worldA = createWorld({ seed: "determinism", dimensions: DIMS });
    const worldB = createWorld({ seed: "determinism", dimensions: DIMS });
    const layoutA = generateWatershed(worldA, { species: makeSpecies() });
    const layoutB = generateWatershed(worldB, { species: makeSpecies() });

    expect(layoutB.channelCenterlineX).toEqual(layoutA.channelCenterlineX);
    expect(layoutB.treeIds.length).toBe(layoutA.treeIds.length);
    expect(worldB.terrain.toSnapshot()).toEqual(worldA.terrain.toSnapshot());
    for (let i = 0; i < layoutA.treeIds.length; i++) {
      expect(worldB.grid.positionOf(layoutB.treeIds[i]!)).toEqual(worldA.grid.positionOf(layoutA.treeIds[i]!));
    }
  });

  it("a different seed produces a different channel path", () => {
    const worldA = createWorld({ seed: "seed-a", dimensions: DIMS });
    const worldB = createWorld({ seed: "seed-b", dimensions: DIMS });
    const layoutA = generateWatershed(worldA, { species: makeSpecies() });
    const layoutB = generateWatershed(worldB, { species: makeSpecies() });
    expect(layoutB.channelCenterlineX).not.toEqual(layoutA.channelCenterlineX);
  });
});
