import { ComponentStore, defineComponent, type ComponentType } from "../core/ComponentStore.js";
import type { EntityId, EntityIdRegistry } from "../core/EntityId.js";
import type { WaterField } from "../hydrology/WaterField.js";
import type { World } from "../persistence/WorldSnapshot.js";
import { getWaterWheel, waterWheelPowerOutput } from "./WaterPower.js";
import { getWorkshop } from "../economy/Workshop.js";

/**
 * P3-16: a real physical connection (kind `"power-transmission"`, P0-02
 * identity) from a power source (today, only a `"water-wheel"`, P3-15)
 * to a workshop it drives. `transmittedPowerTo` re-derives the current
 * power fresh from the source's own live state every call -- never a
 * cached wattage -- so a source that physically stops (the wheel's own
 * entity destroyed, or its water simply drying up) transmits genuinely
 * zero power the very next query, with no separate "unplug" step
 * needed: P3-16's own literal acceptance test ("ceases when the
 * physical source stops").
 */
export interface PowerTransmission {
  sourceId: EntityId;
  workshopId: EntityId;
}
export const PowerTransmissionComponent: ComponentType<PowerTransmission> = defineComponent<PowerTransmission>("power-transmission");

export function assertValidPowerTransmission(transmission: PowerTransmission): void {
  if (!Number.isInteger(transmission.sourceId) || transmission.sourceId < 1) {
    throw new RangeError(`power transmission sourceId must be a positive integer, got ${transmission.sourceId}`);
  }
  if (!Number.isInteger(transmission.workshopId) || transmission.workshopId < 1) {
    throw new RangeError(`power transmission workshopId must be a positive integer, got ${transmission.workshopId}`);
  }
}

export function setPowerTransmission(components: ComponentStore, id: EntityId, transmission: PowerTransmission): void {
  assertValidPowerTransmission(transmission);
  components.set(id, PowerTransmissionComponent, transmission);
}

export function getPowerTransmission(components: ComponentStore, id: EntityId): PowerTransmission | undefined {
  const transmission = components.get(id, PowerTransmissionComponent);
  if (transmission !== undefined) assertValidPowerTransmission(transmission);
  return transmission;
}

/** Connects a live power source entity to a live workshop entity. Throws if either isn't real/live. */
export function connectPower(world: World, sourceId: EntityId, workshopId: EntityId): EntityId {
  if (!world.entities.isLive(sourceId)) throw new RangeError(`entity ${sourceId} is not a live power source`);
  if (getWorkshop(world.components, workshopId) === undefined) throw new RangeError(`entity ${workshopId} has no Workshop component`);
  const id = world.entities.create("power-transmission");
  setPowerTransmission(world.components, id, { sourceId, workshopId });
  return id;
}

/** Sum of real power currently reaching `workshopId` through every live transmission connected to it -- zero if none, or if every connected source has stopped/vanished. Only `"water-wheel"` sources exist today (P3-15); a future source kind extends the single `if` here, not this function's callers. Takes raw pieces (not `World`) so it's callable from hot-path tick functions like `Craft.ts`'s `tickCraftJob`, matching that file's own established parameter style. */
export function transmittedPowerTo(entities: EntityIdRegistry, components: ComponentStore, water: WaterField, workshopId: EntityId): number {
  let total = 0;
  for (const id of entities.liveIdsOfKind("power-transmission")) {
    const transmission = getPowerTransmission(components, id);
    if (transmission === undefined || transmission.workshopId !== workshopId) continue;
    if (!entities.isLive(transmission.sourceId)) continue;
    const wheel = getWaterWheel(components, transmission.sourceId);
    if (wheel !== undefined) total += waterWheelPowerOutput(water, wheel);
  }
  return total;
}

/** Work-rate multiplier a workshop's currently transmitted power grants -- `1` (neutral) with no power, growing with real power delivered. Plausible, tunable coefficient. */
export const POWER_WORK_BONUS = 0.05;

export function workshopPowerMultiplier(entities: EntityIdRegistry, components: ComponentStore, water: WaterField, workshopId: EntityId): number {
  return 1 + transmittedPowerTo(entities, components, water, workshopId) * POWER_WORK_BONUS;
}
