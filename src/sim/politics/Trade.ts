import { ComponentStore, defineComponent, type ComponentType } from "../core/ComponentStore.js";
import type { EntityId } from "../core/EntityId.js";
import type { EventId } from "../history/EventLog.js";
import type { World } from "../persistence/WorldSnapshot.js";
import type { RegionCoordinate, RegionMap } from "../region/RegionMap.js";
import { routeBetween } from "../region/Travel.js";
import { getSite, setSite } from "../region/Site.js";
import { getOwner, setOwner } from "../creatures/Ownership.js";
import { getGood } from "../economy/Good.js";

/**
 * P7-03: shortages/surpluses create PHYSICAL inter-site trade flows --
 * a caravan is a real, persistent `"caravan"` entity carrying a real
 * amount of the source site's stored food (the site's own region-scale
 * physical state, P6-06/P6-07) along a real route computed over the
 * ordinary travel network (P6-09's `travelCost`, unmodified, via the
 * real shortest-cost `routeBetween`). The food is deducted from the
 * source ONLY at departure, arrives ONLY when the caravan physically
 * completes the route (no teleportation), and is delivered ONLY to a
 * destination that genuinely needed it. Optional goods move the same
 * way (their institutional owner transfers on arrival). Every step
 * records real events.
 */

/** Reserve each inhabitant is assumed to need before a site counts as having surplus (kg/capita). Real balance data, tunable like every other constant in this codebase. */
export const FOOD_RESERVE_KG_PER_CAPITA = 10;
/** A site is in real shortage when its stored food is below this fraction of its reserve. */
export const SHORTAGE_FRACTION = 0.5;
/** Hard cap on one caravan's food payload (kg). */
export const CARAVAN_CAPACITY_KG = 200;
/** Region cells advanced per tick -- one ordinary 8-connected step, the network's own granularity. */
export const CARAVAN_SPEED_CELLS_PER_TICK = 1;

export interface Caravan {
  originSiteId: EntityId;
  destinationSiteId: EntityId;
  foodKg: number;
  goodIds: readonly EntityId[];
  route: readonly RegionCoordinate[];
  /** Cells already travelled -- `progressSteps === route.length - 1` means arrived. */
  progressSteps: number;
  departedEventId: EventId;
}
export const CaravanComponent: ComponentType<Caravan> = defineComponent<Caravan>("caravan");

export function assertValidCaravan(caravan: Caravan): void {
  if (!Number.isInteger(caravan.originSiteId) || caravan.originSiteId < 1) throw new RangeError(`caravan originSiteId must be a positive integer, got ${caravan.originSiteId}`);
  if (!Number.isInteger(caravan.destinationSiteId) || caravan.destinationSiteId < 1) throw new RangeError(`caravan destinationSiteId must be a positive integer, got ${caravan.destinationSiteId}`);
  if (caravan.originSiteId === caravan.destinationSiteId) throw new RangeError(`caravan origin and destination must differ, both ${caravan.originSiteId}`);
  if (!(Number.isFinite(caravan.foodKg) && caravan.foodKg >= 0)) throw new RangeError(`caravan foodKg must be a non-negative finite number, got ${caravan.foodKg}`);
  if (caravan.foodKg === 0 && caravan.goodIds.length === 0) throw new RangeError("caravan must carry food or goods");
  for (const goodId of caravan.goodIds) {
    if (!Number.isInteger(goodId) || goodId < 1) throw new RangeError(`caravan goodIds must be positive integers, got ${goodId}`);
  }
  if (caravan.route.length < 2) throw new RangeError(`caravan route must have at least two cells, got ${caravan.route.length}`);
  if (caravan.progressSteps < 0 || caravan.progressSteps > caravan.route.length - 1) {
    throw new RangeError(`caravan progressSteps must be within the route, got ${caravan.progressSteps} for ${caravan.route.length} cells`);
  }
  if (!Number.isInteger(caravan.departedEventId) || caravan.departedEventId < 1) throw new RangeError(`caravan departedEventId must be a positive integer, got ${caravan.departedEventId}`);
}

