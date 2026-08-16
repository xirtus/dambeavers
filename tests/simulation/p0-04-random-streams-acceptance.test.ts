/**
 * Headless acceptance test for P0-04 — Seeded random streams.
 *
 * Roadmap acceptance test (DAMN_BEAVERS_MASTER_ROADMAP.md, P0-04):
 *   "two headless runs with the same seed and commands produce bit-for-bit
 *   identical test snapshots."
 *
 * This drives SimulationClock (P0-01) and RandomStreams (P0-04) together
 * -- multiple named subsystem streams drawn from in a data-dependent
 * pattern every tick, exactly the way hydrology/job-selection/ecology will
 * eventually share one seed once those systems exist -- rather than
 * testing RandomStreams in isolation, so the acceptance test reflects how
 * it will actually be used.
 */
import { describe, expect, it } from "vitest";
import { SimulationClock } from "../../src/sim/core/SimulationClock.js";
import { RandomStreams } from "../../src/sim/core/Random.js";

interface RunResult {
  finalTick: number;
  draws: number[];
  finalSnapshot: ReturnType<RandomStreams["toSnapshot"]>;
}

const SUBSYSTEMS = ["hydrology", "job-selection", "ecology"];

/**
 * A toy headless "run": for TICK_COUNT ticks, each tick draws from a
 * subsystem stream chosen by a rule that depends on tick state (not a
 * fixed round-robin), so the exact interleaving of draws across streams
 * varies run to run in exactly the way real subsystems (whose per-tick
 * workload varies) would exercise this API.
 */
function runHeadless(seed: number | string, tickCount: number): RunResult {
  const clock = new SimulationClock({ tickRateHz: 20 });
  const random = new RandomStreams(seed);
  const draws: number[] = [];

  clock.onTick((tick) => {
    const subsystem = SUBSYSTEMS[tick % SUBSYSTEMS.length]!;
    const stream = random.stream(subsystem);
    const drawCountThisTick = 1 + (tick % 3); // varies 1..3 draws/tick, data-dependent
    for (let i = 0; i < drawCountThisTick; i++) {
      draws.push(stream.nextUint32());
    }
  });

  clock.resume();
  for (let i = 0; i < tickCount; i++) {
    clock.advance(1 / 20); // exactly one tick per call
  }

  return { finalTick: clock.tick, draws, finalSnapshot: random.toSnapshot() };
}

describe("P0-04 acceptance: identical seed and commands yield bit-for-bit identical results", () => {
  it("reproduces the exact same draw sequence and final random-stream snapshot across two independent runs", () => {
    const runA = runHeadless("pond-test-seed-1", 5000);
    const runB = runHeadless("pond-test-seed-1", 5000);

    expect(runA.finalTick).toBe(5000);
    expect(runB.finalTick).toBe(runA.finalTick);
    expect(runB.draws).toEqual(runA.draws);
    expect(runB.finalSnapshot).toEqual(runA.finalSnapshot);
  });

  it("a different seed with the same commands produces a different result (seed is not silently ignored)", () => {
    const runA = runHeadless("pond-test-seed-1", 1000);
    const runC = runHeadless("pond-test-seed-2", 1000);

    expect(runC.draws).not.toEqual(runA.draws);
  });

  it("numeric and string seeds are each independently reproducible", () => {
    const runA = runHeadless(123456, 1000);
    const runB = runHeadless(123456, 1000);
    expect(runB.draws).toEqual(runA.draws);
  });
});
