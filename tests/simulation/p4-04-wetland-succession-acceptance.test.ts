/**
 * Headless acceptance test for P4-04 -- Wetland succession.
 *
 * Roadmap acceptance test: "persistent ponding converts ecological
 * suitability toward wetland species."
 *
 * The SAME fitness-weighted species sampler `bestFittingSpecies` is fed
 * the same site twice -- dry, then persistently flooded. The dry site
 * favors the dry-adapted species; the flooded site's suitability shifts
 * toward the wetland species. No second wetland-specific system exists.
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
import { PlantSpeciesRegistry } from "../../src/sim/ecology/PlantSpecies.js";
import { registerStandardPlantSpecies } from "../../src/sim/ecology/standardPlantSpecies.js";
import { bestFittingSpecies } from "../../src/sim/ecology/PlantLifecycle.js";

function buildWorld(): { world: World; plantSpecies: PlantSpeciesRegistry } {
  const entities = new EntityIdRegistry();
  const components = new ComponentStore(entities);
  const grid = new WorldGrid({ sizeX: 20, sizeY: 10, sizeZ: 20 }, entities);
  const materials = new MaterialRegistry();
  registerStandardMaterials(materials);
  const terrain = new TerrainField(grid, materials);
  for (let x = 0; x < 20; x++) for (let z = 0; z < 20; z++) for (let y = 0; y <= 2; y++) terrain.setMaterial(x, y, z, "soil");
  const water = new WaterField(grid);
  const weather = new Weather();
  const clock = new SimulationClock({ tickRateHz: 20 });
  const random = new RandomStreams(404);
  const events = new EventLog(entities);
  const plantSpecies = new PlantSpeciesRegistry();
  registerStandardPlantSpecies(plantSpecies);
  return { world: { clock, random, entities, components, grid, terrain, events, water, weather }, plantSpecies };
}

describe("P4-04 -- Wetland succession", () => {
  it("persistent ponding shifts a site's suitability from dry-adapted toward wetland species", () => {
    const { world, plantSpecies } = buildWorld();
    const random = world.random.stream("wetland");

    // Dry site: the dry-adapted species dominates the real fitness-weighted rolls.
    const dryCounts: Record<string, number> = {};
    for (let i = 0; i < 200; i++) {
      const id = bestFittingSpecies(plantSpecies, world.water, random, 8, 8);
      if (id !== undefined) dryCounts[id] = (dryCounts[id] ?? 0) + 1;
    }
    expect(dryCounts["aspen"] ?? 0).toBeGreaterThan(dryCounts["willow"] ?? 0);

    // Persistent ponding at the SAME site: suitability converts toward the wetland species.
    world.water.setDepth(8, 8, 5);
    const wetCounts: Record<string, number> = {};
    for (let i = 0; i < 200; i++) {
      const id = bestFittingSpecies(plantSpecies, world.water, random, 8, 8);
      if (id !== undefined) wetCounts[id] = (wetCounts[id] ?? 0) + 1;
    }
    expect(wetCounts["willow"] ?? 0).toBeGreaterThan(wetCounts["aspen"] ?? 0);
  });
});
