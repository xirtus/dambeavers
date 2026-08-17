import { dayNightPhase, ambientTemperature, DAY_LENGTH_TICKS } from "./Weather.js";

/**
 * P4-01: seasons layer a slow annual cycle on top of P1-18's existing
 * day/night clock -- the same "pure function of `SimulationClock.tick`
 * alone" discipline `Weather.ts` already established (no separate
 * calendar counter to desync). `ambientTemperature`/`isDaytime`/
 * `applyPrecipitation` are all left untouched (existing callers,
 * tests, and balance data keep their exact current behavior); this file
 * ADDS a seasonal layer callers can opt into.
 */
export type Season = "spring" | "summer" | "autumn" | "winter";
const SEASON_ORDER: readonly Season[] = ["spring", "summer", "autumn", "winter"];

/** Ticks in one full simulated year -- deliberately a small, whole multiple of `DAY_LENGTH_TICKS` (a "year" of 20 in-game days) rather than a realistic 365, so a full seasonal cycle is observable within ordinary acceptance-test/soak-test tick budgets, matching `FOOD_PRODUCTION_YEAR_TICKS`'s own "short enough to drive directly, long enough to be meaningful" precedent. Plausible, tunable balance data. */
export const YEAR_LENGTH_TICKS = DAY_LENGTH_TICKS * 20;

function validateTick(tick: number): void {
  if (!Number.isInteger(tick) || tick < 0) throw new RangeError(`tick must be a non-negative integer, got ${tick}`);
}

/** `[0, 1)` fraction of the current year elapsed -- `0` deep winter/year start, `0.5` midsummer. */
export function yearPhase(tick: number): number {
  validateTick(tick);
  return (tick % YEAR_LENGTH_TICKS) / YEAR_LENGTH_TICKS;
}

/** Which of the four seasons `tick` falls in -- a quarter of the year each, in a fixed spring->summer->autumn->winter order. */
export function currentSeason(tick: number): Season {
  const phase = yearPhase(tick);
  const index = Math.min(3, Math.floor(phase * 4));
  return SEASON_ORDER[index]!;
}

/** Midpoint/swing of the annual temperature sinusoid, same `[0, 1]` scale as `Weather.ts`'s daily one -- peaks in summer (`phase = 0.25`, matching `SEASON_ORDER`'s summer slot), troughs in winter. Plausible, tunable balance data, deliberately a SMALLER swing than the daily cycle (seasons shift the baseline, they don't dominate day/night). */
export const SEASONAL_TEMPERATURE_AMPLITUDE = 0.15;

/**
 * Real ambient temperature including BOTH the existing fast daily cycle
 * (`Weather.ts`'s own `ambientTemperature`, entirely unmodified) and a
 * slower seasonal envelope on top of it -- one shared formula, not two
 * separately-scripted "summer is warm"/"winter is cold" branches. Clamped
 * to `[0, 1]` since a deep-winter night can otherwise dip the combined
 * value below the daily cycle's own floor.
 */
export function seasonalAmbientTemperature(tick: number): number {
  const daily = ambientTemperature(tick);
  const yearP = yearPhase(tick);
  const seasonalOffset = SEASONAL_TEMPERATURE_AMPLITUDE * Math.cos(2 * Math.PI * (yearP - 0.25));
  return Math.min(1, Math.max(0, daily + seasonalOffset));
}

/** Real multiplier on `Weather.ts`'s own `precipitationRate` for the current season -- spring wettest, winter driest (consistent with `seasonalAmbientTemperature`'s own winter-is-cold, and P4-12's freezing precipitation instead of falling as liquid). Plausible, tunable balance data, keyed by season (an open string derived from real tick), never a per-month/per-day scripted calendar. */
export const SEASONAL_PRECIPITATION_MULTIPLIER: Readonly<Record<Season, number>> = Object.freeze({
  spring: 1.3,
  summer: 0.8,
  autumn: 1.0,
  winter: 0.6,
});

export function seasonalPrecipitationMultiplier(tick: number): number {
  return SEASONAL_PRECIPITATION_MULTIPLIER[currentSeason(tick)];
}

/** Real multiplier on plant growth/reproduction rate for the current season -- winter dormancy (near-zero growth), spring/summer active growth, autumn tapering off. Consumed by `PlantLifecycle.ts` (P4-02). Plausible, tunable balance data. */
export const SEASONAL_GROWTH_MULTIPLIER: Readonly<Record<Season, number>> = Object.freeze({
  spring: 1.4,
  summer: 1.2,
  autumn: 0.6,
  winter: 0.05,
});

export function seasonalGrowthMultiplier(tick: number): number {
  return SEASONAL_GROWTH_MULTIPLIER[currentSeason(tick)];
}

/** Real multiplier on animal activity (foraging/reproduction drive) for the current season -- winter scarcity slows both, matching real seasonal ecology. Consumed by `Animal.ts`/`AnimalPopulation.ts` (P4-05/P4-08), completing P4-01's own literal "...and animal behavior" acceptance clause once those systems exist to consume it. Plausible, tunable balance data. */
export const SEASONAL_ACTIVITY_MULTIPLIER: Readonly<Record<Season, number>> = Object.freeze({
  spring: 1.2,
  summer: 1.0,
  autumn: 1.0,
  winter: 0.5,
});

export function seasonalActivityMultiplier(tick: number): number {
  return SEASONAL_ACTIVITY_MULTIPLIER[currentSeason(tick)];
}

// Re-exported for convenience so callers needing both day/night and season phase don't need two imports.
export { dayNightPhase };
