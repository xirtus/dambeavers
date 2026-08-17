/**
 * Headless acceptance test for P2-07 — Food production loop.
 *
 * Roadmap acceptance test:
 *   "colony can acquire, store, and consume renewable food for at least
 *   one simulated year."
 *
 * The loop is deliberately ordinary: a live, healthy plant-like producer
 * periodically drops real `Food` item entities; the P2-01 stockpile scans
 * material policy and creates ordinary P1-09 haul jobs; a beaver physically
 * carries each item to storage; another beaver consumes the stored item
 * via P1-13 hunger behavior. No invisible food counter, no scripted
 * colony-year success flag, and no direct transfer from source to stomach.
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
import { BASELINE_NEEDS, getNeeds, setNeeds } from "../../src/sim/creatures/Needs.js";
import { tickBeaverNeeds } from "../../src/sim/creatures/BeaverNeeds.js";
import { setPlant } from "../../src/sim/ecology/Plant.js";
import {
  createFoodProducer,
  FOOD_PRODUCTION_YEAR_TICKS,
  tickFoodProducer,
} from "../../src/sim/ecology/FoodProduction.js";
import { createStockpile, generateStockpileHaulJobs, storedItemIds, type StockpilePolicy } from "../../src/sim/logistics/Stockpile.js";
import { getJob } from "../../src/sim/jobs/Job.js";
import { tickHaulJob } from "../../src/sim/labor/Hauling.js";

const ORGANIC_ONLY_POLICY: StockpilePolicy = {
  allowedMaterialCategories: ["organic"],
  allowedMaterialIds: [],
  forbiddenMaterialCategories: [],
  forbiddenMaterialIds: [],
};

function buildFlatWorld(sizeX = 14, sizeY = 8, sizeZ = 14, floor = 2): { world: World; materials: MaterialRegistry; water: WaterField } {
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
  const random = new RandomStreams(1);
  const events = new EventLog(entities);
  return { world: { clock, random, entities, components, grid, terrain, events, water, weather }, materials, water };
}

function spawnAt(world: World, x: number, z: number, name: string): EntityId {
  const floor = world.grid.surfaceY(x, z)!;
  return spawnBeaver(world, { name, position: { x, y: floor + 1, z } });
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
    expect(iterations).toBeLessThan(1_000);
  }
}

function consumeStoredFood(world: World, materials: MaterialRegistry, eater: EntityId, foodId: EntityId): void {
  const profile = getSwimmer(world.components, eater)!;
  setNeeds(world.components, eater, { ...BASELINE_NEEDS, hunger: 0.9 });
  let iterations = 0;
  while (world.entities.isLive(foodId)) {
    const result = tickBeaverNeeds(world.grid, world.terrain, world.water, materials, world.entities, world.components, eater, profile);
    world.clock.advanceTicks(1);
    iterations++;
    expect(result.intent.kind).toBe("seek-food");
    expect(iterations).toBeLessThan(50);
  }
  expect(getNeeds(world.components, eater)!.hunger).toBeLessThan(0.9);
}

describe("P2-07 acceptance: food production loop", () => {
  it("acquires, stores, and consumes renewable physical food across at least one simulated year", () => {
    const { world, materials, water } = buildFlatWorld();
    const stockpileId = createStockpile(world, [{ x: 10, z: 10 }], ORGANIC_ONLY_POLICY);
    const hauler = spawnAt(world, 9, 10, "Hauler");
    const eater = spawnAt(world, 10, 10, "Eater");

    const interval = FOOD_PRODUCTION_YEAR_TICKS / 4;
    const producer = createFoodProducer(world, "tree", { x: 3, z: 3 }, {
      foodMaterialId: "leaves",
      nutritionValue: 0.35,
      massKg: 1,
      productionIntervalTicks: interval,
      nextProductionTick: 0,
    });
    setPlant(world.components, producer, { speciesId: "aspen", ageTicks: FOOD_PRODUCTION_YEAR_TICKS, health: 1 });

    let producedCount = 0;
    let consumedCount = 0;
    for (let dueTick = 0; dueTick <= FOOD_PRODUCTION_YEAR_TICKS; dueTick += interval) {
      if (world.clock.tick < dueTick) world.clock.advanceTicks(dueTick - world.clock.tick);

      const produced = tickFoodProducer(world, producer);
      expect(produced).toHaveLength(1);
      producedCount += produced.length;

      const jobs = generateStockpileHaulJobs(world, materials, stockpileId);
      expect(jobs).toHaveLength(1);
      driveHaulJobs(world, materials, water, hauler, jobs);

      expect(storedItemIds(world, materials, stockpileId)).toContain(produced[0]!);
      consumeStoredFood(world, materials, eater, produced[0]!);
      consumedCount++;
    }

    if (world.clock.tick < FOOD_PRODUCTION_YEAR_TICKS) {
      world.clock.advanceTicks(FOOD_PRODUCTION_YEAR_TICKS - world.clock.tick);
    }

    expect(world.clock.tick).toBeGreaterThanOrEqual(FOOD_PRODUCTION_YEAR_TICKS);
    expect(producedCount).toBe(5);
    expect(consumedCount).toBe(5);
    const storedAfterMeals = storedItemIds(world, materials, stockpileId);
    expect(storedAfterMeals.filter((id) => world.entities.kindOf(id) === "food")).toEqual([]);
    expect(storedAfterMeals.filter((id) => world.entities.kindOf(id) === "refuse")).toHaveLength(5); // P2-09: consumed food now leaves physical waste behind
    expect(world.events.getDebugState().eventTypeCounts).toContainEqual({ eventType: "food-produced", count: 5 });
  });
});
