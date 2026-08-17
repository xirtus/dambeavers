import { defineComponent, type ComponentStore, type ComponentType } from "../core/ComponentStore.js";
import type { EntityId, EntityIdRegistry } from "../core/EntityId.js";
import type { WorldGrid } from "../world/WorldGrid.js";
import type { MaterialId } from "../materials/Material.js";

/**
 * P2-09's physical waste item. Refuse is deliberately just another
 * material-bearing, massive entity that ordinary hauling/stockpiles can
 * move; disposal policy lives in storage rules, not in a magic cleanup
 * counter.
 */
export type RefuseOrigin = "food-consumption" | "material-processing";

export interface Refuse {
  materialId: MaterialId;
  massKg: number;
  origin: RefuseOrigin;
  sourceEntityId?: EntityId;
}

export const RefuseComponent: ComponentType<Refuse> = defineComponent<Refuse>("refuse");

const MATERIAL_ID_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const VALID_ORIGINS: readonly RefuseOrigin[] = ["food-consumption", "material-processing"];

function assertPositiveEntityId(value: unknown, label: string): asserts value is EntityId {
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new RangeError(`${label} must be a positive entity id, got ${JSON.stringify(value)}`);
  }
}

export function assertValidRefuse(refuse: Refuse): void {
  if (refuse === null || typeof refuse !== "object") throw new RangeError("refuse must be an object");
  if (typeof refuse.materialId !== "string" || !MATERIAL_ID_PATTERN.test(refuse.materialId)) {
    throw new RangeError(`refuse materialId must be lowercase kebab-case, got ${JSON.stringify(refuse.materialId)}`);
  }
  if (!(Number.isFinite(refuse.massKg) && refuse.massKg > 0)) {
    throw new RangeError(`refuse massKg must be positive and finite, got ${JSON.stringify(refuse.massKg)}`);
  }
  if (!VALID_ORIGINS.includes(refuse.origin)) {
    throw new RangeError(`refuse origin must be one of ${VALID_ORIGINS.join(", ")}, got ${JSON.stringify(refuse.origin)}`);
  }
  if (refuse.sourceEntityId !== undefined) assertPositiveEntityId(refuse.sourceEntityId, "refuse sourceEntityId");
}

export function setRefuse(components: ComponentStore, id: EntityId, refuse: Refuse): void {
  assertValidRefuse(refuse);
  components.set(id, RefuseComponent, refuse);
}

export function getRefuse(components: ComponentStore, id: EntityId): Refuse | undefined {
  const refuse = components.get(id, RefuseComponent);
  if (refuse !== undefined) assertValidRefuse(refuse);
  return refuse;
}

export function createRefuse(
  entities: EntityIdRegistry,
  components: ComponentStore,
  grid: WorldGrid,
  position: { x: number; y: number; z: number },
  refuse: Refuse,
): EntityId {
  assertValidRefuse(refuse);
  const id = entities.create("refuse");
  grid.setEntityPosition(id, position.x, position.y, position.z);
  setRefuse(components, id, refuse);
  return id;
}
