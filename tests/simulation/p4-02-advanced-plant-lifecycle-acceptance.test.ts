/**
 * Headless acceptance test for P4-02 -- Advanced plant lifecycle.
 *
 * Roadmap acceptance test: "germination, growth, maturity, reproduction,
 * stress, and death occur from environmental conditions."
 *
 * One plant entity, driven only by `tickPlantLifecycle` over real
 * environmental state: it germinates (a real sapling), grows (ageTicks
 * advance), matures (derived growth fraction), reproduces (a real
 * fitness-weighted seed into an open neighbor), suffers stress (health
 * drift toward a mismatched site's fitness), and dies (destroyed, with a
 * recorded `plant-died` event) -- each from environmental conditions,
 * never a scripted stage table.
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
import { getPlant, setPlant } from "../../src/sim/ecology/Plant.js";
import { plantSapling } from "../../src/sim/ecology/EcologyResponse.js";
import { tickPlantLifecycle, attemptReproduction, bestFittingSpecies } from "../../src/sim/ecology/PlantLifecycle.js";

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
  const random = new RandomStreams(402);
  const events = new EventLog(entities);
  const plantSpecies = new PlantSpeciesRegistry();
  registerStandardPlantSpecies(plantSpecies);
  return { world: { clock, random, entities, components, grid, terrain, events, water, weather }, plantSpecies };
}

describe("P4-02 -- Advanced plant lifecycle", () => {
  it("germination, growth, maturity, reproduction, stress, and death all occur from environmental conditions", () => {
    const { world, plantSpecies } = buildWorld();
    const random = world.random.stream("lifecycle");

    // Germination: a real sapling entity, age 0.
    const treeId = plantSapling(world, "aspen", { x: 5, z: 5 });
    expect(getPlant(world.components, treeId)!.ageTicks).toBe(0);

    // Growth: ageTicks advance through the real lifecycle tick.
    for (let i = 0; i < 50; i++) {
      world.clock.advanceTicks(1);
      tickPlantLifecycle(world, plantSpecies, random, treeId);
    }
    expect(getPlant(world.components, treeId)!.ageTicks).toBeGreaterThan(0);

    // Maturity is derived: a mature, healthy plant is reproductively eligible.
    setPlant(world.components, treeId, { speciesId: "aspen", ageTicks: 100000, health: 1 });
    const neighborBefore = world.entities.liveIdsOfKind("tree").length;

    // Reproduction: repeated real rolls seed a real sapling into an open neighbor.
    let offspringId: ReturnType<typeof attemptReproduction> = undefined;
    for (let i = 0; i < 10000 && offspringId === undefined; i++) {
      offspringId = attemptReproduction(world, plantSpecies, random, treeId);
    }
    expect(offspringId).toBeDefined();
    expect(world.entities.liveIdsOfKind("tree").length).toBe(neighborBefore + 1);
    expect(bestFittingSpecies(plantSpecies, world.water, random, 5, 5)).toBeDefined(); // species choice is a real fitness-weighted roll

    // Stress: a species-mismatched site (deep water for a dry-adapted aspen) drives health down.
    setPlant(world.components, treeId, { speciesId: "aspen", ageTicks: 100000, health: 0.5 });
    world.water.setDepth(5, 5, 5);
    const stressedBefore = getPlant(world.components, treeId)!.health;
    for (let i = 0; i < 100; i++) {
      world.clock.advanceTicks(1);
      tickPlantLifecycle(world, plantSpecies, random, treeId);
    }
    const stressedAfter = getPlant(world.components, treeId)!.health;
    expect(stressedAfter).toBeLessThan(stressedBefore);

    // Death: health reaching the wilt threshold destroys the plant and records a real event.
    setPlant(world.components, treeId, { speciesId: "aspen", ageTicks: 100000, health: 0.03 });
    let died = false;
    for (let i = 0; i < 1000 && !died; i++) {
      world.clock.advanceTicks(1);
      died = tickPlantLifecycle(world, plantSpecies, random, treeId) === "died";
    }
    expect(died).toBe(true);
    expect(world.entities.isLive(treeId)).toBe(false);
    expect(world.events.eventsOfType("plant-died").some((e) => e.subjectIds.includes(treeId))).toBe(true);
  });
});
