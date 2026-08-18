import type { EntityId } from "../core/EntityId.js";
import type { EventId, RecordedEvent } from "../history/EventLog.js";
import type { World } from "../persistence/WorldSnapshot.js";
import { nameOf } from "../creatures/Naming.js";
import { relationshipWith, getHouseholdMembership, setRelationshipWith } from "../creatures/Relationships.js";
import { getLeadership } from "../creatures/Leadership.js";
import { getMemories, recordMemory } from "../creatures/Memory.js";
import { getStress, setStress } from "../creatures/Stress.js";
import { beliefsOf, adoptBelief, getBelief } from "../creatures/Belief.js";
import { reputationOf } from "../creatures/Reputation.js";
import { getNeeds, NEED_URGENT_THRESHOLD } from "../creatures/Needs.js";
import { applyRelationshipContact } from "../creatures/SocialInteraction.js";
import { relieveSocialNeed } from "./Verbs.js";

/**
 * P9-03: conversation options and outcomes depend on IDENTITY (who the
 * listener is -- their name, their leadership role), KNOWLEDGE (the
 * listener's own recorded deeds, the speaker's own recorded memories),
 * RELATIONSHIP (the real edge -- kin variants and kin discussion only
 * exist when the edge says so), CULTURE (the households' real P5-08
 * beliefs -- discuss/adopt options only exist for real beliefs), and
 * SITUATION (a stressed listener can be consoled, a needy one
 * comforted). Every option is DERIVED from real state at query time and
 * every effect is an existing system's own: relationship contact
 * (P2-12's own function), social-need relief (P2-12's own constants),
 * memory transfer (P5-02's own `recordMemory`), belief adoption
 * (P5-08's own `adoptBelief`), stress relief (the real Stress
 * component). Nothing here invents a fact; an option that doesn't
 * derive from state simply doesn't exist.
 */

export type ConversationOptionKind =
  | "chat"
  | "ask-about-event"
  | "share-memory"
  | "discuss-belief"
  | "adopt-belief"
  | "remark-reputation"
  | "console"
  | "comfort"
  | "ask-about-kin";

export interface ConversationOption {
  id: string;
  kind: ConversationOptionKind;
  label: string;
  /** The real record(s) the option is ABOUT, where one exists (the acceptance's "options depend on knowledge"). */
  eventIds: EventId[];
  /** The real entity the option is about (belief id, kin id), where one exists. */
  entityIds: EntityId[];
}

export interface ConversationResult {
  ok: boolean;
  reason?: string;
  eventIds: EventId[];
  effects: string[];
}

const OPTION_SOURCE_EVENT_TYPES = new Set([
  "offspring-born",
  "leader-appointed",
  "ritual-performed",
  "rule-violated",
  "wound-inflicted",
  "battle-casualty",
  "social-interaction",
  "wayfarer-conversation",
]);

function describe(world: World, id: EntityId): string {
  const name = nameOf(world, id);
  return name !== undefined ? `"${name}"` : `#${id}`;
}

/** The listener's own recorded deeds, newest first -- what they genuinely know and can be asked about. */
function listenerKnowledge(world: World, listenerId: EntityId): RecordedEvent[] {
  return world.events
    .eventsInvolving(listenerId)
    .filter((event) => event.subjectIds.includes(listenerId) && OPTION_SOURCE_EVENT_TYPES.has(event.eventType))
    .sort((a, b) => b.tick - a.tick || b.id - a.id)
    .slice(0, 5);
}

/**
 * Every conversation option currently available between `speakerId` and
 * `listenerId`, derived fresh from real state. Deterministic (sorted by
 * option id).
 */
