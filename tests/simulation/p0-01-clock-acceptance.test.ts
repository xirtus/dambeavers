/**
 * Headless acceptance test for P0-01 — Simulation clock.
 *
 * Roadmap acceptance test (DAMN_BEAVERS_MASTER_ROADMAP.md, P0-01):
 *   "pause freezes authoritative state; running the same deterministic test
 *   for 100,000 ticks at different render frame rates yields identical
 *   simulation state."
 *
 * This runs with no renderer, no UI, and no game loop — only the clock.
 *
 * Methodology note: looping "until N ticks happen" and then comparing state
 * at that tick is tautological — simulationTimeSeconds is a pure function
 * of the tick index, so it matches trivially regardless of any rounding bug
 * in how real time was converted to ticks. The real criterion is: the SAME
 * elapsed real time, chunked differently across render frames, must produce
 * the SAME resulting tick. The primary test below drives 60fps and 30fps
 * with an exact, precomputed frame count each (300,000 frames of 1/60s vs
 * 150,000 frames of 1/30s) that both nominally cover the same real-time
 * span, with no runtime float bookkeeping of "elapsed time so far" in the
 * test itself — that bookkeeping would reintroduce the very float
 * summation error the clock's internal accumulator is designed to avoid.
 */
import { describe, expect, it } from "vitest";
import { SimulationClock } from "../../src/sim/core/SimulationClock.js";

const TICK_RATE_HZ = 20;
const TARGET_TICKS = 100_000;
const REAL_TIME_BUDGET_SECONDS = TARGET_TICKS / TICK_RATE_HZ; // 5000.0 seconds, exactly

/** Deterministic, seed-only PRNG (mulberry32) — test-local, not part of the sim. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface DrivenResult {
  finalTick: number;
  finalSimTime: number;
  ticks: Array<[number, number]>;
}

function driveExactFrames(dtSeconds: number, frameCount: number): DrivenResult {
  const clock = new SimulationClock({ tickRateHz: TICK_RATE_HZ });
  const ticks: Array<[number, number]> = [];
  clock.onTick((tick, simTime) => ticks.push([tick, simTime]));
  clock.resume();
  for (let i = 0; i < frameCount; i++) {
    clock.advance(dtSeconds);
  }
  return { finalTick: clock.tick, finalSimTime: clock.simulationTimeSeconds, ticks };
}

function driveUntilTick(nextDeltaSeconds: () => number, targetTick: number): Array<[number, number]> {
  const clock = new SimulationClock({ tickRateHz: TICK_RATE_HZ });
  const ticks: Array<[number, number]> = [];
  clock.onTick((tick, simTime) => {
    if (tick <= targetTick) ticks.push([tick, simTime]);
  });
  clock.resume();
  while (clock.tick < targetTick) {
    clock.advance(nextDeltaSeconds());
  }
  return ticks;
}

describe("P0-01 acceptance: pause freezes authoritative state", () => {
  it("holds tick and simulation time constant across arbitrary real time while paused", () => {
    const clock = new SimulationClock({ tickRateHz: 20 });
    clock.resume();
    clock.advance(123.456); // run for a while first
    const frozenTick = clock.tick;
    const frozenTime = clock.simulationTimeSeconds;

    clock.pause();
    for (const dt of [0.016, 1, 60, 3600, 0.0001]) {
      clock.advance(dt);
    }

    expect(clock.tick).toBe(frozenTick);
    expect(clock.simulationTimeSeconds).toBe(frozenTime);
  });
});

describe("P0-01 acceptance: frame-rate independence over an identical real-time budget", () => {
  it("reaches the exact same tick and simulation time at 60fps vs 30fps for the same nominal real-time span", () => {
    // 300,000 frames of exactly 1/60s and 150,000 frames of exactly 1/30s
    // are two different frame-rate chunkings of the same nominal
    // REAL_TIME_BUDGET_SECONDS span (5000s). This is the test that would
    // have failed before the error-diffused rounding fix: naive per-call
    // rounding biases 1/60s and 1/30s in opposite directions, landing 30fps
    // one whole tick behind 60fps for the same elapsed real time.
    const at60fps = driveExactFrames(1 / 60, 300_000);
    const at30fps = driveExactFrames(1 / 30, 150_000);

    expect(at60fps.finalTick).toBe(TARGET_TICKS);
    expect(at30fps.finalTick).toBe(at60fps.finalTick);
    expect(at60fps.finalSimTime).toBe(REAL_TIME_BUDGET_SECONDS);
    expect(at30fps.finalSimTime).toBe(at60fps.finalSimTime);

    // Not just the final snapshot -- the full per-tick trace must match.
    expect(at30fps.ticks).toEqual(at60fps.ticks);
  });

  it("produces the identical tick/time trace under irregular, jittered frame timing", () => {
    const reference = driveExactFrames(1 / 60, 300_000).ticks;

    // Variable/jittered frame rate, as a real render loop would actually
    // produce (dropped frames, vsync jitter), deterministic via a fixed seed.
    const rand = mulberry32(42);
    const jittered = driveUntilTick(() => (1 / 60) * (0.2 + rand() * 2), TARGET_TICKS);

    expect(jittered).toEqual(reference);
  });
});
