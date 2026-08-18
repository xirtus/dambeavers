import type { EntityId } from "../core/EntityId.js";
import type { EventId, RecordedEvent } from "../history/EventLog.js";
import type { World } from "../persistence/WorldSnapshot.js";
import type { Owner } from "../creatures/Ownership.js";
import { getOwner } from "../creatures/Ownership.js";
import { getGood, type Good } from "../economy/Good.js";
import { getHeld } from "../labor/Log.js";
import { getDepiction } from "../creatures/Art.js";
import { nameOf, recordedNameOf } from "../creatures/Naming.js";
import {
  itemMoveEventsOf,
  moveDestination,
  moveOrigin,
  ownershipTransferEventsOf,
  transferNewOwner,
  transferPreviousOwner,
  type ItemLocation,
} from "./Provenance.js";

/**
 * P8-05: an old object's whole life -- maker, owners, locations, use in
 * events, theft, loss, recovery, and current state -- assembled from
 * recorded history plus the object's live components. Nothing here is
 * remembered twice: the owner chain is the sequence of recorded
 * `ownership-transferred` events (each carrying BOTH owners, so the
 * chain reconstructs from events alone), the location trail is the
 * sequence of recorded `item-moved` events, and uses/thefts are the
 * real events that name the item. An object that predates the
 * recording (transfers done before P8's recorders existed) honestly
 * shows only what was recorded.
 */

export interface ArtifactOwnershipEntry {
  tick: number;
  eventId: EventId;
  previousOwner: Owner | undefined;
  newOwner: Owner | undefined;
}

export interface ArtifactLocationEntry {
  tick: number;
  eventId: EventId;
  from: ItemLocation | undefined;
  to: ItemLocation | undefined;
  causeEventId: EventId | undefined;
}

export interface ArtifactLoss {
  tick: number;
  eventId: EventId;
  description: string;
}

export interface ArtifactRecovery {
  tick: number;
  eventId: EventId;
  description: string;
}

export interface ArtifactHistory {
  itemId: EntityId;
  known: boolean;
  maker?: EntityId;
  good?: Good;
  depiction?: { kind: string; id: number };
  ownership: ArtifactOwnershipEntry[];
  locations: ArtifactLocationEntry[];
  uses: RecordedEvent[];
  thefts: RecordedEvent[];
  losses: ArtifactLoss[];
  recoveries: ArtifactRecovery[];
  current: {
    live: boolean;
    owner?: Owner;
    heldBy?: EntityId;
    position?: { x: number; y: number; z: number };
  };
}

function describe(world: World, id: EntityId): string {
  const name = recordedNameOf(world, id);
  return name !== undefined ? `"${name}" (#${id})` : `#${id}`;
}

function describeOwner(world: World, owner: Owner | undefined): string {
  if (owner === undefined) return "unrecorded";
  return owner.ownerType === "communal"
    ? "the community (communal)"
    : `${owner.ownerType} owner ${owner.ownerId !== undefined ? describe(world, owner.ownerId) : "?"}`;
}

/**
 * The artifact's full history. `known` false means the id never
 * resolved as an entity; otherwise every section is real recorded data
 * (plus live components for the present). All event lists are in
 * chronological order.
 */
