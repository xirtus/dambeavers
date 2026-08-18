import type { EntityId } from "../core/EntityId.js";
import type { World } from "../persistence/WorldSnapshot.js";
import { getSite, SiteComponent } from "../region/Site.js";
import { getOwner, OwnerComponent, setOwner } from "../creatures/Ownership.js";
import { getGood } from "../economy/Good.js";

/**
 * P7-04: exchange value WITHOUT per-item scripted prices -- value is a
 * real function of relative scarcity: base utility (per-KIND balance
 * data, the same class of tunable constant as `Food.ts`'s nutrition
 * values) scaled by how scarce the kind actually is in the real world
 * state around the market location (supply = mass of that kind held by
 * real owners nearby; demand = the real populations that consume it).
 * Flood the market with planks and a plank is genuinely worth less;
 * strip a region bare and the last plank is genuinely worth more. No
 * price column exists anywhere on any item.
 */

/** Per-kind base utility -- balance data, NOT prices: the scarcity factor below is what moves real exchange value. Unknown kinds get a neutral default. */
export const BASE_UTILITY_BY_GOOD_KIND: Readonly<Record<string, number>> = Object.freeze({
  plank: 1,
  "stone-block": 1.4,
  "clay-brick": 1.1,
  "raw-stone": 0.8,
});

/** How far (Chebyshev region cells) a market draws supply/demand from -- its real catchment area. */
export const MARKET_RADIUS_CELLS = 6;

/** Per-kind demand weight per capita: how much one inhabitant's consumption presses on this kind (real data; unknown kinds default to 1). */
export const DEMAND_WEIGHT_BY_GOOD_KIND: Readonly<Record<string, number>> = Object.freeze({
  plank: 0.8,
  "stone-block": 0.5,
  "clay-brick": 0.5,
  "raw-stone": 0.4,
});

/** The market's real total supply of `goodKind`: mass held institutionally by any site within the catchment radius. */
export function marketSupply(world: World, goodKind: string, regionX: number, regionZ: number, radius: number = MARKET_RADIUS_CELLS): number {
  let supplyKg = 0;
  for (const siteId of world.components.query(SiteComponent)) {
    const site = getSite(world.components, siteId);
    if (site === undefined) continue;
    if (Math.max(Math.abs(site.regionX - regionX), Math.abs(site.regionZ - regionZ)) > radius) continue;
    for (const itemId of world.components.query(OwnerComponent)) {
      const owner = getOwner(world.components, itemId);
      if (owner === undefined || owner.ownerType !== "institutional" || owner.ownerId !== siteId) continue;
      const good = getGood(world.components, itemId);
      if (good !== undefined && good.goodKind === goodKind) supplyKg += good.massKg;
    }
  }
  return supplyKg;
}

/** The market's real total demand for `goodKind`: the weighted population of every site within the catchment radius. */
export function marketDemand(world: World, goodKind: string, regionX: number, regionZ: number, radius: number = MARKET_RADIUS_CELLS): number {
  let demand = 0;
  for (const siteId of world.components.query(SiteComponent)) {
    const site = getSite(world.components, siteId);
    if (site === undefined) continue;
    if (Math.max(Math.abs(site.regionX - regionX), Math.abs(site.regionZ - regionZ)) > radius) continue;
    demand += site.populationCount * (DEMAND_WEIGHT_BY_GOOD_KIND[goodKind] ?? 1);
  }
  return demand;
}

const MIN_SCARCITY_FACTOR = 0.25;
const MAX_SCARCITY_FACTOR = 4;

/**
 * Real scarcity factor: demand per unit supply, clamped to a sane band
 * (a good nobody holds isn't worth infinity; a good of which there are
 * mountains isn't worth zero). 1 supply kg is never "nothing": the +1
 * floor keeps the factor finite and the zero-supply case meaningful.
 */
export function scarcityFactor(demand: number, supplyKg: number): number {
  return Math.min(MAX_SCARCITY_FACTOR, Math.max(MIN_SCARCITY_FACTOR, demand / (supplyKg + 1)));
}

/**
 * The real exchange value of one kg of `goodKind` at a market location:
 * base utility x real scarcity. Two markets with different real
 * supply/demand states therefore value the SAME kind differently, and
 * relative scarcity between kinds moves their exchange rates -- the
 * literal acceptance clause, with no price script anywhere.
 */
export function exchangeValueOf(world: World, goodKind: string, regionX: number, regionZ: number, radius: number = MARKET_RADIUS_CELLS): number {
  const base = BASE_UTILITY_BY_GOOD_KIND[goodKind] ?? 1;
  return base * scarcityFactor(marketDemand(world, goodKind, regionX, regionZ, radius), marketSupply(world, goodKind, regionX, regionZ, radius));
}

/** How many kg of `kindB` one kg of `kindA` is worth at this market -- a derived exchange rate, not a stored price. */
export function exchangeRate(world: World, kindA: string, kindB: string, regionX: number, regionZ: number, radius: number = MARKET_RADIUS_CELLS): number {
  const valueB = exchangeValueOf(world, kindB, regionX, regionZ, radius);
  if (valueB <= 0) return 0;
  return exchangeValueOf(world, kindA, regionX, regionZ, radius) / valueB;
}

/** Real barter: two institutionally-owned goods change owners when their computed values are within tolerance -- actual exchange at actual values, never a scripted trade. */
export const BARTER_TOLERANCE = 0.25;

export function barterExchange(world: World, itemAId: EntityId, itemBId: EntityId, ownerAId: EntityId, ownerBId: EntityId, marketX: number, marketZ: number, radius: number = MARKET_RADIUS_CELLS): boolean {
  const goodA = getGood(world.components, itemAId);
  const goodB = getGood(world.components, itemBId);
  const ownerA = getOwner(world.components, itemAId);
  const ownerB = getOwner(world.components, itemBId);
  if (goodA === undefined || goodB === undefined || ownerA === undefined || ownerB === undefined) return false;
  if (ownerA.ownerType !== "institutional" || ownerA.ownerId !== ownerAId) return false;
  if (ownerB.ownerType !== "institutional" || ownerB.ownerId !== ownerBId) return false;
  const valueA = goodA.massKg * exchangeValueOf(world, goodA.goodKind, marketX, marketZ, radius);
  const valueB = goodB.massKg * exchangeValueOf(world, goodB.goodKind, marketX, marketZ, radius);
  if (valueA <= 0 || valueB <= 0) return false;
  const ratio = valueA / valueB;
  if (Math.abs(ratio - 1) > BARTER_TOLERANCE) return false;
  setOwner(world.components, itemAId, { ownerType: "institutional", ownerId: ownerBId });
  setOwner(world.components, itemBId, { ownerType: "institutional", ownerId: ownerAId });
  return true;
}
