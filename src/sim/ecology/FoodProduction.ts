import { defineComponent, type ComponentStore, type ComponentType } from "../core/ComponentStore.js";
import type { EntityId } from "../core/EntityId.js";
import type { ColumnCoordinate } from "../hydrology/WaterField.js";
import type { MaterialId } from "../materials/Material.js";
import type { World } from "../persistence/WorldSnapshot.js";
import { setFood } from "../labor/Food.js";
import { getPlant } from "./Plant.js";
import { startFoodSpoilage } from "./FoodSpoilage.js";

/**
 * P2-07's explicit simulated-year unit. There is not yet a calendar
 * subsystem, so this module owns the one balance constant the task needs:
 * a year is long enough to cover a mature aspen's current growth horizon
 * (`standardPlantSpecies.ts`), but short enough for headless acceptance
 * tests to drive directly without introducing a scheduler.
 */
export const FOOD_PRODUCTION_YEAR_TICKS = 20_000;

export interface FoodProducer {
  /** Stable material id for the physical food item this source drops. */
  foodMaterialId: MaterialId;
  /** [0, 1] hunger restoration stored on each produced `Food` item. */
  nutritionValue: number;
  /** Physical mass of each produced item, used by ordinary hauling. */
  massKg: number;
  /** Positive integer number of ticks between harvestable outputs. */
  productionIntervalTicks: number;
  /** Authoritative tick at which the next item appears. */
  nextProductionTick: number;
}

export const FoodProducerComponent: ComponentType<FoodProducer> = defineComponent<FoodProducer>("food-producer");

export interface FoodProductionDebugState {
  producerId: EntityId;
  position?: ColumnCoordinate;
  foodMaterialId: MaterialId;
  nutritionValue: number;
  massKg: number;
  productionIntervalTicks: number;
  nextProductionTick: number;
  ticksUntilNext: number;
}

const MATERIAL_ID_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

export function assertValidFoodProducer(producer: FoodProducer): void {
  if (typeof producer.foodMaterialId !== "string" || !MATERIAL_ID_PATTERN.test(producer.foodMaterialId)) {
    throw new RangeError(`food producer material id must be lowercase kebab-case, got ${JSON.stringify(producer.foodMaterialId)}`);
  }
  if (!(Number.isFinite(producer.nutritionValue) && producer.nutritionValue > 0 && producer.nutritionValue <= 1)) {
    throw new RangeError(`food producer nutritionValue must be in (0, 1], got ${producer.nutritionValue}`);
  }
  if (!(Number.isFinite(producer.massKg) && producer.massKg > 0)) {
    throw new RangeError(`food producer massKg must be positive and finite, got ${producer.massKg}`);
  }
  if (!Number.isInteger(producer.productionIntervalTicks) || producer.productionIntervalTicks <= 0) {
    throw new RangeError(`food producer productionIntervalTicks must be a positive integer, got ${producer.productionIntervalTicks}`);
  }
  if (!Number.isInteger(producer.nextProductionTick) || producer.nextProductionTick < 0) {
    throw new RangeError(`food producer nextProductionTick must be a non-negative integer, got ${producer.nextProductionTick}`);
  }
}

export function setFoodProducer(components: ComponentStore, id: EntityId, producer: FoodProducer): void {
  assertValidFoodProducer(producer);
  components.set(id, FoodProducerComponent, producer);
}

export function getFoodProducer(components: ComponentStore, id: EntityId): FoodProducer | undefined {
  const producer = components.get(id, FoodProducerComponent);
  if (producer !== undefined) assertValidFoodProducer(producer);
  return producer;
}

function itemLocation(world: World, sourceId: EntityId): { x: number; y: number; z: number } | undefined {
  const position = world.grid.positionOf(sourceId);
  if (position === undefined) return undefined;
  if (world.grid.surfaceY(position.x, position.z) === undefined) return undefined;
  return { x: position.x, y: position.y, z: position.z };
}

