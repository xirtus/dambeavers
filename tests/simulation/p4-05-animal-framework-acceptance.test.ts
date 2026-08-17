/**
 * Headless acceptance test for P4-05 -- Animal framework.
 *
 * Roadmap acceptance test: "multiple animal species share general
 * creature/navigation/needs components rather than species-specific AI
 * controllers."
 *
 * Three different species (land, land-predator, aquatic) are spawned and
 * all carry the SAME generic component types the beaver creature model
 * already defined -- `CreatureBody`, `Locomotion`, `Swimmer`, `Needs`,
 * `Health` -- plus ONE shared `Animal` marker holding only a speciesId.
 * No species-specific controller component type exists anywhere.
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
import { CreatureBodyComponent, LocomotionComponent, SwimmerComponent, HealthComponent } from "../../src/sim/creatures/Beaver.js";
import { NeedsComponent } from "../../src/sim/creatures/Needs.js";
import { AnimalSpeciesRegistry, registerStandardAnimalSpecies } from "../../src/sim/creatures/AnimalSpecies.js";
import { spawnAnimal, getAnimal, AnimalComponent, dieAnimal } from "../../src/sim/creatures/Animal.js";
import { ALL_COMPONENT_TYPES } from "../../src/sim/persistence/AllComponentTypes.js";

function buildWorld(): { world: World; animalSpecies: AnimalSpeciesRegistry } {
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
  const random = new RandomStreams(405);
  const events = new EventLog(entities);
  const animalSpecies = new AnimalSpeciesRegistry();
  registerStandardAnimalSpecies(animalSpecies);
  return { world: { clock, random, entities, components, grid, terrain, events, water, weather }, animalSpecies };
}

describe("P4-05 -- Animal framework", () => {
  it("multiple animal species share the general creature/navigation/needs components, not species-specific controllers", () => {
    const { world, animalSpecies } = buildWorld();

    const rabbitId = spawnAnimal(world, animalSpecies, "rabbit", { x: 3, y: 3, z: 3 });
    const foxId = spawnAnimal(world, animalSpecies, "fox", { x: 5, y: 3, z: 5 });
    world.water.setDepth(8, 8, 2);
    const troutId = spawnAnimal(world, animalSpecies, "trout", { x: 8, y: 4, z: 8 });

    for (const id of [rabbitId, foxId, troutId]) {
      expect(world.entities.kindOf(id)).toBe("animal");
      // Every species shares the SAME general component types the beaver
      // model already defined -- never a per-species component type.
      expect(world.components.has(id, CreatureBodyComponent)).toBe(true);
      expect(world.components.has(id, LocomotionComponent)).toBe(true);
      expect(world.components.has(id, SwimmerComponent)).toBe(true);
      expect(world.components.has(id, NeedsComponent)).toBe(true);
      expect(world.components.has(id, HealthComponent)).toBe(true);
      // The only animal-specific state is a shared marker with a speciesId.
      expect(world.components.has(id, AnimalComponent)).toBe(true);
    }
    expect(getAnimal(world.components, rabbitId)!.speciesId).toBe("rabbit");
    expect(getAnimal(world.components, foxId)!.speciesId).toBe("fox");
    expect(getAnimal(world.components, troutId)!.speciesId).toBe("trout");

    // No species-specific controller component type is registered anywhere:
    // the registry holds exactly one shared "animal" component for all three.
    for (const name of ALL_COMPONENT_TYPES.keys()) {
      expect(name).not.toMatch(/rabbit|fox|trout/);
    }

    // Death is the shared light-weight primitive: a real carcass good, no
    // beaver-specific burial machinery.
    const carcassId = dieAnimal(world, rabbitId, "trauma", "plant-matter");
    expect(world.entities.isLive(rabbitId)).toBe(false);
    expect(world.entities.kindOf(carcassId)).toBe("good");
  });
});
