import { describe, expect, it } from "vitest";
import { EntityIdRegistry } from "../../src/sim/core/EntityId.js";
import { ComponentStore } from "../../src/sim/core/ComponentStore.js";
import {
  setNeeds,
  getNeeds,
  applyNeedsTick,
  BASELINE_NEEDS,
  NEED_URGENT_THRESHOLD,
  HUNGER_DECAY_PER_TICK,
  THIRST_DECAY_PER_TICK,
  FATIGUE_ACTIVE_INCREASE_PER_TICK,
  FATIGUE_REST_RECOVERY_PER_TICK,
} from "../../src/sim/creatures/Needs.js";

describe("Needs component", () => {
  it("round-trips valid needs", () => {
    const entities = new EntityIdRegistry();
    const components = new ComponentStore(entities);
    const id = entities.create("beaver");
    const needs = { hunger: 0.2, thirst: 0.3, fatigue: 0.1, thermalComfort: 0.9 };
    setNeeds(components, id, needs);
    expect(getNeeds(components, id)).toEqual(needs);
  });

  it("rejects any need value outside [0, 1]", () => {
    const entities = new EntityIdRegistry();
    const components = new ComponentStore(entities);
    const id = entities.create("beaver");
    expect(() => setNeeds(components, id, { hunger: -0.01, thirst: 0, fatigue: 0, thermalComfort: 1 })).toThrow(
      RangeError,
    );
    expect(() => setNeeds(components, id, { hunger: 0, thirst: 1.01, fatigue: 0, thermalComfort: 1 })).toThrow(
      RangeError,
    );
    expect(() => setNeeds(components, id, { hunger: 0, thirst: 0, fatigue: NaN, thermalComfort: 1 })).toThrow(
      RangeError,
    );
  });

  it("BASELINE_NEEDS starts every need fully satisfied and perfectly comfortable", () => {
    expect(BASELINE_NEEDS).toEqual({ hunger: 0, thirst: 0, fatigue: 0, thermalComfort: 1 });
  });
});

describe("applyNeedsTick", () => {
  it("worsens hunger and thirst by their documented per-tick rate regardless of activity", () => {
    const idle = applyNeedsTick(BASELINE_NEEDS, false);
    const active = applyNeedsTick(BASELINE_NEEDS, true);
    expect(idle.hunger).toBeCloseTo(HUNGER_DECAY_PER_TICK, 10);
    expect(idle.thirst).toBeCloseTo(THIRST_DECAY_PER_TICK, 10);
    expect(active.hunger).toBeCloseTo(HUNGER_DECAY_PER_TICK, 10);
    expect(active.thirst).toBeCloseTo(THIRST_DECAY_PER_TICK, 10);
  });

  it("thirst worsens faster than hunger", () => {
    expect(THIRST_DECAY_PER_TICK).toBeGreaterThan(HUNGER_DECAY_PER_TICK);
  });

  it("fatigue increases while active and decreases while resting", () => {
    const start = { hunger: 0, thirst: 0, fatigue: 0.5, thermalComfort: 1 };
    const activeResult = applyNeedsTick(start, true);
    const restResult = applyNeedsTick(start, false);
    expect(activeResult.fatigue).toBeCloseTo(0.5 + FATIGUE_ACTIVE_INCREASE_PER_TICK, 10);
    expect(restResult.fatigue).toBeCloseTo(0.5 - FATIGUE_REST_RECOVERY_PER_TICK, 10);
  });

  it("clamps every need to [0, 1] instead of overflowing/underflowing", () => {
    const nearMax = { hunger: 0.999, thirst: 0.999, fatigue: 0.999, thermalComfort: 1 };
    const result = applyNeedsTick(nearMax, true);
    expect(result.hunger).toBeLessThanOrEqual(1);
    expect(result.thirst).toBeLessThanOrEqual(1);
    expect(result.fatigue).toBeLessThanOrEqual(1);

    const nearMin = { hunger: 0, thirst: 0, fatigue: 0.001, thermalComfort: 1 };
    const rested = applyNeedsTick(nearMin, false);
    expect(rested.fatigue).toBeGreaterThanOrEqual(0);
  });

  it("leaves thermalComfort unchanged -- no real environmental driver exists yet", () => {
    const needs = { hunger: 0.3, thirst: 0.3, fatigue: 0.3, thermalComfort: 0.42 };
    expect(applyNeedsTick(needs, true).thermalComfort).toBe(0.42);
    expect(applyNeedsTick(needs, false).thermalComfort).toBe(0.42);
  });

  it("repeated ticks accumulate correctly toward the urgency threshold", () => {
    let needs = BASELINE_NEEDS;
    const ticksToUrgentThirst = Math.ceil(NEED_URGENT_THRESHOLD / THIRST_DECAY_PER_TICK);
    for (let i = 0; i < ticksToUrgentThirst; i++) needs = applyNeedsTick(needs, false);
    expect(needs.thirst).toBeGreaterThanOrEqual(NEED_URGENT_THRESHOLD);
  });

  it("rejects an already-invalid input needs value", () => {
    expect(() => applyNeedsTick({ hunger: 1.5, thirst: 0, fatigue: 0, thermalComfort: 1 }, false)).toThrow(
      RangeError,
    );
  });
});