export function setCaravan(components: ComponentStore, caravanId: EntityId, caravan: Caravan): void {
  assertValidCaravan(caravan);
  components.set(caravanId, CaravanComponent, {
    originSiteId: caravan.originSiteId,
    destinationSiteId: caravan.destinationSiteId,
    foodKg: caravan.foodKg,
    goodIds: [...caravan.goodIds],
    route: caravan.route.map((cell) => ({ ...cell })),
    progressSteps: caravan.progressSteps,
    departedEventId: caravan.departedEventId,
  });
}

export function getCaravan(components: ComponentStore, caravanId: EntityId): Caravan | undefined {
  const caravan = components.get(caravanId, CaravanComponent);
  if (caravan !== undefined) assertValidCaravan(caravan);
  return caravan;
}

/**
 * The site's real food balance in kg: stored food minus its reserve
 * (population x per-capita reserve). Positive = surplus available to
 * trade away; negative = the real shortfall it needs to import.
 */
export function foodBalance(world: World, siteId: EntityId): number {
  const site = getSite(world.components, siteId);
  if (site === undefined) throw new RangeError(`unknown site ${siteId}`);
  return site.storedFoodKg - site.populationCount * FOOD_RESERVE_KG_PER_CAPITA;
}

/** Real shortage: stored food is below half the reserve. */
export function hasFoodShortage(world: World, siteId: EntityId): boolean {
  const site = getSite(world.components, siteId);
  if (site === undefined) throw new RangeError(`unknown site ${siteId}`);
  return site.storedFoodKg < site.populationCount * FOOD_RESERVE_KG_PER_CAPITA * SHORTAGE_FRACTION;
}

/** Real surplus: strictly more stored food than the reserve. */
export function hasFoodSurplus(world: World, siteId: EntityId): boolean {
  return foodBalance(world, siteId) > 0;
}

/** Whether an active caravan already links `originId` to `destinationId` -- real state, prevents duplicate flows to the same destination. */
export function hasActiveCaravanBetween(world: World, originId: EntityId, destinationId: EntityId): boolean {
  for (const caravanId of world.components.query(CaravanComponent)) {
    const caravan = getCaravan(world.components, caravanId);
    if (caravan !== undefined && caravan.originSiteId === originId && caravan.destinationSiteId === destinationId) return true;
  }
  return false;
}

/**
 * Dispatches one real caravan when `originId` has surplus and
 * `destinationId` has shortage: computes the real route, deducts the
 * food (bounded by surplus, shortfall, and capacity) from the origin's
 * stored state AT DEPARTURE, and records a real `"trade-caravan-departed"`
 * event. Returns the caravan id, or undefined when no route exists or
 * the two sites' real states don't justify the flow.
 */
export function dispatchCaravan(world: World, regionMap: RegionMap, originId: EntityId, destinationId: EntityId): EntityId | undefined {
  if (hasActiveCaravanBetween(world, originId, destinationId)) return undefined;
  const origin = getSite(world.components, originId);
  const destination = getSite(world.components, destinationId);
  if (origin === undefined || destination === undefined) return undefined;
  const surplus = foodBalance(world, originId);
  if (surplus <= 0 || !hasFoodShortage(world, destinationId)) return undefined;

  const route = routeBetween(regionMap, { regionX: origin.regionX, regionZ: origin.regionZ }, { regionX: destination.regionX, regionZ: destination.regionZ });
  if (route.length === 0) return undefined;

  const shortfall = destination.populationCount * FOOD_RESERVE_KG_PER_CAPITA - destination.storedFoodKg;
  const foodKg = Math.min(surplus, shortfall, CARAVAN_CAPACITY_KG);
  setSite(world.components, originId, { ...origin, storedFoodKg: origin.storedFoodKg - foodKg });

  const caravanId = world.entities.create("caravan");
  const departedEventId = world.events.record({
    tick: world.clock.tick,
    eventType: "trade-caravan-departed",
    subjectIds: [caravanId],
    objectIds: [originId, destinationId],
    location: { x: 0, y: 0, z: 0 },
  });
  setCaravan(world.components, caravanId, {
    originSiteId: originId,
    destinationSiteId: destinationId,
    foodKg,
    goodIds: [],
    route,
    progressSteps: 0,
    departedEventId,
  });
  return caravanId;
}

