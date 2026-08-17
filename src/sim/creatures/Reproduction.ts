import { defineComponent, type ComponentStore, type ComponentType } from "../core/ComponentStore.js";
import type { EntityId } from "../core/EntityId.js";
import type { EventId } from "../history/EventLog.js";
import type { CellCoordinate } from "../world/WorldGrid.js";
import type { World } from "../persistence/WorldSnapshot.js";
import { getIdentity, setIdentity, spawnBeaver } from "./Beaver.js";
import { initializeNewbornLifeStage } from "./Aging.js";
import {
  getHouseholdMembership,
  relationshipWith,
  setHouseholdMembership,
  setRelationshipWith,
} from "./Relationships.js";
import { getSleepClaim, getSleepSpaceDebugState, sleepSpaceClaimedBy } from "../spaces/SleepSpace.js";

/**
 * P2-11's birth mechanism. It does not model pregnancy, sex, childhood
 * capability, fertility curves, or mate-seeking behavior yet; those are
 * later systems. This layer only does the first durable simulation fact
 * the roadmap asks for: when an already-eligible pair exists in ordinary
 * relationship/lodge state, the world can produce a persistent offspring
 * entity with parent references, reciprocal kin edges, and a birth event.
 */

export interface Parentage {
  parentIds: [EntityId, EntityId];
  birthTick: number;
}
export const ParentageComponent: ComponentType<Parentage> = defineComponent<Parentage>("parentage");

export interface ReproductiveState {
  lastBirthTick?: number;
}
export const ReproductiveStateComponent: ComponentType<ReproductiveState> = defineComponent<ReproductiveState>("reproductive-state");

export const DEFAULT_BIRTH_INTERVAL_TICKS = 20 * 60 * 60 * 24 * 30;

export type ReproductionIneligibilityReason =
  | "same-parent"
  | "not-live-beaver"
  | "not-mutual-mates"
  | "missing-usable-claimed-sleep-space"
  | "not-same-lodge-room"
  | "birth-interval";

export interface ReproductionEligibility {
  eligible: boolean;
  reason: "eligible" | ReproductionIneligibilityReason;
  parentIds: [EntityId, EntityId];
  birthLocation?: CellCoordinate;
  lodgeZoneId?: EntityId;
}

export interface ProduceOffspringOptions {
  name?: string;
  birthIntervalTicks?: number;
}

export interface BirthResult {
  offspringId: EntityId;
  parentIds: [EntityId, EntityId];
  birthEventId: EventId;
  birthLocation: CellCoordinate;
  lodgeZoneId: EntityId;
}

function assertPositiveEntityId(value: unknown, label: string): asserts value is EntityId {
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new RangeError(`${label} must be a positive entity id, got ${JSON.stringify(value)}`);
  }
}

function assertNonNegativeInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new RangeError(`${label} must be a non-negative integer, got ${JSON.stringify(value)}`);
  }
}

function orderedPair(a: EntityId, b: EntityId): [EntityId, EntityId] {
  return a < b ? [a, b] : [b, a];
}

export function assertValidParentage(parentage: Parentage): void {
  if (parentage === null || typeof parentage !== "object") throw new RangeError("parentage must be an object");
  if (!Array.isArray(parentage.parentIds) || parentage.parentIds.length !== 2) {
    throw new RangeError(`parentage parentIds must contain exactly two parent ids, got ${JSON.stringify(parentage.parentIds)}`);
  }
  assertPositiveEntityId(parentage.parentIds[0], "parentage parentIds[0]");
  assertPositiveEntityId(parentage.parentIds[1], "parentage parentIds[1]");
  if (parentage.parentIds[0] === parentage.parentIds[1]) {
    throw new RangeError(`parentage parentIds must be distinct, got ${parentage.parentIds[0]}`);
  }
  assertNonNegativeInteger(parentage.birthTick, "parentage birthTick");
}

export function setParentage(components: ComponentStore, offspringId: EntityId, parentage: Parentage): void {
  assertValidParentage(parentage);
  components.set(offspringId, ParentageComponent, parentage);
}

export function getParentage(components: ComponentStore, offspringId: EntityId): Parentage | undefined {
  const parentage = components.get(offspringId, ParentageComponent);
  if (parentage !== undefined) assertValidParentage(parentage);
  return parentage;
}

