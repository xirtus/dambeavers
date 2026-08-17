import { defineComponent, type ComponentStore, type ComponentType } from "../core/ComponentStore.js";
import type { EntityId } from "../core/EntityId.js";
import type { MaterialRegistry } from "../materials/Material.js";
import type { World } from "../persistence/WorldSnapshot.js";
import { ambientTemperature } from "../weather/Weather.js";
import { getInventory, setInventory } from "../creatures/Beaver.js";
import { getFood, setFood } from "../labor/Food.js";
import { getHeld } from "../labor/Log.js";

/**
 * P2-08's food-spoilage state: a per-food persistent freshness timer,
 * driven by ordinary material properties (`decayResistance`) and the
 * item's actual current environment. No food kind has special spoilage
 * logic; two identical food entities diverge only when their real
 * surroundings diverge (wet vs dry, colder vs warmer).
 */
export interface FoodSpoilage {
  /** Remaining edible quality, [0, 1]. The food entity is destroyed when this reaches 0. */
  freshness: number;
  /** Nutrition value this item had when spoilage tracking began. */
  initialNutritionValue: number;
  /** Authoritative tick at which `freshness` was last updated. */
  lastUpdatedTick: number;
}

export const FoodSpoilageComponent: ComponentType<FoodSpoilage> = defineComponent<FoodSpoilage>("food-spoilage");

export interface FoodSpoilageEnvironment {
  foodId: EntityId;
  materialId: string;
  materialDecayResistance: number;
  ambientTemperature: number;
  waterDepth: number;
  decayRatePerTick: number;
}

export interface FoodSpoilageTickResult {
  foodId: EntityId;
  elapsedTicks: number;
  previousFreshness: number;
  freshness: number;
  previousNutritionValue: number;
  nutritionValue: number;
  spoiled: boolean;
  environment: FoodSpoilageEnvironment;
}

export interface FoodSpoilageDebugState extends FoodSpoilage {
  foodId: EntityId;
  environment: FoodSpoilageEnvironment;
}

/**
 * Tunable base loss of freshness per tick before material/environment
 * multipliers. At the current P2 scale this is intentionally coarse:
 * systems invoke spoilage explicitly from tests or a future scheduler,
 * not from a hidden global loop.
 */
export const FOOD_BASE_DECAY_PER_TICK = 0.0001;

function assertNonNegativeInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new RangeError(`${label} must be a non-negative integer, got ${JSON.stringify(value)}`);
  }
}

export function assertValidFoodSpoilage(spoilage: FoodSpoilage): void {
  if (spoilage === null || typeof spoilage !== "object") throw new RangeError("food spoilage must be an object");
  if (!(Number.isFinite(spoilage.freshness) && spoilage.freshness >= 0 && spoilage.freshness <= 1)) {
    throw new RangeError(`food freshness must be in [0, 1], got ${JSON.stringify(spoilage.freshness)}`);
  }
  if (!(Number.isFinite(spoilage.initialNutritionValue) && spoilage.initialNutritionValue > 0 && spoilage.initialNutritionValue <= 1)) {
    throw new RangeError(`food initialNutritionValue must be in (0, 1], got ${JSON.stringify(spoilage.initialNutritionValue)}`);
  }
  assertNonNegativeInteger(spoilage.lastUpdatedTick, "food spoilage lastUpdatedTick");
}

export function setFoodSpoilage(components: ComponentStore, id: EntityId, spoilage: FoodSpoilage): void {
  assertValidFoodSpoilage(spoilage);
  components.set(id, FoodSpoilageComponent, spoilage);
}

export function getFoodSpoilage(components: ComponentStore, id: EntityId): FoodSpoilage | undefined {
  const spoilage = components.get(id, FoodSpoilageComponent);
  if (spoilage !== undefined) assertValidFoodSpoilage(spoilage);
  return spoilage;
}

export function startFoodSpoilage(world: World, foodId: EntityId): void {
  const food = getFood(world.components, foodId);
  if (food === undefined) throw new RangeError(`entity ${foodId} has no Food component`);
  setFoodSpoilage(world.components, foodId, {
    freshness: 1,
    initialNutritionValue: food.nutritionValue,
    lastUpdatedTick: world.clock.tick,
  });
}

function positionOfFood(world: World, foodId: EntityId): { x: number; y: number; z: number } {
  const position = world.grid.positionOf(foodId);
  if (position !== undefined) return position;
  const held = getHeld(world.components, foodId);
  if (held !== undefined && world.entities.isLive(held.by)) {
    const holderPosition = world.grid.positionOf(held.by);
    if (holderPosition !== undefined) return holderPosition;
  }
  throw new RangeError(`food ${foodId} has no grid position and is not held by a live positioned entity`);
}

