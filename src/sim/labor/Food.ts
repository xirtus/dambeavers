import { ComponentStore, defineComponent, type ComponentType } from "../core/ComponentStore.js";
import type { EntityId } from "../core/EntityId.js";

/**
 * P1-13's "stored food item" -- a real, physical entity (kind `"food"`,
 * P0-02 identity), reusing `Log.ts`'s already-generic `Held`/`Reservation`
 * components and `pickUp`/`drop` functions directly (they operate on ANY
 * item entity by id, never checking for a `Log` component specifically --
 * see `Log.ts`'s own doc comment on why those were built generic in the
 * first place). `nutritionValue` gives a stored item real, inspectable
 * variance a beaver's bark/cambium fallback (`BeaverNeeds.ts`'s
 * `eatFromTree`, which always fully satisfies hunger) doesn't have: a
 * smaller/larger cache genuinely restores a different amount, rather than
 * "eating" meaning the same fixed thing regardless of what's actually
 * being eaten.
 */
export interface Food {
  /** [0, 1] fraction of the hunger scale (`Needs.hunger`, P1-06) this item restores when eaten. */
  nutritionValue: number;
}
export const FoodComponent: ComponentType<Food> = defineComponent<Food>("food");

export function assertValidFood(food: Food): void {
  if (!(Number.isFinite(food.nutritionValue) && food.nutritionValue > 0 && food.nutritionValue <= 1)) {
    throw new RangeError(`food nutritionValue must be in (0, 1], got ${food.nutritionValue}`);
  }
}

export function setFood(components: ComponentStore, id: EntityId, food: Food): void {
  assertValidFood(food);
  components.set(id, FoodComponent, food);
}

export function getFood(components: ComponentStore, id: EntityId): Food | undefined {
  const food = components.get(id, FoodComponent);
  if (food !== undefined) assertValidFood(food);
  return food;
}
