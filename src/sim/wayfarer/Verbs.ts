import type { EntityId } from "../core/EntityId.js";
import type { ColumnCoordinate } from "../hydrology/WaterField.js";
import type { EventId } from "../history/EventLog.js";
import type { World } from "../persistence/WorldSnapshot.js";
import type { ColonyLoopDeps } from "../runtime/ColonyLoop.js";
import { getNeeds, setNeeds } from "../creatures/Needs.js";
import { eatFoodItem, drinkWater } from "../creatures/BeaverNeeds.js";
import { getFood } from "../labor/Food.js";
import { pickUp, drop, getHeld } from "../labor/Log.js";
import { findPath } from "../navigation/Pathfinding.js";
import { getSwimmer } from "../creatures/Beaver.js";
import { getGate, setGate } from "../hydrology/Gate.js";
import { getTool, getRequiredTool, hasHeldToolKindForLabor } from "../labor/Equipment.js";
import { practiceSkill } from "../creatures/SkillProgression.js";
import { getJob } from "../jobs/Job.js";
import { applyRelationshipContact, getSocialState, setWorldSocialState, SOCIAL_INTERACTION_RELIEF } from "../creatures/SocialInteraction.js";
import { conductConversation } from "./Conversation.js";
import { playerAttack } from "./Combat.js";
import { playerSteal } from "./Consequences.js";

/**
 * P9-02: the adventure-mode interaction verbs -- pickup, drop, use,
 * eat, drink, open, climb, swim, speak, and attack -- each operating on
 * ORDINARY world entities through the systems' own public primitives.
 * No verb has its own effect: pickup/drop are `Log.ts`'s own
 * (P1-09, with provenance recording), eat/drink are `BeaverNeeds.ts`'s
 * own exported primitives (the exact ones the ordinary AI calls), open
 * is the gate's own real `isOpen` state, use is P2-04's real tool
 * matching plus P2-03's real skill practice, speak is P2-12's own
 * relationship-contact machinery, and attack is the SAME exchange
 * primitive simulated battles use (P7-15's `resolveBattleExchange`).
 * Climb and swim are not separate verbs at all: they are what the
 * ordinary move command ALREADY does -- P1-04's navigation prices
 * slopes and water through the creature's own profile, so moving to a
 * higher cell IS climbing and moving into deep water IS swimming, with
 * the same costs and limits every other agent has.
 */

export type WayfarerVerb =
  | { kind: "pickup"; itemId: EntityId }
  | { kind: "drop"; itemId: EntityId; at: ColumnCoordinate }
  | { kind: "eat"; itemId: EntityId }
  | { kind: "drink" }
  | { kind: "open"; gateId: EntityId }
  | { kind: "use"; toolId: EntityId; targetId: EntityId }
  | { kind: "speak"; targetId: EntityId }
  | { kind: "attack"; targetId: EntityId }
  | { kind: "steal"; itemId: EntityId };

export interface VerbResult {
  ok: boolean;
  /** True when the world genuinely prevents this (out of reach, wrong item, no water) vs. a malformed request. */
  blocked: boolean;
  reason: string | undefined;
  /** Real events this verb recorded. */
  eventIds: EventId[];
}

function fail(reason: string, blocked = true): VerbResult {
  return { ok: false, blocked, reason, eventIds: [] };
}

/** The verb-layer reachability rule: the target column must be Chebyshev-adjacent to the actor AND genuinely reachable through ordinary navigation (the same path truth every other action uses -- the navigator is 4-connected, so a diagonal neighbor is a 2-step route, still adjacent). */
function canReach(deps: ColonyLoopDeps, world: World, actorId: EntityId, column: ColumnCoordinate): boolean {
  const position = world.grid.positionOf(actorId);
  if (position === undefined) return false;
  if (Math.max(Math.abs(position.x - column.x), Math.abs(position.z - column.z)) > 1) return false;
  const swimmer = getSwimmer(deps.components, actorId);
  if (swimmer === undefined) return false;
  const path = findPath(deps.grid, deps.terrain, deps.water, deps.materials, { x: position.x, z: position.z }, column, swimmer);
  return path !== undefined;
}

