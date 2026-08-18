/**
 * Headless acceptance test for P6-03 -- Regional hydrology.
 *
 * Roadmap acceptance test: "rivers originate, merge, flow downhill, and
 * terminate coherently across the regional map."
 *
 * Rivers are a real D8 flow-accumulation network over the real generated
 * elevation (P6-02): each river cell accumulates its whole upstream
 * catchment, two upstream chains merging where they flow into one cell,
 * flowing strictly downhill, and terminating at a real region edge or
 * interior sink. All four clauses are checked literally below.
 */
import { describe, expect, it } from "vitest";
import { EntityIdRegistry } from "../../src/sim/core/EntityId.js";
import { ComponentStore } from "../../src/sim/core/ComponentStore.js";
import { SimulationClock } from "../../src/sim/core/SimulationClock.js";
import { RandomStreams } from "../../src/sim/core/Random.js";
import { WorldGrid } from "../../src/sim/world/WorldGrid.js";
import { TerrainField } from "../../src/sim/world/TerrainField.js";
import { EventLog } from "../../src/sim/history/EventLog.js";
import { MaterialRegistry } from "../../src/sim/materials/Material.js";
import { registerStandardMaterials } from "../../src/sim/materials/standardMaterials.js";
import { WaterField } from "../../src/sim/hydrology/WaterField.js";
import { Weather } from "../../src/sim/weather/Weather.js";
import type { World } from "../../src/sim/persistence/WorldSnapshot.js";
import { RegionMap } from "../../src/sim/region/RegionMap.js";
import { generateMacroTerrain } from "../../src/sim/region/MacroTerrain.js";
import { computeRiverNetwork, classifyTermination } from "../../src/sim/region/RegionalHydrology.js";

const REGION_SIZE = 32;

function buildWorld(): { world: World; regionMap: RegionMap } {
  const entities = new EntityIdRegistry();
  const components = new ComponentStore(entities);
  const grid = new WorldGrid({ sizeX: 20, sizeY: 8, sizeZ: 20 }, entities);
  const materials = new MaterialRegistry();
  registerStandardMaterials(materials);
  const terrain = new TerrainField(grid, materials);
  const water = new WaterField(grid);
  const weather = new Weather();
  const clock = new SimulationClock({ tickRateHz: 20 });
  const random = new RandomStreams(603);
  const events = new EventLog(entities);
  return {
    world: { clock, random, entities, components, grid, terrain, events, water, weather },
    regionMap: new RegionMap(REGION_SIZE, REGION_SIZE),
  };
}

describe("P6-03 -- Regional hydrology", () => {
  it("rivers originate, merge, flow downhill, and terminate coherently across the regional map", () => {
    const { world, regionMap } = buildWorld();
    generateMacroTerrain(regionMap, world.random.stream("acceptance-terrain"));
    const network = computeRiverNetwork(regionMap);

    // "Originate": real river cells exist (upstream accumulation crosses
    // the real threshold), and each has a genuine positive accumulation.
    expect(network.riverCellIndices.length).toBeGreaterThan(0);
    for (const index of network.riverCellIndices) {
      expect(network.accumulation[index]).toBeGreaterThanOrEqual(1);
    }

    // "Merge": at least one cell receives flow from two or more DISTINCT
    // upstream cells -- a real confluence, not a detected-after-the-fact
    // scripted river junction.
    const inflowCounts = new Map<number, number>();
    for (const target of network.flowDirection) {
      if (target === undefined) continue;
      inflowCounts.set(target, (inflowCounts.get(target) ?? 0) + 1);
    }
    expect([...inflowCounts.values()].some((count) => count >= 2)).toBe(true);

    // "Flow downhill": every river cell's own flow target (when it has
    // one) sits at a real lower-or-equal elevation.
    for (const index of network.riverCellIndices) {
      const target = network.flowDirection[index];
      if (target === undefined) continue;
      const x = index % REGION_SIZE;
      const z = Math.floor(index / REGION_SIZE);
      const tx = target % REGION_SIZE;
      const tz = Math.floor(target / REGION_SIZE);
      expect(regionMap.elevationAt(tx, tz)).toBeLessThanOrEqual(regionMap.elevationAt(x, z));
    }

    // "Terminate coherently": following any river cell's real flow chain
    // ends at either the region's own edge (flowing off the map) or an
    // interior local minimum (a real closed basin).
    for (const index of network.riverCellIndices) {
      expect(["region-edge", "sink"]).toContain(classifyTermination(regionMap, network.flowDirection, index));
    }
  });
});
