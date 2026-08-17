import { defineComponent, type ComponentStore, type ComponentType } from "../core/ComponentStore.js";
import type { EntityId } from "../core/EntityId.js";
import type { EventId } from "../history/EventLog.js";
import type { CellCoordinate } from "../world/WorldGrid.js";
import type { World } from "../persistence/WorldSnapshot.js";
import { currentJobOf } from "../jobs/JobBoard.js";
import { getNeeds, clamp01, NEED_URGENT_THRESHOLD } from "./Needs.js";
import { getSleepClaim, getSleepSpaceDebugState } from "../spaces/SleepSpace.js";
import { getZone } from "../spaces/FunctionalSpace.js";
import { relationshipWith, setRelationshipWith, type KinRelation, type RelationshipEdge } from "./Relationships.js";

/**
 * P2-13's minimal social scheduler. This is intentionally not a hand-
 * authored scene system: it has no named narrative beats, no dialogue
 * scripts, no forced pathing, and no puppeteering of busy beavers. It
 * only turns ordinary live state -- idleness, social pressure, existing
 * relationship edges, P2-06 lodge occupancy, and physical presence in that
 * shared lodge room -- into a small generic interaction event and the
 * relationship changes that event can justify. Participants must already be
 * standing next to each other inside the same claimed lodge room; approach
 * and social routing are later tasks' job, not a parallel movement system
 * built here.
 */

export interface SocialState {
  socialNeed: number;
  lastInteractionTick?: number;
}
export const SocialStateComponent: ComponentType<SocialState> = defineComponent<SocialState>("social-state");

export const BASELINE_SOCIAL_STATE: Readonly<SocialState> = Object.freeze({ socialNeed: 0 });
export const SOCIAL_NEED_INCREASE_PER_IDLE_TICK = 0.01;
export const SOCIAL_INTERACTION_THRESHOLD = 0.6;
export const SOCIAL_INTERACTION_RELIEF = 0.5;
export const SOCIAL_FAMILIARITY_GAIN = 0.1;
export const SOCIAL_AFFINITY_GAIN = 0.03;

export interface SocialInteractionResult {
  participantIds: [EntityId, EntityId];
  eventId: EventId;
  venueZoneId: EntityId;
  location: CellCoordinate;
}

export interface SocialDebugState {
  beaverId: EntityId;
  socialState?: SocialState;
  idle: boolean;
  venueZoneId?: EntityId;
}

function assertNonNegativeInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new RangeError(`${label} must be a non-negative integer, got ${JSON.stringify(value)}`);
  }
}

export function assertValidSocialState(state: SocialState): void {
  if (state === null || typeof state !== "object") throw new RangeError("social state must be an object");
  if (!(state.socialNeed >= 0 && state.socialNeed <= 1)) {
    throw new RangeError(`social state socialNeed must be in [0, 1], got ${state.socialNeed}`);
  }
  if (state.lastInteractionTick !== undefined) assertNonNegativeInteger(state.lastInteractionTick, "social state lastInteractionTick");
}

export function setSocialState(components: ComponentStore, beaverId: EntityId, state: SocialState): void {
  assertValidSocialState(state);
  components.set(beaverId, SocialStateComponent, state);
}

export function getSocialState(components: ComponentStore, beaverId: EntityId): SocialState | undefined {
  const state = components.get(beaverId, SocialStateComponent);
  if (state !== undefined) assertValidSocialState(state);
  return state;
}

function assertLiveBeaver(world: World, beaverId: EntityId): void {
  if (!world.entities.isLive(beaverId) || world.entities.kindOf(beaverId) !== "beaver") {
    throw new RangeError(`social entity ${beaverId} is not a live beaver`);
  }
}

/** Exported so any world-aware reader of `SocialState` outside this file (e.g. `Mood.ts`) applies the same future-tick rejection this file's own callers already do -- not just this module's own paths. */
export function assertSocialStateNotFromFuture(world: World, state: SocialState): void {
  if (state.lastInteractionTick !== undefined && state.lastInteractionTick > world.clock.tick) {
    throw new RangeError(`social state lastInteractionTick ${state.lastInteractionTick} is after current world tick ${world.clock.tick}`);
  }
}

