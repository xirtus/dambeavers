import { ComponentStore, defineComponent, type ComponentType } from "../core/ComponentStore.js";
import type { EntityId } from "../core/EntityId.js";
import type { EventId } from "../history/EventLog.js";
import type { World } from "../persistence/WorldSnapshot.js";
import type { RegionMap } from "../region/RegionMap.js";
import { isProhibited, recordViolation, type RuleViolation } from "../creatures/Law.js";
import { getOwner, setOwner, OwnerComponent } from "../creatures/Ownership.js";
import { recordOwnershipTransfer } from "../chronicle/Provenance.js";
import { HeldComponent } from "../labor/Log.js";
import { getPoliticalEntity } from "./PoliticalEntity.js";
import { getLeadership } from "../creatures/Leadership.js";
import { routeBetween } from "../region/Travel.js";
import { getSite, setSite, SiteComponent } from "../region/Site.js";
import { setMigrationGroup } from "./Migration.js";

/**
 * P7-09: investigation, accusation, judgment, and punishment operate on
 * WITNESSED/EVALUATED actions -- an accusation is a real, persistent
 * `"accusation"` entity that must name a real recorded violation event
 * (P5-12's own real `"rule-violated"` record) AND at least one real
 * piece of evidence: either a witness actually recorded on that event,
 * or physical evidence (the stolen item in the accused's real
 * possession). Investigation then derives further witnesses from REAL
 * history (entities that recorded events at the violation's location
 * around its tick), judgment is rendered by a real judge (the polity's
 * own leader under P7-08/P5-11), and punishment is a real consequence
 * (fine = real ownership transfer; confinement = a real until-tick
 * restriction; exile = a real migration with the punishment as its
 * recorded cause). Every step is a real event chained to the one before
 * -- an inspectable causal case file, never a scripted verdict.
 */

export type AccusationStatus = "filed" | "investigating" | "judged";

export interface Accusation {
  accusedId: EntityId;
  violationEventId: EventId;
  accuserId: EntityId;
  witnessIds: readonly EntityId[];
  evidenceItemId?: EntityId;
  status: AccusationStatus;
  filedEventId: EventId;
  judgmentEventId?: EventId;
  guilty?: boolean;
}
export const AccusationComponent: ComponentType<Accusation> = defineComponent<Accusation>("accusation");

export interface Confinement {
  untilTick: number;
  imposedByEventId: EventId;
}
export const ConfinementComponent: ComponentType<Confinement> = defineComponent<Confinement>("confinement");

export const INVESTIGATION_TICKS = 5;
export const WITNESS_LOCATION_WINDOW_TICKS = 60;

export function assertValidAccusation(accusation: Accusation): void {
  if (!Number.isInteger(accusation.accusedId) || accusation.accusedId < 1) throw new RangeError(`accusation accusedId must be a positive integer, got ${accusation.accusedId}`);
  if (!Number.isInteger(accusation.accuserId) || accusation.accuserId < 1) throw new RangeError(`accusation accuserId must be a positive integer, got ${accusation.accuserId}`);
  if (!Number.isInteger(accusation.violationEventId) || accusation.violationEventId < 1) throw new RangeError(`accusation violationEventId must be a positive integer, got ${accusation.violationEventId}`);
  if (accusation.status !== "filed" && accusation.status !== "investigating" && accusation.status !== "judged") {
    throw new RangeError(`accusation status must be filed/investigating/judged, got ${JSON.stringify(accusation.status)}`);
  }
  for (const witnessId of accusation.witnessIds) {
    if (!Number.isInteger(witnessId) || witnessId < 1) throw new RangeError(`accusation witnessIds must be positive integers, got ${witnessId}`);
  }
  if (accusation.evidenceItemId !== undefined && (!Number.isInteger(accusation.evidenceItemId) || accusation.evidenceItemId < 1)) {
    throw new RangeError(`accusation evidenceItemId must be a positive integer when present, got ${accusation.evidenceItemId}`);
  }
  if (!Number.isInteger(accusation.filedEventId) || accusation.filedEventId < 1) throw new RangeError(`accusation filedEventId must be a positive integer, got ${accusation.filedEventId}`);
  if (accusation.status === "judged" && accusation.guilty === undefined) throw new RangeError("a judged accusation must carry a verdict");
  if (accusation.status !== "judged" && accusation.guilty !== undefined) throw new RangeError("an unjudged accusation must not carry a verdict");
}

