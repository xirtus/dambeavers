import { ComponentStore, defineComponent, type ComponentType } from "../core/ComponentStore.js";
import type { EntityId } from "../core/EntityId.js";
import type { EventId } from "../history/EventLog.js";
import type { World } from "../persistence/WorldSnapshot.js";
import { getSite, setSite } from "../region/Site.js";
import { claimedCellsOfSite } from "./Territory.js";
import { organizationMembers } from "./Organization.js";
import { diplomaticStanding, activeTreatiesOf, getTreaty } from "./Diplomacy.js";
import { getOwner, OwnerComponent } from "../creatures/Ownership.js";
import { getGood } from "../economy/Good.js";
import { householdMembers } from "../creatures/Relationships.js";
import { nameOf } from "../creatures/Naming.js";

/**
 * P7-02: a settlement IS a political entity -- the real P6-06 `Site`
 * entity, given a `political-entity` component that names its current
 * leader (a real beaver entity when the site is actively simulated, as
 * assigned by P7-08's government forms through P5-11's real leadership
 * machinery), its government form (a data id, resolved by
 * `Government.ts`), and its territory claims (P7-07's real claim
 * entities). Population, resources, and diplomatic identity are
 * DERIVED: population is the site's own real `populationCount` (P6-06),
 * resources are its real stored food plus its institutionally-owned
 * goods (`Ownership.ts` P5-06), and diplomatic identity is its name
 * (P5-10's shared `Identity`) plus its real diplomatic standing toward
 * every other polity (`Diplomacy.ts` P7-06). No parallel settlement
 * model is invented anywhere.
 */

export interface PoliticalEntity {
  /** Current leader: a real beaver entity id for an actively-simulated site. Absent while the site has no assigned leader. */
  leaderId?: EntityId;
  /** Data id of the site's government form -- resolved by `Government.ts` (P7-08), default `"elder-council"`. */
  governmentFormId: string;
  /** The site's own live territory claim entity ids (P7-07). */
  territoryClaimIds: readonly EntityId[];
  /** The primary household of an actively-simulated site, if one exists (P5-05/P6-06). */
  householdId?: EntityId;
  establishedEventId: EventId;
}
export const PoliticalEntityComponent: ComponentType<PoliticalEntity> = defineComponent<PoliticalEntity>("political-entity");

const FORM_ID_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

export function assertValidPoliticalEntity(entity: PoliticalEntity): void {
  if (!FORM_ID_PATTERN.test(entity.governmentFormId)) {
    throw new RangeError(`political-entity governmentFormId must be non-empty lowercase kebab-case, got ${JSON.stringify(entity.governmentFormId)}`);
  }
  for (const claimId of entity.territoryClaimIds) {
    if (!Number.isInteger(claimId) || claimId < 1) {
      throw new RangeError(`political-entity territoryClaimIds must be positive integers, got ${claimId}`);
    }
  }
  if (new Set(entity.territoryClaimIds).size !== entity.territoryClaimIds.length) {
    throw new RangeError(`political-entity territoryClaimIds must be unique, got ${JSON.stringify(entity.territoryClaimIds)}`);
  }
  if (entity.leaderId !== undefined && (!Number.isInteger(entity.leaderId) || entity.leaderId < 1)) {
    throw new RangeError(`political-entity leaderId must be a positive integer when present, got ${entity.leaderId}`);
  }
  if (entity.householdId !== undefined && (!Number.isInteger(entity.householdId) || entity.householdId < 1)) {
    throw new RangeError(`political-entity householdId must be a positive integer when present, got ${entity.householdId}`);
  }
  if (!Number.isInteger(entity.establishedEventId) || entity.establishedEventId < 1) {
    throw new RangeError(`political-entity establishedEventId must be a positive integer, got ${entity.establishedEventId}`);
  }
}

export function setPoliticalEntity(components: ComponentStore, siteId: EntityId, entity: PoliticalEntity): void {
  assertValidPoliticalEntity(entity);
  const normalized: PoliticalEntity = {
    governmentFormId: entity.governmentFormId,
    territoryClaimIds: [...entity.territoryClaimIds],
    establishedEventId: entity.establishedEventId,
  };
  if (entity.leaderId !== undefined) normalized.leaderId = entity.leaderId;
  if (entity.householdId !== undefined) normalized.householdId = entity.householdId;
  components.set(siteId, PoliticalEntityComponent, normalized);
}

export function getPoliticalEntity(components: ComponentStore, siteId: EntityId): PoliticalEntity | undefined {
  const entity = components.get(siteId, PoliticalEntityComponent);
  if (entity !== undefined) assertValidPoliticalEntity(entity);
  return entity;
}

/**
 * Establishes `siteId` as a real polity: attaches the political-entity
 * component (default government form `"elder-council"`, no leader until
 * P7-08's selection runs, no claims until P7-07 claims them) and records
 * a real `"polity-established"` event chained to the site's own founding
 * event (real causal history: the polity exists because the settlement
 * does).
 */
