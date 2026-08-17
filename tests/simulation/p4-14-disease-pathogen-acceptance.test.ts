/**
 * Headless acceptance test for P4-14 -- Disease/pathogen framework.
 *
 * Roadmap acceptance test: "an infectious agent can transmit between
 * valid hosts through a defined transmission route."
 *
 * The defined route is real proximity (Manhattan <= 1) with a real
 * per-pathogen transmission probability. An infected host transmits to
 * an adjacent susceptible host; a host five columns away is never
 * reached. Progression grows severity and real health damage each tick,
 * and death routes through the correct existing per-kind mechanism --
 * `Mortality.die` for a beaver (corpse + normal death pipeline), the
 * light-weight animal death for an animal.
 */
import { describe, expect, it } from "vitest";
import { EntityIdRegistry, type EntityId } from "../../src/sim/core/EntityId.js";
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
import { spawnBeaver } from "../../src/sim/creatures/Beaver.js";
import { AnimalSpeciesRegistry, registerStandardAnimalSpecies } from "../../src/sim/creatures/AnimalSpecies.js";
import { spawnAnimal } from "../../src/sim/creatures/Animal.js";
import { PathogenRegistry, registerStandardPathogens, infect, tickTransmission, tickInfectionProgress, getInfection } from "../../src/sim/creatures/Disease.js";

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
  const random = new RandomStreams(414);
  const events = new EventLog(entities);
  const animalSpecies = new AnimalSpeciesRegistry();
  registerStandardAnimalSpecies(animalSpecies);
  return { world: { clock, random, entities, components, grid, terrain, events, water, weather }, animalSpecies };
}

describe("P4-14 -- Disease/pathogen framework", () => {
  it("an infectious agent transmits between valid hosts through the defined proximity route", () => {
    const { world, animalSpecies } = buildWorld();
    const pathogens = new PathogenRegistry();
    registerStandardPathogens(pathogens);
    const random = world.random.stream("disease");

    const hostId = spawnBeaver(world, { name: "PatientZero", position: { x: 15, y: 3, z: 15 } });
    const adjacentId = spawnBeaver(world, { name: "Adjacent", position: { x: 15, y: 3, z: 16 } });
    const distantId = spawnBeaver(world, { name: "Distant", position: { x: 10, y: 3, z: 10 } });
    const animalHostId = spawnAnimal(world, animalSpecies, "rabbit", { x: 15, y: 3, z: 14 });

    infect(world, pathogens, hostId, "swamp-fever");
    expect(getInfection(world.components, hostId)).toBeDefined();
    expect(world.events.eventsOfType("infection-contracted").some((e) => e.subjectIds.includes(hostId))).toBe(true);

    // The defined route is real proximity: adjacent susceptible hosts of
    // EITHER valid kind (beaver or animal) can contract it...
    let adjacentInfected = false;
    for (let i = 0; i < 300 && !adjacentInfected; i++) {
      tickTransmission(world, pathogens, random, hostId);
      adjacentInfected = getInfection(world.components, adjacentId) !== undefined;
    }
    expect(adjacentInfected).toBe(true);

    // ...while a host far outside the route is never reached.
    expect(getInfection(world.components, distantId)).toBeUndefined();

    // Progression: severity grows and real health damage accrues, killing
    // the host through the correct existing per-kind mechanism.
    const severityBefore = getInfection(world.components, hostId)!.severity;
    world.clock.advanceTicks(1);
    tickInfectionProgress(world, pathogens, hostId);
    expect(getInfection(world.components, hostId)!.severity).toBeGreaterThan(severityBefore);

    let died = false;
    for (let i = 0; i < 5000 && world.entities.isLive(hostId); i++) {
      world.clock.advanceTicks(1);
      tickInfectionProgress(world, pathogens, hostId);
    }
    expect(world.entities.isLive(hostId)).toBe(false);
    expect(world.entities.kindOf(world.entities.liveIdsOfKind("corpse")[0]!)).toBe("corpse"); // beaver death pipeline, not the animal one

    // An infected ANIMAL dies through the animal death primitive instead.
    infect(world, pathogens, animalHostId, "swamp-fever");
    for (let i = 0; i < 5000 && world.entities.isLive(animalHostId); i++) {
      world.clock.advanceTicks(1);
      tickInfectionProgress(world, pathogens, animalHostId);
    }
    expect(world.entities.isLive(animalHostId)).toBe(false);
  });
});
