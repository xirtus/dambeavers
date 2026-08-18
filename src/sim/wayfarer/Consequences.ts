import type { EntityId } from "../core/EntityId.js";
import type { EventId } from "../history/EventLog.js";
import type { World } from "../persistence/WorldSnapshot.js";
import type { ColonyLoopDeps } from "../runtime/ColonyLoop.js";
import { isProhibited, recordViolation } from "../creatures/Law.js";
import { pickUp, getHeld } from "../labor/Log.js";
import { getOwner } from "../creatures/Ownership.js";
import { reputationOf } from "../creatures/Reputation.js";
import { AccusationComponent, getAccusation } from "../politics/Justice.js";
import { getRelationships } from "../creatures/Relationships.js";
import type { VerbResult } from "./Verbs.js";

/**
 * P9-07: personal reputation and consequences -- crimes, aid, violence,
 * theft, kinship, and heroism ALREADY alter persistent social/history
 * state through the ordinary systems (P5-13 derives reputation from the
 * real recorded events; P7-09's accusations reference real violations;
 * wounds and deaths are real records; kin edges are real state). This
 * file adds the adventure-facing pieces only: a real `steal` verb
 * (the ordinary violation detector + the ordinary pickup -- the
 * reputation drop happens because the recorded violation exists, not
 * because this file decrements anything), and a derived deed summary
 * for the player's own character. No parallel score exists.
 */

/** The real steal: taking an item another person owns -- records the ordinary violation (P5-12) and performs the ordinary pickup (P1-09). The victim's household can later file a real accusation (P7-09) against the real record. */
export function playerSteal(deps: ColonyLoopDeps, world: World, beaverId: EntityId, itemId: EntityId): VerbResult {
  if (getHeld(deps.components, itemId) !== undefined) {
    return { ok: false, blocked: true, reason: `item ${itemId} is already held`, eventIds: [] };
  }
  const owner = getOwner(deps.components, itemId);
  if (owner === undefined || owner.ownerType !== "personal" || owner.ownerId === undefined || owner.ownerId === beaverId) {
    return { ok: false, blocked: true, reason: `item ${itemId} is not someone else's personal property -- taking it is not theft`, eventIds: [] };
  }
  const violation = isProhibited(world, beaverId, itemId);
  if (violation === undefined) {
    return { ok: false, blocked: true, reason: `taking ${itemId} would not be a real violation`, eventIds: [] };
  }
  const position = world.grid.positionOf(itemId);
  if (position === undefined) {
    return { ok: false, blocked: true, reason: `item ${itemId} has no position to take it from`, eventIds: [] };
  }
  // The ordinary violation record FIRST (the real persistent history),
  // then the ordinary physical pickup (with provenance recording).
  const violationEventId = recordViolation(world, violation);
  pickUp(deps.components, deps.grid, itemId, beaverId, world);
  return { ok: true, blocked: false, reason: undefined, eventIds: [violationEventId] };
}

export interface WayfarerDeeds {
  reputation: number;
  violationsCommitted: number;
  accusationsAgainst: number;
  accusationsFiled: number;
  woundsInflicted: number;
  kills: number;
  aidGiven: number;
  kinCount: number;
  heroismEvents: number;
}

/** The player character's real social/history standing, derived from recorded history + live state -- the same facts Chronicle/P5-13/P7-09 read. */
export function wayfarerDeeds(world: World, beaverId: EntityId): WayfarerDeeds {
  let violationsCommitted = 0;
  let accusationsAgainst = 0;
  let accusationsFiled = 0;
  let woundsInflicted = 0;
  let kills = 0;
  let aidGiven = 0;
  let heroismEvents = 0;

  for (const event of world.events.all()) {
    if (event.eventType === "rule-violated" && event.subjectIds.includes(beaverId)) violationsCommitted++;
    if (event.eventType === "wound-inflicted" && event.objectIds.includes(beaverId)) woundsInflicted++;
    if (event.eventType === "wayfarer-attack" && event.subjectIds.includes(beaverId) && event.data?.defenderDied === true) kills++;
    if (event.eventType === "ritual-performed" && event.subjectIds.includes(beaverId)) aidGiven++;
    if (event.eventType === "battle-casualty" && event.subjectIds.includes(beaverId)) heroismEvents++;
  }

  for (const accusationId of world.components.query(AccusationComponent)) {
    const accusation = getAccusation(world.components, accusationId);
    if (accusation === undefined) continue;
    if (accusation.accusedId === beaverId) accusationsAgainst++;
    if (accusation.accuserId === beaverId) accusationsFiled++;
  }

  const relationships = getRelationships(world.components, beaverId);
  const kinCount = relationships?.edges.filter((edge) => edge.kin !== "unrelated").length ?? 0;

  return {
    reputation: reputationOf(world, beaverId),
    violationsCommitted,
    accusationsAgainst,
    accusationsFiled,
    woundsInflicted,
    kills,
    aidGiven,
    kinCount,
    heroismEvents,
  };
}
