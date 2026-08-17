/**
 * Headless acceptance test for P2-08 -- Food spoilage.
 *
 * Roadmap acceptance test:
 *   "identical food stored under different environmental conditions decays
 *   at different rates."
 *
 * The difference here is ordinary world state: both food items are real
 * physical `"food"` entities with identical Food/FoodSpoilage data, both
 * are genuinely stored in active organic stockpiles, and only one storage
 * column has standing water. Spoilage reads that live environment and the
 * material's `decayResistance`; no food-kind branch or scripted "wet
 * stockpile spoils faster" outcome exists.
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
import { setFood, getFood } from "../../src/sim/labor/Food.js";
import { createStockpile, storedItemIds, type StockpilePolicy } from "../../src/sim/logistics/Stockpile.js";
import { getFoodSpoilage, startFoodSpoilage, tickAllFoodSpoilage } from "../../src/sim/ecology/FoodSpoilage.js";

const ORGANIC_POLICY: StockpilePolicy = {
  allowedMaterialCategories: ["organic"],
  allowedMaterialIds: [],
  forbiddenMaterialCategories: [],
  forbiddenMaterialIds: [],
};

function buildFlatWorld(sizeX = 10, sizeY = 8, sizeZ = 10, floor = 2): { world: World; materials: MaterialRegistry; water: WaterField } {
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
  const random = new RandomStreams(208);
  const events = new EventLog(entities);
  return { world: { clock, random, entities, components, grid, terrain, events, water, weather }, materials, water };
}

function createStoredFood(world: World, x: number, z: number): EntityId {
  const foodId = world.entities.create("food");
  const floor = world.grid.surfaceY(x, z)!;
  world.grid.setEntityPosition(foodId, x, floor + 1, z);
  setFood(world.components, foodId, {
    nutritionValue: 0.8,
    materialId: "plant-matter",
    massKg: 1,
  });
  startFoodSpoilage(world, foodId);
  return foodId;
}

describe("P2-08 -- Food spoilage", () => {
  it("identical stored food decays at different rates under different real environmental conditions", () => {
    const { world, materials, water } = buildFlatWorld();
    const dryStockpile = createStockpile(world, [{ x: 2, z: 2 }], ORGANIC_POLICY);
    const wetStockpile = createStockpile(world, [{ x: 7, z: 7 }], ORGANIC_POLICY);
    const dryFood = createStoredFood(world, 2, 2);
    const wetFood = createStoredFood(world, 7, 7);
    water.setDepth(7, 7, 1);

    expect(storedItemIds(world, materials, dryStockpile)).toEqual([dryFood]);
    expect(storedItemIds(world, materials, wetStockpile)).toEqual([wetFood]);
    expect(getFood(world.components, dryFood)).toEqual(getFood(world.components, wetFood));
    expect(getFoodSpoilage(world.components, dryFood)).toEqual(getFoodSpoilage(world.components, wetFood));

    world.clock.advanceTicks(1_000);
    tickAllFoodSpoilage(world, materials);

    const drySpoilage = getFoodSpoilage(world.components, dryFood)!;
    const wetSpoilage = getFoodSpoilage(world.components, wetFood)!;
    const dryFoodState = getFood(world.components, dryFood)!;
    const wetFoodState = getFood(world.components, wetFood)!;

    expect(wetSpoilage.freshness).toBeLessThan(drySpoilage.freshness);
    expect(wetFoodState.nutritionValue).toBeLessThan(dryFoodState.nutritionValue);
    expect(world.events.eventsInvolving(dryFood).at(-1)!.eventType).toBe("food-decayed");
    expect(world.events.eventsInvolving(wetFood).at(-1)!.eventType).toBe("food-decayed");
  });
});
