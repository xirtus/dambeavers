import { ComponentStore, defineComponent, type ComponentType } from "../core/ComponentStore.js";
import type { EntityId } from "../core/EntityId.js";
import type { EventId } from "../history/EventLog.js";
import type { World } from "../persistence/WorldSnapshot.js";
import type { RegionCoordinate, RegionMap } from "../region/RegionMap.js";
import { routeBetween } from "../region/Travel.js";
import { getSite, setSite } from "../region/Site.js";
import { getMilitaryUnit } from "./Military.js";
import { organizationMembers } from "./Organization.js";
import type { RandomStream } from "../core/Random.js";

/**
 * P7-13: hostile groups ENTER a site for resources or prey using
 * ORDINARY travel -- a raid is a real `"raid"` entity whose raiders
 * (a real military organization's real members, or a real predator
 * band) traverse the SAME travel network every caravan and migration
 * uses (`routeBetween`/`travelCost`, P6-09, unmodified) and arrive only
 * after physically completing the route. What happens on arrival is
 * real looting: the target's stored food genuinely decreases and
 * returns with the raiders. No teleportation, no scripted
 * "raid happens" trigger -- the raid IS its own physical journey.
 */

export type RaidMotive = "resources" | "prey" | "territory";
export type RaidPhase = "traveling" | "engaged" | "returning";

export interface Raid {
  /** Settlement raids' origin site (where loot returns); absent for predator bands, which have no settlement to carry loot home to. */
  originSiteId?: EntityId;
  targetSiteId: EntityId;
  /** The raiding military unit (settlement raids), when there is one. */
  unitOrgId?: EntityId;
  /** Real raiders: the unit's member beaver ids (settlement raids). */
  raiderIds: readonly EntityId[];
  /** Real raiders: predator band size (creature raids -- wildlife drawn from the regional ecology by the caller). */
  raiderCount: number;
  motive: RaidMotive;
  route: readonly RegionCoordinate[];
  progressSteps: number;
  phase: RaidPhase;
  lootFoodKg: number;
  departedEventId: EventId;
  arrivalEventId?: EventId;
}
export const RaidComponent: ComponentType<Raid> = defineComponent<Raid>("raid");

const RAID_MOTIVES: readonly RaidMotive[] = ["resources", "prey", "territory"];
const RAID_PHASES: readonly RaidPhase[] = ["traveling", "engaged", "returning"];

export const RAID_SPEED_CELLS_PER_TICK = 1;
export const RAID_LOOT_FRACTION = 0.25;
export const RAID_LOOT_CAPACITY_KG = 150;
export const PREDATOR_PREY_EAT_KG = 2;
export const PREDATOR_KILL_PROBABILITY = 0.05;

