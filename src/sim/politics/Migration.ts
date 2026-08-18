import { ComponentStore, defineComponent, type ComponentType } from "../core/ComponentStore.js";
import type { EntityId } from "../core/EntityId.js";
import type { EventId } from "../history/EventLog.js";
import type { World } from "../persistence/WorldSnapshot.js";
import type { RegionCoordinate, RegionMap } from "../region/RegionMap.js";
import { routeBetween } from "../region/Travel.js";
import { getSite, setSite } from "../region/Site.js";
import { hasFoodShortage, foodBalance } from "./Trade.js";
import { OFFSCREEN_SITE_POPULATION_CAP } from "../region/OffscreenLOD.js";
import { getPoliticalEntity } from "./PoliticalEntity.js";
import { householdMembers, relationshipWith } from "../creatures/Relationships.js";
import { StressComponent } from "../creatures/Stress.js";

/**
 * P7-05: individuals/households move because of opportunity, danger,
 * kinship, or displacement -- each reason computed from REAL state, and
 * the move itself is physical: a `"migration-group"` entity carrying a
 * real number of inhabitants travels the ordinary travel network
 * (P6-09's `travelCost`, via the real `routeBetween`); the origin's
 * population drops at departure and the destination's rises only on
 * arrival. No teleportation, no scripted "they decide to leave" story
 * beat.
 */

export type MigrationReason = "opportunity" | "danger" | "kinship" | "displacement";

export interface MigrationGroup {
  originSiteId: EntityId;
  destinationSiteId: EntityId;
  populationCount: number;
  reason: MigrationReason;
  route: readonly RegionCoordinate[];
  progressSteps: number;
  departedEventId: EventId;
}
export const MigrationGroupComponent: ComponentType<MigrationGroup> = defineComponent<MigrationGroup>("migration-group");

const MIGRATION_REASONS: readonly MigrationReason[] = ["opportunity", "danger", "kinship", "displacement"];

export function assertValidMigrationGroup(group: MigrationGroup): void {
  if (!Number.isInteger(group.originSiteId) || group.originSiteId < 1) throw new RangeError(`migration-group originSiteId must be a positive integer, got ${group.originSiteId}`);
  if (!Number.isInteger(group.destinationSiteId) || group.destinationSiteId < 1) throw new RangeError(`migration-group destinationSiteId must be a positive integer, got ${group.destinationSiteId}`);
  if (group.originSiteId === group.destinationSiteId) throw new RangeError(`migration-group origin and destination must differ, both ${group.originSiteId}`);
  if (!Number.isInteger(group.populationCount) || group.populationCount < 1) throw new RangeError(`migration-group populationCount must be a positive integer, got ${group.populationCount}`);
  if (!MIGRATION_REASONS.includes(group.reason)) throw new RangeError(`migration-group reason must be one of ${MIGRATION_REASONS.join(", ")}, got ${JSON.stringify(group.reason)}`);
  if (group.route.length < 2) throw new RangeError(`migration-group route must have at least two cells, got ${group.route.length}`);
  if (group.progressSteps < 0 || group.progressSteps > group.route.length - 1) {
    throw new RangeError(`migration-group progressSteps must be within the route, got ${group.progressSteps} for ${group.route.length} cells`);
  }
  if (!Number.isInteger(group.departedEventId) || group.departedEventId < 1) throw new RangeError(`migration-group departedEventId must be a positive integer, got ${group.departedEventId}`);
}

export function setMigrationGroup(components: ComponentStore, groupId: EntityId, group: MigrationGroup): void {
  assertValidMigrationGroup(group);
  components.set(groupId, MigrationGroupComponent, {
    originSiteId: group.originSiteId,
    destinationSiteId: group.destinationSiteId,
    populationCount: group.populationCount,
    reason: group.reason,
    route: group.route.map((cell) => ({ ...cell })),
    progressSteps: group.progressSteps,
    departedEventId: group.departedEventId,
  });
}

export function getMigrationGroup(components: ComponentStore, groupId: EntityId): MigrationGroup | undefined {
  const group = components.get(groupId, MigrationGroupComponent);
  if (group !== undefined) assertValidMigrationGroup(group);
  return group;
}

/** How many recent ticks count as "recent" for danger memory. */
export const DANGER_MEMORY_TICKS = 4_800; // 10 days at 20 tps
export const MIGRATION_PUSH_THRESHOLD = 1;
export const MIGRATION_SPEED_CELLS_PER_TICK = 1;

const PUSH_EVENT_WEIGHT: Readonly<Record<string, number>> = Object.freeze({
  "raid-arrived": 0.8,
  "raid-looted": 1,
  "battle-began": 0.6,
  "territory-ceded": 1,
  "war-declared": 0.4,
});

