import { defineComponent, type ComponentType, type ComponentStore } from "../core/ComponentStore.js";
import type { EntityId } from "../core/EntityId.js";
import type { World } from "../persistence/WorldSnapshot.js";
import type { ColonyLoopDeps } from "../runtime/ColonyLoop.js";
import { relationshipWith } from "../creatures/Relationships.js";
import { getNeeds, NEED_URGENT_THRESHOLD } from "../creatures/Needs.js";
import { tickBeaverBehavior } from "../creatures/BeaverBehavior.js";
import { advanceTowards } from "../creatures/BeaverLocomotion.js";
import { nameOf } from "../creatures/Naming.js";
import { currentJobOf, suspendJob } from "../jobs/JobBoard.js";

/**
 * P9-08: companions -- autonomous characters accompany the player for
 * SOCIAL/SYSTEMIC reasons (their real relationship edge makes them
 * willing) while retaining ORDINARY AI: a companion is still ticked by
 * the colony loop through the same `tickBeaverBehavior` arbitration
 * (needs, rest, conflicts), only the job-assignment branch is skipped
 * (they accompany, not work) and a follow intent is added on top --
 * when the companion's ordinary arbitration produced no action of its
 * own, they path toward the player through the SAME
 * `advanceTowards` movement primitive every other agent uses. No
 * puppeteering, no teleport, no special companion state machine: one
 * real component, one real derived willingness score, one extra
 * ordinary-movement call per tick.
 */

export interface Companion {
  followsId: EntityId;
}
export const CompanionComponent: ComponentType<Companion> = defineComponent<Companion>("companion");

export const COMPANION_WILLINGNESS_THRESHOLD = 0.5;

/** P9 critic fix: the companion marker is snapshot state -- validate it. */
export function assertValidCompanion(companion: Companion): void {
  if (!Number.isInteger(companion.followsId) || companion.followsId < 1) {
    throw new RangeError(`companion followsId must be a positive integer, got ${companion.followsId}`);
  }
}

export function setCompanion(components: ComponentStore, beaverId: EntityId, companion: Companion): void {
  assertValidCompanion(companion);
  components.set(beaverId, CompanionComponent, companion);
}

export function getCompanion(components: ComponentStore, beaverId: EntityId): Companion | undefined {
  return components.get(beaverId, CompanionComponent);
}

export function isCompanion(components: ComponentStore, beaverId: EntityId): boolean {
  return components.has(beaverId, CompanionComponent);
}

/**
 * The real willingness of `candidateId` to accompany `playerId`, derived
 * from their actual relationship edge (familiarity + affinity, with a
 * real kin/mate bonus) -- a stranger will not follow you, a mate will.
 * Pure and deterministic.
 */
export function companionWillingness(world: World, playerId: EntityId, candidateId: EntityId): number {
  if (!world.entities.isLive(candidateId) || world.entities.kindOf(candidateId) !== "beaver") return 0;
  if (candidateId === playerId) return 0;
  const edge = relationshipWith(world.components, candidateId, playerId) ?? relationshipWith(world.components, playerId, candidateId);
  if (edge === undefined) return 0;
  let score = (edge.familiarity ?? 0) * 0.4 + Math.max(0, edge.affinity) * 0.6;
  if (edge.kin !== "unrelated") score += 0.4;
  return Math.min(1, score);
}

/** Offers companionship -- requires the candidate's real willingness. The candidate's held job is suspended (requeued unclaimed) -- companions skip job work, so a held reservation would otherwise stall forever. Returns the companion record or undefined. */
export function inviteCompanion(world: World, playerId: EntityId, candidateId: EntityId): { companionId: EntityId; eventId: number } | undefined {
  if (companionWillingness(world, playerId, candidateId) < COMPANION_WILLINGNESS_THRESHOLD) return undefined;
  const heldJob = currentJobOf(world.entities, world.components, candidateId);
  if (heldJob !== undefined) suspendJob(world.components, heldJob);
  setCompanion(world.components, candidateId, { followsId: playerId });
  const eventId = world.events.record({
    tick: world.clock.tick,
    eventType: "companion-joined",
    subjectIds: [candidateId],
    objectIds: [playerId],
    location: world.grid.positionOf(candidateId) ?? { x: 0, y: 0, z: 0 },
  });
  return { companionId: candidateId, eventId };
}

/** Dismisses a companion (or loses one whose player died) -- a real recorded leave. */
export function dismissCompanion(world: World, companionId: EntityId, reason: string): void {
  const companion = getCompanion(world.components, companionId);
  if (companion === undefined) return;
  world.components.remove(companionId, CompanionComponent);
  world.events.record({
    tick: world.clock.tick,
    eventType: "companion-left",
    subjectIds: [companionId],
    objectIds: [companion.followsId],
    location: world.grid.positionOf(companionId) ?? { x: 0, y: 0, z: 0 },
    data: { reason },
  });
}

/**
 * The companion's tick inside the colony loop (called INSTEAD of the
 * ordinary job-assignment branch): ordinary behavior arbitration first
 * (needs/rest exactly like everyone else), and when that produced no
 * action of its own, one ordinary movement step toward the player. If
 * the player is gone, the companionship ends -- honestly.
 */
export function tickCompanion(deps: ColonyLoopDeps, world: World, companionId: EntityId): void {
  const companion = getCompanion(world.components, companionId);
  if (companion === undefined) return;
  const playerId = companion.followsId;
  if (!world.entities.isLive(playerId)) {
    dismissCompanion(world, companionId, "the followed player is gone");
    return;
  }
  const outcome = tickBeaverBehavior(deps.grid, deps.terrain, deps.water, deps.materials, deps.entities, deps.components, companionId, deps.profile);
  if (outcome.kind === "working") return;

  // Ordinary follow: only when the companion's own needs aren't urgent
  // (a starving companion attends to survival first -- ordinary AI).
  const needs = getNeeds(deps.components, companionId);
  if (needs !== undefined && (needs.hunger >= NEED_URGENT_THRESHOLD || needs.thirst >= NEED_URGENT_THRESHOLD || needs.fatigue >= NEED_URGENT_THRESHOLD)) return;

  const playerPosition = world.grid.positionOf(playerId);
  if (playerPosition === undefined) return;
  const ownPosition = world.grid.positionOf(companionId);
  if (ownPosition === undefined) return;
  if (Math.max(Math.abs(ownPosition.x - playerPosition.x), Math.abs(ownPosition.z - playerPosition.z)) <= 1) return; // already beside the player
  advanceTowards(deps.grid, deps.terrain, deps.water, deps.materials, deps.components, companionId, { x: playerPosition.x, z: playerPosition.z });
}

/** Every current companion of `playerId`, sorted by id. */
export function companionsOf(components: ComponentStore, playerId: EntityId): EntityId[] {
  const companions: EntityId[] = [];
  for (const beaverId of components.query(CompanionComponent)) {
    const companion = getCompanion(components, beaverId);
    if (companion !== undefined && companion.followsId === playerId) companions.push(beaverId);
  }
  return companions.sort((a, b) => a - b);
}

/** The companion's real name for display (P5-10's own naming). */
export function companionName(world: World, companionId: EntityId): string {
  return nameOf(world, companionId) ?? `#${companionId}`;
}
