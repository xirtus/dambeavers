import { describe, expect, it, vi } from "vitest";
import { SimulationClock } from "../../src/sim/core/SimulationClock.js";

describe("SimulationClock construction", () => {
  it("starts paused at tick 0 and time 0", () => {
    const clock = new SimulationClock();
    expect(clock.tick).toBe(0);
    expect(clock.simulationTimeSeconds).toBe(0);
    expect(clock.isPaused).toBe(true);
    expect(clock.speed).toBe(1);
  });

  it("rejects a tick rate that does not evenly divide 1e9 ns", () => {
    expect(() => new SimulationClock({ tickRateHz: 3 })).toThrow(RangeError);
  });

  it("rejects a non-positive tick rate", () => {
    expect(() => new SimulationClock({ tickRateHz: 0 })).toThrow(RangeError);
    expect(() => new SimulationClock({ tickRateHz: -5 })).toThrow(RangeError);
  });

  it("accepts a custom valid tick rate", () => {
    const clock = new SimulationClock({ tickRateHz: 50 });
    expect(clock.tickRateHz).toBe(50);
  });
});

describe("SimulationClock pause/resume", () => {
  it("produces no ticks while paused, even with large deltas", () => {
    const clock = new SimulationClock({ tickRateHz: 20 });
    expect(clock.advance(1000)).toBe(0);
    expect(clock.tick).toBe(0);
  });

  it("advances once resumed and freezes again on pause", () => {
    const clock = new SimulationClock({ tickRateHz: 20 }); // 50ms/tick
    clock.resume();
    clock.advance(0.1); // 100ms -> 2 ticks
    expect(clock.tick).toBe(2);

    clock.pause();
    const tickAtPause = clock.tick;
    const timeAtPause = clock.simulationTimeSeconds;
    clock.advance(10); // large real time, must not move the clock
    clock.advance(10);
    expect(clock.tick).toBe(tickAtPause);
    expect(clock.simulationTimeSeconds).toBe(timeAtPause);
  });

  it("resuming preserves sub-tick accumulator instead of discarding it", () => {
    const clock = new SimulationClock({ tickRateHz: 20 }); // 50ms/tick
    clock.resume();
    clock.advance(0.03); // 30ms accumulated, no tick yet
    expect(clock.tick).toBe(0);
    clock.pause();
    clock.resume();
    clock.advance(0.03); // + 30ms = 60ms total -> crosses the 50ms boundary once
    expect(clock.tick).toBe(1);
  });
});

describe("SimulationClock speed multiplier", () => {
  it("rejects negative or non-integer speeds", () => {
    const clock = new SimulationClock();
    expect(() => clock.setSpeed(-1)).toThrow(RangeError);
    expect(() => clock.setSpeed(1.5)).toThrow(RangeError);
  });

  it("rejects a speed multiplier above the sane maximum, to bound worst-case synchronous tick processing", () => {
    const clock = new SimulationClock();
    expect(() => clock.setSpeed(2000)).toThrow(RangeError);
    expect(() => clock.setSpeed(1024)).not.toThrow();
  });

  it("produces proportionally more ticks at higher integer speed", () => {
    const a = new SimulationClock({ tickRateHz: 20 });
    const b = new SimulationClock({ tickRateHz: 20 });
    a.resume();
    b.resume();
    b.setSpeed(4);

    a.advance(1); // 1 real second at 1x -> 20 ticks
    b.advance(1); // 1 real second at 4x -> 80 ticks

    expect(a.tick).toBe(20);
    expect(b.tick).toBe(80);
  });

  it("speed 0 produces no ticks while leaving isPaused false", () => {
    const clock = new SimulationClock({ tickRateHz: 20 });
    clock.resume();
    clock.setSpeed(0);
    clock.advance(5);
    expect(clock.tick).toBe(0);
    expect(clock.isPaused).toBe(false);
  });
});