export function establishPolity(world: World, siteId: EntityId, governmentFormId: string = "elder-council"): void {
  const site = getSite(world.components, siteId);
  if (site === undefined) throw new RangeError(`unknown site ${siteId}`);
  if (getPoliticalEntity(world.components, siteId) !== undefined) return;
  const establishedEventId = world.events.record({
    tick: world.clock.tick,
    eventType: "polity-established",
    subjectIds: [siteId],
    location: { x: 0, y: 0, z: 0 },
    // P6-06 stores the founding event id as a plain number; EventLog's
    // branded EventId is the same underlying value (type-only cast).
    causeEventId: site.foundedEventId as EventId,
  });
  setPoliticalEntity(world.components, siteId, {
    governmentFormId,
    territoryClaimIds: [],
    ...(site.householdId !== undefined ? { householdId: site.householdId } : {}),
    establishedEventId,
  });
}

/**
 * Binds the polity's primary household (its real, persistent social
 * core -- the members every leadership/justice/military system draws
 * from) and mirrors it onto the site's own P6-06 `householdId` so the
 * settlement and its polity never disagree about who lives there.
 */
export function bindPolityHousehold(world: World, siteId: EntityId, householdId: EntityId): void {
  const entity = getPoliticalEntity(world.components, siteId);
  const site = getSite(world.components, siteId);
  if (entity === undefined || site === undefined) throw new RangeError(`unknown polity/site ${siteId}`);
  setPoliticalEntity(world.components, siteId, { ...entity, householdId });
  setSite(world.components, siteId, { ...site, householdId });
}

/** The polity's current leader (real beaver id), if one has been assigned. */
export function polityLeader(world: World, siteId: EntityId): EntityId | undefined {
  return getPoliticalEntity(world.components, siteId)?.leaderId;
}

/** The polity's real population -- the site's own live `populationCount` (P6-06), derived fresh. */
export function polityPopulation(world: World, siteId: EntityId): number {
  return getSite(world.components, siteId)?.populationCount ?? 0;
}

/**
 * The polity's real resources: its site-stored food PLUS the mass of
 * every good institutionally owned by the site itself. Derived fresh --
 * two ways of holding real value, both already-persistent state.
 */
export function polityResources(world: World, siteId: EntityId): { storedFoodKg: number; goodIds: EntityId[]; goodMassKg: number } {
  const site = getSite(world.components, siteId);
  const goodIds: EntityId[] = [];
  let goodMassKg = 0;
  for (const itemId of world.components.query(OwnerComponent)) {
    const owner = getOwner(world.components, itemId);
    if (owner !== undefined && owner.ownerType === "institutional" && owner.ownerId === siteId) {
      goodIds.push(itemId);
      const good = getGood(world.components, itemId);
      if (good !== undefined) goodMassKg += good.massKg;
    }
  }
  return { storedFoodKg: site?.storedFoodKg ?? 0, goodIds: goodIds.sort((a, b) => a - b), goodMassKg };
}

/** The polity's real territory: the cells of its own live claims (P7-07). */
export function polityTerritory(world: World, siteId: EntityId) {
  return claimedCellsOfSite(world, siteId);
}

/**
 * The polity's real diplomatic identity: its persisted name (P5-10) plus
 * the current standing toward every OTHER established polity, derived
 * from shared history (P7-06). Sorted by target site id for determinism.
 */
export function polityDiplomaticIdentity(world: World, siteId: EntityId): Array<{ targetSiteId: EntityId; standing: number; treaties: EntityId[] }> {
  const rows: Array<{ targetSiteId: EntityId; standing: number; treaties: EntityId[] }> = [];
  for (const otherSiteId of world.components.query(PoliticalEntityComponent).sort((a, b) => a - b)) {
    if (otherSiteId === siteId) continue;
    rows.push({
      targetSiteId: otherSiteId,
      standing: diplomaticStanding(world, siteId, otherSiteId),
      treaties: activeTreatiesOf(world, siteId).filter((treatyId) => {
        const treaty = getTreaty(world.components, treatyId);
        return treaty !== undefined && treaty.partyIds.includes(otherSiteId);
      }),
    });
  }
  return rows;
}

/** The polity's persisted name (falls back to a stable id-based label when unnamed). */
export function polityName(world: World, siteId: EntityId): string {
  return nameOf(world, siteId) ?? `site-${siteId}`;
}

/** Every institutionally-owned good held in the name of any organization whose members include members of this polity's primary household -- the polity's real institutional assets. */
export function polityInstitutionalAssets(world: World, siteId: EntityId): EntityId[] {
  const entity = getPoliticalEntity(world.components, siteId);
  if (entity === undefined || entity.householdId === undefined) return [];
  const householdMemberIds = new Set(householdMembers(world.components, entity.householdId));
  const assets: EntityId[] = [];
  for (const itemId of world.components.query(OwnerComponent)) {
    const owner = getOwner(world.components, itemId);
    if (owner === undefined || owner.ownerType !== "institutional" || owner.ownerId === undefined) continue;
    const members = organizationMembers(world.components, owner.ownerId);
    if (members.some((memberId) => householdMemberIds.has(memberId))) assets.push(itemId);
  }
  return [...new Set([...assets, ...polityResources(world, siteId).goodIds])].sort((a, b) => a - b);
}
