import { ComponentStore, defineComponent, type ComponentType } from "../core/ComponentStore.js";
import type { EntityId } from "../core/EntityId.js";
import type { MaterialId } from "../materials/Material.js";
import type { WorldGrid } from "../world/WorldGrid.js";
import type { ColumnCoordinate } from "../hydrology/WaterField.js";
import { getInventory, setInventory } from "../creatures/Beaver.js";

/**
 * A physical log -- P1-08's "physical logs generated from tree mass"
 * requirement, satisfied as a real entity (kind `"log"`, P0-02 identity)
 * with real physical properties (AGENTS.md Law 1.6: physical resources
 * are physical, never an invisible integer counter), not a bundled item
 * stack. Position lives in `WorldGrid` (P0-05) while on the ground, not
 * duplicated here -- same "derive/store once" precedent as `Plant`'s own
 * doc comment.
 *
 * `materialId`/`massKg` are P1-08's own two fields (mass, material) of
 * P1-09's five-item list ("mass, material, location, holder/container
 * relation, reservation state, movement/hauling cost"). This file now
 * (P1-09) also adds `Held`/`Reservation` below -- the holder/container
 * relation and reservation state, generic on ANY entity (not
 * log-specific), since a future item type would want the identical
 * shape rather than a parallel near-duplicate.
 */
export interface Log {
  materialId: MaterialId;
  massKg: number;
}
export const LogComponent: ComponentType<Log> = defineComponent<Log>("log");

export function assertValidLog(log: Log): void {
  if (log.materialId.trim().length === 0) {
    throw new RangeError(`log materialId must be non-empty, got ${JSON.stringify(log.materialId)}`);
  }
  if (!(Number.isFinite(log.massKg) && log.massKg > 0)) {
    throw new RangeError(`log massKg must be a positive finite number, got ${log.massKg}`);
  }
}

export function setLog(components: ComponentStore, id: EntityId, log: Log): void {
  assertValidLog(log);
  components.set(id, LogComponent, log);
}

export function getLog(components: ComponentStore, id: EntityId): Log | undefined {
  const log = components.get(id, LogComponent);
  if (log !== undefined) assertValidLog(log);
  return log;
}

/**
 * Present on an item entity exactly while it's being carried -- the
 * "holder/container relation" P1-09's own list names. A held item has NO
 * `WorldGrid` position (`pickUp` clears it): its location IS wherever
 * `by` currently is, derived, never stored twice (same "derive, don't
 * duplicate" discipline P0-09/P0-10 already established for terrain
 * solidity and harvestable mass). Component PRESENCE is the "is this
 * being carried" flag -- no separate boolean to drift out of sync with
 * whether the component is actually attached.
 */
export interface Held {
  by: EntityId;
}
export const HeldComponent: ComponentType<Held> = defineComponent<Held>("held");

export function assertValidHeld(held: Held): void {
  if (!Number.isInteger(held.by) || held.by < 1) {
    throw new RangeError(`held.by must be a positive integer, got ${held.by}`);
  }
}

export function setHeld(components: ComponentStore, id: EntityId, held: Held): void {
  assertValidHeld(held);
  components.set(id, HeldComponent, held);
}

export function getHeld(components: ComponentStore, id: EntityId): Held | undefined {
  const held = components.get(id, HeldComponent);
  if (held !== undefined) assertValidHeld(held);
  return held;
}

/**
 * Present on an item entity exactly while some beaver has claimed the
 * exclusive right to haul it -- P1-09's "reservation state." Mirrors
 * `Job.reservedBy` (P1-07) at the ITEM level rather than only the job
 * level: P1-09's own list names reservation as a property the ITEM
 * itself must have, inspectable directly (`inspectEntity`, P0-12)
 * without cross-referencing which job currently references it. Kept in
 * sync with the reserving job's own lifecycle exclusively by
 * `Hauling.ts`'s `tickHaulJob` -- no other code path sets or clears this,
 * so the two can't drift apart from each other in practice, the same
 * discipline `NeedFocus`/`Job.reservedBy` themselves rely on.
 */
export interface Reservation {
  by: EntityId;
}
export const ReservationComponent: ComponentType<Reservation> = defineComponent<Reservation>("reservation");

export function assertValidReservation(reservation: Reservation): void {
  if (!Number.isInteger(reservation.by) || reservation.by < 1) {
    throw new RangeError(`reservation.by must be a positive integer, got ${reservation.by}`);
  }
}

export function setReservation(components: ComponentStore, id: EntityId, reservation: Reservation): void {
  assertValidReservation(reservation);
  components.set(id, ReservationComponent, reservation);
}

export function getReservation(components: ComponentStore, id: EntityId): Reservation | undefined {
  const reservation = components.get(id, ReservationComponent);
  if (reservation !== undefined) assertValidReservation(reservation);
  return reservation;
}

export function clearReservation(components: ComponentStore, id: EntityId): void {
  components.remove(id, ReservationComponent);
}

/**
 * Picks `itemId` up off the ground into `beaverId`'s `Inventory`
 * (P1-05) -- the item's `WorldGrid` position is cleared (Law 1.6: a held
 * item is still physical, just not independently located; it travels
 * WITH its holder rather than needing its own position kept in sync
 * every tick) and `Held` is attached. Throws if the item is already held
 * (can't be picked up twice) or `beaverId` has no `Inventory`.
 */
export function pickUp(components: ComponentStore, grid: WorldGrid, itemId: EntityId, beaverId: EntityId): void {
  if (components.has(itemId, HeldComponent)) {
    throw new RangeError(`item ${itemId} is already held -- cannot pick it up again`);
  }
  const inventory = getInventory(components, beaverId);
  if (inventory === undefined) {
    throw new RangeError(`entity ${beaverId} has no Inventory component -- cannot hold items`);
  }
  setInventory(components, beaverId, { itemIds: [...inventory.itemIds, itemId] });
  grid.clearEntityPosition(itemId);
  setHeld(components, itemId, { by: beaverId });
}

/**
 * Sets `itemId` down at `atColumn`, real ground level (`WorldGrid.surfaceY`)
 * -- removes it from its holder's `Inventory` and `Held`, gives it back a
 * real `WorldGrid` position. Throws if the item isn't currently held, or
 * `atColumn` has no ground to stand a physical object on.
 */
export function drop(components: ComponentStore, grid: WorldGrid, itemId: EntityId, atColumn: ColumnCoordinate): void {
  const held = getHeld(components, itemId);
  if (held === undefined) {
    throw new RangeError(`item ${itemId} is not currently held -- cannot drop it`);
  }
  const inventory = getInventory(components, held.by)!; // guaranteed defined -- pickUp requires it, and nothing removes a beaver's own Inventory component
  setInventory(components, held.by, { itemIds: inventory.itemIds.filter((id) => id !== itemId) });
  const floor = grid.surfaceY(atColumn.x, atColumn.z);
  if (floor === undefined) {
    throw new RangeError(`cannot drop item ${itemId} at (${atColumn.x}, ${atColumn.z}) -- no ground there`);
  }
  grid.setEntityPosition(itemId, atColumn.x, floor + 1, atColumn.z);
  components.remove(itemId, HeldComponent);
}