export function artifactHistory(world: World, itemId: EntityId): ArtifactHistory {
  const known = world.entities.isKnown(itemId);
  if (!known) {
    return {
      itemId,
      known: false,
      ownership: [],
      locations: [],
      uses: [],
      thefts: [],
      losses: [],
      recoveries: [],
      current: { live: false },
    };
  }
  const good = getGood(world.components, itemId);
  const depiction = getDepiction(world.components, itemId);

  const ownership: ArtifactOwnershipEntry[] = ownershipTransferEventsOf(world, itemId).map((event) => ({
    tick: event.tick,
    eventId: event.id,
    previousOwner: transferPreviousOwner(event),
    newOwner: transferNewOwner(event),
  }));

  const locations: ArtifactLocationEntry[] = itemMoveEventsOf(world, itemId).map((event) => ({
    tick: event.tick,
    eventId: event.id,
    from: moveOrigin(event),
    to: moveDestination(event),
    causeEventId: event.causeEventId,
  }));

  const uses = world.events
    .eventsInvolving(itemId)
    .filter((event) => event.eventType !== "ownership-transferred" && event.eventType !== "item-moved")
    .sort((a, b) => a.tick - b.tick || a.id - b.id);

  // Theft: real recorded violations naming this item (P5-12/P7-09's
  // `rule-violated` events carry the stolen item as an object).
  const thefts = world.events
    .eventsOfType("rule-violated")
    .filter((event) => event.objectIds.includes(itemId))
    .sort((a, b) => a.tick - b.tick || a.id - b.id);

  // Loss, honestly classified:
  //  (a) dropped at the moment its carrier died -- an item-moved event
  //      caused by a recorded death event;
  //  (b) its owner died with no heir -- ownership transferred to the
  //      community.
  const losses: ArtifactLoss[] = [];
  for (const entry of locations) {
    if (entry.causeEventId !== undefined && world.events.get(entry.causeEventId).eventType.endsWith("-death")) {
      const death = world.events.get(entry.causeEventId);
      const carrierId = entry.from !== undefined && entry.from.kind === "carried-by" ? entry.from.by : death.subjectIds[0];
      const carrierText = carrierId !== undefined ? describe(world, carrierId) : "its carrier";
      losses.push({
        tick: entry.tick,
        eventId: entry.eventId,
        description: `Dropped when ${carrierText} died (death event #${death.id}).`,
      });
    }
  }
  for (const entry of ownership) {
    if (entry.newOwner?.ownerType === "communal" && entry.previousOwner?.ownerType === "personal") {
      losses.push({
        tick: entry.tick,
        eventId: entry.eventId,
        description: `Its owner ${entry.previousOwner.ownerId !== undefined ? describe(world, entry.previousOwner.ownerId) : "?"} died without an heir -- ownership fell to the community.`,
      });
    }
  }
  losses.sort((a, b) => a.tick - b.tick || a.eventId - b.eventId);

  // Recovery: a real pickup after a recorded loss -- the next item-moved
  // event after a loss that puts it back in someone's hands.
  const recoveries: ArtifactRecovery[] = [];
  for (const loss of losses) {
    const pickup = locations.find((entry) => entry.tick >= loss.tick && entry.to?.kind === "carried-by" && entry.eventId !== loss.eventId);
    if (pickup !== undefined && pickup.to?.kind === "carried-by") {
      recoveries.push({
        tick: pickup.tick,
        eventId: pickup.eventId,
        description: `Picked up again by ${describe(world, pickup.to.by)} after its loss (move event #${pickup.eventId}).`,
      });
    }
  }
  recoveries.sort((a, b) => a.tick - b.tick || a.eventId - b.eventId);

  const owner = getOwner(world.components, itemId);
  const held = getHeld(world.components, itemId);
  const position = world.grid.positionOf(itemId);

  return {
    itemId,
    known: true,
    ...(good?.makerId !== undefined ? { maker: good.makerId } : {}),
    ...(good !== undefined ? { good } : {}),
    ...(depiction !== undefined ? { depiction: { kind: depiction.kind, id: depiction.id } } : {}),
    ownership,
    locations,
    uses,
    thefts,
    losses,
    recoveries,
    current: {
      live: world.entities.isLive(itemId),
      ...(owner !== undefined ? { owner } : {}),
      ...(held !== undefined ? { heldBy: held.by } : {}),
      ...(position !== undefined ? { position } : {}),
    },
  };
}

/** The artifact's maker, from its own Good component (P3-17's makerId -- a stable entity reference, recorded at crafting). */
export function artifactMaker(world: World, itemId: EntityId): EntityId | undefined {
  return getGood(world.components, itemId)?.makerId;
}

/** The artifact's full owner chain, oldest first, as reconstructed from recorded transfer events alone. */
export function artifactOwnerChain(world: World, itemId: EntityId): Array<{ tick: number; owner: Owner | undefined }> {
  const chain: Array<{ tick: number; owner: Owner | undefined }> = [];
  const events = ownershipTransferEventsOf(world, itemId);
  if (events.length === 0) return chain;
  const first = events[0]!;
  chain.push({ tick: first.tick, owner: transferPreviousOwner(first) });
  for (const event of events) {
    chain.push({ tick: event.tick, owner: transferNewOwner(event) });
  }
  return chain;
}

/** Human-readable one-line description of the artifact's recorded life -- every clause is backed by the sections above. */
export function describeArtifact(world: World, itemId: EntityId): string {
  const history = artifactHistory(world, itemId);
  if (!history.known) return `entity #${itemId} is not a known object.`;
  const parts: string[] = [];
  if (history.maker !== undefined) parts.push(`made by ${describe(world, history.maker)}`);
  if (history.good !== undefined) parts.push(`a ${history.good.goodKind} of ${history.good.massKg}kg`);
  parts.push(`${history.ownership.length} recorded ownership transfer(s)`);
  parts.push(`${history.locations.length} recorded move(s)`);
  parts.push(`${history.uses.length} recorded use(s)`);
  if (history.thefts.length > 0) parts.push(`${history.thefts.length} recorded theft(s)`);
  if (history.losses.length > 0) parts.push(`${history.losses.length} recorded loss(es)`);
  if (history.recoveries.length > 0) parts.push(`${history.recoveries.length} recorded recovery/ies`);
  parts.push(history.current.live ? "still in existence" : "destroyed");
  parts.push(history.current.owner !== undefined ? `currently ${describeOwner(world, history.current.owner)}` : "currently unowned");
  return `Object #${itemId}: ${parts.join("; ")}.`;
}
