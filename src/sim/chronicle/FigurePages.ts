import type { EntityId } from "../core/EntityId.js";
import type { EventId, RecordedEvent } from "../history/EventLog.js";
import type { World } from "../persistence/WorldSnapshot.js";
import { nameOf, recordedNameOf } from "../creatures/Naming.js";
import { getIdentity } from "../creatures/Beaver.js";
import { getWorldParentage } from "../creatures/Reproduction.js";
import { getRelationships, getHouseholdMembership, householdMembers } from "../creatures/Relationships.js";
import { getLeadership } from "../creatures/Leadership.js";
import { getGood } from "../economy/Good.js";
import { getDepiction } from "../creatures/Art.js";
import { reputationOf } from "../creatures/Reputation.js";
import { significanceOf, HISTORICAL_FIGURE_THRESHOLD } from "../creatures/HistoricalFigure.js";

/**
 * P8-03: a historical figure page -- every claim the page makes about a
 * beaver is backed by an explicit, authoritative source: a recorded
 * event id, a live component on a real entity, or the entity registry's
 * own liveness (for the alive/dead fact itself). No claim may appear
 * without sources; a player-facing page renders each claim as a link
 * into exactly these records (the acceptance's "every displayed claim
 * links to authoritative simulation records").
 */

export type FigureSource =
  | { kind: "event"; eventId: EventId }
  | { kind: "component"; componentType: string; entityId: EntityId }
  | { kind: "registry" };

export interface FigureClaim {
  heading: string;
  detail: string;
  sources: FigureSource[];
}

export interface FigurePage {
  personId: EntityId;
  known: boolean;
  live: boolean;
  name?: string;
  significance: number;
  claims: FigureClaim[];
}

function parentIdsFromEvents(world: World, personId: EntityId): EntityId[] {
  const event = world.events.eventsOfType("offspring-born").find((e) => e.subjectIds.includes(personId));
  return event === undefined ? [] : [...event.objectIds].slice(0, 2) as EntityId[];
}

function parentIdsOf(world: World, personId: EntityId): { parentIds: EntityId[]; source: FigureSource } {
  const parentage = getWorldParentage(world, personId);
  if (parentage !== undefined) {
    return { parentIds: [...parentage.parentIds], source: { kind: "component", componentType: "parentage", entityId: personId } };
  }
  const fromEvents = parentIdsFromEvents(world, personId);
  const event = world.events.eventsOfType("offspring-born").find((e) => e.subjectIds.includes(personId));
  return {
    parentIds: fromEvents,
    source: event === undefined ? { kind: "registry" } : { kind: "event", eventId: event.id },
  };
}

function deathEventOf(world: World, personId: EntityId): RecordedEvent | undefined {
  let found: RecordedEvent | undefined;
  for (const event of world.events.eventsInvolving(personId)) {
    if (event.subjectIds.includes(personId) && event.eventType.endsWith("-death")) {
      if (found === undefined || event.tick > found.tick) found = event;
    }
  }
  return found;
}

function offspringEventsOf(world: World, personId: EntityId): RecordedEvent[] {
  return world.events.eventsOfType("offspring-born").filter((event) => event.objectIds[0] === personId || event.objectIds[1] === personId);
}

/** The real recorded reputation-bearing deeds (P5-13's own weights) -- the events `reputationOf` actually counts. */
function reputationSourceEvents(world: World, personId: EntityId): RecordedEvent[] {
  return world.events
    .eventsInvolving(personId)
    .filter((event) => event.subjectIds.includes(personId) && ["offspring-born", "leader-appointed", "ritual-performed", "rule-violated"].includes(event.eventType));
}

function describeOwner(world: World, id: EntityId): string {
  const name = recordedNameOf(world, id);
  return name !== undefined ? `"${name}" (#${id})` : `#${id}`;
}

/**
 * Builds the full figure page. Every claim carries its own sources;
 * every event source is a real recorded event id and every component
 * source is a real attached component -- the page never states a fact
 * it cannot point at.
 */
