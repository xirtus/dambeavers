/**
 * Headless acceptance test for P1-17 — Minimal ecology response.
 *
 * Roadmap acceptance test (DAMN_BEAVERS_MASTER_ROADMAP.md, P1-17):
 *   "persistently flooded dry vegetation declines while suitable wetland
 *   vegetation gains viability."
 *
 * Uses the project's own real, standard plant species (P0-10's
 * `registerStandardPlantSpecies` -- aspen, a real dry-ground specialist,
 * and willow, a real wetland species, unmodified) and a real
 * `WaterField` flood, driven purely through `EcologyResponse.ts`'s
 * `applyVegetationHealthTick` -- the SAME shared formula for both trees,
 * never two separately-scripted outcomes.
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
import type { World } from "../../src/sim/persistence/WorldSnapshot.js";
import { setPlant, getPlant } from "../../src/sim/ecology/Plant.js";
import { PlantSpeciesRegistry } from "../../src/sim/ecology/PlantSpecies.js";
import { registerStandardPlantSpecies } from "../../src/sim/ecology/standardPlantSpecies.js";
import { applyVegetationHealthTick, WETNESS_REFERENCE_DEPTH } from "../../src/sim/ecology/EcologyResponse.js";

const SIZE_X = 10;
const SIZE_Y = 8;
const SIZE_Z = 10;
const ASPEN_AT = { x: 3, z: 3 };
const WILLOW_AT = { x: 6, z: 6 };

function buildWorld(): { world: World; water: WaterField; plantSpecies: PlantSpeciesRegistry } {
  const entities = new EntityIdRegistry();
  const components = new ComponentStore(entities);
  const grid = new WorldGrid({ sizeX: SIZE_X, sizeY: SIZE_Y, sizeZ: SIZE_Z }, entities);
  const materials = new MaterialRegistry();
  registerStandardMaterials(materials);
  const terrain = new TerrainField(grid, materials);
  for (let x = 0; x < SIZE_X; x++) {
    for (let z = 0; z < SIZE_Z; z++) {
      for (let y = 0; y <= 2; y++) terrain.setMaterial(x, y, z, "soil");
    }
  }
  const water = new WaterField(grid);
  const plantSpecies = new PlantSpeciesRegistry();
  registerStandardPlantSpecies(plantSpecies);
  const clock = new SimulationClock({ tickRateHz: 20 });
  const random = new RandomStreams("p1-17-ecology");
  const events = new EventLog(entities);
  const world: World = { clock, random, entities, components, grid, terrain, events };
  return { world, water, plantSpecies };
}

describe("P1-17 acceptance: persistently flooded dry vegetation declines while suitable wetland vegetation gains viability", () => {
  it("holds for the project's own real aspen (dry) and willow (wetland) species under a real, sustained flood", () => {
    const { world, water, plantSpecies } = buildWorld();

    // Both real trees start already established, at identical, middling health.
    const aspen = world.entities.create("tree");
    world.grid.setEntityPosition(aspen, ASPEN_AT.x, world.grid.surfaceY(ASPEN_AT.x, ASPEN_AT.z)! + 1, ASPEN_AT.z);
    setPlant(world.components, aspen, { speciesId: "aspen", ageTicks: 5000, health: 0.6 });

    const willow = world.entities.create("tree");
    world.grid.setEntityPosition(willow, WILLOW_AT.x, world.grid.surfaceY(WILLOW_AT.x, WILLOW_AT.z)! + 1, WILLOW_AT.z);
    setPlant(world.components, willow, { speciesId: "willow", ageTicks: 5000, health: 0.6 });

    // A real, sustained flood covers BOTH sites identically.
    water.setDepth(ASPEN_AT.x, ASPEN_AT.z, WETNESS_REFERENCE_DEPTH * 2);
    water.setDepth(WILLOW_AT.x, WILLOW_AT.z, WETNESS_REFERENCE_DEPTH * 2);

    for (let tick = 0; tick < 300; tick++) {
      world.clock.resume();
      world.clock.advanceTicks(1);

      const aspenPlant = getPlant(world.components, aspen)!;
      const aspenSpecies = plantSpecies.get(aspenPlant.speciesId);
      setPlant(world.components, aspen, applyVegetationHealthTick(aspenPlant, aspenSpecies, water, ASPEN_AT.x, ASPEN_AT.z));

      const willowPlant = getPlant(world.components, willow)!;
      const willowSpecies = plantSpecies.get(willowPlant.speciesId);
      setPlant(world.components, willow, applyVegetationHealthTick(willowPlant, willowSpecies, water, WILLOW_AT.x, WILLOW_AT.z));
    }

    const aspenHealth = getPlant(world.components, aspen)!.health;
    const willowHealth = getPlant(world.components, willow)!.health;

    expect(aspenHealth).toBeLessThan(0.6); // the dry species genuinely declined
    expect(willowHealth).toBeGreaterThan(0.6); // the wetland species genuinely gained viability
    expect(world.entities.isLive(aspen)).toBe(true); // still standing -- declining health, not destruction (out of this task's scope)
    expect(world.entities.isLive(willow)).toBe(true);
  });
});
