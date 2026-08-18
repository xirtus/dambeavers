import type { EntityId } from "../core/EntityId.js";
import type { EventId, RecordedEvent } from "../history/EventLog.js";
import type { World } from "../persistence/WorldSnapshot.js";
import { nameOf, recordedNameOf } from "../creatures/Naming.js";
import { getSite } from "../region/Site.js";
import { getGood } from "../economy/Good.js";
import { getLog } from "../labor/Log.js";
import { getFood } from "../labor/Food.js";
import { getOwner } from "../creatures/Ownership.js";
import { getWar, warHistory } from "../politics/War.js";
import { getRelationships, relationshipWith, getHouseholdMembership, householdMembers } from "../creatures/Relationships.js";
import { getParentage, getWorldParentage } from "../creatures/Reproduction.js";
import { getConstruction, getBuildProgress } from "../labor/Construction.js";
import { getDamSegment } from "../hydrology/Dam.js";
import { getBridgeSegment } from "../structures/Bridge.js";
import { getDepiction } from "../creatures/Art.js";
import { believedVersionsOf } from "./Rumors.js";

/**
 * P8-01: the historical query API -- every kind of thing the roadmap
 * names (people, sites, objects, events, relationships, wars,
 * constructions, causal links) queried BY STABLE ID, returning real,
 * derived records whose `references` always point at authoritative
 * simulation records (event ids and entity ids -- never copies of
 * history). This file invents no new state and no new event type: it
 * only assembles what already exists.
 */

export type ChronicleQueryKind = "person" | "site" | "object" | "event" | "relationship" | "war" | "construction" | "causal-link";

export type ChronicleReference =
  | { kind: "event"; eventId: EventId }
  | { kind: "entity"; entityId: EntityId };

export interface ChronicleRecord {
  kind: ChronicleQueryKind;
  /** The stable id this record was queried by (an EntityId, or the event's own id for event/causal-link queries). */
  id: number;
  /** Whether the id resolves in its own authoritative space (registry for entities, EventLog for events). */
  known: boolean;
  name?: string;
  /** One-line plain-text summary assembled from real facts only. */
  summary: string;
  references: ChronicleReference[];
}

function sortedEvents(events: RecordedEvent[]): RecordedEvent[] {
  return [...events].sort((a, b) => a.tick - b.tick || a.id - b.id);
}

function summaryOf(world: World, id: EntityId): string {
  const name = recordedNameOf(world, id);
  const label = name !== undefined ? `"${name}"` : "unnamed";
  return `${world.entities.kindOf(id)} #${id} (${label}, ${world.entities.isLive(id) ? "live" : "destroyed"})`;
}

/** Query a real beaver by stable id -- live or dead (history resolves forever, EventLog's own contract). */
export function queryPerson(world: World, personId: EntityId): ChronicleRecord {
  const known = world.entities.isKnown(personId) && world.entities.kindOf(personId) === "beaver";
  if (!known) {
    return { kind: "person", id: personId, known: false, summary: `no beaver entity ${personId} is known`, references: [] };
  }
  const name = recordedNameOf(world, personId);
  const events = sortedEvents(world.events.eventsInvolving(personId));
  const references: ChronicleReference[] = events.map((event) => ({ kind: "event", eventId: event.id }));
  const parentage = getWorldParentage(world, personId);
  if (parentage !== undefined) references.push(...parentage.parentIds.map((entityId) => ({ kind: "entity" as const, entityId })));
  const membership = getHouseholdMembership(world.components, personId);
  if (membership !== undefined) references.push({ kind: "entity", entityId: membership.householdId });
  const relationships = getRelationships(world.components, personId);
  if (relationships !== undefined) references.push(...relationships.edges.map((edge) => ({ kind: "entity" as const, entityId: edge.withId })));
  const summary = `${world.entities.isLive(personId) ? "live" : "dead"} beaver #${personId} ${name !== undefined ? `"${name}"` : "(unnamed)"}: ${events.length} recorded events involving them`;
  return { kind: "person", id: personId, known: true, ...(name !== undefined ? { name } : {}), summary, references };
}

/** Query a real settlement site by stable id. */
export function querySite(world: World, siteId: EntityId): ChronicleRecord {
  const known = world.entities.isKnown(siteId) && world.entities.kindOf(siteId) === "site";
  if (!known) {
    return { kind: "site", id: siteId, known: false, summary: `no site entity ${siteId} is known`, references: [] };
  }
  const site = getSite(world.components, siteId);
  const name = recordedNameOf(world, siteId);
  const events = sortedEvents(world.events.eventsInvolving(siteId));
  const references: ChronicleReference[] = events.map((event) => ({ kind: "event", eventId: event.id }));
  if (site?.householdId !== undefined) references.push({ kind: "entity", entityId: site.householdId });
  const summary =
    site === undefined
      ? `site #${siteId} ${name !== undefined ? `"${name}"` : "(unnamed)"} (destroyed)`
      : `site #${siteId} ${name !== undefined ? `"${name}"` : "(unnamed)"} at region (${site.regionX}, ${site.regionZ}): population ${site.populationCount}, ${site.storedFoodKg}kg stored food, ${events.length} recorded events`;
  return { kind: "site", id: siteId, known: true, ...(name !== undefined ? { name } : {}), summary, references };
}

