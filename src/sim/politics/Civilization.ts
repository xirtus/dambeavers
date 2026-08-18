import { ComponentStore, defineComponent, type ComponentType } from "../core/ComponentStore.js";
import type { EntityId } from "../core/EntityId.js";
import type { EventId } from "../history/EventLog.js";
import type { World } from "../persistence/WorldSnapshot.js";
import { getSite } from "../region/Site.js";
import { getPoliticalEntity } from "./PoliticalEntity.js";
import { diplomaticStanding } from "./Diplomacy.js";
import { getBelief } from "../creatures/Belief.js";
import { organizationMembers, getOrganization } from "./Organization.js";
import { nameEntity } from "../creatures/Naming.js";
import type { RandomStream } from "../core/Random.js";

/**
 * P7-17: a civilization is a real, durable composition of real
 * settlements (P6-06 sites -- never a parallel polity model), real
 * institutions (P7-01 organizations whose members genuinely span the
 * member settlements), and a real shared historical identity (an actual
 * P5-08 belief whose origin is a real recorded event shared by the
 * founders -- the SAME causal history machinery everything else uses).
 * Formation requires the real preconditions the roadmap implies:
 * multiple settlements that actually relate (real diplomatic standing)
 * and actually share something (an institution or a belief) -- a
 * civilization cannot be declared into existence by fiat.
 */

export interface Civilization {
  memberSiteIds: readonly EntityId[];
  institutionOrgIds: readonly EntityId[];
  foundingBeliefId?: EntityId;
  foundingEventId: EventId;
  status: "active" | "dissolved";
  dissolvedEventId?: EventId;
  successorOfId?: EntityId;
}
export const CivilizationComponent: ComponentType<Civilization> = defineComponent<Civilization>("civilization");

export const CIVILIZATION_FORMATION_STANDING = 0.3;

export function assertValidCivilization(civilization: Civilization): void {
  if (civilization.memberSiteIds.length < 2) throw new RangeError(`civilization must have at least two member sites, got ${civilization.memberSiteIds.length}`);
  for (const siteId of civilization.memberSiteIds) {
    if (!Number.isInteger(siteId) || siteId < 1) throw new RangeError(`civilization memberSiteIds must be positive integers, got ${siteId}`);
  }
  if (new Set(civilization.memberSiteIds).size !== civilization.memberSiteIds.length) throw new RangeError(`civilization memberSiteIds must be unique, got ${JSON.stringify(civilization.memberSiteIds)}`);
  for (const orgId of civilization.institutionOrgIds) {
    if (!Number.isInteger(orgId) || orgId < 1) throw new RangeError(`civilization institutionOrgIds must be positive integers, got ${orgId}`);
  }
  if (civilization.foundingBeliefId !== undefined && (!Number.isInteger(civilization.foundingBeliefId) || civilization.foundingBeliefId < 1)) {
    throw new RangeError(`civilization foundingBeliefId must be a positive integer when present, got ${civilization.foundingBeliefId}`);
  }
  if (!Number.isInteger(civilization.foundingEventId) || civilization.foundingEventId < 1) {
    throw new RangeError(`civilization foundingEventId must be a positive integer, got ${civilization.foundingEventId}`);
  }
  if (civilization.status !== "active" && civilization.status !== "dissolved") {
    throw new RangeError(`civilization status must be active/dissolved, got ${JSON.stringify(civilization.status)}`);
  }
  if (civilization.status === "dissolved" && (civilization.dissolvedEventId === undefined || !Number.isInteger(civilization.dissolvedEventId) || civilization.dissolvedEventId < 1)) {
    throw new RangeError(`a dissolved civilization must carry a positive dissolvedEventId, got ${civilization.dissolvedEventId}`);
  }
  if (civilization.status === "active" && civilization.dissolvedEventId !== undefined) {
    throw new RangeError("an active civilization must not carry a dissolvedEventId");
  }
  if (civilization.successorOfId !== undefined && (!Number.isInteger(civilization.successorOfId) || civilization.successorOfId < 1)) {
    throw new RangeError(`civilization successorOfId must be a positive integer when present, got ${civilization.successorOfId}`);
  }
}

export function setCivilization(components: ComponentStore, civilizationId: EntityId, civilization: Civilization): void {
  assertValidCivilization(civilization);
  const normalized: Civilization = {
    memberSiteIds: [...civilization.memberSiteIds],
    institutionOrgIds: [...civilization.institutionOrgIds],
    foundingEventId: civilization.foundingEventId,
    status: civilization.status,
  };
  if (civilization.foundingBeliefId !== undefined) normalized.foundingBeliefId = civilization.foundingBeliefId;
  if (civilization.dissolvedEventId !== undefined) normalized.dissolvedEventId = civilization.dissolvedEventId;
  if (civilization.successorOfId !== undefined) normalized.successorOfId = civilization.successorOfId;
  components.set(civilizationId, CivilizationComponent, normalized);
}

export function getCivilization(components: ComponentStore, civilizationId: EntityId): Civilization | undefined {
  const civilization = components.get(civilizationId, CivilizationComponent);
  if (civilization !== undefined) assertValidCivilization(civilization);
  return civilization;
}

