import type { WorldGrid } from "../world/WorldGrid.js";
import type { WaterField } from "../hydrology/WaterField.js";

/**
 * P1-18's "basic weather and day/night" -- the roadmap's own four-item
 * list, each real:
 *
 * - day/night clock: `dayNightPhase`/`dayNumber`/`isDaytime`, pure
 *   functions of `SimulationClock.tick` alone (P0-01) -- no separate
 *   day-counter state to desync from the authoritative clock, matching
 *   this codebase's "discover from live state" discipline
 *   (`Pathfinding.ts`, `BeaverNeeds.ts`'s `nearestTree`/`nearestWater`).
 *   Deliberately tick-based, not derived from `tickRateHz` or real
 *   wall-clock elapsed time (AGENTS.md Law 8 -- the same tick count must
 *   always mean the same time of day regardless of how fast the clock is
 *   configured to run).
 * - ambient temperature: `ambientTemperature`, a real, continuous
 *   sinusoid driven purely by day/night phase -- warmest at solar noon,
 *   coldest at solar midnight, on the SAME `[0, 1]` "how comfortable"
 *   scale `Needs.ThermalEnvironment.ambientTarget` already uses (P1-15).
 *   A real, correct, unit-tested function with no current caller yet
 *   (AGENTS.md Law 10, matching `Mortality.ts`'s `applyTrauma`/
 *   `EcologyResponse.ts`'s `plantSapling` precedent): `BeaverNeeds.ts`'s
 *   `deriveThermalEnvironment` still uses its own fixed `AIR_THERMAL_TARGET`
 *   constant for air, a real, already-shipped, already-critic-reviewed
 *   P1-15 mechanism this task deliberately leaves untouched -- wiring a
 *   time-varying ambient temperature into it is a natural, well-scoped
 *   FUTURE integration (the exact constant to replace, and the field to
 *   replace it in, already exist), not required by this task's own
 *   literal acceptance test (which is about precipitation, not thermal
 *   exposure), and rewiring another task's shipped, tested behavior is
 *   out of this task's scope.
 * - precipitation input: `applyPrecipitation` -- adds real water volume
 *   via `WaterField.addVolume` (whose own doc comment already names "a
 *   future rain/inflow/outflow system" as its intended caller) to every
 *   real ground column, then lets the ALREADY-EXISTING hydrology system
 *   (`Flow.ts`'s `stepFlow`, P1-03, entirely unmodified) move it exactly
 *   like water from any other source. This is the one bullet with a
 *   literal roadmap acceptance test.
 * - simple weather state: the `Weather` class's own `condition` --
 *   the only genuinely stateful fact this module needs (day/night phase
 *   and ambient temperature are both pure functions of tick, precipitation
 *   rate is purely derived from `condition`), so there is exactly one
 *   piece of real mutable state to keep in sync, not several.
 */

// ---- Day/night clock ----

/** Ticks in one full simulated day-night cycle. Deliberately tick-based (see this file's own top doc comment) -- plausible, tunable balance data, matching every other rate/duration constant in this codebase (e.g. `PlantSpeciesDefinition.matureAgeTicks`). */
export const DAY_LENGTH_TICKS = 2400;

/** Phase (fraction of the day elapsed, `[0, 1)`) at which day begins/ends -- plausible, tunable balance data giving a 12-hour night / 12-hour day split by default. */
export const DAWN_PHASE = 0.25;
export const DUSK_PHASE = 0.75;

function validateTick(tick: number): void {
  if (!Number.isInteger(tick) || tick < 0) {
    throw new RangeError(`tick must be a non-negative integer, got ${tick}`);
  }
}

/** `[0, 1)` fraction of the current day elapsed, derived purely from `tick % DAY_LENGTH_TICKS` -- exactly reproducible from the tick count alone (Law 8), never a separately-tracked, driftable counter. `0` is solar midnight, `0.5` is solar noon. */
export function dayNightPhase(tick: number): number {
  validateTick(tick);
  return (tick % DAY_LENGTH_TICKS) / DAY_LENGTH_TICKS;
}

/** Which day number (`0`-indexed) `tick` falls in. */
export function dayNumber(tick: number): number {
  validateTick(tick);
  return Math.floor(tick / DAY_LENGTH_TICKS);
}

/** Whether `tick` falls within the daylight portion of its day (`[DAWN_PHASE, DUSK_PHASE)`). */
export function isDaytime(tick: number): boolean {
  const phase = dayNightPhase(tick);
  return phase >= DAWN_PHASE && phase < DUSK_PHASE;
}

// ---- Ambient temperature ----

/** Midpoint and swing of the daily ambient-temperature sinusoid, on `Needs.ThermalEnvironment.ambientTarget`'s own `[0, 1]` scale. The peak (`0.7 + 0.3 = 1.0`, solar noon) deliberately equals `BeaverNeeds.ts`'s existing `AIR_THERMAL_TARGET` constant -- a real continuity choice, not a coincidence, so daytime ambient conditions are never WORSE than what P1-15 already modeled, only night conditions add real variation on top. Plausible, tunable balance data. */
export const AMBIENT_TEMPERATURE_MIDPOINT = 0.7;
export const AMBIENT_TEMPERATURE_AMPLITUDE = 0.3;