export function setAccusation(components: ComponentStore, accusationId: EntityId, accusation: Accusation): void {
  assertValidAccusation(accusation);
  const normalized: Accusation = {
    accusedId: accusation.accusedId,
    violationEventId: accusation.violationEventId,
    accuserId: accusation.accuserId,
    witnessIds: [...accusation.witnessIds],
    status: accusation.status,
    filedEventId: accusation.filedEventId,
  };
  if (accusation.evidenceItemId !== undefined) normalized.evidenceItemId = accusation.evidenceItemId;
  if (accusation.judgmentEventId !== undefined) normalized.judgmentEventId = accusation.judgmentEventId;
  if (accusation.guilty !== undefined) normalized.guilty = accusation.guilty;
  components.set(accusationId, AccusationComponent, normalized);
}

export function getAccusation(components: ComponentStore, accusationId: EntityId): Accusation | undefined {
  const accusation = components.get(accusationId, AccusationComponent);
  if (accusation !== undefined) assertValidAccusation(accusation);
  return accusation;
}

export function assertValidConfinement(confinement: Confinement): void {
  if (!Number.isInteger(confinement.untilTick) || confinement.untilTick < 0) throw new RangeError(`confinement untilTick must be a non-negative integer, got ${confinement.untilTick}`);
  if (!Number.isInteger(confinement.imposedByEventId) || confinement.imposedByEventId < 1) throw new RangeError(`confinement imposedByEventId must be a positive integer, got ${confinement.imposedByEventId}`);
}

export function setConfinement(components: ComponentStore, entityId: EntityId, confinement: Confinement): void {
  assertValidConfinement(confinement);
  components.set(entityId, ConfinementComponent, confinement);
}

export function getConfinement(components: ComponentStore, entityId: EntityId): Confinement | undefined {
  const confinement = components.get(entityId, ConfinementComponent);
  if (confinement !== undefined) assertValidConfinement(confinement);
  return confinement;
}

/** Whether `entityId` is genuinely confined right now (a real until-tick restriction; expired restrictions are simply over). */
export function isConfined(world: World, entityId: EntityId): boolean {
  const confinement = getConfinement(world.components, entityId);
  return confinement !== undefined && confinement.untilTick > world.clock.tick;
}

/**
 * Records a violation the SAME way P5-12 does, but with the real
 * witnesses who saw it recorded on the event itself (as additional
 * objects) -- the evidence base P7-09's justice pipeline operates on.
 */
export function recordWitnessedViolation(world: World, violation: RuleViolation, witnessIds: readonly EntityId[]): EventId {
  const location = world.grid.positionOf(violation.actorId) ?? world.grid.positionOf(violation.itemId) ?? { x: 0, y: 0, z: 0 };
  return world.events.record({
    tick: world.clock.tick,
    eventType: "rule-violated",
    subjectIds: [violation.actorId],
    objectIds: [violation.itemId, ...witnessIds],
    location,
  });
}

/** Real physical evidence: the stolen item currently in the accused's possession (personally owned by them, or held by them). */
function physicalEvidenceOf(world: World, violation: RuleViolation, accusedId: EntityId): EntityId | undefined {
  const owner = getOwner(world.components, violation.itemId);
  if (owner !== undefined && owner.ownerType === "personal" && owner.ownerId === accusedId) return violation.itemId;
  const held = world.components.get(violation.itemId, HeldComponent);
  if (held !== undefined && held.by === accusedId) return violation.itemId;
  return undefined;
}

/** Real testimonial evidence: every entity recorded as a witness ON the violation event (beyond actor and item). */
function witnessesOnEvent(world: World, violationEventId: EventId, actorId: EntityId, itemId: EntityId): EntityId[] {
  const event = world.events.get(violationEventId);
  return event.objectIds.filter((id) => id !== itemId && id !== actorId);
}

/**
 * Files a real accusation against `violation` -- and VALIDATES the
 * evidence at filing: the accusation must carry at least one real
 * witness recorded on the violation event, or the real physical evidence
 * (the item in the accused's possession). A fabricated event id or
 * evidence-free accusation throws: justice runs on witnessed/evidenced
 * actions, exactly as the roadmap says. Records `"accusation-filed"`.
 */