function targetColumn(world: World, targetId: EntityId): ColumnCoordinate | undefined {
  const position = world.grid.positionOf(targetId);
  return position === undefined ? undefined : { x: position.x, z: position.z };
}

/**
 * Executes one verb for the controlled beaver. The verb's effects are
 * entirely the underlying systems' own; this function only checks the
 * ordinary reachability/eligibility preconditions and returns what
 * happened.
 */
export function executeWayfarerVerb(deps: ColonyLoopDeps, world: World, beaverId: EntityId, verb: WayfarerVerb): VerbResult {
  switch (verb.kind) {
    case "pickup": {
      const column = targetColumn(world, verb.itemId);
      if (column === undefined) return fail(`item ${verb.itemId} has no position -- nothing to pick up`);
      if (!canReach(deps, world, beaverId, column)) return fail(`item ${verb.itemId} is not adjacent and reachable`);
      if (getHeld(deps.components, verb.itemId) !== undefined) return fail(`item ${verb.itemId} is already held`);
      pickUp(deps.components, deps.grid, verb.itemId, beaverId, world);
      return { ok: true, blocked: false, reason: undefined, eventIds: [] };
    }
    case "drop": {
      if (getHeld(deps.components, verb.itemId)?.by !== beaverId) return fail(`item ${verb.itemId} is not held by you`);
      if (!canReach(deps, world, beaverId, verb.at)) return fail(`drop cell (${verb.at.x}, ${verb.at.z}) is not adjacent and reachable`);
      drop(deps.components, deps.grid, verb.itemId, verb.at, world);
      return { ok: true, blocked: false, reason: undefined, eventIds: [] };
    }
    case "eat": {
      if (getFood(deps.components, verb.itemId) === undefined) return fail(`entity ${verb.itemId} is not food`);
      const heldBy = getHeld(deps.components, verb.itemId)?.by;
      const column = targetColumn(world, verb.itemId);
      const reachable = heldBy === beaverId || (column !== undefined && canReach(deps, world, beaverId, column));
      if (!reachable) return fail(`food ${verb.itemId} is neither held nor adjacent`);
      const needs = getNeeds(deps.components, beaverId);
      if (needs === undefined) return fail(`you have no Needs component`, false);
      // The SAME primitive the ordinary AI's seek-food pipeline calls.
      setNeeds(deps.components, beaverId, eatFoodItem(deps.entities, deps.components, deps.grid, beaverId, verb.itemId, needs, { world }));
      return { ok: true, blocked: false, reason: undefined, eventIds: [] };
    }
    case "drink": {
      const position = world.grid.positionOf(beaverId);
      if (position === undefined) return fail(`you have no position`, false);
      // The SAME accessibility check the ordinary AI's seek-water uses.
      if (deps.water.depthAt(position.x, position.z) <= 0) return fail(`no standing water here to drink`);
      const needs = getNeeds(deps.components, beaverId);
      if (needs === undefined) return fail(`you have no Needs component`, false);
      setNeeds(deps.components, beaverId, drinkWater(needs));
      return { ok: true, blocked: false, reason: undefined, eventIds: [] };
    }
    case "open": {
      const gate = getGate(deps.components, verb.gateId);
      if (gate === undefined) return fail(`entity ${verb.gateId} is not a gate`);
      if (!canReach(deps, world, beaverId, { x: gate.site.x, z: gate.site.z })) return fail(`gate ${verb.gateId} is not adjacent and reachable`);
      // The gate's own real state flips -- hydrology reads the same field.
      setGate(deps.components, verb.gateId, { ...gate, isOpen: !gate.isOpen });
      world.events.record({
        tick: world.clock.tick,
        eventType: gate.isOpen ? "gate-closed" : "gate-opened",
        subjectIds: [beaverId],
        objectIds: [verb.gateId],
        location: { x: gate.site.x, y: gate.y, z: gate.site.z },
      });
      return { ok: true, blocked: false, reason: undefined, eventIds: [] };
    }
    case "use": {
      const tool = getTool(deps.components, verb.toolId);
      const required = getRequiredTool(deps.components, verb.targetId);
      if (tool === undefined) return fail(`entity ${verb.toolId} is not a tool`);
      if (required === undefined) return fail(`entity ${verb.targetId} does not require a tool -- nothing to use it on`);
      if (getHeld(deps.components, verb.toolId)?.by !== beaverId) return fail(`tool ${verb.toolId} is not held by you`);
      const laborKind = tool.laborKinds[0];
      if (laborKind === undefined || !hasHeldToolKindForLabor(deps.components, beaverId, laborKind, required.toolKind)) {
        return fail(`tool ${verb.toolId} (${tool.toolKind}) does not match the required ${required.toolKind}`);
      }
      // The target's real location: its own placed position, or (for a
      // job entity, which lives at its target column) the job's own
      // recorded target.
      const placedColumn = targetColumn(world, verb.targetId);
      const job = getJob(deps.components, verb.targetId);
      const column = placedColumn ?? (job !== undefined ? { x: job.target.x, z: job.target.z } : undefined);
      if (column === undefined || !canReach(deps, world, beaverId, column)) return fail(`target ${verb.targetId} is not adjacent and reachable`);
      // Real use: ordinary skill practice (P2-03) + a real record.
      practiceSkill(deps.components, beaverId, laborKind, 1);
      const eventId = world.events.record({
        tick: world.clock.tick,
        eventType: "tool-used",
        subjectIds: [beaverId],
        objectIds: [verb.toolId, verb.targetId],
        location: { x: column.x, y: 0, z: column.z },
      });
      return { ok: true, blocked: false, reason: undefined, eventIds: [eventId] };
    }
    case "speak": {
      if (!world.entities.isLive(verb.targetId) || world.entities.kindOf(verb.targetId) !== "beaver") {
        return fail(`entity ${verb.targetId} is not a live beaver to speak with`);
      }
      const column = targetColumn(world, verb.targetId);
      if (column === undefined || !canReach(deps, world, beaverId, column)) return fail(`${verb.targetId} is not adjacent and reachable`);
      const result = conductConversation(world, beaverId, verb.targetId, "chat");
      return { ok: result.ok, blocked: !result.ok, reason: result.ok ? undefined : result.reason, eventIds: result.eventIds };
    }
    case "attack": {
      if (!world.entities.isLive(verb.targetId)) return fail(`entity ${verb.targetId} is not alive`);
      const column = targetColumn(world, verb.targetId);
      if (column === undefined || !canReach(deps, world, beaverId, column)) return fail(`${verb.targetId} is not adjacent and reachable`);
      const result = playerAttack(world, deps.materials, beaverId, verb.targetId, world.random.stream("wayfarer-attack"));
      return { ok: true, blocked: false, reason: undefined, eventIds: result.eventIds };
    }
    case "steal": {
      return playerSteal(deps, world, beaverId, verb.itemId);
    }
    default: {
      const exhaustive: never = verb;
      return fail(`unknown verb ${JSON.stringify(exhaustive)}`, false);
    }
  }
}

/** The ordinary social-need relief a successful speak applies -- the SAME constants/mechanism P2-12's own interactions use. */
export function relieveSocialNeed(world: World, beaverId: EntityId): void {
  const state = getSocialState(world.components, beaverId);
  if (state === undefined) return;
  setWorldSocialState(world, beaverId, {
    socialNeed: Math.max(0, state.socialNeed - SOCIAL_INTERACTION_RELIEF),
    lastInteractionTick: world.clock.tick,
  });
}

/** Applies the ordinary relationship-contact effect to a pair (exported here for the speak verb's own callers; delegates to P2-12's own function). */
export function applySpeakContact(world: World, speakerId: EntityId, listenerId: EntityId): void {
  applyRelationshipContact(world, speakerId, listenerId);
}
