import type { EntityId } from "../core/EntityId.js";
import type { EventId } from "../history/EventLog.js";
import type { World } from "../persistence/WorldSnapshot.js";
import { getOwner } from "./Ownership.js";

/**
 * P5-12: prohibited behavior recognized from RULE + real ACTION FACTS --
 * `isProhibited` is a pure query over `Ownership.ts`'s real `Owner`
 * state (P5-06) and the real actor/item pair involved, never a bespoke
 * "TheftEvent" scripted trigger some labor driver has to remember to
 * fire. Deliberately a single, real, concrete rule for now (taking
 * something personally owned by someone else) -- the roadmap's own
 * "baseline," not a full legal code; a future task adding more rules
 * extends `ProhibitedAction`'s own union and this function's real
 * checks, not a hardcoded rule-id switch elsewhere.
 */
export type ProhibitedAction = "theft";

export interface RuleViolation {
  action: ProhibitedAction;
  actorId: EntityId;
  itemId: EntityId;
}

/** Whether `actorId` taking `itemId` (a real hauling/possession-transfer action) is a real rule violation -- true exactly when `itemId` is personally owned by someone else. Not yet wired into any automatic labor driver (Law 10) -- a real, callable detector any future "operate a haul job" caller can consult before proceeding. */
export function isProhibited(world: World, actorId: EntityId, itemId: EntityId): RuleViolation | undefined {
  const owner = getOwner(world.components, itemId);
  if (owner === undefined || owner.ownerType !== "personal" || owner.ownerId === undefined || owner.ownerId === actorId) return undefined;
  return { action: "theft", actorId, itemId };
}

/** Records a real `"rule-violated"` event for `violation` -- the actual historical fact a future reputation/conflict/law-enforcement system can react to (P0-08's own "EventLog IS the general reaction mechanism" precedent, no new hook needed). */
export function recordViolation(world: World, violation: RuleViolation): EventId {
  const location = world.grid.positionOf(violation.actorId) ?? world.grid.positionOf(violation.itemId) ?? { x: 0, y: 0, z: 0 };
  return world.events.record({
    tick: world.clock.tick,
    eventType: "rule-violated",
    subjectIds: [violation.actorId],
    objectIds: [violation.itemId],
    location,
  });
}