export function foodSpoilageEnvironment(world: World, materials: MaterialRegistry, foodId: EntityId): FoodSpoilageEnvironment {
  const food = getFood(world.components, foodId);
  if (food === undefined) throw new RangeError(`entity ${foodId} has no Food component`);
  const position = positionOfFood(world, foodId);
  const material = materials.get(food.materialId);
  const waterDepth = world.water.depthAt(position.x, position.z);
  const resistanceFactor = 1 - material.decayResistance;
  const temperatureMultiplier = 0.5 + ambientTemperature(world.clock.tick);
  const wetnessMultiplier = 1 + Math.min(3, Math.max(0, waterDepth)) * 2;
  const decayRatePerTick = FOOD_BASE_DECAY_PER_TICK * resistanceFactor * temperatureMultiplier * wetnessMultiplier;
  return {
    foodId,
    materialId: food.materialId,
    materialDecayResistance: material.decayResistance,
    ambientTemperature: ambientTemperature(world.clock.tick),
    waterDepth,
    decayRatePerTick,
  };
}

function currentSpoilageOrStart(world: World, foodId: EntityId): FoodSpoilage {
  const existing = getFoodSpoilage(world.components, foodId);
  if (existing !== undefined) return existing;
  startFoodSpoilage(world, foodId);
  return getFoodSpoilage(world.components, foodId)!;
}

function clearHeldFoodInventoryReference(world: World, foodId: EntityId): void {
  const held = getHeld(world.components, foodId);
  if (held === undefined) return;
  const inventory = getInventory(world.components, held.by);
  if (inventory === undefined) return;
  if (!inventory.itemIds.includes(foodId)) return;
  setInventory(world.components, held.by, { itemIds: inventory.itemIds.filter((id) => id !== foodId) });
}

export function tickFoodSpoilage(world: World, materials: MaterialRegistry, foodId: EntityId): FoodSpoilageTickResult | undefined {
  if (!world.entities.isLive(foodId)) return undefined;
  const food = getFood(world.components, foodId);
  if (food === undefined) return undefined;
  const spoilage = currentSpoilageOrStart(world, foodId);
  const environment = foodSpoilageEnvironment(world, materials, foodId);
  const elapsedTicks = world.clock.tick - spoilage.lastUpdatedTick;
  if (elapsedTicks < 0) {
    throw new RangeError(`food ${foodId} spoilage lastUpdatedTick ${spoilage.lastUpdatedTick} is after current tick ${world.clock.tick}`);
  }

  const previousFreshness = spoilage.freshness;
  const previousNutritionValue = food.nutritionValue;
  const freshness = Math.max(0, previousFreshness - environment.decayRatePerTick * elapsedTicks);
  const nutritionValue = spoilage.initialNutritionValue * freshness;
  const position = positionOfFood(world, foodId);

  if (freshness <= 0) {
    world.events.record({
      tick: world.clock.tick,
      eventType: "food-spoiled",
      subjectIds: [foodId],
      location: position,
    });
    clearHeldFoodInventoryReference(world, foodId);
    world.entities.destroy(foodId);
    return {
      foodId,
      elapsedTicks,
      previousFreshness,
      freshness: 0,
      previousNutritionValue,
      nutritionValue: 0,
      spoiled: true,
      environment,
    };
  }

  setFood(world.components, foodId, { ...food, nutritionValue });
  setFoodSpoilage(world.components, foodId, {
    ...spoilage,
    freshness,
    lastUpdatedTick: world.clock.tick,
  });
  // Records "food-decayed" ONLY when this item crosses a freshness decile
  // (10% bands) -- not once per tick per item, which is what the original
  // P2-08 code did and what the Phase 2 gate soak test proved is a real
  // scaling bug: with a few thousand live food items each decaying a
  // little every tick, the append-only EventLog grew to ~15.5 million
  // events within 12,500 ticks and OOMed the whole run (heap ~4GB,
  // empirically confirmed via file telemetry during that run). A per-tick
  // heartbeat is not what `EventLog` exists for (it's "important state
  // changes," P0-08), and no consumer anywhere reads decay heartbeats --
  // a decile-crossing record is still a real, inspectable "decay
  // progressed" fact, bounded to at most ~10 per item's lifetime, and is
  // a pure function of the already-persisted `freshness` values (no new
  // persisted field, no schema change).
  if (elapsedTicks > 0 && freshness < previousFreshness && Math.floor(previousFreshness * 10) > Math.floor(freshness * 10)) {
    world.events.record({
      tick: world.clock.tick,
      eventType: "food-decayed",
      subjectIds: [foodId],
      location: position,
    });
  }
  return {
    foodId,
    elapsedTicks,
    previousFreshness,
    freshness,
    previousNutritionValue,
    nutritionValue,
    spoiled: false,
    environment,
  };
}

export function tickAllFoodSpoilage(world: World, materials: MaterialRegistry): FoodSpoilageTickResult[] {
  const results: FoodSpoilageTickResult[] = [];
  for (const foodId of world.entities.liveIdsOfKind("food").sort((a, b) => a - b)) {
    const result = tickFoodSpoilage(world, materials, foodId);
    if (result !== undefined) results.push(result);
  }
  return results;
}

export function getFoodSpoilageDebugState(world: World, materials: MaterialRegistry, foodId: EntityId): FoodSpoilageDebugState {
  const spoilage = getFoodSpoilage(world.components, foodId);
  if (spoilage === undefined) throw new RangeError(`entity ${foodId} has no FoodSpoilage component`);
  return {
    foodId,
    ...spoilage,
    environment: foodSpoilageEnvironment(world, materials, foodId),
  };
}