export function conversationOptions(world: World, speakerId: EntityId, listenerId: EntityId): ConversationOption[] {
  if (!world.entities.isLive(listenerId) || world.entities.kindOf(listenerId) !== "beaver") return [];
  const options: ConversationOption[] = [];
  const edge = relationshipWith(world.components, speakerId, listenerId);
  const listenerName = describe(world, listenerId);

  // Identity + relationship: the greeting always exists, and its label
  // reflects who the listener IS (name, leader role) and what the edge
  // says they are to each other.
  const listenerHousehold = getHouseholdMembership(world.components, listenerId);
  const isLeader = listenerHousehold !== undefined && getLeadership(world.components, listenerHousehold.householdId)?.leaderId === listenerId;
  const kinLabel = edge !== undefined && edge.kin !== "unrelated" ? ` (your ${edge.kin})` : "";
  options.push({
    id: "chat",
    kind: "chat",
    label: `Talk with ${isLeader ? "leader " : ""}${listenerName}${kinLabel}`,
    eventIds: [],
    entityIds: [listenerId],
  });

  // Relationship: asking about kin only exists when the edge says kin.
  if (edge !== undefined && edge.kin !== "unrelated") {
    options.push({
      id: "ask-about-kin",
      kind: "ask-about-kin",
      label: `Ask ${listenerName} about your shared ${edge.kin} bond`,
      eventIds: [],
      entityIds: [listenerId],
    });
  }

  // Knowledge: what the listener has actually done (their own recorded deeds).
  for (const event of listenerKnowledge(world, listenerId)) {
    options.push({
      id: `ask-about-event-${event.id}`,
      kind: "ask-about-event",
      label: `Ask ${listenerName} about their recorded deed "${event.eventType}" (tick ${event.tick})`,
      eventIds: [event.id],
      entityIds: [],
    });
  }

  // Knowledge: the speaker's own memories, shareable.
  const memories = getMemories(world.components, speakerId);
  if (memories !== undefined) {
    for (const entry of memories.entries.slice(0, 5)) {
      options.push({
        id: `share-memory-${entry.eventId}`,
        kind: "share-memory",
        label: `Tell ${listenerName} about something you remember (event #${entry.eventId})`,
        eventIds: [entry.eventId],
        entityIds: [],
      });
    }
  }

  // Culture: real beliefs of either household.
  const speakerHousehold = getHouseholdMembership(world.components, speakerId);
  const beliefIds = new Set<EntityId>();
  if (speakerHousehold !== undefined) for (const beliefId of beliefsOf(world, speakerHousehold.householdId)) beliefIds.add(beliefId);
  if (listenerHousehold !== undefined) for (const beliefId of beliefsOf(world, listenerHousehold.householdId)) beliefIds.add(beliefId);
  for (const beliefId of [...beliefIds].sort((a, b) => a - b)) {
    options.push({
      id: `discuss-belief-${beliefId}`,
      kind: "discuss-belief",
      label: `Discuss the belief ${describe(world, beliefId)} with ${listenerName}`,
      eventIds: [],
      entityIds: [beliefId],
    });
    if (listenerHousehold !== undefined && speakerHousehold !== undefined && !beliefsOf(world, speakerHousehold.householdId).includes(beliefId)) {
      options.push({
        id: `adopt-belief-${beliefId}`,
        kind: "adopt-belief",
        label: `Take up the belief ${describe(world, beliefId)}`,
        eventIds: [],
        entityIds: [beliefId],
      });
    }
  }

  // Identity + reputation: remark on the listener's real reputation.
  options.push({
    id: "remark-reputation",
    kind: "remark-reputation",
    label: `Remark on ${listenerName}'s reputation (${reputationOf(world, listenerId).toFixed(2)})`,
    eventIds: [],
    entityIds: [listenerId],
  });

  // Situation: a stressed listener can be consoled; a needy one comforted.
  const stress = getStress(world.components, listenerId);
  if (stress !== undefined && stress.level >= 0.5) {
    options.push({
      id: "console",
      kind: "console",
      label: `Console ${listenerName}, who is visibly stressed (${stress.level.toFixed(2)})`,
      eventIds: [],
      entityIds: [listenerId],
    });
  }
  const needs = getNeeds(world.components, listenerId);
  if (needs !== undefined && (needs.hunger >= NEED_URGENT_THRESHOLD || needs.thirst >= NEED_URGENT_THRESHOLD || needs.fatigue >= NEED_URGENT_THRESHOLD)) {
    options.push({
      id: "comfort",
      kind: "comfort",
      label: `Comfort ${listenerName}, who is in urgent need`,
      eventIds: [],
      entityIds: [listenerId],
    });
  }

  return options.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Conducts one real conversation turn: validates the option derives
 * from current state (an option that no longer derives fails honestly),
 * applies the option's own system effects, and records a real
 * `"wayfarer-conversation"` event chained to the record the option is
 * about, where one exists.
 */
export function conductConversation(world: World, speakerId: EntityId, listenerId: EntityId, optionId: string): ConversationResult {
  const options = conversationOptions(world, speakerId, listenerId);
  const option = options.find((o) => o.id === optionId);
  if (option === undefined) {
    return { ok: false, reason: `option "${optionId}" does not derive from current state`, eventIds: [], effects: [] };
  }
  const effects: string[] = [];
  const causeEventId = option.eventIds.length > 0 ? option.eventIds[0] : undefined;

  if (option.kind === "ask-about-event" && causeEventId !== undefined) {
    // Knowledge genuinely moves: the speaker records a real memory of
    // the event they asked about (P5-02's own mechanism).
    recordMemory(world, speakerId, causeEventId, 0.2);
    effects.push("you learned of a recorded deed");
  } else if (option.kind === "share-memory" && causeEventId !== undefined) {
    recordMemory(world, listenerId, causeEventId, 0.2);
    effects.push("you shared a real memory");
  } else if (option.kind === "adopt-belief") {
    const speakerHousehold = getHouseholdMembership(world.components, speakerId);
    if (speakerHousehold === undefined) {
      return { ok: false, reason: "you have no household to adopt a belief into", eventIds: [], effects };
    }
    const beliefId = option.entityIds[0]!;
    if (getBelief(world.components, beliefId) === undefined) {
      return { ok: false, reason: `belief ${beliefId} no longer exists`, eventIds: [], effects };
    }
    adoptBelief(world, beliefId, speakerHousehold.householdId);
    effects.push("you adopted a real belief");
  } else if (option.kind === "console") {
    const stress = getStress(world.components, listenerId);
    if (stress !== undefined) {
      setStress(world.components, listenerId, { level: Math.max(0, stress.level - 0.2) });
      effects.push("the listener's real stress eased");
    }
  } else if (option.kind === "remark-reputation") {
    const reputation = reputationOf(world, listenerId);
    const edge = relationshipWith(world.components, speakerId, listenerId);
    const affinity = Math.max(-1, Math.min(1, (edge?.affinity ?? 0) + reputation * 0.05));
    setRelationshipWith(world.components, speakerId, {
      withId: listenerId,
      kin: edge?.kin ?? "unrelated",
      familiarity: edge?.familiarity ?? 0,
      affinity,
    });
    effects.push("your opinion of them shifted with their real reputation");
  }

  // Ordinary contact (P2-12's own function) + social relief for both.
  applyRelationshipContact(world, speakerId, listenerId);
  relieveSocialNeed(world, speakerId);
  relieveSocialNeed(world, listenerId);

  const eventId = world.events.record({
    tick: world.clock.tick,
    eventType: "wayfarer-conversation",
    subjectIds: [speakerId, listenerId],
    objectIds: [],
    location: world.grid.positionOf(listenerId) ?? world.grid.positionOf(speakerId) ?? { x: 0, y: 0, z: 0 },
    ...(causeEventId !== undefined ? { causeEventId } : {}),
    data: { optionId: option.kind },
  });
  return { ok: true, eventIds: [eventId], effects };
}
