/**
 * Headless acceptance test for P4-16 -- Ecosystem causality reports.
 *
 * Roadmap acceptance test: "the game can explain a population or
 * vegetation shift using recorded environmental causes."
 *
 * `explainEntityHistory` and `summarizeEcosystemEvents` compose entirely
 * from the existing EventLog primitives: a real multi-hop causal chain
 * explains a tree's fate, and population/vegetation event types are
 * summarized from recorded environmental causes -- no second parallel
 * history mechanism.
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
import { plantSapling } from "../../src/sim/ecology/EcologyResponse.js";
import { spawnBeaver } from "../../src/sim/creatures/Beaver.js";
import { explainEntityHistory, summarizeEcosystemEvents, VEGETATION_EVENT_TYPES, POPULATION_EVENT_TYPES } from "../../src/sim/history/EcosystemCausality.js";

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
  const random = new RandomStreams(416);
  const events = new EventLog(entities);
  const plantSpecies = new PlantSpeciesRegistry();
  registerStandardPlantSpecies(plantSpecies);
  return { world: { clock, random, entities, components, grid, terrain, events, water, weather }, plantSpecies };
}

describe("P4-16 -- Ecosystem causality reports", () => {
  it("recorded environmental causes explain a vegetation shift and summarize population events", () => {
    const { world } = buildWorld();

    // A real vegetation shift: a tree is felled, another dies from its
    // environment -- both recorded facts with real causes.
    const fellerId = spawnBeaver(world, { name: "Feller", position: { x: 5, y: 3, z: 6 } });
    const felledId = plantSapling(world, "aspen", { x: 5, z: 5 });
    world.events.record({ tick: 1, eventType: "tree-felled", subjectIds: [felledId], objectIds: [fellerId], location: { x: 5, y: 3, z: 5 } });
    const diedId = plantSapling(world, "willow", { x: 6, z: 6 });
    const droughtEventId = world.events.record({ tick: 2, eventType: "pond-receded", subjectIds: [], location: { x: 6, y: 3, z: 6 } });
    world.events.record({ tick: 3, eventType: "plant-died", subjectIds: [diedId], location: { x: 6, y: 3, z: 6 }, causeEventId: droughtEventId });

    // The explanation composes from the real event log, walking the
    // recorded cause chain rather than a parallel history table.
    const felledExplanation = explainEntityHistory(world, felledId);
    expect(felledExplanation.some((e) => e.event.eventType === "tree-felled")).toBe(true);

    const diedExplanation = explainEntityHistory(world, diedId);
    const deathExplanation = diedExplanation.find((e) => e.event.eventType === "plant-died");
    expect(deathExplanation).toBeDefined();
    expect(deathExplanation!.causalChain.map((e) => e.eventType)).toContain("pond-receded");

    // Population/vegetation summaries are real counts over the same log.
    const victimA = spawnBeaver(world, { name: "VictimA", position: { x: 1, y: 3, z: 1 } });
    const victimB = spawnBeaver(world, { name: "VictimB", position: { x: 2, y: 3, z: 2 } });
    world.events.record({ tick: 4, eventType: "starvation-death", subjectIds: [victimA], location: { x: 1, y: 3, z: 1 } });
    world.events.record({ tick: 5, eventType: "starvation-death", subjectIds: [victimB], location: { x: 2, y: 3, z: 2 } });
    const vegetationSummary = summarizeEcosystemEvents(world, VEGETATION_EVENT_TYPES, 0);
    const populationSummary = summarizeEcosystemEvents(world, POPULATION_EVENT_TYPES, 0);
    expect(vegetationSummary.find((s) => s.eventType === "tree-felled")?.count).toBe(1);
    expect(vegetationSummary.find((s) => s.eventType === "plant-died")?.count).toBe(1);
    expect(populationSummary.find((s) => s.eventType === "starvation-death")?.count).toBe(2);
  });
});