function assertKnownBeaverParents(world: World, parentage: Parentage): void {
  for (const parentId of parentage.parentIds) {
    if (!world.entities.isKnown(parentId) || world.entities.kindOf(parentId) !== "beaver") {
      throw new RangeError(`parentage references parent id ${parentId}, which is not a known beaver entity`);
    }
  }
}

export function setWorldParentage(world: World, offspringId: EntityId, parentage: Parentage): void {
  assertValidParentage(parentage);
  assertKnownBeaverParents(world, parentage);
  world.components.set(offspringId, ParentageComponent, parentage);
}

export function getWorldParentage(world: World, offspringId: EntityId): Parentage | undefined {
  const parentage = getParentage(world.components, offspringId);
  if (parentage !== undefined) assertKnownBeaverParents(world, parentage);
  return parentage;
}

export function assertValidReproductiveState(state: ReproductiveState): void {
  if (state === null || typeof state !== "object") throw new RangeError("reproductive state must be an object");
  if (state.lastBirthTick !== undefined) assertNonNegativeInteger(state.lastBirthTick, "reproductive state lastBirthTick");
}

export function setReproductiveState(components: ComponentStore, beaverId: EntityId, state: ReproductiveState): void {
  assertValidReproductiveState(state);
  components.set(beaverId, ReproductiveStateComponent, state);
}

export function getReproductiveState(components: ComponentStore, beaverId: EntityId): ReproductiveState | undefined {
  const state = components.get(beaverId, ReproductiveStateComponent);
  if (state !== undefined) assertValidReproductiveState(state);
  return state;
}

function isLiveBeaver(world: World, id: EntityId): boolean {
  return world.entities.isLive(id) && world.entities.kindOf(id) === "beaver";
}

function areMutualMates(world: World, a: EntityId, b: EntityId): boolean {
  return relationshipWith(world.components, a, b)?.kin === "mate" && relationshipWith(world.components, b, a)?.kin === "mate";
}

function hasWaitedSinceLastBirth(world: World, id: EntityId, intervalTicks: number): boolean {
  const state = getReproductiveState(world.components, id);
  return state?.lastBirthTick === undefined || world.clock.tick - state.lastBirthTick >= intervalTicks;
}

function eligibleClaimedSleepPlacement(world: World, residentId: EntityId): { location: CellCoordinate; zoneId: EntityId } | undefined {
  const claim = getSleepClaim(world, residentId);
  if (claim === undefined) return undefined;
  if (sleepSpaceClaimedBy(world, claim.spaceId) !== residentId) return undefined;
  const debug = getSleepSpaceDebugState(world, claim.spaceId);
  if (!debug.usable || debug.placement === undefined) return undefined;
  const position = world.grid.positionOf(claim.spaceId);
  if (position === undefined) return undefined;
  return { location: position, zoneId: debug.placement.zoneId };
}

export function reproductionEligibility(
  world: World,
  parentA: EntityId,
  parentB: EntityId,
  options: { birthIntervalTicks?: number } = {},
): ReproductionEligibility {
  const parentIds = orderedPair(parentA, parentB);
  if (parentA === parentB) return { eligible: false, reason: "same-parent", parentIds };
  if (!isLiveBeaver(world, parentA) || !isLiveBeaver(world, parentB)) return { eligible: false, reason: "not-live-beaver", parentIds };
  if (!areMutualMates(world, parentA, parentB)) return { eligible: false, reason: "not-mutual-mates", parentIds };

  const placementA = eligibleClaimedSleepPlacement(world, parentA);
  const placementB = eligibleClaimedSleepPlacement(world, parentB);
  if (placementA === undefined || placementB === undefined) {
    return { eligible: false, reason: "missing-usable-claimed-sleep-space", parentIds };
  }
  if (placementA.zoneId !== placementB.zoneId) return { eligible: false, reason: "not-same-lodge-room", parentIds };

  const intervalTicks = options.birthIntervalTicks ?? DEFAULT_BIRTH_INTERVAL_TICKS;
  assertNonNegativeInteger(intervalTicks, "birthIntervalTicks");
  if (!hasWaitedSinceLastBirth(world, parentA, intervalTicks) || !hasWaitedSinceLastBirth(world, parentB, intervalTicks)) {
    return { eligible: false, reason: "birth-interval", parentIds };
  }

  return { eligible: true, reason: "eligible", parentIds, birthLocation: placementA.location, lodgeZoneId: placementA.zoneId };
}