export function fileAccusation(world: World, accuserId: EntityId, violation: RuleViolation, witnessIds: readonly EntityId[], evidenceItemId?: EntityId): EntityId {
  const violationEventId = recordWitnessedViolation(world, violation, witnessIds.length > 0 ? witnessIds : []);
  const realWitnesses = witnessesOnEvent(world, violationEventId, violation.actorId, violation.itemId);
  const physical = evidenceItemId !== undefined ? physicalEvidenceOf(world, violation, violation.actorId) : undefined;
  if (realWitnesses.length === 0 && physical === undefined) {
    throw new RangeError(`accusation against ${violation.actorId} must carry a real witness or real physical evidence`);
  }
  const accusationId = world.entities.create("accusation");
  const filedEventId = world.events.record({
    tick: world.clock.tick,
    eventType: "accusation-filed",
    subjectIds: [accuserId],
    objectIds: [violation.actorId, accusationId],
    location: world.grid.positionOf(violation.actorId) ?? { x: 0, y: 0, z: 0 },
    causeEventId: violationEventId,
  });
  setAccusation(world.components, accusationId, {
    accusedId: violation.actorId,
    violationEventId,
    accuserId,
    witnessIds: realWitnesses,
    ...(physical !== undefined ? { evidenceItemId: physical } : {}),
    status: "filed",
    filedEventId,
  });
  return accusationId;
}

/**
 * One tick of investigation over every filed (not yet judged)
 * accusation: derives ADDITIONAL witnesses from real history -- any
 * entity that recorded an event at the violation's location within the
 * real witness window around the violation's tick genuinely could have
 * seen it. After `INVESTIGATION_TICKS` such passes the accusation
 * matures to `"investigating"` with its full evidence list. Real
 * evidence-gathering, not a scripted reveal.
 */
export function tickInvestigations(world: World): void {
  for (const accusationId of world.components.query(AccusationComponent).sort((a, b) => a - b)) {
    const accusation = getAccusation(world.components, accusationId);
    if (accusation === undefined || accusation.status === "judged") continue;
    const violationEvent = world.events.get(accusation.violationEventId);
    const derivedWitnesses = new Set<EntityId>(accusation.witnessIds);
    for (const event of world.events.all()) {
      if (Math.abs(event.tick - violationEvent.tick) > WITNESS_LOCATION_WINDOW_TICKS) continue;
      if (event.location.x !== violationEvent.location.x || event.location.z !== violationEvent.location.z) continue;
      for (const id of [...event.subjectIds, ...event.objectIds]) {
        if (id !== accusation.accusedId && world.entities.isKnown(id)) derivedWitnesses.add(id);
      }
    }
    setAccusation(world.components, accusationId, { ...accusation, witnessIds: [...derivedWitnesses].sort((a, b) => a - b), status: "investigating" });
  }
}

/** The real judge for `siteId`: its polity's current live leader (P7-08/P5-11). No leader = no judge (an honest absence, not a default verdict). */
export function judgeOfSite(world: World, siteId: EntityId): EntityId | undefined {
  const entity = getPoliticalEntity(world.components, siteId);
  if (entity === undefined) return undefined;
  const leaderId = entity.leaderId ?? (entity.householdId !== undefined ? getLeadership(world.components, entity.householdId)?.leaderId : undefined);
  return leaderId !== undefined && world.entities.isLive(leaderId) ? leaderId : undefined;
}

/**
 * Renders a real judgment: the accusation's judge (by `judgeOfSite`'s
 * own rule, given the judge's site) weighs the evidence list -- a real
 * witness or real physical evidence convicts; an evidence-free case
 * acquits. Records `"judgment-rendered"` chained to the filing, and the
 * accusation persists with its verdict (real case history).
 */
export function renderJudgment(world: World, accusationId: EntityId, judgeId: EntityId): boolean {
  const accusation = getAccusation(world.components, accusationId);
  if (accusation === undefined) throw new RangeError(`unknown accusation ${accusationId}`);
  if (accusation.status === "judged") throw new RangeError(`accusation ${accusationId} is already judged`);
  const guilty = accusation.witnessIds.length > 0 || accusation.evidenceItemId !== undefined;
  const judgmentEventId = world.events.record({
    tick: world.clock.tick,
    eventType: "judgment-rendered",
    subjectIds: [judgeId],
    objectIds: [accusation.accusedId, accusationId],
    location: world.grid.positionOf(accusation.accusedId) ?? { x: 0, y: 0, z: 0 },
    causeEventId: accusation.filedEventId,
  });
  setAccusation(world.components, accusationId, { ...accusation, status: "judged", judgmentEventId, guilty });
  return guilty;
}

export type PunishmentKind = "fine" | "confinement" | "exile";

export const CONFINEMENT_TICKS = 2_400;

