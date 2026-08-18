import type { EntityId } from "../core/EntityId.js";
import type { EventId } from "../history/EventLog.js";
import type { World } from "../persistence/WorldSnapshot.js";
import { getSite } from "../region/Site.js";
import { getCivilization, setCivilization, formCivilization } from "./Civilization.js";
import { getOrganization, organizationMembers } from "./Organization.js";
import { beliefsOf, adoptBelief } from "../creatures/Belief.js";
import { getPoliticalEntity } from "./PoliticalEntity.js";
import { polityResources, polityInstitutionalAssets } from "./PoliticalEntity.js";
import { getOwner, OwnerComponent, setOwner } from "../creatures/Ownership.js";
import type { RandomStream } from "../core/Random.js";

/**
 * P7-18: civilizations can fragment, disappear, or be replaced -- and
 * when they do, their sites, artifacts, descendants, and history
 * PERSIST. Collapse is a real condition evaluated from real state (no
 * member site with living population, or no live shared institution)
 * and records a real `"civilization-collapsed"` event chained to the
 * precipitating event (the last member's death event, the disaster
 * that emptied a site). The civilization entity itself is NEVER
 * destroyed -- it persists dissolved, exactly like every other retired
 * entity in this codebase, so its history stays queryable forever.
 * Succession is real replacement: a new civilization may form over the
 * survivors with `successorOfId` pointing at the collapsed one,
 * ADOPTING its actual beliefs (P5-08's own real cultural transmission)
 * and inheriting its institutions' assets where they still exist --
 * recorded as `"civilization-succeeded"` chained to the collapse.
 */

/** How long (ticks) a site's recorded population-decline events stay "recent" for collapse evaluation. */
export const COLLAPSE_MEMORY_TICKS = 48_000;

/** The real collapse conditions for `civilizationId`: every member site's population is zero, OR no institution of the civilization still has a live member. */
export function collapseConditionsOf(world: World, civilizationId: EntityId): { collapsed: boolean; causeEventId?: EventId } {
  const civilization = getCivilization(world.components, civilizationId);
  if (civilization === undefined || civilization.status === "dissolved") return { collapsed: true };

  let anyPopulated = false;
  let lastDeathEventId: EventId | undefined;
  for (const siteId of civilization.memberSiteIds) {
    const site = getSite(world.components, siteId);
    if (site !== undefined && site.populationCount > 0) {
      anyPopulated = true;
      break;
    }
    const deaths = ["trauma-death", "starvation-death", "disease-death", "exposure-death", "drowning-death"];
    for (const eventType of deaths) {
      for (const event of world.events.eventsOfType(eventType)) {
        if (event.objectIds.includes(siteId) && event.tick > world.clock.tick - COLLAPSE_MEMORY_TICKS) lastDeathEventId = event.id;
      }
    }
  }

  let anyLiveInstitution = false;
  for (const orgId of civilization.institutionOrgIds) {
    const members = organizationMembers(world.components, orgId).filter((id) => world.entities.isLive(id));
    if (getOrganization(world.components, orgId) !== undefined && members.length > 0) {
      anyLiveInstitution = true;
      break;
    }
  }

  if (!anyPopulated && civilization.memberSiteIds.length > 0) return { collapsed: true, ...(lastDeathEventId !== undefined ? { causeEventId: lastDeathEventId } : {}) };
  if (civilization.institutionOrgIds.length > 0 && !anyLiveInstitution) return { collapsed: true };
  return { collapsed: false };
}

/**
 * Evaluates every active civilization and collapses the ones whose real
 * conditions fail: status -> `"dissolved"` (the entity persists), a real
 * `"civilization-collapsed"` event fires chained to the real
 * precipitating event when one is known. Sites, artifacts (every good
 * owned by the civilization's members/institutions keeps its real
 * owner), descendants, and history are untouched -- they persist by
 * construction (P0-02/P0-08's own forever-resolving identity/history
 * contracts).
 */
export function tickCivilizations(world: World): EntityId[] {
  const collapsedIds: EntityId[] = [];
  for (const civilizationId of world.components.query(CivilizationMarker).sort((a, b) => a - b)) {
    const civilization = getCivilization(world.components, civilizationId);
    if (civilization === undefined || civilization.status === "dissolved") continue;
    const conditions = collapseConditionsOf(world, civilizationId);
    if (!conditions.collapsed) continue;
    const dissolvedEventId = world.events.record({
      tick: world.clock.tick,
      eventType: "civilization-collapsed",
      subjectIds: [...civilization.memberSiteIds],
      objectIds: [civilizationId],
      location: { x: 0, y: 0, z: 0 },
      causeEventId: conditions.causeEventId ?? civilization.foundingEventId,
    });
    setCivilization(world.components, civilizationId, { ...civilization, status: "dissolved", dissolvedEventId });
    collapsedIds.push(civilizationId);
  }
  return collapsedIds;
}

