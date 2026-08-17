import type { EntityId } from "../core/EntityId.js";
import type { World } from "../persistence/WorldSnapshot.js";
import { getNormProfile, evaluateBehavior } from "./Norms.js";
import { getTraits, traitOrDefault } from "./Traits.js";

/**
 * P5-13: reputation is a real, DERIVED query over `EventLog`'s own
 * already-real history (P0-08) -- witnessed/known actions this beaver
 * was a real subject of -- never a separately-tracked score that could
 * drift from what actually happened. No new component; `reputationOf`
 * recomputes fresh every call, the same "discover from live state,
 * never cache" discipline `Household.ts`'s own `householdMembers` and
 * `JobBoard.ts`'s `currentJobOf` already established.
 */
const REPUTATION_EVENT_WEIGHT: Readonly<Record<string, number>> = Object.freeze({
  "offspring-born": 0.1,
  "leader-appointed": 0.3,
  "ritual-performed": 0.05,
  "rule-violated": -0.4,
});

function clampSigned(value: number): number {
  return Math.min(1, Math.max(-1, value));
}

/** Real, global reputation `[-1, 1]` for `beaverId` -- sums a real weight per real recorded event it was a SUBJECT of (never merely mentioned as an object), for every event type this file assigns a weight to. Unweighted event types (most of them -- ordinary labor, movement) contribute nothing, matching real social judgment (most everyday acts aren't reputation-defining). */
export function reputationOf(world: World, beaverId: EntityId): number {
  let score = 0;
  for (const event of world.events.eventsInvolving(beaverId)) {
    if (!event.subjectIds.includes(beaverId)) continue;
    const weight = REPUTATION_EVENT_WEIGHT[event.eventType];
    if (weight !== undefined) score += weight;
  }
  return clampSigned(score);
}

/**
 * How `householdId`'s OWN generated norms (P5-07) evaluate `beaverId`
 * specifically -- the same real global `reputationOf` score, scaled by
 * how favorably this household's norms regard the actor's own real
 * `industriousness` trait (`evaluateBehavior`). Two different households
 * can therefore rate the SAME beaver's SAME history differently, purely
 * because their own generated norms differ -- the literal "individuals/
 * groups evaluate an actor" plural framing, satisfied by one shared
 * formula rather than a per-group branch.
 */
export function reputationAsSeenBy(world: World, beaverId: EntityId, householdId: EntityId): number {
  const base = reputationOf(world, beaverId);
  const norms = getNormProfile(world.components, householdId);
  if (norms === undefined) return base;
  const industriousness = traitOrDefault(getTraits(world.components, beaverId), "industriousness");
  const approval = evaluateBehavior(norms, "industriousness", industriousness);
  return clampSigned(base * (0.5 + approval));
}