/**
 * The site's real migration push score (danger + displacement +
 * shortage + stress, each from real state): recent hostile events
 * naming this site, territorial losses, food shortage, and (for an
 * actively-simulated site) the household's average stress. Derived
 * fresh every call.
 */
export function migrationPushScore(world: World, siteId: EntityId): number {
  let score = 0;
  const now = world.clock.tick;
  for (const eventType of Object.keys(PUSH_EVENT_WEIGHT)) {
    for (const event of world.events.eventsOfType(eventType)) {
      if (now - event.tick > DANGER_MEMORY_TICKS) continue;
      // Losing territory displaces the LOSER (the subject); raids,
      // battles, and war declarations press on anyone involved.
      const involved = eventType === "territory-ceded"
        ? event.subjectIds.includes(siteId)
        : event.subjectIds.includes(siteId) || event.objectIds.includes(siteId);
      if (involved) score += PUSH_EVENT_WEIGHT[eventType]!;
    }
  }
  if (hasFoodShortage(world, siteId)) score += 0.5;
  const entity = getPoliticalEntity(world.components, siteId);
  if (entity?.householdId !== undefined) {
    const members = householdMembers(world.components, entity.householdId).filter((id) => world.entities.isLive(id));
    if (members.length > 0) {
      let stressSum = 0;
      let counted = 0;
      for (const memberId of members) {
        const stress = world.components.get(memberId, StressComponent);
        if (stress !== undefined) {
          stressSum += stress.level;
          counted++;
        }
      }
      if (counted > 0) score += stressSum / counted;
    }
  }
  return score;
}

/**
 * The site's real pull score as a migration destination: opportunity
 * (its real food balance), spare capacity (distance from the population
 * cap), and kinship (live kin ties between its household and the
 * origin's -- real `Relationships.ts` edges, so kinship genuinely
 * pulls; absent for inactive sites, which have no member entities).
 */
export function migrationPullScore(world: World, originSiteId: EntityId, destinationSiteId: EntityId): number {
  const destination = getSite(world.components, destinationSiteId);
  if (destination === undefined) return 0;
  let score = Math.max(0, Math.min(1, foodBalance(world, destinationSiteId) / 100));
  score += Math.max(0, 1 - destination.populationCount / OFFSCREEN_SITE_POPULATION_CAP);

  const originEntity = getPoliticalEntity(world.components, originSiteId);
  const destEntity = getPoliticalEntity(world.components, destinationSiteId);
  if (originEntity?.householdId !== undefined && destEntity?.householdId !== undefined) {
    const originMembers = householdMembers(world.components, originEntity.householdId);
    const destMembers = new Set(householdMembers(world.components, destEntity.householdId));
    let kinLinks = 0;
    for (const memberId of originMembers) {
      for (const otherId of destMembers) {
        const edge = relationshipWith(world.components, memberId, otherId);
        if (edge !== undefined && edge.kin !== "unrelated") kinLinks++;
      }
    }
    if (kinLinks > 0) score += 0.5;
  }
  return score;
}

/** Whether a live migration group already left this site (one exodus at a time -- populations don't dribble away every tick). */
export function hasActiveOutboundMigration(world: World, originSiteId: EntityId): boolean {
  for (const groupId of world.components.query(MigrationGroupComponent)) {
    const group = getMigrationGroup(world.components, groupId);
    if (group !== undefined && group.originSiteId === originSiteId) return true;
  }
  return false;
}

/**
 * Plans one real migration: when the origin's push score clears the
 * threshold, its inhabitants consider every OTHER site and depart toward
 * the highest real pull score. Population is deducted from the origin at
 * departure, the group travels the real route, and the destination gains
 * it only on arrival (`tickMigrationGroups`). One exodus at a time per
 * origin (realistic pacing -- a pressured site doesn't drain as a
 * stream of micro-groups). The departure event's cause is the strongest
 * recent hostile event at the origin when the reason is
 * danger/displacement (real causal history), absent otherwise.
 */
