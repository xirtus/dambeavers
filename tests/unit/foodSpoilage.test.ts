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
import { snapshotWorld, restoreWorld } from "../../src/sim/persistence/WorldSnapshot.js";
import { ALL_COMPONENT_TYPES } from "../../src/sim/persistence/AllComponentTypes.js";
import { getFood, setFood } from "../../src/sim/labor/Food.js";
import { getInventory, spawnBeaver } from "../../src/sim/creatures/Beaver.js";
import { applyTrauma } from "../../src/sim/creatures/Mortality.js";
import { pickUp } from "../../src/sim/labor/Log.js";
import {
  FoodSpoilageComponent,
  foodSpoilageEnvironment,
  getFoodSpoilage,
  getFoodSpoilageDebugState,
  setFoodSpoilage,
  startFoodSpoilage,
  tickAllFoodSpoilage,
  tickFoodSpoilage,
} from "../../src/sim/ecology/FoodSpoilage.js";

function buildFlatWorld(sizeX = 8, sizeY = 8, sizeZ = 8, floor = 2): { world: World; materials: MaterialRegistry; water: WaterField } {
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

function spawnFood(world: World, x: number, z: number, nutritionValue = 0.8): EntityId {
  const foodId = world.entities.create("food");
  const floor = world.grid.surfaceY(x, z)!;
  world.grid.setEntityPosition(foodId, x, floor + 1, z);
  setFood(world.components, foodId, { nutritionValue, materialId: "plant-matter", massKg: 1 });
  startFoodSpoilage(world, foodId);
  return foodId;
}

describe("FoodSpoilage", () => {
  it("decays real Food nutrition as freshness decreases over elapsed ticks", () => {
    const { world, materials } = buildFlatWorld();
    const foodId = spawnFood(world, 3, 3);
    world.clock.advanceTicks(1_000);

    const result = tickFoodSpoilage(world, materials, foodId)!;

    expect(result.elapsedTicks).toBe(1_000);
    expect(result.freshness).toBeLessThan(1);
    expect(result.nutritionValue).toBeCloseTo(0.8 * result.freshness, 10);
    expect(getFood(world.components, foodId)!.nutritionValue).toBeCloseTo(result.nutritionValue, 10);
    expect(world.events.eventsInvolving(foodId).at(-1)!.eventType).toBe("food-decayed");
  });

  it("uses ordinary water exposure as an environmental multiplier, so otherwise identical food decays at different rates", () => {
    const { world, materials, water } = buildFlatWorld();
    const dryFood = spawnFood(world, 2, 2);
    const wetFood = spawnFood(world, 5, 5);
    water.setDepth(5, 5, 1);
    world.clock.advanceTicks(1_000);

    tickAllFoodSpoilage(world, materials);

    expect(getFoodSpoilage(world.components, wetFood)!.freshness).toBeLessThan(getFoodSpoilage(world.components, dryFood)!.freshness);
    expect(getFood(world.components, wetFood)!.nutritionValue).toBeLessThan(getFood(world.components, dryFood)!.nutritionValue);
  });

  it("REGRESSION (P2-08): held food decays using its live holder's real position instead of crashing during hauling", () => {
    const { world, materials, water } = buildFlatWorld();
    const foodId = spawnFood(world, 3, 3);
    const holder = spawnBeaver(world, { name: "Carrier", position: { x: 5, y: world.grid.surfaceY(5, 5)! + 1, z: 5 } });
    pickUp(world.components, world.grid, foodId, holder);
    water.setDepth(5, 5, 1);
    world.clock.advanceTicks(1_000);

    const result = tickFoodSpoilage(world, materials, foodId)!;

    expect(result.environment.waterDepth).toBe(1);
    expect(result.freshness).toBeLessThan(1);
    expect(world.entities.isLive(foodId)).toBe(true);
  });

  it("destroys fully spoiled food and records the terminal spoilage event", () => {
    const { world, materials } = buildFlatWorld();
    const foodId = spawnFood(world, 3, 3);
    setFoodSpoilage(world.components, foodId, {
      freshness: 0.001,
      initialNutritionValue: 0.8,
      lastUpdatedTick: world.clock.tick,
    });
    world.clock.advanceTicks(1_000);

    const result = tickFoodSpoilage(world, materials, foodId)!;

    expect(result.spoiled).toBe(true);
    expect(world.entities.isLive(foodId)).toBe(false);
    expect(world.events.eventsInvolving(foodId).at(-1)!.eventType).toBe("food-spoiled");
  });

  it("REGRESSION (critic-found Moderate, P2-08): fully spoiled held food clears the holder inventory before destruction", () => {
    const { world, materials } = buildFlatWorld();
    const foodId = spawnFood(world, 3, 3);
    const holder = spawnBeaver(world, { name: "Carrier", position: { x: 3, y: world.grid.surfaceY(3, 3)! + 1, z: 3 } });
    pickUp(world.components, world.grid, foodId, holder);
    setFoodSpoilage(world.components, foodId, {
      freshness: 0.001,
      initialNutritionValue: 0.8,
      lastUpdatedTick: world.clock.tick,
    });
    world.clock.advanceTicks(1_000);

    const result = tickFoodSpoilage(world, materials, foodId)!;

    expect(result.spoiled).toBe(true);
    expect(world.entities.isLive(foodId)).toBe(false);
    expect(getInventory(world.components, holder)!.itemIds).toEqual([]);
    expect(() => applyTrauma(world, holder, 1)).not.toThrow();
  });

  it("validates corrupted restored spoilage component data at the read boundary", () => {
    const { world } = buildFlatWorld();
    const foodId = world.entities.create("food");
    world.components.set(foodId, FoodSpoilageComponent, {
      freshness: 2,
      initialNutritionValue: 0.8,
      lastUpdatedTick: 0,
    } as never);

    expect(() => getFoodSpoilage(world.components, foodId)).toThrow(RangeError);
  });

  it("persists spoilage state through the full component registry", () => {
    const { world } = buildFlatWorld();
    const foodId = spawnFood(world, 3, 3);
    setFoodSpoilage(world.components, foodId, {
      freshness: 0.75,
      initialNutritionValue: 0.8,
      lastUpdatedTick: 12,
    });

    const restoreMaterials = new MaterialRegistry();
    registerStandardMaterials(restoreMaterials);
    const restored = restoreWorld(JSON.parse(JSON.stringify(snapshotWorld(world))), { componentTypes: ALL_COMPONENT_TYPES, materials: restoreMaterials });

    expect(getFoodSpoilage(restored.components, foodId)).toEqual(getFoodSpoilage(world.components, foodId));
  });

  it("exposes debug state including current environmental rate inputs", () => {
    const { world, materials, water } = buildFlatWorld();
    const foodId = spawnFood(world, 3, 3);
    water.setDepth(3, 3, 0.5);

    const debug = getFoodSpoilageDebugState(world, materials, foodId);

    expect(debug.foodId).toBe(foodId);
    expect(debug.freshness).toBe(1);
    expect(debug.environment).toEqual(foodSpoilageEnvironment(world, materials, foodId));
    expect(debug.environment.waterDepth).toBe(0.5);
    expect(debug.environment.decayRatePerTick).toBeGreaterThan(0);
  });
});