function sharedLiveHouseholdId(world: World, parentA: EntityId, parentB: EntityId): EntityId | undefined {
  const householdA = getHouseholdMembership(world.components, parentA);
  const householdB = getHouseholdMembership(world.components, parentB);
  if (householdA === undefined || householdB === undefined) return undefined;
  if (householdA.householdId !== householdB.householdId) return undefined;
  if (!world.entities.isLive(householdA.householdId) || world.entities.kindOf(householdA.householdId) !== "household") {
    throw new RangeError(`shared household ${householdA.householdId} is not a live household entity`);
  }
  return householdA.householdId;
}

function wireKinRelationships(world: World, childId: EntityId, parentA: EntityId, parentB: EntityId): void {
  setRelationshipWith(world.components, parentA, { withId: childId, kin: "child", familiarity: 1, affinity: 0.6 });
  setRelationshipWith(world.components, parentB, { withId: childId, kin: "child", familiarity: 1, affinity: 0.6 });
  setRelationshipWith(world.components, childId, { withId: parentA, kin: "parent", familiarity: 1, affinity: 0.6 });
  setRelationshipWith(world.components, childId, { withId: parentB, kin: "parent", familiarity: 1, affinity: 0.6 });
}

export function produceOffspring(world: World, parentA: EntityId, parentB: EntityId, options: ProduceOffspringOptions = {}): BirthResult {
  const eligibility = reproductionEligibility(world, parentA, parentB, options);
  if (!eligibility.eligible || eligibility.birthLocation === undefined || eligibility.lodgeZoneId === undefined) {
    throw new RangeError(`parents ${parentA} and ${parentB} are not eligible to produce offspring: ${eligibility.reason}`);
  }
  const sharedHouseholdId = sharedLiveHouseholdId(world, parentA, parentB);

  const childId = spawnBeaver(world, { name: options.name ?? "Newborn", position: eligibility.birthLocation });
  if (options.name === undefined) setIdentity(world.components, childId, { name: `Kit-${childId}` });
  initializeNewbornLifeStage(world, childId);
  setWorldParentage(world, childId, { parentIds: eligibility.parentIds, birthTick: world.clock.tick });
  wireKinRelationships(world, childId, parentA, parentB);
  if (sharedHouseholdId !== undefined) setHouseholdMembership(world.components, childId, { householdId: sharedHouseholdId });

  setReproductiveState(world.components, parentA, { lastBirthTick: world.clock.tick });
  setReproductiveState(world.components, parentB, { lastBirthTick: world.clock.tick });

  const childPosition = world.grid.positionOf(childId);
  if (childPosition === undefined) throw new RangeError(`newborn ${childId} has no grid position`);
  const birthEventId = world.events.record({
    tick: world.clock.tick,
    eventType: "offspring-born",
    subjectIds: [childId],
    objectIds: [parentA, parentB, eligibility.lodgeZoneId],
    location: childPosition,
  });
  return {
    offspringId: childId,
    parentIds: eligibility.parentIds,
    birthEventId,
    birthLocation: childPosition,
    lodgeZoneId: eligibility.lodgeZoneId,
  };
}

export function tickReproduction(world: World, options: ProduceOffspringOptions & { maxBirths?: number } = {}): BirthResult[] {
  const maxBirths = options.maxBirths ?? 1;
  assertNonNegativeInteger(maxBirths, "maxBirths");
  const births: BirthResult[] = [];
  const beavers = world.entities.liveIdsOfKind("beaver").sort((a, b) => a - b);
  for (let i = 0; i < beavers.length; i++) {
    for (let j = i + 1; j < beavers.length; j++) {
      if (births.length >= maxBirths) return births;
      const a = beavers[i]!;
      const b = beavers[j]!;
      if (reproductionEligibility(world, a, b, options).eligible) {
        births.push(produceOffspring(world, a, b, options));
      }
    }
  }
  return births;
}

export interface ReproductionDebugState {
  beaverId: EntityId;
  name?: string;
  parentage?: Parentage;
  reproductiveState?: ReproductiveState;
}

export function getReproductionDebugState(world: World, beaverId: EntityId): ReproductionDebugState {
  const identity = getIdentity(world.components, beaverId);
  return {
    beaverId,
    ...(identity === undefined ? {} : { name: identity.name }),
    ...(getWorldParentage(world, beaverId) === undefined ? {} : { parentage: getWorldParentage(world, beaverId)! }),
    ...(getReproductiveState(world.components, beaverId) === undefined
      ? {}
      : { reproductiveState: getReproductiveState(world.components, beaverId)! }),
  };
}