/**
 * One tick of every live caravan: each advances one real network step.
 * A caravan that completes its route delivers -- the destination's
 * stored food rises by exactly the payload, each carried good's
 * institutional owner becomes the destination site, and a real
 * `"trade-goods-delivered"` event records the delivery (chained to the
 * departure). The caravan entity is then destroyed (its id remains
 * historically resolvable, like every other retired entity).
 */
export function tickCaravans(world: World, regionMap: RegionMap): void {
  for (const caravanId of world.components.query(CaravanComponent).sort((a, b) => a - b)) {
    const caravan = getCaravan(world.components, caravanId);
    if (caravan === undefined) continue;
    const progressSteps = Math.min(caravan.progressSteps + CARAVAN_SPEED_CELLS_PER_TICK, caravan.route.length - 1);
    if (progressSteps < caravan.route.length - 1) {
      setCaravan(world.components, caravanId, { ...caravan, progressSteps });
      continue;
    }

    const destination = getSite(world.components, caravan.destinationSiteId);
    if (destination !== undefined) {
      setSite(world.components, caravan.destinationSiteId, { ...destination, storedFoodKg: destination.storedFoodKg + caravan.foodKg });
      for (const goodId of caravan.goodIds) {
        const owner = getOwner(world.components, goodId);
        if (owner !== undefined && owner.ownerType === "institutional" && owner.ownerId === caravan.originSiteId) {
          setOwner(world.components, goodId, { ownerType: "institutional", ownerId: caravan.destinationSiteId });
        }
      }
    }
    world.events.record({
      tick: world.clock.tick,
      eventType: "trade-goods-delivered",
      subjectIds: [caravan.originSiteId],
      objectIds: [caravan.destinationSiteId, ...caravan.goodIds],
      location: { x: 0, y: 0, z: 0 },
      causeEventId: caravan.departedEventId,
    });
    world.entities.destroy(caravanId);
  }
}

/**
 * One tick of trade scheduling over every site: pairs each real surplus
 * with each real shortage (deterministic order), dispatching caravans
 * until the surplus is spoken for. Caravans are real entities; their
 * progress is advanced by `tickCaravans`.
 */
export function scheduleTrade(world: World, regionMap: RegionMap, siteIds: readonly EntityId[]): void {
  const sorted = [...siteIds].sort((a, b) => a - b);
  for (const originId of sorted) {
    if (!hasFoodSurplus(world, originId)) continue;
    for (const destinationId of sorted) {
      if (originId === destinationId) continue;
      if (!hasFoodShortage(world, destinationId)) continue;
      dispatchCaravan(world, regionMap, originId, destinationId);
      if (!hasFoodSurplus(world, originId)) break;
    }
  }
}

/** Real query: every good kind in a caravan's payload, with its mass -- the physical composition of the flow. */
export function caravanPayload(world: World, caravanId: EntityId): Array<{ goodId: EntityId; goodKind: string; massKg: number }> {
  const caravan = getCaravan(world.components, caravanId);
  if (caravan === undefined) return [];
  const payload: Array<{ goodId: EntityId; goodKind: string; massKg: number }> = [];
  for (const goodId of caravan.goodIds) {
    const good = getGood(world.components, goodId);
    if (good !== undefined) payload.push({ goodId, goodKind: good.goodKind, massKg: good.massKg });
  }
  return payload;
}
