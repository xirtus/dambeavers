import { ComponentStore, defineComponent, type ComponentType } from "../core/ComponentStore.js";
import type { EntityId } from "../core/EntityId.js";
import type { MaterialId } from "../materials/Material.js";

/**
 * P3-01's generic crafted/gathered item -- the same "physical resources
 * are physical" shape `Log.ts`'s `Log` established (materialId + massKg),
 * generalized to any produced good kind (`"plank"`, `"stone-block"`,
 * `"clay-brick"`, `"raw-stone"`, a P3-18 trade good, ...) rather than one
 * hardcoded interface per output type. `Held`/`Reservation`/`pickUp`/
 * `drop` (`Log.ts`) are already generic over any item entity id, so a
 * `Good` reuses them unchanged rather than duplicating item-movement
 * machinery.
 *
 * `quality`/`makerId`/`value` are optional P3-17/P3-18 provenance fields:
 * present only on goods a recipe/quality system actually populated (raw
 * gathered material from `Digging.ts` has none of these), never a
 * required field every good must fake a value for.
 */
export interface Good {
  goodKind: string;
  materialId: MaterialId;
  massKg: number;
  quality?: number;
  makerId?: EntityId;
  value?: number;
}
export const GoodComponent: ComponentType<Good> = defineComponent<Good>("good");

const GOOD_KIND_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

export function assertValidGood(good: Good): void {
  if (!GOOD_KIND_PATTERN.test(good.goodKind)) {
    throw new RangeError(`good goodKind must be non-empty lowercase kebab-case, got ${JSON.stringify(good.goodKind)}`);
  }
  if (good.materialId.trim().length === 0) {
    throw new RangeError(`good materialId must be non-empty, got ${JSON.stringify(good.materialId)}`);
  }
  if (!(Number.isFinite(good.massKg) && good.massKg > 0)) {
    throw new RangeError(`good massKg must be a positive finite number, got ${good.massKg}`);
  }
  if (good.quality !== undefined && !(Number.isFinite(good.quality) && good.quality >= 0 && good.quality <= 1)) {
    throw new RangeError(`good quality must be between 0 and 1 when present, got ${good.quality}`);
  }
  if (good.makerId !== undefined && (!Number.isInteger(good.makerId) || good.makerId < 1)) {
    throw new RangeError(`good makerId must be a positive integer when present, got ${good.makerId}`);
  }
  if (good.value !== undefined && !(Number.isFinite(good.value) && good.value >= 0)) {
    throw new RangeError(`good value must be a non-negative finite number when present, got ${good.value}`);
  }
}

export function setGood(components: ComponentStore, id: EntityId, good: Good): void {
  assertValidGood(good);
  components.set(id, GoodComponent, good);
}

export function getGood(components: ComponentStore, id: EntityId): Good | undefined {
  const good = components.get(id, GoodComponent);
  if (good !== undefined) assertValidGood(good);
  return good;
}