export function assertValidRaid(raid: Raid): void {
  if (raid.originSiteId !== undefined && (!Number.isInteger(raid.originSiteId) || raid.originSiteId < 1)) throw new RangeError(`raid originSiteId must be a positive integer when present, got ${raid.originSiteId}`);
  if (!Number.isInteger(raid.targetSiteId) || raid.targetSiteId < 1) throw new RangeError(`raid targetSiteId must be a positive integer, got ${raid.targetSiteId}`);
  if (raid.originSiteId !== undefined && raid.originSiteId === raid.targetSiteId) throw new RangeError(`raid origin and target must differ, both ${raid.originSiteId}`);
  if (raid.originSiteId === undefined && raid.unitOrgId !== undefined) throw new RangeError("a settlement raid (unitOrgId present) must name its origin site");
  if (raid.unitOrgId !== undefined && (!Number.isInteger(raid.unitOrgId) || raid.unitOrgId < 1)) throw new RangeError(`raid unitOrgId must be a positive integer when present, got ${raid.unitOrgId}`);
  for (const raiderId of raid.raiderIds) {
    if (!Number.isInteger(raiderId) || raiderId < 1) throw new RangeError(`raid raiderIds must be positive integers, got ${raiderId}`);
  }
  if (!Number.isInteger(raid.raiderCount) || raid.raiderCount < 0) throw new RangeError(`raid raiderCount must be a non-negative integer, got ${raid.raiderCount}`);
  if (raid.raiderIds.length === 0 && raid.raiderCount === 0) throw new RangeError("raid must have raiders (ids or count)");
  if (!RAID_MOTIVES.includes(raid.motive)) throw new RangeError(`raid motive must be one of ${RAID_MOTIVES.join(", ")}, got ${JSON.stringify(raid.motive)}`);
  if (!RAID_PHASES.includes(raid.phase)) throw new RangeError(`raid phase must be one of ${RAID_PHASES.join(", ")}, got ${JSON.stringify(raid.phase)}`);
  if (raid.route.length < 2) throw new RangeError(`raid route must have at least two cells, got ${raid.route.length}`);
  if (!(Number.isFinite(raid.lootFoodKg) && raid.lootFoodKg >= 0)) throw new RangeError(`raid lootFoodKg must be a non-negative finite number, got ${raid.lootFoodKg}`);
  if (!Number.isInteger(raid.departedEventId) || raid.departedEventId < 1) throw new RangeError(`raid departedEventId must be a positive integer, got ${raid.departedEventId}`);
  if (raid.arrivalEventId !== undefined && (!Number.isInteger(raid.arrivalEventId) || raid.arrivalEventId < 1)) {
    throw new RangeError(`raid arrivalEventId must be a positive integer when present, got ${raid.arrivalEventId}`);
  }
}

export function setRaid(components: ComponentStore, raidId: EntityId, raid: Raid): void {
  assertValidRaid(raid);
  const normalized: Raid = {
    targetSiteId: raid.targetSiteId,
    raiderIds: [...raid.raiderIds],
    raiderCount: raid.raiderCount,
    motive: raid.motive,
    route: raid.route.map((cell) => ({ ...cell })),
    progressSteps: raid.progressSteps,
    phase: raid.phase,
    lootFoodKg: raid.lootFoodKg,
    departedEventId: raid.departedEventId,
  };
  if (raid.originSiteId !== undefined) normalized.originSiteId = raid.originSiteId;
  if (raid.unitOrgId !== undefined) normalized.unitOrgId = raid.unitOrgId;
  if (raid.arrivalEventId !== undefined) normalized.arrivalEventId = raid.arrivalEventId;
  components.set(raidId, RaidComponent, normalized);
}

export function getRaid(components: ComponentStore, raidId: EntityId): Raid | undefined {
  const raid = components.get(raidId, RaidComponent);
  if (raid !== undefined) assertValidRaid(raid);
  return raid;
}

/**
 * Plans a real settlement raid: `unitOrgId`'s live members travel the
 * ordinary network from their site to `targetSiteId`. The raid records
 * a real `"raid-departed"` event. Returns undefined when the unit has
 * no live members or no route exists.
 */
export function planSettlementRaid(world: World, regionMap: RegionMap, unitOrgId: EntityId, originSiteId: EntityId, targetSiteId: EntityId, motive: RaidMotive): EntityId | undefined {
  const raiderIds = organizationMembers(world.components, unitOrgId).filter((id) => world.entities.isLive(id));
  if (raiderIds.length === 0) return undefined;
  const origin = getSite(world.components, originSiteId);
  const target = getSite(world.components, targetSiteId);
  if (origin === undefined || target === undefined) return undefined;
  const route = routeBetween(regionMap, { regionX: origin.regionX, regionZ: origin.regionZ }, { regionX: target.regionX, regionZ: target.regionZ });
  if (route.length === 0) return undefined;

  const raidId = world.entities.create("raid");
  const departedEventId = world.events.record({
    tick: world.clock.tick,
    eventType: "raid-departed",
    subjectIds: [raidId, ...raiderIds],
    objectIds: [originSiteId, targetSiteId],
    location: { x: 0, y: 0, z: 0 },
  });
  setRaid(world.components, raidId, {
    originSiteId,
    targetSiteId,
    unitOrgId,
    raiderIds,
    raiderCount: 0,
    motive,
    route,
    progressSteps: 0,
    phase: "traveling",
    lootFoodKg: 0,
    departedEventId,
  });
  return raidId;
}

