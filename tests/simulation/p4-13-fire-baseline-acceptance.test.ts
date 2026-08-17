/**
 * Headless acceptance test for P4-13 -- Fire baseline.
 *
 * Roadmap acceptance test: "combustible matter can ignite/spread based
 * on temperature/fuel/moisture rather than object category alone."
 *
 * Ignition and spread come from ONE real `fuelReadiness` formula over
 * fuel (real organic wood material + growth fraction), moisture (real
 * site wetness), and temperature (real seasonal ambient) -- never an
 * object-category branch. A dry, mature, warm-season tree ignites and
 * spreads to a neighboring dry tree with a real multi-hop causal chain;
 * the identical tree standing in persistent water never ignites.
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
import { setPlant } from "../../src/sim/ecology/Plant.js";
import { plantSapling } from "../../src/sim/ecology/EcologyResponse.js";
import { tickFire, setBurning, getBurning } from "../../src/sim/ecology/Fire.js";
import { explainEntityHistory } from "../../src/sim/history/EcosystemCausality.js";

function buildWorld(): { world: World; materials: MaterialRegistry; plantSpecies: PlantSpeciesRegistry } {
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
  const random = new RandomStreams(413);
  const events = new EventLog(entities);
  const plantSpecies = new PlantSpeciesRegistry();
  registerStandardPlantSpecies(plantSpecies);
  return { world: { clock, random, entities, components, grid, terrain, events, water, weather }, materials, plantSpecies };
}

describe("P4-13 -- Fire baseline", () => {
  it("combustible matter ignites and spreads from temperature, fuel, and moisture -- never object category alone", () => {
    const { world, materials, plantSpecies } = buildWorld();
    world.clock.advanceTicks(1200); // solar noon: warmest ambient
    const random = world.random.stream("fire");

    // Fuel and moisture: a mature dry tree is combustible; the IDENTICAL
    // tree in persistent water never ignites, however many ticks pass.
    const soakedId = plantSapling(world, "aspen", { x: 16, z: 16 });
    setPlant(world.components, soakedId, { speciesId: "aspen", ageTicks: 100000, health: 1 });
    world.water.setDepth(16, 16, 4);
    for (let i = 0; i < 300; i++) {
      const outcome = tickFire(world, plantSpecies, materials, random, soakedId);
      expect(outcome).toBe("unchanged"); // moisture makes it genuinely non-combustible
      expect(getBurning(world.components, soakedId)).toBeUndefined();
    }

    // Ignition and spread: a dry mature tree ignites, and the burning tree
    // spreads to a dry neighbor, recording a real multi-hop causal chain.
    const neighborIds = [plantSapling(world, "aspen", { x: 12, z: 13 }), plantSapling(world, "aspen", { x: 13, z: 12 })];
    for (const id of neighborIds) setPlant(world.components, id, { speciesId: "aspen", ageTicks: 100000, health: 1 });

    let spread = false;
    for (let attempt = 0; attempt < 60 && !spread; attempt++) {
      const sourceId = plantSapling(world, "aspen", { x: 12, z: 12 });
      setPlant(world.components, sourceId, { speciesId: "aspen", ageTicks: 100000, health: 1 });
      setBurning(world.components, sourceId, { ignitedTick: world.clock.tick });
      world.events.record({ tick: world.clock.tick, eventType: "plant-ignited", subjectIds: [sourceId], location: world.grid.positionOf(sourceId)! });
      for (let i = 0; i < 15 && world.entities.isLive(sourceId) && !spread; i++) {
        world.clock.advanceTicks(1);
        tickFire(world, plantSpecies, materials, random, sourceId);
        spread = neighborIds.some((id) => getBurning(world.components, id) !== undefined);
      }
    }
    expect(spread).toBe(true);

    // The ignition of the neighbor is a recorded, causally-linked event:
    // a real chain walks back from the neighbor to the source's own ignition.
    const ignitedNeighborId = neighborIds.find((id) => getBurning(world.components, id) !== undefined)!;
    const explanation = explainEntityHistory(world, ignitedNeighborId);
    const ignitionExplanation = explanation.find((e) => e.event.eventType === "plant-ignited");
    expect(ignitionExplanation).toBeDefined();
    expect(ignitionExplanation!.causalChain.length).toBeGreaterThan(1);
  });
});