import { CivilizationComponent } from "./Civilization.js";
const CivilizationMarker = CivilizationComponent;

/**
 * Real succession: forms a NEW civilization over `newMemberSiteIds`
 * with `successorOfId` naming the collapsed predecessor, adopting the
 * predecessor's actual beliefs into the successors' households
 * (P5-08's own cultural transmission -- the shared identity genuinely
 * carries over), and recording `"civilization-succeeded"` chained to
 * the predecessor's own collapse event. The predecessor's sites,
 * artifacts, and history remain exactly as they were -- replacement,
 * not erasure.
 */
export function succeedCivilization(world: World, collapsedCivilizationId: EntityId, newMemberSiteIds: readonly EntityId[], random: RandomStream): EntityId {
  const predecessor = getCivilization(world.components, collapsedCivilizationId);
  if (predecessor === undefined) throw new RangeError(`unknown civilization ${collapsedCivilizationId}`);
  if (predecessor.status !== "dissolved") throw new RangeError(`civilization ${collapsedCivilizationId} has not collapsed -- succession requires a real collapse`);
  if (predecessor.dissolvedEventId === undefined) throw new RangeError(`civilization ${collapsedCivilizationId} is missing its collapse event`);

  // Adopt the predecessor's real beliefs into the successors' households (real cultural transmission).
  const successorHouseholds = newMemberSiteIds
    .map((siteId) => getPoliticalEntity(world.components, siteId)?.householdId)
    .filter((id): id is EntityId => id !== undefined);
  const predecessorBelief = predecessor.foundingBeliefId;
  if (predecessorBelief !== undefined) {
    for (const householdId of successorHouseholds) {
      if (!beliefsOf(world, householdId).includes(predecessorBelief)) adoptBelief(world, predecessorBelief, householdId);
    }
  }

  // Institutions that still exist carry over as the successor's institutions.
  const institutionOrgIds = predecessor.institutionOrgIds.filter((orgId) => getOrganization(world.components, orgId) !== undefined);

  const successorId = formCivilization(world, newMemberSiteIds, institutionOrgIds, random);
  const successor = getCivilization(world.components, successorId)!;
  const succeededEventId = world.events.record({
    tick: world.clock.tick,
    eventType: "civilization-succeeded",
    subjectIds: [...newMemberSiteIds],
    objectIds: [successorId, collapsedCivilizationId],
    location: { x: 0, y: 0, z: 0 },
    causeEventId: predecessor.dissolvedEventId,
  });
  setCivilization(world.components, successorId, { ...successor, successorOfId: collapsedCivilizationId });
  return successorId;
}

/**
 * The real persistent legacy of a (possibly dissolved) civilization:
 * its member sites, its institutions' remaining assets, its founding
 * belief -- everything that must outlive the civilization itself. All
 * derived from live state; nothing is copied or duplicated.
 */
export function civilizationLegacy(world: World, civilizationId: EntityId): { siteIds: EntityId[]; assetGoodIds: EntityId[]; beliefIds: EntityId[] } {
  const civilization = getCivilization(world.components, civilizationId);
  if (civilization === undefined) return { siteIds: [], assetGoodIds: [], beliefIds: [] };
  const assetGoodIds = new Set<EntityId>();
  for (const orgId of civilization.institutionOrgIds) {
    for (const itemId of world.components.query(OwnerComponent)) {
      const owner = getOwner(world.components, itemId);
      if (owner !== undefined && owner.ownerType === "institutional" && owner.ownerId === orgId) assetGoodIds.add(itemId);
    }
  }
  for (const siteId of civilization.memberSiteIds) {
    for (const itemId of polityInstitutionalAssets(world, siteId)) assetGoodIds.add(itemId);
  }
  const beliefIds = civilization.foundingBeliefId !== undefined ? [civilization.foundingBeliefId] : [];
  return { siteIds: [...civilization.memberSiteIds], assetGoodIds: [...assetGoodIds].sort((a, b) => a - b), beliefIds };
}

export { polityResources, setOwner };
