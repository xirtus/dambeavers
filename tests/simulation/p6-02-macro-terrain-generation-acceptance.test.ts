/**
 * Headless acceptance test for P6-02 -- Macro terrain generation.
 *
 * Roadmap acceptance test: "generated elevation forms coherent drainage
 * basins rather than isolated random heightfields."
 *
 * Elevation comes from real multi-octave bilinearly-interpolated value
 * noise (smooth, correlated -- never independent per-cell randomness), and
 * basins are computed by a real D8 steepest-descent flow algorithm. This
 * test proves coherence: neighboring elevations stay tightly correlated
 * (no isolated random jumps), every cell belongs to exactly one real
 * basin, each basin's cells all really do drain to its one sink, and more
 * than one genuine basin exists across the map.
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
import { generateMacroTerrain, computeFlowDirections, computeDrainageBasins, MACRO_ELEVATION_RANGE } from "../../src/sim/region/MacroTerrain.js";

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
  const random = new RandomStreams(602);
  const events = new EventLog(entities);
  return {
    world: { clock, random, entities, components, grid, terrain, events, water, weather },
    regionMap: new RegionMap(REGION_SIZE, REGION_SIZE),
  };
}

describe("P6-02 -- Macro terrain generation", () => {
  it("generated elevation is coherent (not isolated random cells) and forms real, complete drainage basins", () => {
    const { world, regionMap } = buildWorld();
    generateMacroTerrain(regionMap, world.random.stream("acceptance-terrain"));

    // Coherence: every horizontal neighbor pair differs by far less than
    // the full elevation range -- smooth, correlated terrain, never
    // independent per-cell rolls (which would produce jumps on the order
    // of the full range between neighbors).
    let maxNeighborStep = 0;
    for (let z = 0; z < REGION_SIZE; z++) {
      for (let x = 0; x < REGION_SIZE - 1; x++) {
        maxNeighborStep = Math.max(maxNeighborStep, Math.abs(regionMap.elevationAt(x, z) - regionMap.elevationAt(x + 1, z)));
      }
    }
    expect(maxNeighborStep).toBeLessThan(MACRO_ELEVATION_RANGE / 4);

    // Every cell belongs to exactly one basin; more than one genuine basin
    // exists (a real landscape of several catchments, not one artifact).
    const basins = computeDrainageBasins(regionMap);
    const totalCells = basins.reduce((sum, basin) => sum + basin.cellIndices.length, 0);
    expect(totalCells).toBe(REGION_SIZE * REGION_SIZE);
    expect(basins.length).toBeGreaterThan(1);

    // Coherence of drainage itself: following each cell's real D8 flow
    // direction downhill always terminates at that cell's own basin sink.
    const flowTo = computeFlowDirections(regionMap);
    const sinkOfBasin = new Map<number, number>();
    for (const basin of basins) {
      for (const cellIndex of basin.cellIndices) sinkOfBasin.set(cellIndex, basin.sinkZ * REGION_SIZE + basin.sinkX);
    }
    for (let index = 0; index < REGION_SIZE * REGION_SIZE; index++) {
      let current = index;
      const visited = new Set<number>();
      while (flowTo[current] !== undefined && !visited.has(current)) {
        visited.add(current);
        current = flowTo[current]!;
      }
      expect(current).toBe(sinkOfBasin.get(index));
    }
  });
});