export function figurePage(world: World, personId: EntityId, significanceThreshold: number = HISTORICAL_FIGURE_THRESHOLD): FigurePage {
  const known = world.entities.isKnown(personId) && world.entities.kindOf(personId) === "beaver";
  if (!known) {
    return { personId, known: false, live: false, significance: 0, claims: [] };
  }
  const live = world.entities.isLive(personId);
  const name = recordedNameOf(world, personId);
  const claims: FigureClaim[] = [];
  const identity = getIdentity(world.components, personId);

  // Identity -- the shared Identity component every named entity uses.
  claims.push({
    heading: "Identity",
    detail: identity?.name !== undefined ? `This beaver is named "${identity.name}" (recorded in their own identity component).` : `This beaver (entity #${personId}) has no recorded name.`,
    sources: [{ kind: "component", componentType: "identity", entityId: personId }],
  });

  // Alive/dead -- the registry's own liveness.
  claims.push({
    heading: "Status",
    detail: live ? `Alive at tick ${world.clock.tick}.` : `No longer alive (the entity registry records them as destroyed).`,
    sources: [{ kind: "registry" }],
  });

  // Birth.
  const birthEvent = world.events.eventsOfType("offspring-born").find((e) => e.subjectIds.includes(personId));
  if (birthEvent !== undefined) {
    const parents = [...birthEvent.objectIds].slice(0, 2);
    claims.push({
      heading: "Birth",
      detail: `Born on tick ${birthEvent.tick} at (${birthEvent.location.x}, ${birthEvent.location.y}, ${birthEvent.location.z}), child of ${parents.map((p) => describeOwner(world, p)).join(" and ")}.`,
      sources: [{ kind: "event", eventId: birthEvent.id }],
    });
  } else {
    claims.push({
      heading: "Birth",
      detail: "No recorded birth event exists for this beaver (they may predate the recording of births, or were spawned as a founder).",
      sources: [{ kind: "registry" }],
    });
  }

  // Parentage.
  const { parentIds, source } = parentIdsOf(world, personId);
  if (parentIds.length > 0) {
    claims.push({
      heading: "Parentage",
      detail: `Parents: ${parentIds.map((p) => describeOwner(world, p)).join(" and ")}.`,
      sources: [source],
    });
  }

  // Death.
  const deathEvent = deathEventOf(world, personId);
  if (deathEvent !== undefined) {
    claims.push({
      heading: "Death",
      detail: `Died on tick ${deathEvent.tick} at (${deathEvent.location.x}, ${deathEvent.location.y}, ${deathEvent.location.z}) -- recorded cause "${deathEvent.eventType}".`,
      sources: [{ kind: "event", eventId: deathEvent.id }],
    });
  }

  // Offspring.
  const offspringEvents = offspringEventsOf(world, personId);
  if (offspringEvents.length > 0) {
    claims.push({
      heading: "Offspring",
      detail: `${offspringEvents.length} recorded ${offspringEvents.length === 1 ? "birth" : "births"} as a parent: ${offspringEvents.map((e) => `#${e.subjectIds[0]}`).join(", ")}.`,
      sources: offspringEvents.map((event) => ({ kind: "event" as const, eventId: event.id })),
    });
  }

  // Leadership.
  const leadershipEvents = world.events.eventsOfType("leader-appointed").filter((e) => e.subjectIds.includes(personId));
  if (leadershipEvents.length > 0) {
    claims.push({
      heading: "Leadership",
      detail: `Appointed leader ${leadershipEvents.length} time(s), most recently on tick ${leadershipEvents[leadershipEvents.length - 1]!.tick}.`,
      sources: leadershipEvents.map((event) => ({ kind: "event" as const, eventId: event.id })),
    });
  }

  // Household.
  const membership = getHouseholdMembership(world.components, personId);
  if (membership !== undefined) {
    const memberIds = householdMembers(world.components, membership.householdId);
    claims.push({
      heading: "Household",
      detail: `Member of household #${membership.householdId} (${memberIds.length} member(s)).`,
      sources: [{ kind: "component", componentType: "household-membership", entityId: personId }],
    });
    const leadership = getLeadership(world.components, membership.householdId);
    if (leadership !== undefined && leadership.leaderId === personId) {
      claims.push({
        heading: "Household leadership",
        detail: `Currently the leader of household #${membership.householdId}.`,
        sources: [{ kind: "component", componentType: "leadership", entityId: membership.householdId }],
      });
    }
  }

  // Relationships.
  const relationships = getRelationships(world.components, personId);
  if (relationships !== undefined && relationships.edges.length > 0) {
    claims.push({
      heading: "Relationships",
      detail: `${relationships.edges.length} recorded relationship edge(s): ${relationships.edges
        .map((edge) => `${describeOwner(world, edge.withId)} (${edge.kin}, familiarity ${edge.familiarity.toFixed(2)}, affinity ${edge.affinity.toFixed(2)})`)
        .join("; ")}.`,
      sources: [{ kind: "component", componentType: "relationships", entityId: personId }],
    });
  }

  // Reputation -- with the exact events it was computed from.
  const reputation = reputationOf(world, personId);
  const reputationEvents = reputationSourceEvents(world, personId);
  claims.push({
    heading: "Reputation",
    detail: `Reputation ${reputation.toFixed(2)} on [-1, 1], derived from ${reputationEvents.length} recorded reputation-bearing ${reputationEvents.length === 1 ? "event" : "events"}.`,
    sources: reputationEvents.map((event) => ({ kind: "event" as const, eventId: event.id })),
  });

  // Artworks made (P5-09 depictions among them).
  const artworks: EntityId[] = [];
  for (const id of world.entities.liveIdsOfKind("good")) {
    const good = getGood(world.components, id);
    if (good?.goodKind === "artwork" && good.makerId === personId) artworks.push(id);
  }
  if (artworks.length > 0) {
    const depictions = artworks
      .map((id) => getDepiction(world.components, id))
      .filter((depiction) => depiction !== undefined);
    claims.push({
      heading: "Artworks",
      detail: `Made ${artworks.length} artwork(s): ${artworks.map((id) => `#${id}`).join(", ")}${depictions.length > 0 ? ` -- ${depictions.length} depict(s) a real person/animal/construction/event of this world` : ""}.`,
      sources: artworks.map((entityId) => ({ kind: "component" as const, componentType: "good", entityId })),
    });
  }

  // Historical significance.
  const significance = significanceOf(world, personId);
  const significanceSources: FigureSource[] = [
    ...offspringEvents.map((event) => ({ kind: "event" as const, eventId: event.id })),
    ...leadershipEvents.map((event) => ({ kind: "event" as const, eventId: event.id })),
    ...artworks.map((entityId) => ({ kind: "component" as const, componentType: "good", entityId })),
    ...reputationEvents.map((event) => ({ kind: "event" as const, eventId: event.id })),
  ];
  claims.push({
    heading: "Historical significance",
    detail: `${significance.toFixed(2)} on [0, 1] -- ${significance >= significanceThreshold ? "a historical figure" : "below the historical-figure threshold"}. Derived from the same recorded deeds listed above.`,
    sources: significanceSources,
  });

  // Full event record.
  const events = world.events.eventsInvolving(personId).sort((a, b) => a.tick - b.tick || a.id - b.id);
  claims.push({
    heading: "Recorded history",
    detail: `${events.length} recorded event(s) involving this beaver, oldest first: ${events
      .map((e) => `"${e.eventType}" (tick ${e.tick}, event #${e.id})`)
      .join(", ")}.`,
    sources: events.map((event) => ({ kind: "event" as const, eventId: event.id })),
  });

  return { personId, known: true, live, ...(name !== undefined ? { name } : {}), significance, claims };
}