describe("SimulationClock input validation", () => {
  it("rejects negative, NaN, or infinite deltas", () => {
    const clock = new SimulationClock();
    clock.resume();
    expect(() => clock.advance(-1)).toThrow(RangeError);
    expect(() => clock.advance(Number.NaN)).toThrow(RangeError);
    expect(() => clock.advance(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it("accepts a zero delta as a no-op", () => {
    const clock = new SimulationClock();
    clock.resume();
    expect(clock.advance(0)).toBe(0);
    expect(clock.tick).toBe(0);
  });
});

describe("SimulationClock tick listeners", () => {
  it("calls listeners once per produced tick with monotonic tick/time", () => {
    const clock = new SimulationClock({ tickRateHz: 20 });
    const calls: Array<[number, number]> = [];
    clock.onTick((tick, simTime) => calls.push([tick, simTime]));
    clock.resume();
    clock.advance(0.15); // 3 ticks at 50ms each

    expect(calls).toEqual([
      [1, 0.05],
      [2, 0.1],
      [3, 0.15],
    ]);
  });

  it("stops calling a listener after it unsubscribes", () => {
    const clock = new SimulationClock({ tickRateHz: 20 });
    const listener = vi.fn();
    const unsubscribe = clock.onTick(listener);
    clock.resume();
    clock.advance(0.05);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    clock.advance(0.05);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("supports multiple independent listeners", () => {
    const clock = new SimulationClock({ tickRateHz: 20 });
    const a = vi.fn();
    const b = vi.fn();
    clock.onTick(a);
    clock.onTick(b);
    clock.resume();
    clock.advance(0.05);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });
});

describe("SimulationClock scheduling", () => {
  it("fires a scheduled callback exactly at the target tick", () => {
    const clock = new SimulationClock({ tickRateHz: 20 });
    const order: string[] = [];
    clock.scheduleAt(3, () => order.push("scheduled-at-3"));
    clock.onTick((tick) => order.push(`tick-${tick}`));
    clock.resume();
    clock.advance(0.2); // 4 ticks

    expect(order).toEqual([
      "tick-1",
      "tick-2",
      "scheduled-at-3",
      "tick-3",
      "tick-4",
    ]);
  });

  it("scheduleAfter is relative to the current tick", () => {
    const clock = new SimulationClock({ tickRateHz: 20 });
    clock.resume();
    clock.advance(0.1); // now at tick 2
    const fired: number[] = [];
    clock.scheduleAfter(2, () => fired.push(clock.tick)); // fires at tick 4
    clock.advance(0.1); // ticks 3, 4
    expect(fired).toEqual([4]);
  });

  it("runs same-tick schedules in FIFO insertion order", () => {
    const clock = new SimulationClock({ tickRateHz: 20 });
    const order: string[] = [];
    clock.scheduleAt(1, () => order.push("first"));
    clock.scheduleAt(1, () => order.push("second"));
    clock.resume();
    clock.advance(0.05);
    expect(order).toEqual(["first", "second"]);
  });

  it("fires on the very next tick when scheduled at or before the current tick", () => {
    const clock = new SimulationClock({ tickRateHz: 20 });
    clock.resume();
    clock.advance(0.1); // now at tick 2
    const fired: number[] = [];
    clock.scheduleAt(2, () => fired.push(clock.tick));
    clock.advance(0.05); // tick 3; the tick-2 schedule fires at tick 3
    expect(fired).toEqual([3]);
  });

  it("rejects scheduling at a tick before the current tick", () => {
    const clock = new SimulationClock({ tickRateHz: 20 });
    clock.resume();
    clock.advance(0.1); // tick 2
    expect(() => clock.scheduleAt(1, () => {})).toThrow(RangeError);
  });

  it("rejects a negative scheduleAfter offset", () => {
    const clock = new SimulationClock();
    expect(() => clock.scheduleAfter(-1, () => {})).toThrow(RangeError);
  });

  it("does not fire a one-shot schedule twice", () => {
    const clock = new SimulationClock({ tickRateHz: 20 });
    let count = 0;
    clock.scheduleAt(1, () => count++);
    clock.resume();
    clock.advance(0.2); // 4 ticks
    expect(count).toBe(1);
  });

  it("supports a bounded same-tick cascade scheduled during its own drain, without deadlocking", () => {
    // Reentrancy contract: scheduling for the tick currently draining runs
    // within the same synchronous pass. This proves a finite cascade
    // completes correctly, as future systems (e.g. hydrology propagation
    // within one tick) may rely on this.
    const clock = new SimulationClock({ tickRateHz: 20 });
    const order: string[] = [];
    let remaining = 3;
    const cascade = () => {
      order.push(`cascade-${remaining}`);
      remaining--;
      if (remaining > 0) clock.scheduleAt(clock.tick, cascade);
    };
    clock.scheduleAt(1, cascade);
    clock.resume();
    clock.advance(0.05); // 1 tick

    expect(order).toEqual(["cascade-3", "cascade-2", "cascade-1"]);
    expect(remaining).toBe(0);
  });
});

describe("SimulationClock.advanceTicks", () => {
  it("advances exactly the requested number of ticks", () => {
    const clock = new SimulationClock({ tickRateHz: 20 });
    clock.advanceTicks(7);
    expect(clock.tick).toBe(7);
  });

  it("works even while paused (deliberately bypasses pause -- see its own doc comment)", () => {
    const clock = new SimulationClock({ tickRateHz: 20 });
    expect(clock.isPaused).toBe(true);
    clock.advanceTicks(5);
    expect(clock.tick).toBe(5);
    expect(clock.isPaused).toBe(true); // does not itself change pause state
  });

  it("works regardless of speed multiplier, including speed 0", () => {
    const clock = new SimulationClock({ tickRateHz: 20 });
    clock.setSpeed(0);
    clock.advanceTicks(3);
    expect(clock.tick).toBe(3);
  });

  it("fires tick listeners and drains scheduled work exactly as advance() does", () => {
    const clock = new SimulationClock({ tickRateHz: 20 });
    const seenTicks: number[] = [];
    clock.onTick((tick) => seenTicks.push(tick));
    let fired = false;
    clock.scheduleAt(2, () => {
      fired = true;
    });

    clock.advanceTicks(3);

    expect(seenTicks).toEqual([1, 2, 3]);
    expect(fired).toBe(true);
  });

  it("does not touch the sub-tick accumulator or rounding carry", () => {
    const clock = new SimulationClock({ tickRateHz: 20 });
    clock.resume();
    clock.advance(0.03); // 30ms leftover in the accumulator, no tick yet
    const accumulatorBefore = clock.accumulatorNanosecondsExact;

    clock.advanceTicks(2);

    expect(clock.accumulatorNanosecondsExact).toBe(accumulatorBefore);
    expect(clock.tick).toBe(2);
  });

  it("rejects a negative or non-integer count", () => {
    const clock = new SimulationClock();
    expect(() => clock.advanceTicks(-1)).toThrow(RangeError);
    expect(() => clock.advanceTicks(1.5)).toThrow(RangeError);
  });

  it("accepts a count of 0 as a no-op", () => {
    const clock = new SimulationClock();
    clock.advanceTicks(0);
    expect(clock.tick).toBe(0);
  });
});

describe("SimulationClock debug observability", () => {
  it("exposes an inspectable snapshot", () => {
    const clock = new SimulationClock({ tickRateHz: 20 });
    clock.onTick(() => {});
    clock.scheduleAt(5, () => {});
    clock.resume();
    clock.advance(0.03); // 30ms: no full tick yet at 50ms/tick, accumulator holds 60%

    const state = clock.getDebugState();
    expect(state.tick).toBe(0);
    expect(state.paused).toBe(false);
    expect(state.speedMultiplier).toBe(1);
    expect(state.tickRateHz).toBe(20);
    expect(state.pendingScheduledCount).toBe(1);
    expect(state.tickListenerCount).toBe(1);
    expect(state.accumulatorFraction).toBeCloseTo(0.6, 10);
  });

  it("carries labels for scheduled work and listeners, for a future click-to-inspect layer", () => {
    const clock = new SimulationClock({ tickRateHz: 20 });
    clock.onTick(() => {}, "needs-decay");
    clock.scheduleAt(5, () => {}, "hydrology-tick");

    const state = clock.getDebugState();
    expect(state.tickListenerLabels).toEqual(["needs-decay"]);
    expect(state.pendingScheduled).toEqual([{ tick: 5, label: "hydrology-tick" }]);
  });

  it("sorts the pending-scheduled snapshot by tick regardless of insertion order", () => {
    const clock = new SimulationClock({ tickRateHz: 20 });
    clock.scheduleAt(9, () => {}, "late");
    clock.scheduleAt(2, () => {}, "early");
    clock.scheduleAt(5, () => {}, "mid");

    const state = clock.getDebugState();
    expect(state.pendingScheduled.map((entry) => entry.label)).toEqual(["early", "mid", "late"]);
  });

  it("exposes the exact sub-tick accumulator for a future persistence layer", () => {
    const clock = new SimulationClock({ tickRateHz: 20 });
    clock.resume();
    clock.advance(0.03); // 30ms of a 50ms tick, no tick produced yet
    expect(clock.accumulatorNanosecondsExact).toBe(30_000_000n);
  });
});

describe("SimulationClock snapshot/restore", () => {
  it("round-trips tick, pause, speed, and the exact mid-tick accumulator", () => {
    const clock = new SimulationClock({ tickRateHz: 20 });
    clock.resume();
    clock.setSpeed(3);
    clock.advance(1.03); // 20 full ticks + 30ms leftover of the 21st

    const snapshot = clock.toSnapshot();
    const restored = SimulationClock.fromSnapshot(snapshot);

    expect(restored.tick).toBe(clock.tick);
    expect(restored.isPaused).toBe(clock.isPaused);
    expect(restored.speed).toBe(clock.speed);
    expect(restored.tickRateHz).toBe(clock.tickRateHz);
    expect(restored.accumulatorNanosecondsExact).toBe(clock.accumulatorNanosecondsExact);
  });

  it("resumes advancing identically to the original after restore (no lost sub-tick progress)", () => {
    const clock = new SimulationClock({ tickRateHz: 20 });
    clock.resume();
    clock.advance(0.09); // 90ms: 1 full tick + 40ms leftover

    const restored = SimulationClock.fromSnapshot(clock.toSnapshot());
    const ticksFromOriginal = clock.advance(0.01); // completes the leftover 40ms -> 1 more tick
    const ticksFromRestored = restored.advance(0.01);

    expect(ticksFromRestored).toBe(ticksFromOriginal);
    expect(restored.tick).toBe(clock.tick);
  });

  it("serializes the accumulator as a decimal string, not a lossy float", () => {
    const clock = new SimulationClock({ tickRateHz: 20 });
    clock.resume();
    clock.advance(0.03);
    const snapshot = clock.toSnapshot();
    expect(typeof snapshot.accumulatorNanosecondsExact).toBe("string");
    expect(snapshot.accumulatorNanosecondsExact).toBe("30000000");
  });

  it("survives a real JSON.stringify/JSON.parse round trip", () => {
    const clock = new SimulationClock({ tickRateHz: 20 });
    clock.resume();
    clock.advance(0.13);
    const revived = JSON.parse(JSON.stringify(clock.toSnapshot()));
    const restored = SimulationClock.fromSnapshot(revived);
    expect(restored.tick).toBe(clock.tick);
    expect(restored.accumulatorNanosecondsExact).toBe(clock.accumulatorNanosecondsExact);
  });

  it("rejects an unsupported snapshot version", () => {
    const clock = new SimulationClock();
    const snapshot = clock.toSnapshot();
    expect(() => SimulationClock.fromSnapshot({ ...snapshot, version: 999 })).toThrow(RangeError);
  });

  it("rejects an accumulator at or beyond a full tick's duration", () => {
    const clock = new SimulationClock({ tickRateHz: 20 }); // 50ms/tick = 50,000,000ns
    const snapshot = clock.toSnapshot();
    expect(() =>
      SimulationClock.fromSnapshot({ ...snapshot, accumulatorNanosecondsExact: "50000000" }),
    ).toThrow(RangeError);
  });

  it("rejects a negative accumulator", () => {
    const clock = new SimulationClock();
    const snapshot = clock.toSnapshot();
    expect(() => SimulationClock.fromSnapshot({ ...snapshot, accumulatorNanosecondsExact: "-1" })).toThrow(
      RangeError,
    );
  });

  it("rejects an out-of-range nsRoundingCarry rather than letting it reach the tick-drain loop unbounded", () => {
    // Legitimate values are always in (-0.5, 0.5]; a huge value here would
    // otherwise let a single normal-sized advance() call produce millions
    // of synchronous ticks -- the same DoS class MAX_SPEED_MULTIPLIER
    // exists to prevent, just reached through a different field.
    const clock = new SimulationClock({ tickRateHz: 20 });
    const snapshot = clock.toSnapshot();
    expect(() => SimulationClock.fromSnapshot({ ...snapshot, nsRoundingCarry: 5e13 })).toThrow(RangeError);
    expect(() => SimulationClock.fromSnapshot({ ...snapshot, nsRoundingCarry: -5e13 })).toThrow(RangeError);
    expect(() => SimulationClock.fromSnapshot({ ...snapshot, nsRoundingCarry: 1 })).toThrow(RangeError);
    expect(() => SimulationClock.fromSnapshot({ ...snapshot, nsRoundingCarry: 0.5 })).not.toThrow();
  });

  it("rejects a non-integer accumulator string", () => {
    const clock = new SimulationClock();
    const snapshot = clock.toSnapshot();
    expect(() =>
      SimulationClock.fromSnapshot({ ...snapshot, accumulatorNanosecondsExact: "not-a-number" }),
    ).toThrow(RangeError);
  });

  it("rejects an out-of-range speed multiplier", () => {
    const clock = new SimulationClock();
    const snapshot = clock.toSnapshot();
    expect(() => SimulationClock.fromSnapshot({ ...snapshot, speedMultiplier: 99_999 })).toThrow(RangeError);
  });

  it("rejects a negative tick index", () => {
    const clock = new SimulationClock();
    const snapshot = clock.toSnapshot();
    expect(() => SimulationClock.fromSnapshot({ ...snapshot, tickIndex: -1 })).toThrow(RangeError);
  });

  it("does not restore pending scheduled work or tick listeners (documented scope boundary)", () => {
    const clock = new SimulationClock({ tickRateHz: 20 });
    let fired = 0;
    clock.onTick(() => fired++);
    clock.scheduleAt(1, () => {
      fired += 100;
    });
    const restored = SimulationClock.fromSnapshot(clock.toSnapshot());
    expect(restored.getDebugState().tickListenerCount).toBe(0);
    expect(restored.getDebugState().pendingScheduledCount).toBe(0);
  });
});
