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
  applyThermalExposure,
  THERMAL_RATE_SCALE,
  type ThermalEnvironment,
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

  it("leaves thermalComfort unchanged -- environmental exposure is a separate function, applyThermalExposure (P1-15)", () => {
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

const WATER_LIKE: ThermalEnvironment = { conductivity: 0.6, ambientTarget: 0.2 }; // matches standardMaterials.ts's real "water"
const AIR_LIKE: ThermalEnvironment = { conductivity: 0.025, ambientTarget: 1 }; // matches standardMaterials.ts's real "air"

describe("applyThermalExposure", () => {
  it("drifts thermalComfort toward the environment's ambientTarget", () => {
    const comfortable = { hunger: 0, thirst: 0, fatigue: 0, thermalComfort: 1 };
    const result = applyThermalExposure(comfortable, WATER_LIKE);
    expect(result.thermalComfort).toBeLessThan(1); // cold water pulls comfort DOWN from a comfortable starting point
  });

  it("matches the exact documented formula: delta = (target - current) * conductivity * THERMAL_RATE_SCALE", () => {
    const needs = { hunger: 0, thirst: 0, fatigue: 0, thermalComfort: 1 };
    const result = applyThermalExposure(needs, WATER_LIKE);
    const expectedDelta = (WATER_LIKE.ambientTarget - 1) * WATER_LIKE.conductivity * THERMAL_RATE_SCALE;
    expect(result.thermalComfort).toBeCloseTo(1 + expectedDelta, 12);
  });

  it("REGRESSION (P1-15 acceptance): cold water changes thermal state strictly faster than mild dry ground, from the identical starting comfort", () => {
    const needs = { hunger: 0, thirst: 0, fatigue: 0, thermalComfort: 1 };
    const inWater = applyThermalExposure(needs, WATER_LIKE);
    const onGround = applyThermalExposure(needs, AIR_LIKE);
    const waterChange = Math.abs(1 - inWater.thermalComfort);
    const groundChange = Math.abs(1 - onGround.thermalComfort);
    expect(waterChange).toBeGreaterThan(groundChange);
    expect(waterChange).toBeGreaterThan(groundChange * 10); // not just marginally faster -- water's real thermalConductivity (0.6) vs air's (0.025) is a ~24x difference
  });

  it("thermalComfort recovers back toward a comfortable target once removed from cold exposure (e.g. dry ground after water)", () => {
    let needs = { hunger: 0, thirst: 0, fatigue: 0, thermalComfort: 1 };
    for (let i = 0; i < 20; i++) needs = applyThermalExposure(needs, WATER_LIKE);
    const chilled = needs.thermalComfort;
    expect(chilled).toBeLessThan(1);

    for (let i = 0; i < 60; i++) needs = applyThermalExposure(needs, AIR_LIKE);
    expect(needs.thermalComfort).toBeGreaterThan(chilled); // warming back up on dry ground
  });

  it("clamps thermalComfort to [0, 1] and never overshoots past the target", () => {
    let needs = { hunger: 0, thirst: 0, fatigue: 0, thermalComfort: 1 };
    for (let i = 0; i < 500; i++) needs = applyThermalExposure(needs, WATER_LIKE);
    expect(needs.thermalComfort).toBeGreaterThanOrEqual(0);
    expect(needs.thermalComfort).toBeCloseTo(WATER_LIKE.ambientTarget, 6); // converges to, never past, the target
  });

  it("a zero-conductivity environment (a vacuum, hypothetically) never changes thermalComfort at all", () => {
    const needs = { hunger: 0, thirst: 0, fatigue: 0, thermalComfort: 0.5 };
    const result = applyThermalExposure(needs, { conductivity: 0, ambientTarget: 1 });
    expect(result.thermalComfort).toBe(0.5);
  });

  it("rejects an already-invalid input needs value", () => {
    expect(() => applyThermalExposure({ hunger: 0, thirst: 0, fatigue: 0, thermalComfort: 1.5 }, AIR_LIKE)).toThrow(RangeError);
  });
});
