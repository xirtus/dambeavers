import { ComponentStore, defineComponent, type ComponentType } from "../core/ComponentStore.js";
import type { EntityId } from "../core/EntityId.js";
import type { World } from "../persistence/WorldSnapshot.js";
import { getHeld, setHeld, HeldComponent } from "../labor/Log.js";
import { haulableMassKg } from "../labor/Hauling.js";

/**
 * P3-07: a real, physical placed container (kind `"container"`, P0-02
 * identity) that holds ordinary item entities by reference -- reusing
 * `Log.ts`'s generic `Held` relation (an item held BY a container is no
 * different in kind from one held by a beaver's `Inventory`; only WHO
 * holds it differs) rather than inventing a second holder mechanism.
 * `itemIds` is the container's own authoritative membership list
 * (mirroring `Inventory.itemIds`'s own precedent); an item's location
 * while contained is derived from the CONTAINER's `WorldGrid` position,
 * never independently tracked (Law 1.6/"derive, don't duplicate").
 */
export interface Container {
  capacityKg: number;
  itemIds: readonly EntityId[];
}
export const ContainerComponent: ComponentType<Container> = defineComponent<Container>("container");

export function assertValidContainer(container: Container): void {
  if (!(Number.isFinite(container.capacityKg) && container.capacityKg > 0)) {
    throw new RangeError(`container capacityKg must be a positive finite number, got ${container.capacityKg}`);
  }
  if (!Array.isArray(container.itemIds)) throw new RangeError("container itemIds must be an array");
  for (const id of container.itemIds) {
    if (!Number.isInteger(id) || id < 1) throw new RangeError(`container itemIds entries must be positive integers, got ${id}`);
  }
}

export function setContainer(components: ComponentStore, id: EntityId, container: Container): void {
  assertValidContainer(container);
  components.set(id, ContainerComponent, { capacityKg: container.capacityKg, itemIds: [...container.itemIds] });
}

export function getContainer(components: ComponentStore, id: EntityId): Container | undefined {
  const container = components.get(id, ContainerComponent);
  if (container !== undefined) assertValidContainer(container);
  return container;
}

export function containedMassKg(components: ComponentStore, containerId: EntityId): number {
  const container = getContainer(components, containerId);
  if (container === undefined) return 0;
  return container.itemIds.reduce((sum, id) => sum + (haulableMassKg(components, id) ?? 0), 0);
}

export function createContainer(world: World, capacityKg: number, position: { x: number; y: number; z: number }): EntityId {
  const id = world.entities.create("container");
  world.grid.setEntityPosition(id, position.x, position.y, position.z);
  setContainer(world.components, id, { capacityKg, itemIds: [] });
  return id;
}

/** Moves `itemId` (must be a real, currently free item on the ground) into `containerId`, clearing its `WorldGrid` position -- while contained, its location is wherever the container is. Throws if the item is already held/contained, or doesn't fit within remaining capacity. */
export function placeInContainer(world: World, containerId: EntityId, itemId: EntityId): void {
  const container = getContainer(world.components, containerId);
  if (container === undefined) throw new RangeError(`entity ${containerId} has no Container component`);
  if (getHeld(world.components, itemId) !== undefined) throw new RangeError(`item ${itemId} is already held/contained -- cannot place it in a container`);
  const mass = haulableMassKg(world.components, itemId);
  if (mass === undefined) throw new RangeError(`entity ${itemId} is not a physical item -- cannot place it in a container`);
  const currentMass = containedMassKg(world.components, containerId);
  if (currentMass + mass > container.capacityKg + 1e-9) {
    throw new RangeError(`container ${containerId} has no room for ${mass}kg (capacity ${container.capacityKg}kg, holds ${currentMass}kg)`);
  }
  world.grid.clearEntityPosition(itemId);
  setHeld(world.components, itemId, { by: containerId });
  setContainer(world.components, containerId, { ...container, itemIds: [...container.itemIds, itemId] });
}

/** Removes `itemId` from `containerId`, giving it back a real `WorldGrid` position at the container's own location. Throws if the container doesn't actually hold it. */
export function removeFromContainer(world: World, containerId: EntityId, itemId: EntityId): void {
  const container = getContainer(world.components, containerId);
  if (container === undefined || !container.itemIds.includes(itemId)) {
    throw new RangeError(`container ${containerId} does not hold item ${itemId}`);
  }
  const position = world.grid.positionOf(containerId);
  if (position === undefined) throw new RangeError(`container ${containerId} has no position -- cannot release items from it`);
  world.components.remove(itemId, HeldComponent);
  world.grid.setEntityPosition(itemId, position.x, position.y, position.z);
  setContainer(world.components, containerId, { ...container, itemIds: container.itemIds.filter((id) => id !== itemId) });
}

