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
import { snapshotWorld, restoreWorld } from "../../src/sim/persistence/WorldSnapshot.js";
import { ALL_COMPONENT_TYPES } from "../../src/sim/persistence/AllComponentTypes.js";
import { getFood } from "../../src/sim/labor/Food.js";
import { setPlant } from "../../src/sim/ecology/Plant.js";
import {
  createFoodProducer,
  getFoodProducer,
  getFoodProductionDebugState,
  FoodProducerComponent,
  setFoodProducer,
  tickAllFoodProducers,
  tickFoodProducer,
} from "../../src/sim/ecology/FoodProduction.js";
import { getFoodSpoilage } from "../../src/sim/ecology/FoodSpoilage.js";

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

describe("FoodProduction", () => {
  it("creates a real food item at a live producer column when its production tick arrives", () => {
    const { world } = buildFlatWorld();
    const producer = createFoodProducer(world, "tree", { x: 3, z: 3 }, {
      foodMaterialId: "plant-matter",
      nutritionValue: 0.25,
      massKg: 1.5,
      productionIntervalTicks: 10,
      nextProductionTick: 5,
    });

    expect(tickFoodProducer(world, producer)).toEqual([]);

    world.clock.advanceTicks(5);
    const [foodId] = tickFoodProducer(world, producer);

    expect(foodId).toBeDefined();
    expect(world.entities.kindOf(foodId!)).toBe("food");
    expect(world.grid.positionOf(foodId!)).toEqual({ x: 3, y: world.grid.surfaceY(3, 3)! + 1, z: 3 });
    expect(getFood(world.components, foodId!)).toEqual({ nutritionValue: 0.25, materialId: "plant-matter", massKg: 1.5 });
    expect(getFoodSpoilage(world.components, foodId!)).toEqual({ freshness: 1, initialNutritionValue: 0.25, lastUpdatedTick: world.clock.tick });
    expect(getFoodProducer(world.components, producer)!.nextProductionTick).toBe(15);
    expect(world.events.eventsInvolving(foodId!)[0]!.eventType).toBe("food-produced");
  });

  it("REGRESSION (P2-07 critic): produces at the source entity's actual position, not above a later overhang", () => {
    const { world } = buildFlatWorld();
    const producer = createFoodProducer(world, "tree", { x: 3, z: 3 }, {
      foodMaterialId: "plant-matter",
      nutritionValue: 0.25,
      massKg: 1,
      productionIntervalTicks: 10,
      nextProductionTick: 0,
    });
    const sourcePosition = world.grid.positionOf(producer)!;
    world.terrain.setMaterial(3, sourcePosition.y + 2, 3, "stone");

    const [foodId] = tickFoodProducer(world, producer);

    expect(world.grid.positionOf(foodId!)).toEqual(sourcePosition);
  });

  it("REGRESSION (P2-07 critic): getFoodProducer rejects restored/corrupted data with no material id", () => {
    const { world } = buildFlatWorld();
    const producer = world.entities.create("tree");
    world.components.set(producer, FoodProducerComponent, {
      nutritionValue: 0.2,
      massKg: 1,
      productionIntervalTicks: 10,
      nextProductionTick: 0,
    } as never);

    expect(() => getFoodProducer(world.components, producer)).toThrow(RangeError);
  });

  it("materializes every missed interval deterministically after a tick jump", () => {
    const { world } = buildFlatWorld();
    const producer = createFoodProducer(world, "tree", { x: 3, z: 3 }, {
      foodMaterialId: "plant-matter",
      nutritionValue: 0.2,
      massKg: 1,
      productionIntervalTicks: 10,
      nextProductionTick: 10,
    });

    world.clock.advanceTicks(35);
    const produced = tickFoodProducer(world, producer);

    expect(produced).toHaveLength(3);
    expect(getFoodProducer(world.components, producer)!.nextProductionTick).toBe(40);
    expect(produced).toEqual([...produced].sort((a, b) => a - b));
  });

  it("does not produce from an unplaced source because there is no real location for the item", () => {
    const { world } = buildFlatWorld();
    const producer = world.entities.create("tree");
    setFoodProducer(world.components, producer, {
      foodMaterialId: "plant-matter",
      nutritionValue: 0.2,
      massKg: 1,
      productionIntervalTicks: 10,
      nextProductionTick: 0,
    });

    expect(tickFoodProducer(world, producer)).toEqual([]);
    expect(world.entities.liveIdsOfKind("food")).toEqual([]);
    expect(getFoodProducer(world.components, producer)!.nextProductionTick).toBe(10);
  });

  it("does not produce from a plant source whose real plant health is zero", () => {
    const { world } = buildFlatWorld();
    const producer = createFoodProducer(world, "tree", { x: 3, z: 3 }, {
      foodMaterialId: "plant-matter",
      nutritionValue: 0.2,
      massKg: 1,
      productionIntervalTicks: 10,
      nextProductionTick: 0,
    });
    setPlant(world.components, producer, { speciesId: "aspen", ageTicks: 20_000, health: 0 });

    expect(tickFoodProducer(world, producer)).toEqual([]);
    expect(world.entities.liveIdsOfKind("food")).toEqual([]);
    expect(getFoodProducer(world.components, producer)!.nextProductionTick).toBe(10);
  });

  it("REGRESSION (P2-07): skipped unhealthy intervals are not backfilled after the plant recovers", () => {
    const { world } = buildFlatWorld();
    const producer = createFoodProducer(world, "tree", { x: 3, z: 3 }, {
      foodMaterialId: "plant-matter",
      nutritionValue: 0.2,
      massKg: 1,
      productionIntervalTicks: 10,
      nextProductionTick: 0,
    });
    setPlant(world.components, producer, { speciesId: "aspen", ageTicks: 20_000, health: 0 });
    world.clock.advanceTicks(35);

    expect(tickFoodProducer(world, producer)).toEqual([]);
    setPlant(world.components, producer, { speciesId: "aspen", ageTicks: 20_000, health: 1 });

    expect(tickFoodProducer(world, producer)).toEqual([]);
    world.clock.advanceTicks(5);
    expect(tickFoodProducer(world, producer)).toHaveLength(1);
  });

  it("tickAllFoodProducers scans producer components in stable id order", () => {
    const { world } = buildFlatWorld();
    const later = createFoodProducer(world, "tree", { x: 5, z: 5 }, {
      foodMaterialId: "plant-matter",
      nutritionValue: 0.2,
      massKg: 1,
      productionIntervalTicks: 10,
      nextProductionTick: 0,
    });
    const earlier = createFoodProducer(world, "tree", { x: 2, z: 2 }, {
      foodMaterialId: "plant-matter",
      nutritionValue: 0.2,
      massKg: 1,
      productionIntervalTicks: 10,
      nextProductionTick: 0,
    });

    const produced = tickAllFoodProducers(world);

    expect(later).toBeLessThan(earlier);
    expect(produced).toHaveLength(2);
    expect(world.events.eventsInvolving(produced[0]!).at(0)!.objectIds).toEqual([later]);
    expect(world.events.eventsInvolving(produced[1]!).at(0)!.objectIds).toEqual([earlier]);
  });

  it("persists producer state through the full component registry", () => {
    const { world } = buildFlatWorld();
    const producer = createFoodProducer(world, "tree", { x: 3, z: 3 }, {
      foodMaterialId: "plant-matter",
      nutritionValue: 0.2,
      massKg: 1,
      productionIntervalTicks: 10,
      nextProductionTick: 10,
    });
    world.clock.advanceTicks(10);
    tickFoodProducer(world, producer);

    const restoreMaterials = new MaterialRegistry();
    registerStandardMaterials(restoreMaterials);
    const restored = restoreWorld(JSON.parse(JSON.stringify(snapshotWorld(world))), { componentTypes: ALL_COMPONENT_TYPES, materials: restoreMaterials });

    expect(getFoodProducer(restored.components, producer)).toEqual(getFoodProducer(world.components, producer));
    expect(restored.entities.liveIdsOfKind("food")).toEqual(world.entities.liveIdsOfKind("food"));
  });

  it("exposes enough debug state to inspect the next production deadline", () => {
    const { world } = buildFlatWorld();
    const producer = createFoodProducer(world, "tree", { x: 3, z: 3 }, {
      foodMaterialId: "plant-matter",
      nutritionValue: 0.2,
      massKg: 1,
      productionIntervalTicks: 10,
      nextProductionTick: 15,
    });
    world.clock.advanceTicks(4);

    expect(getFoodProductionDebugState(world, producer)).toEqual({
      producerId: producer,
      position: { x: 3, z: 3 },
      foodMaterialId: "plant-matter",
      nutritionValue: 0.2,
      massKg: 1,
      productionIntervalTicks: 10,
      nextProductionTick: 15,
      ticksUntilNext: 11,
    });
  });
});