export function setWorldSocialState(world: World, beaverId: EntityId, state: SocialState): void {
  assertLiveBeaver(world, beaverId);
  assertSocialStateNotFromFuture(world, state);
  setSocialState(world.components, beaverId, state);
}

function urgentSurvivalNeed(world: World, beaverId: EntityId): boolean {
  const needs = getNeeds(world.components, beaverId);
  if (needs === undefined) return false;
  return needs.hunger >= NEED_URGENT_THRESHOLD || needs.thirst >= NEED_URGENT_THRESHOLD || needs.fatigue >= NEED_URGENT_THRESHOLD;
}

export function isSociallyIdle(world: World, beaverId: EntityId): boolean {
  assertLiveBeaver(world, beaverId);
  if (currentJobOf(world.entities, world.components, beaverId) !== undefined) return false;
  return !urgentSurvivalNeed(world, beaverId);
}

interface SocialVenue {
  zoneId: EntityId;
  location: CellCoordinate;
}

function socialVenueFor(world: World, beaverId: EntityId): SocialVenue | undefined {
  assertLiveBeaver(world, beaverId);
  const claim = getSleepClaim(world, beaverId);
  if (claim === undefined) return undefined;
  const debug = getSleepSpaceDebugState(world, claim.spaceId);
  if (!debug.usable || debug.placement === undefined) return undefined;
  const position = world.grid.positionOf(beaverId);
  if (position === undefined) throw new RangeError(`social beaver ${beaverId} has no grid position`);
  // A claimed lodge room only counts as the interaction venue while the
  // beaver is physically inside it -- claimed lodge state alone must never
  // let an interaction record a venue its participants are not standing in.
  const zone = getZone(world.components, debug.placement.zoneId);
  if (zone === undefined) return undefined;
  const insideZone = zone.cells.some((cell) => cell.x === position.x && cell.z === position.z);
  if (!insideZone) return undefined;
  return { zoneId: debug.placement.zoneId, location: position };
}

function areCloseEnoughForSocialContact(a: CellCoordinate, b: CellCoordinate): boolean {
  return Math.abs(a.x - b.x) + Math.abs(a.z - b.z) <= 1 && a.y === b.y;
}

function relationshipScore(world: World, a: EntityId, b: EntityId): number | undefined {
  const ab = relationshipWith(world.components, a, b);
  const ba = relationshipWith(world.components, b, a);
  if (ab === undefined || ba === undefined) return undefined;
  return ab.familiarity + ba.familiarity + ab.affinity + ba.affinity;
}

function improvedEdge(existing: RelationshipEdge | undefined, withId: EntityId): RelationshipEdge {
  const kin: KinRelation = existing?.kin ?? "unrelated";
  return {
    withId,
    kin,
    familiarity: clamp01((existing?.familiarity ?? 0) + SOCIAL_FAMILIARITY_GAIN),
    affinity: Math.min(1, Math.max(-1, (existing?.affinity ?? 0) + SOCIAL_AFFINITY_GAIN)),
  };
}

function applyRelationshipContact(world: World, a: EntityId, b: EntityId): void {
  setRelationshipWith(world.components, a, improvedEdge(relationshipWith(world.components, a, b), b));
  setRelationshipWith(world.components, b, improvedEdge(relationshipWith(world.components, b, a), a));
}

export function tickSocialNeeds(world: World): void {
  for (const beaverId of world.entities.liveIdsOfKind("beaver").sort((a, b) => a - b)) {
    const current = getSocialState(world.components, beaverId);
    if (current === undefined) continue;
    assertSocialStateNotFromFuture(world, current);
    if (!isSociallyIdle(world, beaverId)) continue;
    setWorldSocialState(world, beaverId, { ...current, socialNeed: clamp01(current.socialNeed + SOCIAL_NEED_INCREASE_PER_IDLE_TICK) });
  }
}

