/**
 * Headless acceptance test for P4-07 -- Predators and prey.
 *
 * Roadmap acceptance test: "predation emerges from hunger, perception,
 * pursuit, combat, and edible-body systems."
 *
 * A hungry fox perceives the nearest prey through a real nearest-entity
 * query, pursues it with the same generic locomotion beavers use, kills
 * on adjacency (combat), gains real hunger relief, and the prey's body
 * becomes a real physical carcass (edible-body). A fed fox does not
 * hunt; urgency, not a script, drives predation.
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
import { spawnAnimal, getAnimal } from "../../src/sim/creatures/Animal.js";
import { getNeeds, setNeeds } from "../../src/sim/creatures/Needs.js";
import { tickPredation, nearestLivePrey } from "../../src/sim/creatures/Predation.js";

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
  const random = new RandomStreams(407);
  const events = new EventLog(entities);
  const animalSpecies = new AnimalSpeciesRegistry();
  registerStandardAnimalSpecies(animalSpecies);
  return { world: { clock, random, entities, components, grid, terrain, events, water, weather }, materials, animalSpecies };
}

describe("P4-07 -- Predators and prey", () => {
  it("hunger, perception, pursuit, combat, and the edible body each contribute to a real hunt", () => {
    const { world, materials, animalSpecies } = buildWorld();

    // Hunger: a fed fox does not hunt, even with prey right next to it.
    const fedFoxId = spawnAnimal(world, animalSpecies, "fox", { x: 2, y: 3, z: 2 });
    const calmRabbitId = spawnAnimal(world, animalSpecies, "rabbit", { x: 2, y: 3, z: 3 });
    setNeeds(world.components, fedFoxId, { hunger: 0.1, thirst: 0, fatigue: 0, thermalComfort: 1 });
    expect(tickPredation(world.grid, world.terrain, world.water, materials, world.entities, world.components, animalSpecies, world, fedFoxId)).toBe("idle");
    expect(world.entities.isLive(calmRabbitId)).toBe(true);

    // Perception + combat + edible body: a hungry fox with adjacent prey
    // kills it, gains real hunger relief, and a real carcass remains.
    const hungryFoxId = spawnAnimal(world, animalSpecies, "fox", { x: 5, y: 3, z: 5 });
    const preyId = spawnAnimal(world, animalSpecies, "rabbit", { x: 5, y: 3, z: 6 });
    setNeeds(world.components, hungryFoxId, { hunger: 0.9, thirst: 0, fatigue: 0, thermalComfort: 1 });
    expect(nearestLivePrey(world.entities, world.components, world.grid, animalSpecies, hungryFoxId)).toBe(preyId);
    expect(tickPredation(world.grid, world.terrain, world.water, materials, world.entities, world.components, animalSpecies, world, hungryFoxId)).toBe("hunted");
    expect(world.entities.isLive(preyId)).toBe(false);
    expect(getNeeds(world.components, hungryFoxId)!.hunger).toBeLessThan(0.9);
    const carcass = world.entities.liveIdsOfKind("good").find((id) => world.grid.positionOf(id)?.x === 5 && world.grid.positionOf(id)?.z === 6);
    expect(carcass).toBeDefined();

    // Pursuit: a hungry fox with prey out of reach moves toward it through
    // the same generic locomotion beavers use.
    const chasingFoxId = spawnAnimal(world, animalSpecies, "fox", { x: 8, y: 3, z: 8 });
    const distantPreyId = spawnAnimal(world, animalSpecies, "rabbit", { x: 8, y: 3, z: 11 });
    setNeeds(world.components, chasingFoxId, { hunger: 0.9, thirst: 0, fatigue: 0, thermalComfort: 1 });
    expect(getAnimal(world.components, distantPreyId)).toBeDefined();
    const startPosition = world.grid.positionOf(chasingFoxId)!;
    const preyPosition = world.grid.positionOf(distantPreyId)!;
    expect(tickPredation(world.grid, world.terrain, world.water, materials, world.entities, world.components, animalSpecies, world, chasingFoxId)).toBe("pursuing");
    const endPosition = world.grid.positionOf(chasingFoxId)!;
    const startDistance = Math.abs(startPosition.x - preyPosition.x) + Math.abs(startPosition.z - preyPosition.z);
    const endDistance = Math.abs(endPosition.x - preyPosition.x) + Math.abs(endPosition.z - preyPosition.z);
    expect(startDistance).toBeGreaterThan(0); // prey genuinely out of reach
    expect(endDistance).toBeLessThan(startDistance); // pursuit really closes distance
  });
});