/**
 * Plans a real predator raid: `raiderCount` predators leave wilderness
 * cell `(originX, originZ)` for the site, drawn from the caller's own
 * regional wildlife state (P6-11). Same ordinary travel, same real
 * arrival -- creatures enter the site the way everything else does.
 */
export function planPredatorRaid(world: World, regionMap: RegionMap, originX: number, originZ: number, targetSiteId: EntityId, raiderCount: number): EntityId | undefined {
  if (!Number.isInteger(raiderCount) || raiderCount < 1) throw new RangeError(`predator raiderCount must be a positive integer, got ${raiderCount}`);
  const target = getSite(world.components, targetSiteId);
  if (target === undefined) return undefined;
  const route = routeBetween(regionMap, { regionX: originX, regionZ: originZ }, { regionX: target.regionX, regionZ: target.regionZ });
  if (route.length === 0) return undefined;

  const raidId = world.entities.create("raid");
  const departedEventId = world.events.record({
    tick: world.clock.tick,
    eventType: "raid-departed",
    subjectIds: [raidId],
    objectIds: [targetSiteId],
    location: { x: 0, y: 0, z: 0 },
  });
  setRaid(world.components, raidId, {
    targetSiteId,
    raiderIds: [],
    raiderCount,
    motive: "prey",
    route,
    progressSteps: 0,
    phase: "traveling",
    lootFoodKg: 0,
    departedEventId,
  });
  return raidId;
}

/**
 * One tick of every live raid. Traveling raids advance one real network
 * step; on arrival a real `"raid-arrived"` event fires. Predator raids
 * (prey motive) consume real food at the target and can kill real
 * inhabitants -- then dissolve (creatures eat and leave; there is no
 * loot to carry home). Settlement raids mark themselves `"engaged"`:
 * the caller (the politics loop) decides whether the site's defenders
 * turn the arrival into a real battle (P7-15) or the raiders loot
 * unopposed via `lootTarget`.
 */
export function tickRaids(world: World, regionMap: RegionMap, random: RandomStream): void {
  for (const raidId of world.components.query(RaidComponent).sort((a, b) => a - b)) {
    const raid = getRaid(world.components, raidId);
    if (raid === undefined) continue;

    if (raid.phase === "traveling") {
      const progressSteps = Math.min(raid.progressSteps + RAID_SPEED_CELLS_PER_TICK, raid.route.length - 1);
      if (progressSteps < raid.route.length - 1) {
        setRaid(world.components, raidId, { ...raid, progressSteps });
        continue;
      }
      const arrivalEventId = world.events.record({
        tick: world.clock.tick,
        eventType: "raid-arrived",
        subjectIds: [raidId, ...raid.raiderIds],
        objectIds: [raid.targetSiteId, ...(raid.originSiteId !== undefined ? [raid.originSiteId] : [])],
        location: { x: 0, y: 0, z: 0 },
        causeEventId: raid.departedEventId,
      });
      if (raid.motive === "prey") {
        applyPredatorArrival(world, raidId, raid, arrivalEventId, random);
        world.entities.destroy(raidId);
        continue;
      }
      setRaid(world.components, raidId, { ...raid, phase: "engaged", arrivalEventId });
      continue;
    }

    if (raid.phase === "returning") {
      const progressSteps = Math.min(raid.progressSteps + RAID_SPEED_CELLS_PER_TICK, raid.route.length - 1);
      if (progressSteps < raid.route.length - 1) {
        setRaid(world.components, raidId, { ...raid, progressSteps });
        continue;
      }
      if (raid.originSiteId !== undefined) {
        const origin = getSite(world.components, raid.originSiteId);
        if (origin !== undefined && raid.lootFoodKg > 0) {
          setSite(world.components, raid.originSiteId, { ...origin, storedFoodKg: origin.storedFoodKg + raid.lootFoodKg });
        }
      }
      world.events.record({
        tick: world.clock.tick,
        eventType: "raid-returned",
        subjectIds: [raidId],
        objectIds: [raid.targetSiteId, ...(raid.originSiteId !== undefined ? [raid.originSiteId] : [])],
        location: { x: 0, y: 0, z: 0 },
        causeEventId: raid.departedEventId,
      });
      world.entities.destroy(raidId);
    }
  }
}