/** Query a real physical object (good/log/food/any known item entity) by stable id. */
export function queryObject(world: World, itemId: EntityId): ChronicleRecord {
  const known = world.entities.isKnown(itemId);
  if (!known) {
    return { kind: "object", id: itemId, known: false, summary: `no entity ${itemId} is known`, references: [] };
  }
  const name = recordedNameOf(world, itemId);
  const good = getGood(world.components, itemId);
  const log = getLog(world.components, itemId);
  const food = getFood(world.components, itemId);
  const owner = getOwner(world.components, itemId);
  const depiction = getDepiction(world.components, itemId);
  const events = sortedEvents(world.events.eventsInvolving(itemId));
  const references: ChronicleReference[] = events.map((event) => ({ kind: "event", eventId: event.id }));
  if (good?.makerId !== undefined) references.push({ kind: "entity", entityId: good.makerId });
  if (owner?.ownerId !== undefined) references.push({ kind: "entity", entityId: owner.ownerId });
  const what = good !== undefined ? `good "${good.goodKind}" ${good.massKg}kg` : log !== undefined ? `log ${log.massKg}kg of ${log.materialId}` : food !== undefined ? `food ${food.massKg}kg` : world.entities.kindOf(itemId);
  const summary = `${what} #${itemId} ${name !== undefined ? `"${name}"` : "(unnamed)"} (${world.entities.isLive(itemId) ? "live" : "destroyed"}): ${events.length} recorded events`;
  return { kind: "object", id: itemId, known: true, ...(name !== undefined ? { name } : {}), summary, references };
}

/** Query one recorded event by its stable event id. */
export function queryEvent(world: World, eventId: EventId): ChronicleRecord {
  const known = world.events.has(eventId);
  if (!known) {
    return { kind: "event", id: eventId, known: false, summary: `no recorded event ${eventId} exists`, references: [] };
  }
  const event = world.events.get(eventId);
  const references: ChronicleReference[] = [
    { kind: "event", eventId: event.id },
    ...(event.causeEventId !== undefined ? [{ kind: "event" as const, eventId: event.causeEventId }] : []),
    ...[...event.subjectIds, ...event.objectIds].map((entityId) => ({ kind: "entity" as const, entityId })),
  ];
  const participants = [...new Set([...event.subjectIds, ...event.objectIds])].map((id) => recordedNameOf(world, id) ?? `#${id}`).join(", ");
  const summary = `event #${event.id} "${event.eventType}" on tick ${event.tick} at (${event.location.x}, ${event.location.y}, ${event.location.z}); participants: ${participants || "none"}`;
  return { kind: "event", id: eventId, known: true, summary, references };
}

/**
 * P11-07: the chronicle preserves BOTH the authoritative event AND the
 * currently-believed (possibly distorted) versions of it -- the two
 * never mix, so a reader can see exactly where the retold story
 * diverged from what actually happened.
 */
export function queryEventWithBelievedVersions(world: World, eventId: EventId): { record: ChronicleRecord; believedVersionIds: EntityId[] } {
  return { record: queryEvent(world, eventId), believedVersionIds: believedVersionsOf(world, eventId) };
}

/** Query the relationship between two stable beaver ids -- the real edge plus the real events that involved them both. */
export function queryRelationship(world: World, personAId: EntityId, personBId: EntityId): ChronicleRecord {
  const aKnown = world.entities.isKnown(personAId) && world.entities.kindOf(personAId) === "beaver";
  const bKnown = world.entities.isKnown(personBId) && world.entities.kindOf(personBId) === "beaver";
  const known = aKnown && bKnown;
  if (!known) {
    return { kind: "relationship", id: personAId, known: false, summary: `relationship between ${personAId} and ${personBId} cannot be queried: ${aKnown ? "" : `${personAId} `}${!aKnown && !bKnown ? "and " : ""}${bKnown ? "" : `${personBId} `}${aKnown || bKnown ? "is" : "are"} not known beavers`, references: [] };
  }
  const edge = relationshipWith(world.components, personAId, personBId);
  const events = sortedEvents(
    world.events
      .eventsInvolving(personAId)
      .filter((event) => event.subjectIds.includes(personBId) || event.objectIds.includes(personBId)),
  );
  const nameA = recordedNameOf(world, personAId);
  const nameB = recordedNameOf(world, personBId);
  const summary =
    edge === undefined
      ? `beaver #${personAId} ${nameA !== undefined ? `"${nameA}"` : ""} and beaver #${personBId} ${nameB !== undefined ? `"${nameB}"` : ""}: no recorded relationship edge, ${events.length} shared events`
      : `beaver #${personAId} ${nameA !== undefined ? `"${nameA}"` : ""} and beaver #${personBId} ${nameB !== undefined ? `"${nameB}"` : ""}: kin=${edge.kin}, familiarity ${edge.familiarity}, affinity ${edge.affinity}; ${events.length} shared events`;
  return {
    kind: "relationship",
    id: personAId,
    known: true,
    summary,
    references: [...events.map((event) => ({ kind: "event" as const, eventId: event.id })), { kind: "entity", entityId: personBId }],
  };
}