function createProducedFood(world: World, sourceId: EntityId, producer: FoodProducer, location: { x: number; y: number; z: number }): EntityId {
  const foodId = world.entities.create("food");
  world.grid.setEntityPosition(foodId, location.x, location.y, location.z);
  setFood(world.components, foodId, {
    nutritionValue: producer.nutritionValue,
    materialId: producer.foodMaterialId,
    massKg: producer.massKg,
  });
  startFoodSpoilage(world, foodId);
  world.events.record({
    tick: world.clock.tick,
    eventType: "food-produced",
    subjectIds: [foodId],
    objectIds: [sourceId],
    location,
  });
  return foodId;
}

function nextDeadlineAfter(producer: FoodProducer, tick: number): number {
  let nextProductionTick = producer.nextProductionTick;
  while (nextProductionTick <= tick) nextProductionTick += producer.productionIntervalTicks;
  return nextProductionTick;
}

function skipMissedProduction(world: World, sourceId: EntityId, producer: FoodProducer): void {
  const nextProductionTick = nextDeadlineAfter(producer, world.clock.tick);
  if (nextProductionTick !== producer.nextProductionTick) {
    setFoodProducer(world.components, sourceId, { ...producer, nextProductionTick });
  }
}

/**
 * Advances one live renewable food source to the world's current tick.
 * If time jumped over several intervals, every missed physical output is
 * materialized deterministically now, but only while the source itself is
 * currently valid. A dead/unplaced source advances its deadline without
 * creating backlog: food that had no healthy source or real location at
 * the time cannot pop into existence later. Nothing is delivered,
 * consumed, or assigned here: produced entities simply appear at the real
 * source column and ordinary stockpile/hauling/needs systems handle the
 * rest.
 */
export function tickFoodProducer(world: World, sourceId: EntityId): EntityId[] {
  if (!world.entities.isLive(sourceId)) return [];
  const producer = getFoodProducer(world.components, sourceId);
  if (producer === undefined) return [];
  const plant = getPlant(world.components, sourceId);
  if (plant !== undefined && plant.health <= 0) {
    skipMissedProduction(world, sourceId, producer);
    return [];
  }
  const location = itemLocation(world, sourceId);
  if (location === undefined) {
    skipMissedProduction(world, sourceId, producer);
    return [];
  }

  const produced: EntityId[] = [];
  let nextProductionTick = producer.nextProductionTick;
  while (nextProductionTick <= world.clock.tick) {
    produced.push(createProducedFood(world, sourceId, producer, location));
    nextProductionTick += producer.productionIntervalTicks;
  }
  if (nextProductionTick !== producer.nextProductionTick) {
    setFoodProducer(world.components, sourceId, { ...producer, nextProductionTick });
  }
  return produced;
}

export function tickAllFoodProducers(world: World): EntityId[] {
  const produced: EntityId[] = [];
  for (const sourceId of world.components.query(FoodProducerComponent).sort((a, b) => a - b)) {
    produced.push(...tickFoodProducer(world, sourceId));
  }
  return produced;
}

export function createFoodProducer(world: World, kind: string, position: { x: number; z: number }, producer: FoodProducer): EntityId {
  const floor = world.grid.surfaceY(position.x, position.z);
  if (floor === undefined) {
    throw new RangeError(`food producer position (${position.x}, ${position.z}) has no real ground`);
  }
  const id = world.entities.create(kind);
  world.grid.setEntityPosition(id, position.x, floor + 1, position.z);
  setFoodProducer(world.components, id, producer);
  return id;
}

export function getFoodProductionDebugState(world: World, producerId: EntityId): FoodProductionDebugState {
  const producer = getFoodProducer(world.components, producerId);
  if (producer === undefined) throw new RangeError(`entity ${producerId} has no FoodProducer component`);
  const position = world.grid.positionOf(producerId);
  return {
    producerId,
    ...(position !== undefined ? { position: { x: position.x, z: position.z } } : {}),
    foodMaterialId: producer.foodMaterialId,
    nutritionValue: producer.nutritionValue,
    massKg: producer.massKg,
    productionIntervalTicks: producer.productionIntervalTicks,
    nextProductionTick: producer.nextProductionTick,
    ticksUntilNext: producer.nextProductionTick - world.clock.tick,
  };
}