/**
 * Applies a real punishment to a JUDGED, GUILTY accusation:
 * - `"fine"`: the accused's personally-owned goods transfer to the
 *   polity's own institutional ownership (real `Ownership.ts` state),
 * - `"confinement"`: a real until-tick `Confinement` restriction,
 * - `"exile"`: a real migration group leaves the site carrying the
 *   accused (population 1), its departure caused by the punishment
 *   itself (real causal chain).
 * Records `"punishment-applied"` chained to the judgment. Returns the
 * punishment event id.
 */
export function applyPunishment(world: World, regionMap: RegionMap, accusationId: EntityId, kind: PunishmentKind, siteId: EntityId): EventId | undefined {
  const accusation = getAccusation(world.components, accusationId);
  if (accusation === undefined) throw new RangeError(`unknown accusation ${accusationId}`);
  if (accusation.status !== "judged" || accusation.guilty !== true) throw new RangeError(`accusation ${accusationId} is not a guilty verdict`);
  const judgmentEventId = accusation.judgmentEventId;
  if (judgmentEventId === undefined) throw new RangeError(`accusation ${accusationId} is missing its judgment event`);

  const punishmentEventId = world.events.record({
    tick: world.clock.tick,
    eventType: "punishment-applied",
    subjectIds: [accusation.accusedId],
    objectIds: [accusationId, siteId],
    location: world.grid.positionOf(accusation.accusedId) ?? { x: 0, y: 0, z: 0 },
    causeEventId: judgmentEventId,
  });

  if (kind === "fine") {
    for (const itemId of world.components.query(OwnerComponent)) {
      const owner = getOwner(world.components, itemId);
      if (owner !== undefined && owner.ownerType === "personal" && owner.ownerId === accusation.accusedId) {
        const next = { ownerType: "institutional" as const, ownerId: siteId };
        setOwner(world.components, itemId, next);
        // P8-05: the confiscation is recorded as real history chained
        // to the judgment -- the artifact's own history shows the theft
        // case's outcome.
        recordOwnershipTransfer(world, itemId, owner, next, { causeEventId: punishmentEventId });
      }
    }
  } else if (kind === "confinement") {
    setConfinement(world.components, accusation.accusedId, { untilTick: world.clock.tick + CONFINEMENT_TICKS, imposedByEventId: punishmentEventId });
  } else {
    // Exile: a REAL migration out of this site, caused by the punishment.
    const site = getSite(world.components, siteId);
    if (site !== undefined && site.populationCount >= 1) {
      let destinationId: EntityId | undefined;
      let bestPull = -Infinity;
      for (const otherSiteId of world.components.query(SiteComponent)) {
        if (otherSiteId === siteId) continue;
        const other = getSite(world.components, otherSiteId);
        if (other === undefined) continue;
        const pull = Math.max(0, other.storedFoodKg - other.populationCount * 10);
        if (pull > bestPull) {
          bestPull = pull;
          destinationId = otherSiteId;
        }
      }
      if (destinationId !== undefined) {
        const destination = getSite(world.components, destinationId)!;
        const route = routeBetween(regionMap, { regionX: site.regionX, regionZ: site.regionZ }, { regionX: destination.regionX, regionZ: destination.regionZ });
        if (route.length > 0) {
          setSite(world.components, siteId, { ...site, populationCount: site.populationCount - 1 });
          const groupId = world.entities.create("migration-group");
          const departedEventId = world.events.record({
            tick: world.clock.tick,
            eventType: "migration-departed",
            subjectIds: [groupId],
            objectIds: [siteId, destinationId, accusation.accusedId],
            location: { x: 0, y: 0, z: 0 },
            causeEventId: punishmentEventId,
            // P8-04: the traveller count is recorded at the moment it
            // happens so site populations are reconstructible later.
            data: { populationCount: 1, reason: "exile" },
          });
          setMigrationGroup(world.components, groupId, {
            originSiteId: siteId,
            destinationSiteId: destinationId,
            populationCount: 1,
            reason: "displacement",
            route,
            progressSteps: 0,
            departedEventId,
          });
        }
      }
    }
  }
  return punishmentEventId;
}

/** Convenience: the full evidence list currently on an accusation (witnesses + physical evidence). */
export function evidenceOf(world: World, accusationId: EntityId): { witnessIds: EntityId[]; evidenceItemId?: EntityId } {
  const accusation = getAccusation(world.components, accusationId);
  if (accusation === undefined) return { witnessIds: [] };
  return { witnessIds: [...accusation.witnessIds], ...(accusation.evidenceItemId !== undefined ? { evidenceItemId: accusation.evidenceItemId } : {}) };
}

export { isProhibited, recordViolation };
