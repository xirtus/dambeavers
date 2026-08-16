import { ComponentStore, defineComponent, type ComponentType } from "../core/ComponentStore.js";
import type { EntityId } from "../core/EntityId.js";

/**
 * P1-06's four needs, per the roadmap's literal list. Each of `hunger`,
 * `thirst`, `fatigue` is `[0, 1]`, 0 = fully satisfied, 1 = critical --
 * deliberately NOT modeling actual satisfaction/consumption yet (no food
 * item exists until P1-13, no sleep/shelter preference until P1-14): this
 * task's job is that these values change continuously and correctly, and
 * that urgency drives real behavior (`BeaverNeeds.ts`), not that a beaver
 * can yet fully resolve a need.
 *
 * `thermalComfort` is the roadmap's "thermal comfort baseline." `[0, 1]`,
 * 1 = perfectly comfortable, matching the other three needs' "worse is
 * higher" polarity would be backwards for "comfort" specifically, so this
 * one field alone is "higher is better" -- documented here since it's the
 * one place that could otherwise silently confuse a reader. As of P1-15
 * (`applyThermalExposure`, below) it genuinely responds to real
 * environmental exposure -- water vs. dry ground, driven by each medium's
 * real `thermalConductivity` (P0-07's own `MaterialRegistry` data, not an
 * invented "temperature" system) -- rather than being held at a constant
 * baseline the way it was before any real driver existed.
 */
export interface Needs {
  hunger: number;
  thirst: number;
  fatigue: number;
  thermalComfort: number;
}
export const NeedsComponent: ComponentType<Needs> = defineComponent<Needs>("needs");

/**
 * A freshly-spawned beaver starts with every need fully satisfied and
 * perfectly comfortable. Frozen so accidental in-place mutation (`const
 * needs = getNeeds(...); needs.hunger = 0;` instead of the
 * decay/set-a-fresh-object pattern every real write path here uses)
 * throws immediately instead of silently corrupting every OTHER beaver
 * that also happens to reference this exact object -- callers must still
 * spread a fresh copy (`{ ...BASELINE_NEEDS }`) when assigning it to an
 * entity, since `ComponentStore.set` stores whatever reference it's given
 * with no cloning (its own documented design); freezing here is
 * defense-in-depth, not a substitute for that.
 */
export const BASELINE_NEEDS: Readonly<Needs> = Object.freeze({ hunger: 0, thirst: 0, fatigue: 0, thermalComfort: 1 });

/** A need at or above this value is urgent enough to drive behavior (`BeaverNeeds.decideIntent`). Plausible, tunable balance data. */
export const NEED_URGENT_THRESHOLD = 0.7;

/** Per-tick worsening for hunger/thirst -- purely time-based, matching the roadmap's "needs change continuously with time." Plausible, tunable balance data; thirst set to worsen faster than hunger, matching real physiology (survivable time without water is shorter than without food). */
export const HUNGER_DECAY_PER_TICK = 0.004;
export const THIRST_DECAY_PER_TICK = 0.006;
/** Per-tick fatigue change while actively traveling vs. resting/idle -- the "...and activity" half of "needs change continuously with time and activity": fatigue, uniquely among these needs, is driven by what the beaver is doing this tick, not merely by time passing. Recovery is deliberately much faster than accumulation: since resting is re-evaluated (and can end) every tick once fatigue drops back below `NEED_URGENT_THRESHOLD`, a recovery rate too close to the accumulation rate would land just barely under the threshold and cross back over after a single subsequent travel tick, producing pointless tick-by-tick rest/travel thrashing instead of a real rest period followed by real progress. Plausible, tunable balance data. */
export const FATIGUE_ACTIVE_INCREASE_PER_TICK = 0.05;
export const FATIGUE_REST_RECOVERY_PER_TICK = 0.25;

/** Exported so P1-13's `BeaverNeeds.ts` consumption actions (eating/drinking) clamp their own restorations the same way this file's own decay does, rather than each reimplementing an identical clamp. */
export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function assertValidNeeds(needs: Needs): void {
  for (const [key, value] of Object.entries(needs)) {
    if (!(value >= 0 && value <= 1)) {
      throw new RangeError(`need "${key}" must be in [0, 1], got ${value}`);
    }
  }
}