/** Real institution check: an organization whose live members include inhabitants of at least two of the given sites' primary households. */
function institutionSpans(world: World, orgId: EntityId, siteIds: readonly EntityId[]): boolean {
  const households = siteIds
    .map((siteId) => getPoliticalEntity(world.components, siteId)?.householdId)
    .filter((id): id is EntityId => id !== undefined);
  if (households.length < 2) return false;
  const memberHouseholds = new Set<EntityId>();
  for (const memberId of organizationMembers(world.components, orgId)) {
    for (const householdId of households) {
      const members = householdMembersOf(world, householdId);
      if (members.includes(memberId)) memberHouseholds.add(householdId);
    }
  }
  return memberHouseholds.size >= 2;
}

import { householdMembers } from "../creatures/Relationships.js";
function householdMembersOf(world: World, householdId: EntityId): EntityId[] {
  return householdMembers(world.components, householdId);
}

/** Real shared-identity check: a belief genuinely held by the primary households of at least two member sites. */
function sharedBelief(world: World, siteIds: readonly EntityId[]): EntityId | undefined {
  const households = siteIds
    .map((siteId) => getPoliticalEntity(world.components, siteId)?.householdId)
    .filter((id): id is EntityId => id !== undefined);
  if (households.length < 2) return undefined;
  for (const beliefId of world.components.query(BeliefMarker)) {
    const belief = getBelief(world.components, beliefId);
    if (belief === undefined) continue;
    const holders = new Set(belief.heldByHouseholdIds);
    const holdingHouseholds = households.filter((householdId) => holders.has(householdId));
    if (holdingHouseholds.length >= 2) return beliefId;
  }
  return undefined;
}

import { BeliefComponent } from "../creatures/Belief.js";
const BeliefMarker = BeliefComponent;

/**
 * The real preconditions for civilization formation: at least two
 * member sites, every pair's real diplomatic standing at or above the
 * threshold, AND a real shared bond -- either an institution spanning
 * multiple members or a belief held by multiple members' households.
 * Derived fresh, never a stored flag.
 */
export function canFormCivilization(world: World, siteIds: readonly EntityId[]): boolean {
  if (siteIds.length < 2) return false;
  for (const siteId of siteIds) {
    if (getSite(world.components, siteId) === undefined) return false;
  }
  for (let i = 0; i < siteIds.length; i++) {
    for (let j = i + 1; j < siteIds.length; j++) {
      if (diplomaticStanding(world, siteIds[i]!, siteIds[j]!) < CIVILIZATION_FORMATION_STANDING) return false;
    }
  }
  for (const orgId of world.components.query(OrgMarker)) {
    if (getOrganization(world.components, orgId) !== undefined && institutionSpans(world, orgId, siteIds)) return true;
  }
  return sharedBelief(world, siteIds) !== undefined;
}

import { OrganizationComponent } from "./Organization.js";
const OrgMarker = OrganizationComponent;

/**
 * Forms a real civilization: validates the real preconditions
 * (`canFormCivilization`), creates the persistent `"civilization"`
 * entity with a generated name (P5-10), adopts the shared belief (if
 * any) as its founding identity, and records `"civilization-founded"`
 * chained to the shared bond's own origin (the belief's origin event,
 * or the founding institution's formation event) -- real causal
 * history, not an authored founding myth.
 */
export function formCivilization(world: World, memberSiteIds: readonly EntityId[], institutionOrgIds: readonly EntityId[], random: RandomStream): EntityId {
  if (!canFormCivilization(world, memberSiteIds)) {
    throw new RangeError(`sites ${JSON.stringify(memberSiteIds)} do not meet civilization formation preconditions`);
  }
  const beliefId = sharedBelief(world, memberSiteIds);
  const institution = institutionOrgIds.find((orgId) => getOrganization(world.components, orgId) !== undefined && institutionSpans(world, orgId, memberSiteIds));

  let causeEventId: EventId | undefined;
  if (beliefId !== undefined) {
    causeEventId = getBelief(world.components, beliefId)!.originEventId;
  } else if (institution !== undefined) {
    causeEventId = getOrganization(world.components, institution)!.formedEventId;
  }

  const civilizationId = world.entities.create("civilization");
  const foundingEventId = world.events.record({
    tick: world.clock.tick,
    eventType: "civilization-founded",
    subjectIds: [...memberSiteIds],
    objectIds: [civilizationId, ...institutionOrgIds, ...(beliefId !== undefined ? [beliefId] : [])],
    location: { x: 0, y: 0, z: 0 },
    ...(causeEventId !== undefined ? { causeEventId } : {}),
  });
  setCivilization(world.components, civilizationId, {
    memberSiteIds: [...memberSiteIds],
    institutionOrgIds: [...institutionOrgIds],
    ...(beliefId !== undefined ? { foundingBeliefId: beliefId } : {}),
    foundingEventId,
    status: "active",
  });
  nameEntity(world, civilizationId, "group", random);
  return civilizationId;
}

/** Every member site that still exists (sites are permanent entities; population is the real liveness measure -- P7-18's collapse logic owns that). */
export function civilizationMemberSites(world: World, civilizationId: EntityId): EntityId[] {
  const civilization = getCivilization(world.components, civilizationId);
  if (civilization === undefined) return [];
  return civilization.memberSiteIds.filter((siteId) => getSite(world.components, siteId) !== undefined);
}

/** The civilization's real shared identity: its founding belief (the actual recorded origin event it references), if any. */
export function civilizationSharedIdentity(world: World, civilizationId: EntityId): EntityId | undefined {
  return getCivilization(world.components, civilizationId)?.foundingBeliefId;
}
