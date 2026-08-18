import type { EntityId } from "../core/EntityId.js";
import type { CellCoordinate } from "../world/WorldGrid.js";
import type { EventId, RecordedEvent } from "../history/EventLog.js";
import type { World } from "../persistence/WorldSnapshot.js";
import type { Owner } from "../creatures/Ownership.js";

/**
 * P8-05's recording foundation: provenance is written as REAL events at
 * the REAL mutation sites. This file provides the two recorders the real
 * ownership/movement systems call (`recordOwnershipTransfer` at
 * inheritance, barter, caravan delivery, and confiscation;
 * `recordItemMove` at pickup/drop where the caller has world context),
 * plus the defensive readers Chronicle's artifact-history queries parse
 * those events back with.
 *
 * Every recorded fact is JSON-plain `EventLog.data` (the P8 amendment to
 * P0-08) -- no new component, no parallel ledger: the event log remains
 * the single authoritative history, and a transfer event carries exactly
 * what changed (the two owners) so an artifact's full owner chain is
 * reconstructible from the events alone, forever, including after
 * everyone involved is dead.
 */

export interface ItemCellLocation {
  kind: "cell";
  x: number;
  y: number;
  z: number;
}

export interface ItemCarriedLocation {
  kind: "carried-by";
  by: EntityId;
}

export type ItemLocation = ItemCellLocation | ItemCarriedLocation;

export function isItemCellLocation(location: unknown): location is ItemCellLocation {
  if (location === null || typeof location !== "object") return false;
  const cell = location as Record<string, unknown>;
  return (
    cell["kind"] === "cell" &&
    Number.isInteger(cell["x"]) &&
    Number.isInteger(cell["y"]) &&
    Number.isInteger(cell["z"])
  );
}

export function isItemCarriedLocation(location: unknown): location is ItemCarriedLocation {
  if (location === null || typeof location !== "object") return false;
  const carried = location as Record<string, unknown>;
  return carried["kind"] === "carried-by" && Number.isInteger(carried["by"]) && (carried["by"] as number) >= 1;
}

export function isItemLocation(location: unknown): location is ItemLocation {
  return isItemCellLocation(location) || isItemCarriedLocation(location);
}

function locationToData(location: ItemLocation): Record<string, unknown> {
  if (location.kind === "cell") {
    return { kind: "cell", x: location.x, y: location.y, z: location.z };
  }
  return { kind: "carried-by", by: location.by };
}

function dataToLocation(data: unknown): ItemLocation | undefined {
  if (isItemCellLocation(data)) return { kind: "cell", x: data.x, y: data.y, z: data.z };
  if (isItemCarriedLocation(data)) return { kind: "carried-by", by: data.by };
  return undefined;
}

function ownerToData(owner: Owner): Record<string, unknown> {
  return owner.ownerId === undefined
    ? { ownerType: owner.ownerType }
    : { ownerType: owner.ownerType, ownerId: owner.ownerId };
}

function dataToOwner(data: unknown): Owner | undefined {
  if (data === null || typeof data !== "object") return undefined;
  const raw = data as Record<string, unknown>;
  const ownerType = raw["ownerType"];
  if (ownerType !== "personal" && ownerType !== "household" && ownerType !== "institutional" && ownerType !== "communal") {
    return undefined;
  }
  const ownerId = raw["ownerId"];
  if (ownerType === "communal") return { ownerType: "communal" };
  if (!Number.isInteger(ownerId) || (ownerId as number) < 1) return undefined;
  return { ownerType, ownerId: ownerId as EntityId };
}

export interface OwnershipTransferOptions {
  /** The real event that caused this transfer (a death, a barter, a delivery, a judgment). */
  causeEventId?: EventId;
  /** Real cell the transfer happened at; defaults to the region-scale origin placeholder the trade/justice systems themselves use. */
  location?: CellCoordinate;
}