/** Query one war by its stable entity id -- the war's own state plus its full recorded history. */
export function queryWar(world: World, warId: EntityId): ChronicleRecord {
  const known = world.entities.isKnown(warId) && world.entities.kindOf(warId) === "war";
  if (!known) {
    return { kind: "war", id: warId, known: false, summary: `no war entity ${warId} is known`, references: [] };
  }
  const war = getWar(world.components, warId);
  const events = warHistory(world, warId);
  const summary =
    war === undefined
      ? `war #${warId} (destroyed): ${events.length} recorded history events`
      : `war #${warId} between site #${war.participantIds[0]} and site #${war.participantIds[1]} (${war.status}, cause ${war.causeKind}): ${events.length} recorded history events`;
  return {
    kind: "war",
    id: warId,
    known: true,
    summary,
    references: [
      ...events.map((event) => ({ kind: "event" as const, eventId: event.id })),
      ...(war !== undefined ? war.participantIds.map((entityId) => ({ kind: "entity" as const, entityId })) : []),
    ],
  };
}

function isConstructionEntity(world: World, id: EntityId): boolean {
  return (
    getConstruction(world.components, id) !== undefined ||
    getBuildProgress(world.components, id) !== undefined ||
    getDamSegment(world.components, id) !== undefined ||
    getBridgeSegment(world.components, id) !== undefined
  );
}

/** Query one construction (a construction entity, dam segment, or bridge segment) by stable id. */
export function queryConstruction(world: World, constructionId: EntityId): ChronicleRecord {
  const known = world.entities.isKnown(constructionId) && isConstructionEntity(world, constructionId);
  if (!known) {
    return { kind: "construction", id: constructionId, known: false, summary: `no construction/dam/bridge entity ${constructionId} is known`, references: [] };
  }
  const events = sortedEvents(world.events.eventsInvolving(constructionId));
  const construction = getConstruction(world.components, constructionId);
  const dam = getDamSegment(world.components, constructionId);
  const bridge = getBridgeSegment(world.components, constructionId);
  const what = construction !== undefined ? "construction" : dam !== undefined ? "dam segment" : "bridge segment";
  const summary = `${what} #${constructionId} (${world.entities.isLive(constructionId) ? "live" : "destroyed"}): ${events.length} recorded events`;
  return {
    kind: "construction",
    id: constructionId,
    known: true,
    summary,
    references: events.map((event) => ({ kind: "event", eventId: event.id })),
  };
}

/** Query the causal links around one event -- the full backward chain (traceBack) and every forward child (events that name it as their cause). */
export function queryCausalLinks(world: World, eventId: EventId): ChronicleRecord {
  const known = world.events.has(eventId);
  if (!known) {
    return { kind: "causal-link", id: eventId, known: false, summary: `no recorded event ${eventId} exists`, references: [] };
  }
  const backward = world.events.traceBack(eventId);
  const forward = world.events.all().filter((event) => event.causeEventId === eventId);
  const summary = `event #${eventId}: ${backward.length - 1} upstream cause(s) recorded, ${forward.length} recorded effect(s)`;
  return {
    kind: "causal-link",
    id: eventId,
    known: true,
    summary,
    references: [...backward.map((event) => ({ kind: "event" as const, eventId: event.id })), ...forward.map((event) => ({ kind: "event" as const, eventId: event.id }))],
  };
}

/**
 * The generic entry point: query by kind + stable id. Dispatches to the
 * specific query above; throws on an unknown kind (a typo should fail
 * loudly, not silently return a fake record).
 */
export function queryByStableId(world: World, kind: ChronicleQueryKind, id: number): ChronicleRecord {
  switch (kind) {
    case "person":
      return queryPerson(world, id as EntityId);
    case "site":
      return querySite(world, id as EntityId);
    case "object":
      return queryObject(world, id as EntityId);
    case "event":
      return queryEvent(world, id as EventId);
    case "relationship":
      throw new RangeError("relationship queries need two ids -- use queryRelationship(world, personAId, personBId)");
    case "war":
      return queryWar(world, id as EntityId);
    case "construction":
      return queryConstruction(world, id as EntityId);
    case "causal-link":
      return queryCausalLinks(world, id as EventId);
    default: {
      const exhaustive: never = kind;
      throw new RangeError(`unknown chronicle query kind ${JSON.stringify(exhaustive)}`);
    }
  }
}
