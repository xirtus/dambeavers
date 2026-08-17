import type { EntityId } from "../core/EntityId.js";
import type { World } from "../persistence/WorldSnapshot.js";
import { getGood } from "../economy/Good.js";
import { getHouseholdMembership } from "./Relationships.js";
import { getLeadership } from "./Leadership.js";
import { reputationOf } from "./Reputation.js";

/**
 * P5-15: historical significance is a real, DERIVED score over recorded
 * deeds -- no separate "historical version" entity is ever spawned
 * (Law 1.6/Law 8: an entity's history is a property of the SAME entity
 * that lived it, not a copy). `significanceOf` recomputes fresh every
 * call from real, already-existing facts (offspring produced, current
 * leadership, artworks made, extreme reputation in either direction --
 * a genuinely infamous figure is still historically significant) --
 * exactly the "discover from live state" discipline this codebase
 * already applies everywhere else.
 */
export const HISTORICAL_FIGURE_THRESHOLD = 0.5;

function offspringCount(world: World, beaverId: EntityId): number {
  return world.events.eventsOfType("offspring-born").filter((e) => e.objectIds.includes(beaverId)).length;
}

function isCurrentLeaderOfAnyHousehold(world: World, beaverId: EntityId): boolean {
  const membership = getHouseholdMembership(world.components, beaverId);
  if (membership === undefined) return false;
  return getLeadership(world.components, membership.householdId)?.leaderId === beaverId;
}

function everWasLeader(world: World, beaverId: EntityId): boolean {
  return world.events.eventsOfType("leader-appointed").some((e) => e.subjectIds.includes(beaverId));
}

function artworksMadeCount(world: World, beaverId: EntityId): number {
  let count = 0;
  for (const id of world.entities.liveIdsOfKind("good")) {
    const good = getGood(world.components, id);
    if (good?.goodKind === "artwork" && good.makerId === beaverId) count++;
  }
  return count;
}

/** Real `[0, 1]` significance score -- a weighted, capped sum of real deeds, never an authored per-beaver flag. */
export function significanceOf(world: World, beaverId: EntityId): number {
  let score = 0;
  score += Math.min(0.3, offspringCount(world, beaverId) * 0.1);
  score += isCurrentLeaderOfAnyHousehold(world, beaverId) ? 0.4 : everWasLeader(world, beaverId) ? 0.25 : 0;
  score += Math.min(0.3, artworksMadeCount(world, beaverId) * 0.15);
  score += Math.abs(reputationOf(world, beaverId)) * 0.3;
  return Math.min(1, score);
}

/** Whether `beaverId` (live or historical -- `EntityIdRegistry.isKnown`'s own "resolves forever after death" precedent means this works for the deceased too) has crossed `HISTORICAL_FIGURE_THRESHOLD`. */
export function isHistoricalFigure(world: World, beaverId: EntityId, threshold: number = HISTORICAL_FIGURE_THRESHOLD): boolean {
  return significanceOf(world, beaverId) >= threshold;
}

/** Every KNOWN (live or dead) beaver id ever significant enough to count as a historical figure -- scans real recorded deed-bearing events for candidate ids (never every entity ever created) rather than an unbounded registry scan. */
export function allHistoricalFigures(world: World, threshold: number = HISTORICAL_FIGURE_THRESHOLD): EntityId[] {
  const candidateIds = new Set<EntityId>();
  for (const eventType of ["offspring-born", "leader-appointed"]) {
    for (const event of world.events.eventsOfType(eventType)) {
      for (const id of [...event.subjectIds, ...event.objectIds]) candidateIds.add(id);
    }
  }
  for (const id of world.entities.liveIdsOfKind("good")) {
    const maker = getGood(world.components, id)?.makerId;
    if (maker !== undefined) candidateIds.add(maker);
  }
  return [...candidateIds].filter((id) => world.entities.isKnown(id) && isHistoricalFigure(world, id, threshold)).sort((a, b) => a - b);
}