export function setNeeds(components: ComponentStore, id: EntityId, needs: Needs): void {
  assertValidNeeds(needs);
  components.set(id, NeedsComponent, needs);
}

export function getNeeds(components: ComponentStore, id: EntityId): Needs | undefined {
  const needs = components.get(id, NeedsComponent);
  if (needs !== undefined) assertValidNeeds(needs);
  return needs;
}

/**
 * One tick's worth of continuous need change (AGENTS.md Law 8:
 * determinism -- a pure function of its inputs, no hidden clock/random
 * read). `wasActive` is whatever the caller (`BeaverNeeds.tickBeaverNeeds`)
 * determined THIS tick's chosen behavior actually was: true only for real
 * travel (`AdvanceResult.outcome` of `"moved"`/`"arrived"`), false for
 * idling, resting, or a movement attempt that didn't actually go anywhere
 * (`"already-there"`/`"unreachable"`). `thermalComfort` passes through
 * unchanged -- see `Needs`'s own doc comment for why.
 */
export function applyNeedsTick(needs: Needs, wasActive: boolean): Needs {
  assertValidNeeds(needs);
  return {
    hunger: clamp01(needs.hunger + HUNGER_DECAY_PER_TICK),
    thirst: clamp01(needs.thirst + THIRST_DECAY_PER_TICK),
    fatigue: clamp01(needs.fatigue + (wasActive ? FATIGUE_ACTIVE_INCREASE_PER_TICK : -FATIGUE_REST_RECOVERY_PER_TICK)),
    thermalComfort: needs.thermalComfort,
  };
}

/**
 * P1-15: "track ambient/water exposure enough for future survival
 * systems" -- `thermalComfort` drifts toward `environment.ambientTarget`
 * (dry ground/air is comfortable, cold water is not -- plausible, tunable
 * balance data, since "how comfortable is this medium" isn't itself a
 * real material physics fact) at a rate scaled by
 * `environment.conductivity`, the real `thermalConductivity` (P0-07)
 * of whatever medium actually surrounds the beaver right now. Water's
 * real conductivity (0.6) is ~24x air's (0.025) -- the SAME real-world
 * physics reason hypothermia in water is far more dangerous than in cold
 * air -- so "cold water changes thermal state faster than mild dry
 * ground" (this task's own literal acceptance wording) falls out of one
 * shared formula driven by real, already-defined material data, never a
 * separate hardcoded "water is special" branch (`deriveThermalEnvironment`
 * in `BeaverNeeds.ts` is the only place that decides WHICH medium
 * currently applies; this function has no idea what water even is).
 *
 * A pure function of its inputs (AGENTS.md Law 8), exactly like
 * `applyNeedsTick` -- `BeaverNeeds.ts` owns deriving `environment` from
 * live world state (position, `WaterField`, `MaterialRegistry`) so this
 * file itself stays free of any world-state dependency, matching its own
 * established "pure decay/exposure math only" boundary.
 */
export interface ThermalEnvironment {
  /** The surrounding medium's real `MaterialProperties.thermalConductivity` (P0-07). */
  conductivity: number;
  /** [0, 1] what `thermalComfort` drifts toward while exposed to this medium. */
  ambientTarget: number;
}

/** How much of the gap toward `ambientTarget` closes per tick, per unit of `conductivity` -- plausible, tunable balance data (kept small enough that even stone's conductivity, 2.0, never closes the whole gap in one tick). */
export const THERMAL_RATE_SCALE = 0.05;

export function applyThermalExposure(needs: Needs, environment: ThermalEnvironment): Needs {
  assertValidNeeds(needs);
  const delta = (environment.ambientTarget - needs.thermalComfort) * environment.conductivity * THERMAL_RATE_SCALE;
  return { ...needs, thermalComfort: clamp01(needs.thermalComfort + delta) };
}