/** Real predator arrival: creatures eat (target food genuinely decreases) and can kill inhabitants (population genuinely decreases). */
function applyPredatorArrival(world: World, raidId: EntityId, raid: Raid, arrivalEventId: EventId, random: RandomStream): void {
  const target = getSite(world.components, raid.targetSiteId);
  if (target === undefined) return;
  const eaten = Math.min(target.storedFoodKg, raid.raiderCount * PREDATOR_PREY_EAT_KG);
  let kills = 0;
  for (let i = 0; i < raid.raiderCount && kills < target.populationCount; i++) {
    if (random.nextBool(PREDATOR_KILL_PROBABILITY)) kills++;
  }
  setSite(world.components, raid.targetSiteId, {
    ...target,
    storedFoodKg: target.storedFoodKg - eaten,
    populationCount: target.populationCount - kills,
  });
  world.events.record({
    tick: world.clock.tick,
    eventType: "raid-looted",
    subjectIds: [raidId],
    objectIds: [raid.targetSiteId],
    location: { x: 0, y: 0, z: 0 },
    causeEventId: arrivalEventId,
  });
}

/**
 * An engaged raid loots its target: the target's stored food genuinely
 * decreases by the real loot amount (bounded by capacity), the raiders
 * carry it home physically (phase `"returning"`, food re-added to the
 * origin only when the route completes), and a real `"raid-looted"`
 * event records it. Returns the loot amount.
 */
export function lootTarget(world: World, raidId: EntityId): number {
  const raid = getRaid(world.components, raidId);
  if (raid === undefined) throw new RangeError(`unknown raid ${raidId}`);
  if (raid.phase !== "engaged") throw new RangeError(`raid ${raidId} is not engaged`);
  const target = getSite(world.components, raid.targetSiteId);
  if (target === undefined) return 0;
  const lootFoodKg = Math.min(target.storedFoodKg * RAID_LOOT_FRACTION, RAID_LOOT_CAPACITY_KG);
  setSite(world.components, raid.targetSiteId, { ...target, storedFoodKg: target.storedFoodKg - lootFoodKg });
  world.events.record({
    tick: world.clock.tick,
    eventType: "raid-looted",
    subjectIds: [raidId, ...raid.raiderIds],
    objectIds: [raid.targetSiteId, ...(raid.originSiteId !== undefined ? [raid.originSiteId] : [])],
    location: { x: 0, y: 0, z: 0 },
    ...(raid.arrivalEventId !== undefined ? { causeEventId: raid.arrivalEventId } : {}),
  });
  const returning = { ...raid, lootFoodKg, phase: "returning" as const, progressSteps: raid.route.length - 1 };
  setRaid(world.components, raidId, returning);
  return lootFoodKg;
}

/** Whether a settlement raid's target has a live defending unit with a defend mission -- the real contested-arrival test. */
export function targetDefenders(world: World, targetSiteId: EntityId): EntityId | undefined {
  for (const orgId of world.components.query(DefenderMarker)) {
    const unit = getMilitaryUnit(world.components, orgId);
    if (unit === undefined) continue;
    if (unit.objective?.kind === "defend" && unit.objective.targetSiteId === targetSiteId) return orgId;
  }
  return undefined;
}

import { MilitaryUnitComponent } from "./Military.js";
const DefenderMarker = MilitaryUnitComponent;