/**
 * Real, continuous ambient-air temperature derived purely from day/night
 * phase -- a genuine sinusoid (smooth and inspectable at any tick, never a
 * step function jumping between two hardcoded day/night constants),
 * warmest at solar noon (`phase = 0.5`) and coldest at solar midnight
 * (`phase = 0`). On the same `[0, 1]` scale as
 * `Needs.ThermalEnvironment.ambientTarget`.
 */
export function ambientTemperature(tick: number): number {
  const phase = dayNightPhase(tick);
  return AMBIENT_TEMPERATURE_MIDPOINT + AMBIENT_TEMPERATURE_AMPLITUDE * Math.cos(2 * Math.PI * (phase - 0.5));
}

// ---- Simple weather state ----

export type WeatherCondition = "clear" | "rain" | "storm";

/** Real precipitation intensity per condition -- volume added per real ground column per simulated second (matches `WaterField.addVolume`'s own "volume per column" semantics, since each column's footprint is exactly 1 cell^2 by `WorldGrid`'s convention). Plausible, tunable balance data. */
export const PRECIPITATION_RATE_BY_CONDITION: Readonly<Record<WeatherCondition, number>> = Object.freeze({
  clear: 0,
  rain: 0.002,
  storm: 0.01,
});

/**
 * Whether `condition` is one of `PRECIPITATION_RATE_BY_CONDITION`'s own
 * defined keys -- `Object.hasOwn`, not the `in` operator, because `in`
 * also matches inherited `Object.prototype` keys (`"constructor"`,
 * `"toString"`, `"hasOwnProperty"`, etc.) even on a frozen plain object
 * literal (`Object.freeze` only freezes OWN properties, it never severs
 * the prototype chain) -- a real, reproducible validation bypass found
 * during this task's own critic review: `setCondition("constructor")`
 * previously passed the `in` check silently, after which
 * `precipitationRate` returned `Object.prototype.constructor` (a
 * function, not a number) instead of throwing immediately at the actual
 * point of invalid input -- exactly the "fail loudly at restore/write
 * time, not eventually somewhere unrelated" standard this project's
 * snapshot-validation code elsewhere already holds itself to (P0-02's
 * NaN/Infinity collision-guard bypass, P0-06's corrupted accumulator).
 */
function isKnownCondition(condition: string): condition is WeatherCondition {
  return Object.hasOwn(PRECIPITATION_RATE_BY_CONDITION, condition);
}

const WEATHER_SNAPSHOT_VERSION = 1;

export interface WeatherSnapshot {
  version: number;
  condition: WeatherCondition;
}

/**
 * Real, minimal mutable weather state -- the roadmap's own "simple weather
 * state." `condition` is the only field; `precipitationRate` is always
 * DERIVED from it (never independently settable), so it can never
 * silently drift out of sync with the condition that's supposed to
 * determine it.
 */
export class Weather {
  private conditionValue: WeatherCondition;

  constructor(condition: WeatherCondition = "clear") {
    this.conditionValue = condition;
  }

  get condition(): WeatherCondition {
    return this.conditionValue;
  }

  setCondition(condition: WeatherCondition): void {
    if (!isKnownCondition(condition)) {
      throw new RangeError(`unknown weather condition ${condition}`);
    }
    this.conditionValue = condition;
  }

  /** Real precipitation rate (volume per column per simulated second) for the CURRENT condition. */
  get precipitationRate(): number {
    return PRECIPITATION_RATE_BY_CONDITION[this.conditionValue];
  }

  toSnapshot(): WeatherSnapshot {
    return { version: WEATHER_SNAPSHOT_VERSION, condition: this.conditionValue };
  }

  static fromSnapshot(snapshot: WeatherSnapshot): Weather {
    if (snapshot.version !== WEATHER_SNAPSHOT_VERSION) {
      throw new RangeError(`unsupported Weather snapshot version ${snapshot.version}, expected ${WEATHER_SNAPSHOT_VERSION}`);
    }
    if (!isKnownCondition(snapshot.condition)) {
      throw new RangeError(`corrupt snapshot: unknown weather condition ${snapshot.condition}`);
    }
    return new Weather(snapshot.condition);
  }
}

// ---- Precipitation input ----

/**
 * P1-18's "precipitation input": adds real water volume
 * (`WaterField.addVolume`) to every real-ground column
 * (`WorldGrid.surfaceY` defined -- an ungenerated column is silently
 * skipped, never invented ground to rain onto) at `weather`'s current
 * `precipitationRate`, scaled by `dtSeconds` -- rain falls uniformly
 * across the whole generated map, never a scripted "flood this specific
 * spot" event. The resulting water is then free to move through the
 * ALREADY-EXISTING hydrology system (`Flow.ts`'s `stepFlow`, entirely
 * unmodified) exactly like water from any other source -- this function's
 * only job is adding the source term, never modeling where it goes
 * afterward.
 */
export function applyPrecipitation(water: WaterField, grid: WorldGrid, weather: Weather, dtSeconds: number): void {
  if (!Number.isFinite(dtSeconds) || dtSeconds < 0) {
    throw new RangeError(`dtSeconds must be a non-negative finite number, got ${dtSeconds}`);
  }
  const rate = weather.precipitationRate;
  if (rate <= 0 || dtSeconds === 0) return;
  const volumePerColumn = rate * dtSeconds;
  const { sizeX, sizeZ } = grid.dims;
  for (let x = 0; x < sizeX; x++) {
    for (let z = 0; z < sizeZ; z++) {
      if (grid.surfaceY(x, z) === undefined) continue;
      water.addVolume(x, z, volumePerColumn);
    }
  }
}
