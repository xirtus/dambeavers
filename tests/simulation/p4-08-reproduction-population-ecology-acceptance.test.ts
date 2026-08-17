/**
 * Headless acceptance test for P4-08 -- Reproduction/population ecology.
 *
 * Roadmap acceptance test: "unmanaged animal populations can rise/fall
 * from food, habitat, predation, and reproduction."
 *
 * Population is never a stored counter: it is always derived from live
 * entities. A sufficiently-fed rabbit at suitable habitat reproduces
 * into an open neighbor (rise); a starving animal dies (fall); an
 * underfed animal cannot reproduce (food gate); an aquatic species
 * cannot reproduce without real habitat depth (habitat gate).
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
import { AnimalSpeciesRegistry, registerStandardAnimalSpecies } from "../../src/sim/creatures/AnimalSpecies.js";
import { spawnAnimal } from "../../src/sim/creatures/Animal.js";
import { setNeeds } from "../../src/sim/creatures/Needs.js";
import { attemptAnimalReproduction, tickAnimal } from "../../src/sim/creatures/AnimalPopulation.js";

function buildWorld(): { world: World; materials: MaterialRegistry; animalSpecies: AnimalSpeciesRegistry } {
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
  const random = new RandomStreams(408);
  const events = new EventLog(entities);
  const animalSpecies = new AnimalSpeciesRegistry();
  registerStandardAnimalSpecies(animalSpecies);
  return { world: { clock, random, entities, components, grid, terrain, events, water, weather }, materials, animalSpecies };
}

function population(world: World): number {
  return world.entities.liveIdsOfKind("animal").length;
}

describe("P4-08 -- Reproduction/population ecology", () => {
  it("unmanaged animal populations rise from food/habitat/reproduction and fall from starvation", () => {
    const { world, materials, animalSpecies } = buildWorld();
    const random = world.random.stream("population");

    // Rise: a sufficiently-fed rabbit at suitable habitat reproduces into
    // an open neighbor -- population is derived from live entities, no counter.
    const rabbitId = spawnAnimal(world, animalSpecies, "rabbit", { x: 4, y: 3, z: 4 });
    setNeeds(world.components, rabbitId, { hunger: 0.1, thirst: 0, fatigue: 0, thermalComfort: 1 });
    const before = population(world);
    let offspring = undefined;
    for (let i = 0; i < 10000 && offspring === undefined; i++) {
      offspring = attemptAnimalReproduction(world, animalSpecies, random, rabbitId);
    }
    expect(offspring).toBeDefined();
    expect(population(world)).toBe(before + 1);
    expect(world.entities.kindOf(offspring!)).toBe("animal");

    // Food gate: an underfed animal never reproduces, however many rolls.
    const hungryRabbitId = spawnAnimal(world, animalSpecies, "rabbit", { x: 6, y: 3, z: 6 });
    setNeeds(world.components, hungryRabbitId, { hunger: 0.9, thirst: 0, fatigue: 0, thermalComfort: 1 });
    const hungryBefore = population(world);
    for (let i = 0; i < 2000; i++) attemptAnimalReproduction(world, animalSpecies, random, hungryRabbitId);
    expect(population(world)).toBe(hungryBefore);

    // Habitat gate: an aquatic species cannot reproduce on dry land.
    const troutId = spawnAnimal(world, animalSpecies, "trout", { x: 8, y: 3, z: 8 });
    setNeeds(world.components, troutId, { hunger: 0.1, thirst: 0, fatigue: 0, thermalComfort: 1 });
    const troutBefore = population(world);
    for (let i = 0; i < 2000; i++) attemptAnimalReproduction(world, animalSpecies, random, troutId);
    expect(population(world)).toBe(troutBefore);

    // Fall: sustained starvation kills through the ordinary needs tick.
    const starvingId = spawnAnimal(world, animalSpecies, "rabbit", { x: 10, y: 3, z: 10 });
    setNeeds(world.components, starvingId, { hunger: 0.99, thirst: 0, fatigue: 0, thermalComfort: 1 });
    const fallBefore = population(world);
    let outcome: string = "idle";
    for (let i = 0; i < 100 && outcome !== "starved"; i++) {
      world.clock.advanceTicks(1);
      outcome = tickAnimal(world.grid, world.terrain, world.water, materials, world.entities, world.components, animalSpecies, random, world, starvingId);
    }
    expect(outcome).toBe("starved");
    expect(world.entities.isLive(starvingId)).toBe(false);
    expect(population(world)).toBe(fallBefore - 1);
  });
});