function choosePartner(world: World, beaverId: EntityId, candidates: readonly EntityId[], used: ReadonlySet<EntityId>): { partnerId: EntityId; venue: SocialVenue } | undefined {
  const ownState = getSocialState(world.components, beaverId);
  if (ownState === undefined) return undefined;
  assertSocialStateNotFromFuture(world, ownState);
  if (ownState.socialNeed < SOCIAL_INTERACTION_THRESHOLD || !isSociallyIdle(world, beaverId)) return undefined;
  const ownVenue = socialVenueFor(world, beaverId);
  if (ownVenue === undefined) return undefined;

  let best: { partnerId: EntityId; score: number; venue: SocialVenue } | undefined;
  for (const candidateId of candidates) {
    if (candidateId === beaverId || used.has(candidateId)) continue;
    const candidateState = getSocialState(world.components, candidateId);
    if (candidateState === undefined) continue;
    assertSocialStateNotFromFuture(world, candidateState);
    if (candidateState.socialNeed < SOCIAL_INTERACTION_THRESHOLD || !isSociallyIdle(world, candidateId)) continue;
    const score = relationshipScore(world, beaverId, candidateId);
    if (score === undefined) continue;
    const candidateVenue = socialVenueFor(world, candidateId);
    if (candidateVenue === undefined || candidateVenue.zoneId !== ownVenue.zoneId) continue;
    if (!areCloseEnoughForSocialContact(ownVenue.location, candidateVenue.location)) continue;
    if (best === undefined || score > best.score || (score === best.score && candidateId < best.partnerId)) {
      best = { partnerId: candidateId, score, venue: ownVenue };
    }
  }
  return best === undefined ? undefined : { partnerId: best.partnerId, venue: best.venue };
}

export function tickSocialInteractions(world: World): SocialInteractionResult[] {
  const results: SocialInteractionResult[] = [];
  const used = new Set<EntityId>();
  const beavers = world.entities.liveIdsOfKind("beaver").sort((a, b) => a - b);
  for (const beaverId of beavers) {
    if (used.has(beaverId)) continue;
    const choice = choosePartner(world, beaverId, beavers, used);
    if (choice === undefined) continue;
    const participantIds: [EntityId, EntityId] = beaverId < choice.partnerId ? [beaverId, choice.partnerId] : [choice.partnerId, beaverId];
    const beforeA = getSocialState(world.components, participantIds[0])!;
    const beforeB = getSocialState(world.components, participantIds[1])!;
    setWorldSocialState(world, participantIds[0], {
      socialNeed: clamp01(beforeA.socialNeed - SOCIAL_INTERACTION_RELIEF),
      lastInteractionTick: world.clock.tick,
    });
    setWorldSocialState(world, participantIds[1], {
      socialNeed: clamp01(beforeB.socialNeed - SOCIAL_INTERACTION_RELIEF),
      lastInteractionTick: world.clock.tick,
    });
    applyRelationshipContact(world, participantIds[0], participantIds[1]);
    const eventId = world.events.record({
      tick: world.clock.tick,
      eventType: "social-interaction",
      subjectIds: participantIds,
      objectIds: [choice.venue.zoneId],
      location: choice.venue.location,
    });
    used.add(participantIds[0]);
    used.add(participantIds[1]);
    results.push({ participantIds, eventId, venueZoneId: choice.venue.zoneId, location: choice.venue.location });
  }
  return results;
}

export function getSocialDebugState(world: World, beaverId: EntityId): SocialDebugState {
  assertLiveBeaver(world, beaverId);
  const socialState = getSocialState(world.components, beaverId);
  if (socialState !== undefined) assertSocialStateNotFromFuture(world, socialState);
  const venue = socialVenueFor(world, beaverId);
  return {
    beaverId,
    idle: isSociallyIdle(world, beaverId),
    ...(socialState === undefined ? {} : { socialState }),
    ...(venue === undefined ? {} : { venueZoneId: venue.zoneId }),
  };
}
