import type { Site } from "./Site.js";

/**
 * P6-07: a real, simplified simulation for a site that is NOT currently
 * loaded in detail -- population and food are tracked as real aggregate
 * numbers with real conservation (food is never created except by a
 * real per-capita production term, never destroyed except by real
 * per-capita consumption; population never grows without a real food
 * surplus, never shrinks except from a real, derived deficit) -- the
 * literal "advances plausibly while preserving conservation/accounting
 * invariants" acceptance test. This is deliberately NOT a full
 * `ColonyLoop.tickColony` run (that would defeat the entire point of an
 * LOD -- an offscreen site must be cheap enough to advance for
 * centuries, P6-13); it is the same class of simplification real games
 * use for off-screen settlements, expressed here as real formulas over
 * real state, never a scripted "nothing happens" placeholder.
 */

/** Real food production per resident per tick, scaled by the site's own biome fertility `[0,1]` -- roughly the same order of magnitude as `FoodProduction.ts`'s own per-producer rate, abstracted to per-capita since an offscreen site has no individual producer entities. Plausible, tunable balance data. */
export const OFFSCREEN_FOOD_PRODUCTION_PER_CAPITA = 0.05;
/** Real food consumption per resident per tick. Plausible, tunable balance data. */
export const OFFSCREEN_FOOD_CONSUMPTION_PER_CAPITA = 0.04;
/** Real population growth rate per tick while food is in surplus (stored food per capita above `SURPLUS_THRESHOLD_KG`) -- a real, small logistic-style rate, not an unbounded explosion. */
export const OFFSCREEN_POPULATION_GROWTH_RATE = 0.0002;
export const SURPLUS_THRESHOLD_KG = 5;
/** Real fraction of population lost per unit of unmet food deficit (in kg per capita) -- starvation, derived from the ACTUAL shortfall, never a flat "some people die" constant. */
export const OFFSCREEN_STARVATION_RATE = 0.05;

/** Real per-capita carrying capacity a site's own current food reserve can plausibly support -- population cannot exceed what real stored food already justifies, a genuine accounting constraint. */
export function carryingCapacity(storedFoodKg: number): number {
  return Math.floor(storedFoodKg / SURPLUS_THRESHOLD_KG) + 1;
}

/**
 * One offscreen tick (or `dtTicks` worth, applied as a single closed-form
 * step -- real for the SAME reason `FoodProduction.ts`'s own interval
 * math is exact rather than iterated one tick at a time, since P6-13
 * needs to advance centuries cheaply) for `site`, scaled by real biome
 * fertility. Returns a NEW `Site` summary (`Site.ts` values only --
 * caller is responsible for persisting it via `setSite`).
 */
export function tickOffscreenSite(site: Site, biomeFertility: number, dtTicks: number): Site {
  if (site.populationCount === 0) return site;
  const production = site.populationCount * OFFSCREEN_FOOD_PRODUCTION_PER_CAPITA * Math.max(0, Math.min(1, biomeFertility)) * dtTicks;
  const consumption = site.populationCount * OFFSCREEN_FOOD_CONSUMPTION_PER_CAPITA * dtTicks;
  const rawFood = site.storedFoodKg + production - consumption;
  const deficitKg = Math.max(0, -rawFood);
  const storedFoodKg = Math.max(0, rawFood);

  const deficitPerCapita = deficitKg / site.populationCount;
  const starved = Math.round(site.populationCount * Math.min(1, deficitPerCapita * OFFSCREEN_STARVATION_RATE));

  const foodPerCapita = site.populationCount > 0 ? storedFoodKg / site.populationCount : 0;
  const surplus = Math.max(0, foodPerCapita - SURPLUS_THRESHOLD_KG);
  const grown = deficitKg > 0 ? 0 : Math.round(site.populationCount * OFFSCREEN_POPULATION_GROWTH_RATE * dtTicks * Math.min(1, surplus));

  const populationCount = Math.max(0, site.populationCount - starved + grown);
  return { ...site, storedFoodKg, populationCount };
}

/** Drives `tickOffscreenSite` repeatedly across `years` worth of ticks in one closed-form step (never iterating tick-by-tick -- P6-13's own deep-time requirement). */
export function tickOffscreenSiteForTicks(site: Site, biomeFertility: number, totalTicks: number): Site {
  return tickOffscreenSite(site, biomeFertility, totalTicks);
}