/**
 * Records a real ownership transfer of `itemId` from `previous` to
 * `next` as a `"ownership-transferred"` event whose `data` payload names
 * both owners. Call this AT the mutation site, immediately after the
 * real `setOwner` (this function changes no state -- the transfer has
 * already happened; the event records it, per AGENTS.md §1.1). Returns
 * the new event id.
 */
export function recordOwnershipTransfer(
  world: World,
  itemId: EntityId,
  previous: Owner,
  next: Owner,
  options: OwnershipTransferOptions = {},
): EventId {
  const data: Record<string, unknown> = {
    previousOwner: ownerToData(previous),
    newOwner: ownerToData(next),
  };
  const objectIds: EntityId[] = [];
  if (previous.ownerId !== undefined) objectIds.push(previous.ownerId);
  if (next.ownerId !== undefined && next.ownerId !== previous.ownerId) objectIds.push(next.ownerId);
  return world.events.record({
    tick: world.clock.tick,
    eventType: "ownership-transferred",
    subjectIds: [itemId],
    objectIds,
    location: options.location ?? { x: 0, y: 0, z: 0 },
    ...(options.causeEventId !== undefined ? { causeEventId: options.causeEventId } : {}),
    data,
  });
}

export interface ItemMoveOptions {
  /** The real event that caused this move (e.g. the death that made the carrier drop the item). */
  causeEventId?: EventId;
}

/**
 * Records a real movement of `itemId` (picked up, set down) as an
 * `"item-moved"` event carrying both endpoints in `data`. Call this AT
 * the mutation site (Log.pickUp/drop pass `world` through) -- the move
 * has already happened; the event records it. The event's own
 * `location` field is a real cell whenever either endpoint is one
 * (required by the schema); a carried-to-carried move has none and would
 * throw, so recorders must ensure at least one endpoint is a cell.
 */
export function recordItemMove(world: World, itemId: EntityId, from: ItemLocation, to: ItemLocation, options: ItemMoveOptions = {}): EventId {
  const cell = from.kind === "cell" ? from : to.kind === "cell" ? to : undefined;
  if (cell === undefined) {
    throw new RangeError(`cannot record a move of item ${itemId} with no cell endpoint -- EventLog events need a real location`);
  }
  return world.events.record({
    tick: world.clock.tick,
    eventType: "item-moved",
    subjectIds: [itemId],
    objectIds: [...(from.kind === "carried-by" ? [from.by] : []), ...(to.kind === "carried-by" && to.by !== (from.kind === "carried-by" ? from.by : to.by) ? [to.by] : [])],
    location: { x: cell.x, y: cell.y, z: cell.z },
    ...(options.causeEventId !== undefined ? { causeEventId: options.causeEventId } : {}),
    data: { from: locationToData(from), to: locationToData(to) },
  });
}

/** Every recorded ownership-transfer event for `itemId`, in record order. */
export function ownershipTransferEventsOf(world: World, itemId: EntityId): RecordedEvent[] {
  return world.events.eventsOfType("ownership-transferred").filter((event) => event.subjectIds.includes(itemId));
}

/** Every recorded item-moved event for `itemId`, in record order. */
export function itemMoveEventsOf(world: World, itemId: EntityId): RecordedEvent[] {
  return world.events.eventsOfType("item-moved").filter((event) => event.subjectIds.includes(itemId));
}

/** The previous owner recorded on a transfer event, if the payload is well-formed. */
export function transferPreviousOwner(event: RecordedEvent): Owner | undefined {
  return dataToOwner(event.data?.previousOwner);
}

/** The new owner recorded on a transfer event, if the payload is well-formed. */
export function transferNewOwner(event: RecordedEvent): Owner | undefined {
  return dataToOwner(event.data?.newOwner);
}

/** The move's origin as recorded on an item-moved event, if the payload is well-formed. */
export function moveOrigin(event: RecordedEvent): ItemLocation | undefined {
  return dataToLocation(event.data?.from);
}

/** The move's destination as recorded on an item-moved event, if the payload is well-formed. */
export function moveDestination(event: RecordedEvent): ItemLocation | undefined {
  return dataToLocation(event.data?.to);
}
