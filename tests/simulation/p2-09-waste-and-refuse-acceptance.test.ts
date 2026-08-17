/**
 * Headless acceptance test for P2-09 -- Waste and refuse.
 *
 * Roadmap acceptance test:
 *   "consumption/processing can generate physical refuse that requires
 *   disposal."
 *
 * This scenario uses consumption because stored food already exists at
 * P1-13/P2-07. Eating a real food item leaves a real `"refuse"` entity
 * with material and mass. P2-01 stockpile policy then emits an ordinary
 * P1-09 haul job for that refuse, and a beaver physically moves it to
 * disposal storage through the same hauling state machine used for logs
 * and food.
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
import { spawnBeaver, getSwimmer } from "../../src/sim/creatures/Beaver.js";
import { BASELINE_NEEDS, setNeeds } from "../../src/sim/creatures/Needs.js";
import { tickBeaverNeeds } from "../../src/sim/creatures/BeaverNeeds.js";
import { setFood } from "../../src/sim/labor/Food.js";
import { tickHaulJob } from "../../src/sim/labor/Hauling.js";
import { getJob } from "../../src/sim/jobs/Job.js";
import { createStockpile, generateStockpileHaulJobs, storedItemIds, type StockpilePolicy } from "../../src/sim/logistics/Stockpile.js";
import { getRefuse } from "../../src/sim/logistics/Refuse.js";

const ORGANIC_POLICY: StockpilePolicy = {
  allowedMaterialCategories: ["organic"],
  allowedMaterialIds: [],
  forbiddenMaterialCategories: [],
  forbiddenMaterialIds: [],
};

function buildFlatWorld(sizeX = 12, sizeY = 8, sizeZ = 12, floor = 2): { world: World; materials: MaterialRegistry; water: WaterField } {
  const entities = new EntityIdRegistry();
  const components = new ComponentStore(entities);
  const grid = new WorldGrid({ sizeX, sizeY, sizeZ }, entities);
  const materials = new MaterialRegistry();
  registerStandardMaterials(materials);
  const terrain = new TerrainField(grid, materials);
  for (let x = 0; x < sizeX; x++) {
    for (let z = 0; z < sizeZ; z++) {
      for (let y = 0; y <= floor; y++) terrain.setMaterial(x, y, z, "soil");
    }
  }
  const water = new WaterField(grid);
  const weather = new Weather();
  const clock = new SimulationClock({ tickRateHz: 20 });
  const random = new RandomStreams(209);
  const events = new EventLog(entities);
  return { world: { clock, random, entities, components, grid, terrain, events, water, weather }, materials, water };
}

function spawnAt(world: World, x: number, z: number, name: string): EntityId {
  const floor = world.grid.surfaceY(x, z)!;
  return spawnBeaver(world, { name, position: { x, y: floor + 1, z } });
}

function spawnFood(world: World, x: number, z: number): EntityId {
  const foodId = world.entities.create("food");
  const floor = world.grid.surfaceY(x, z)!;
  world.grid.setEntityPosition(foodId, x, floor + 1, z);
  setFood(world.components, foodId, {
    nutritionValue: 0.5,
    materialId: "plant-matter",
    massKg: 1,
  });
  return foodId;
}

function driveHaulJobs(world: World, materials: MaterialRegistry, water: WaterField, hauler: EntityId, jobIds: EntityId[]): void {
  const profile = getSwimmer(world.components, hauler)!;
  let iterations = 0;
  while (jobIds.some((jobId) => getJob(world.components, jobId)!.status !== "completed")) {
    const outcome = tickHaulJob(world.grid, world.terrain, water, materials, world.entities, world.components, hauler, profile, jobIds);
    world.clock.advanceTicks(1);
    iterations++;
    expect(outcome).not.toBe("failed");
    expect(outcome).not.toBe("requeued");
    expect(iterations).toBeLessThan(500);
  }
}

describe("P2-09 -- Waste and refuse", () => {
  it("consumption generates physical refuse that ordinary hauling disposes into storage", () => {
    const { world, materials, water } = buildFlatWorld();
    const eater = spawnAt(world, 2, 2, "Eater");
    const hauler = spawnAt(world, 2, 2, "Hauler");
    const food = spawnFood(world, 2, 2);
    const disposalStockpile = createStockpile(world, [{ x: 8, z: 8 }], ORGANIC_POLICY);
    setNeeds(world.components, eater, { ...BASELINE_NEEDS, hunger: 0.9 });

    const eatResult = tickBeaverNeeds(world.grid, world.terrain, water, materials, world.entities, world.components, eater, getSwimmer(world.components, eater)!, undefined, { world });

    expect(eatResult.intent.kind).toBe("seek-food");
    expect(world.entities.isLive(food)).toBe(false);
    const [refuseId] = world.entities.liveIdsOfKind("refuse");
    expect(refuseId).toBeDefined();
    expect(getRefuse(world.components, refuseId!)).toMatchObject({
      materialId: "plant-matter",
      origin: "food-consumption",
      sourceEntityId: food,
    });
    expect(world.events.eventsInvolving(refuseId!)[0]!.eventType).toBe("refuse-created");
    expect(world.grid.positionOf(refuseId!)).toEqual(world.grid.positionOf(eater));

    const jobs = generateStockpileHaulJobs(world, materials, disposalStockpile);
    expect(jobs).toHaveLength(1);
    driveHaulJobs(world, materials, water, hauler, jobs);

    expect(storedItemIds(world, materials, disposalStockpile)).toEqual([refuseId]);
    expect(world.grid.positionOf(refuseId!)).toMatchObject({ x: 8, z: 8 });
  });
});
