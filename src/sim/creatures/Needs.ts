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
 * `thermalComfort` is the roadmap's "thermal comfort baseline" -- present
 * as a real field (so the roadmap's four-need list is complete) but held
 * at a constant neutral baseline for now: nothing in the world yet
 * produces real thermal variation (no weather/seasons until P1-18, no
 * shelter until P1-10), and inventing a fake decay curve with no real
 * environmental driver behind it would be exactly the "smuggle the
 * desired story into the code" AGENTS.md warns against. `[0, 1]`, 1 =
 * perfectly comfortable, matching the other three needs' "worse is
 * higher" polarity would be backwards for "comfort" specifically, so this
 * one field alone is "higher is better" -- documented here since it's the
 * one place that could otherwise silently confuse a reader.
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

function clamp01(value: number): number {
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