export function planMigrations(world: World, regionMap: RegionMap, siteIds: readonly EntityId[]): EntityId[] {
  const created: EntityId[] = [];
  for (const originId of [...siteIds].sort((a, b) => a - b)) {
    const push = migrationPushScore(world, originId);
    if (push < MIGRATION_PUSH_THRESHOLD) continue;
    if (hasActiveOutboundMigration(world, originId)) continue;
    const origin = getSite(world.components, originId);
    if (origin === undefined || origin.populationCount <= 1) continue;

    let bestDestination: EntityId | undefined;
    let bestPull = 0;
    for (const destinationId of siteIds) {
      if (destinationId === originId) continue;
      const pull = migrationPullScore(world, originId, destinationId);
      if (pull > bestPull) {
        bestPull = pull;
        bestDestination = destinationId;
      }
    }
    if (bestDestination === undefined || bestPull <= 0) continue;
    const destination = getSite(world.components, bestDestination);
    if (destination === undefined) continue;
    const route = routeBetween(regionMap, { regionX: origin.regionX, regionZ: origin.regionZ }, { regionX: destination.regionX, regionZ: destination.regionZ });
    if (route.length === 0) continue;

    // Real reasons, resolved from real state in a fixed precedence order.
    // Same involvement rule as `migrationPushScore` above: a cession
    // displaces its LOSER (the subject) only -- the winner's presence
    // among the objects must not brand their own exodus "displacement".
    let reason: MigrationReason = "opportunity";
    let causeEventId: EventId | undefined;
    const now = world.clock.tick;
    outer: for (const eventType of Object.keys(PUSH_EVENT_WEIGHT)) {
      for (const event of world.events.eventsOfType(eventType)) {
        if (now - event.tick > DANGER_MEMORY_TICKS) continue;
        const involved = eventType === "territory-ceded"
          ? event.subjectIds.includes(originId)
          : event.subjectIds.includes(originId) || event.objectIds.includes(originId);
        if (involved) {
          reason = eventType === "territory-ceded" ? "displacement" : "danger";
          causeEventId = event.id;
          break outer;
        }
      }
    }
    if (reason === "opportunity" && kinshipPullOnly(world, originId, bestDestination)) {
      reason = "kinship";
    }

    const travelers = Math.max(1, Math.floor(origin.populationCount / 4));
    setSite(world.components, originId, { ...origin, populationCount: origin.populationCount - travelers });
    const groupId = world.entities.create("migration-group");
    const departedEventId = world.events.record({
      tick: world.clock.tick,
      eventType: "migration-departed",
      subjectIds: [groupId],
      objectIds: [originId, bestDestination],
      location: { x: 0, y: 0, z: 0 },
      ...(causeEventId !== undefined ? { causeEventId } : {}),
      // P8-04: the traveller count is recorded at the moment it happens
      // so site populations are reconstructible at past dates.
      data: { populationCount: travelers, reason },
    });
    setMigrationGroup(world.components, groupId, {
      originSiteId: originId,
      destinationSiteId: bestDestination,
      populationCount: travelers,
      reason,
      route,
      progressSteps: 0,
      departedEventId,
    });
    created.push(groupId);
  }
  return created;
}

function kinshipPullOnly(world: World, originSiteId: EntityId, destinationSiteId: EntityId): boolean {
  const originEntity = getPoliticalEntity(world.components, originSiteId);
  const destEntity = getPoliticalEntity(world.components, destinationSiteId);
  if (originEntity?.householdId === undefined || destEntity?.householdId === undefined) return false;
  const destMembers = new Set(householdMembers(world.components, destEntity.householdId));
  for (const memberId of householdMembers(world.components, originEntity.householdId)) {
    for (const otherId of destMembers) {
      const edge = relationshipWith(world.components, memberId, otherId);
      if (edge !== undefined && edge.kin !== "unrelated") return true;
    }
  }
  return false;
}

/**
 * One tick of every live migration group: each advances one real
 * network step; on arrival the destination's population rises by the
 * group's count and a real `"migration-arrived"` event (chained to the
 * departure) records it. The group entity is then destroyed.
 */
export function tickMigrationGroups(world: World, regionMap: RegionMap): void {
  for (const groupId of world.components.query(MigrationGroupComponent).sort((a, b) => a - b)) {
    const group = getMigrationGroup(world.components, groupId);
    if (group === undefined) continue;
    const progressSteps = Math.min(group.progressSteps + MIGRATION_SPEED_CELLS_PER_TICK, group.route.length - 1);
    if (progressSteps < group.route.length - 1) {
      setMigrationGroup(world.components, groupId, { ...group, progressSteps });
      continue;
    }
    const destination = getSite(world.components, group.destinationSiteId);
    if (destination !== undefined) {
      setSite(world.components, group.destinationSiteId, { ...destination, populationCount: destination.populationCount + group.populationCount });
    }
    world.events.record({
      tick: world.clock.tick,
      eventType: "migration-arrived",
      subjectIds: [group.destinationSiteId],
      objectIds: [group.originSiteId, groupId],
      location: { x: 0, y: 0, z: 0 },
      causeEventId: group.departedEventId,
      // P8-04: the arrival count is recorded at the moment it happens.
      data: { populationCount: group.populationCount },
    });
    world.entities.destroy(groupId);
  }
}

/** Every live migration group whose destination is `siteId` (real inbound traffic, derived). */
export function inboundMigrationGroups(world: World, siteId: EntityId): EntityId[] {
  const groups: EntityId[] = [];
  for (const groupId of world.components.query(MigrationGroupComponent)) {
    const group = getMigrationGroup(world.components, groupId);
    if (group !== undefined && group.destinationSiteId === siteId) groups.push(groupId);
  }
  return groups.sort((a, b) => a - b);
}
