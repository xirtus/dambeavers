const NS_PER_SECOND = 1_000_000_000n;

const SIMULATION_CLOCK_SNAPSHOT_VERSION = 1;
/** Legitimate `nsRoundingCarry` values are always in `(-0.5, 0.5]` (see the field's own doc comment); bounding restore to `(-1, 1)` rejects a corrupted/hand-edited snapshot with room to spare while still being a real, meaningful bound -- not `Number.isFinite`, which would accept a value large enough to force millions of synchronous ticks out of the very next advance() call. */
const NS_ROUNDING_CARRY_BOUND = 1;

/**
 * Upper bound on the integer speed multiplier. Not a gameplay balance
 * choice — it exists so a misconfigured "fast forward" caller (e.g. a UI
 * bug that sets speed to an unbounded value) cannot turn one normal-sized
 * `advance()` call into hundreds of millions of synchronous tick-listener
 * invocations and freeze the process. Callers that need to catch up a
 * large amount of offscreen/background simulation time should call
 * `advance()` repeatedly rather than requesting an unbounded multiplier.
 */
const MAX_SPEED_MULTIPLIER = 1024;

export type TickListener = (tick: number, simulationTimeSeconds: number) => void;
export type ScheduledCallback = () => void;
export type Unsubscribe = () => void;

export interface SimulationClockDebugState {
  tick: number;
  simulationTimeSeconds: number;
  paused: boolean;
  speedMultiplier: number;
  tickRateHz: number;
  /** Fraction of the current tick's duration already accumulated. Debug/display only — see accumulatorNanosecondsExact for the exact value. */
  accumulatorFraction: number;
  pendingScheduledCount: number;
  /** Snapshot of pending scheduled work, soonest first, for a future click-to-inspect debug layer (P0-12). */
  pendingScheduled: Array<{ tick: number; label: string }>;
  tickListenerCount: number;
  tickListenerLabels: string[];
}

export interface SimulationClockOptions {
  /** Authoritative ticks per simulated second. Must evenly divide 1e9 ns. */
  tickRateHz?: number;
}

/**
 * Persists exactly the authoritative time state: tick index, run/pause and
 * speed, and the exact sub-tick accumulator (so a reload resumes mid-tick
 * precisely rather than losing up to one tick's worth of progress).
 * `accumulatorNanosecondsExact` is a decimal string, not a JS number --
 * `bigint` has no native JSON representation and the accumulator can
 * exceed 2^53 in principle, so round-tripping it through a plain `number`
 * field would silently reintroduce the precision loss this class exists to
 * avoid (see the class doc comment).
 *
 * Deliberately NOT persisted: pending `scheduleAt`/`scheduleAfter` entries
 * and `onTick` listeners. Both hold live JS closures/callbacks, which
 * cannot round-trip through a JSON-plain snapshot at all -- this scheduler
 * is a within-session mechanism (closer to `setTimeout` than to durable
 * game state). A future system that needs a persistent countdown (a
 * decay timer, a construction ETA) must store its own deadline as
 * ordinary component/domain data and re-derive/re-register its callback
 * after load, rather than expect the scheduler itself to serialize
 * closures.
 */
export interface SimulationClockSnapshot {
  version: number;
  tickRateHz: number;
  tickIndex: number;
  paused: boolean;
  speedMultiplier: number;
  accumulatorNanosecondsExact: string;
  nsRoundingCarry: number;
}

interface ScheduledEntry {
  tick: number;
  seq: number;
  callback: ScheduledCallback;
  label: string;
}

interface TickListenerEntry {
  listener: TickListener;
  label: string;
}

/** Binary min-heap over ScheduledEntry, ordered by (tick, seq). Keeps scheduling O(log n) as entity/job/hydrology counts grow into the thousands. */
class ScheduleHeap {
  private readonly items: ScheduledEntry[] = [];

  get size(): number {
    return this.items.length;
  }

  private less(a: ScheduledEntry, b: ScheduledEntry): boolean {
    return a.tick !== b.tick ? a.tick < b.tick : a.seq < b.seq;
  }

  push(entry: ScheduledEntry): void {
    this.items.push(entry);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      const parentEntry = this.items[parent]!;
      const current = this.items[i]!;
      if (!this.less(current, parentEntry)) break;
      this.items[i] = parentEntry;
      this.items[parent] = current;
      i = parent;
    }
  }

  peek(): ScheduledEntry | undefined {
    return this.items[0];
  }

  pop(): ScheduledEntry | undefined {
    const top = this.items[0];
    if (top === undefined) return undefined;
    const last = this.items.pop()!;
    if (this.items.length > 0) {
      this.items[0] = last;
      let i = 0;
      const n = this.items.length;
      for (;;) {
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        let smallest = i;
        if (l < n && this.less(this.items[l]!, this.items[smallest]!)) smallest = l;
        if (r < n && this.less(this.items[r]!, this.items[smallest]!)) smallest = r;
        if (smallest === i) break;
        const a = this.items[i]!;
        const b = this.items[smallest]!;
        this.items[i] = b;
        this.items[smallest] = a;
        i = smallest;
      }
    }
    return top;
  }

  toSortedArraySnapshot(): ScheduledEntry[] {
    return [...this.items].sort((a, b) => (a.tick !== b.tick ? a.tick - b.tick : a.seq - b.seq));
  }
}

/**
 * The authoritative simulation clock. Owns tick index and simulation time;
 * everything else in the simulation must derive time from this, never from
 * wall-clock/render timing.
 *
 * Determinism invariant: the accumulator is exact-integer nanoseconds
 * (bigint), not floating-point seconds, and per-call float→ns rounding
 * error is diffused into the next call via `nsRoundingCarry` instead of
 * being dropped. Floating point addition is not associative, so naively
 * summing float seconds (or independently rounding each call to the
 * nearest ns with no carry) both let a fixed-size render-frame delta
 * accumulate a systematic bias — 1/60s and 1/30s round in different
 * directions relative to their true value, and that bias compounds
 * linearly with call count. With the carry preserved, the cumulative
 * nanoseconds fed into the accumulator converge to the true elapsed time
 * to within under 1ns regardless of how it was chunked across calls, so
 * the tick index reached after a given amount of real time is independent
 * of render frame rate. `tick` is the sole exact time source; treat
 * `simulationTimeSeconds` as a float64 convenience derivative (see its
 * doc comment for the long-horizon precision boundary).
 */
export class SimulationClock {
  private readonly tickDurationNs: bigint;
  private readonly tickRateHzValue: number;

  private accumulatorNs = 0n;
  /**
   * Sub-nanosecond rounding remainder from the last advance() call, in
   * `(-1, 1)` by construction (`exactNs - Math.round(exactNs)` is always
   * in `(-0.5, 0.5]`, and the carry only ever accumulates one such term
   * before being consumed again next call). Persisted (see
   * `SimulationClockSnapshot`) for exact restore rather than the ~1ns
   * drift losing it would cause; `fromSnapshot` bounds-checks it against
   * this same range so a corrupted/hand-edited value can't reach the
   * accumulator drain loop as a huge number (see `NS_ROUNDING_CARRY_BOUND`).
   */
  private nsRoundingCarry = 0;
  private tickIndex = 0;
  private paused = true;
  private speedMultiplier = 1;

  private readonly tickListeners: TickListenerEntry[] = [];
  private readonly scheduled = new ScheduleHeap();
  private scheduleSeq = 0;

  constructor(options: SimulationClockOptions = {}) {
    const tickRateHz = options.tickRateHz ?? 20;
    if (!Number.isInteger(tickRateHz) || tickRateHz <= 0) {
      throw new RangeError(`tickRateHz must be a positive integer, got ${tickRateHz}`);
    }
    if (NS_PER_SECOND % BigInt(tickRateHz) !== 0n) {
      throw new RangeError(
        `tickRateHz (${tickRateHz}) must evenly divide 1e9 ns/s to keep tick duration exact`,
      );
    }
    this.tickRateHzValue = tickRateHz;
    this.tickDurationNs = NS_PER_SECOND / BigInt(tickRateHz);
  }

  get tick(): number {
    return this.tickIndex;
  }

  /**
   * Convenience float64 view of `tick * tickDuration`. Exact for any
   * realistic session length: precision is only lost once
   * `tick * tickDurationNs` exceeds 2^53 ns (~104 days of *simulated*
   * clock time at 20Hz, reachable in hours of real time at high speed
   * multipliers). Systems needing exactness at that horizon — interval
   * timers, decay schedules — should key off the integer `tick`, not this
   * getter.
   */
  get simulationTimeSeconds(): number {
    return Number(BigInt(this.tickIndex) * this.tickDurationNs) / 1e9;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  get speed(): number {
    return this.speedMultiplier;
  }

  get tickRateHz(): number {
    return this.tickRateHzValue;
  }

  /** Exact sub-tick accumulator. `toSnapshot()`/`fromSnapshot()` (P0-06) use this for precise restore instead of the lossy `accumulatorFraction` debug view. */
  get accumulatorNanosecondsExact(): bigint {
    return this.accumulatorNs;
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  /**
   * Integer multiplier applied to elapsed real time before accumulation.
   * 0 is a valid speed (distinct from pause: state is inspectable as
   * "running at 0x" rather than "paused") and behaves identically to pause
   * for tick production, but resume()/pause() are the explicit state the
   * UI should drive; speed governs how fast a running clock advances.
   */
  setSpeed(multiplier: number): void {
    if (!Number.isInteger(multiplier) || multiplier < 0 || multiplier > MAX_SPEED_MULTIPLIER) {
      throw new RangeError(
        `speed multiplier must be an integer in [0, ${MAX_SPEED_MULTIPLIER}], got ${multiplier}`,
      );
    }
    this.speedMultiplier = multiplier;
  }

  onTick(listener: TickListener, label = "unlabeled"): Unsubscribe {
    const entry: TickListenerEntry = { listener, label };
    this.tickListeners.push(entry);
    return () => {
      const index = this.tickListeners.indexOf(entry);
      if (index !== -1) this.tickListeners.splice(index, 1);
    };
  }

  /**
   * Schedule a callback to run once, at or after the given absolute tick.
   * Reentrancy contract: calling this from within a tick-processing
   * callback for `tick === clock.tick` (the tick currently draining) will
   * run the new entry within the *same* synchronous drain pass, after any
   * already-queued entries for that tick. This allows deliberate same-tick
   * cascades; a callback that unconditionally reschedules itself for the
   * current tick will loop synchronously forever. Schedule for a future
   * tick (`clock.tick + 1` or later) for a "resume next tick" pattern.
   */
  scheduleAt(tick: number, callback: ScheduledCallback, label = "unlabeled"): void {
    if (!Number.isInteger(tick) || tick < this.tickIndex) {
      throw new RangeError(
        `scheduleAt tick must be an integer >= current tick (${this.tickIndex}), got ${tick}`,
      );
    }
    this.scheduled.push({ tick, seq: this.scheduleSeq++, callback, label });
  }

  /** Schedule a callback to run once, `ticksFromNow` ticks after the current tick. */
  scheduleAfter(ticksFromNow: number, callback: ScheduledCallback, label = "unlabeled"): void {
    if (!Number.isInteger(ticksFromNow) || ticksFromNow < 0) {
      throw new RangeError(`ticksFromNow must be a non-negative integer, got ${ticksFromNow}`);
    }
    this.scheduleAt(this.tickIndex + ticksFromNow, callback, label);
  }

  /**
   * Advance the clock by `realDeltaSeconds` of real (render-loop) time.
   * Produces zero or more authoritative ticks. No-op while paused or at
   * speed 0. Returns the number of ticks actually processed.
   *
   * `realDeltaSeconds` should be a bounded render-frame-sized chunk (a
   * fraction of a second up to a few seconds). Very large single deltas
   * are still handled correctly, but once `realDeltaSeconds * 1e9`
   * exceeds 2^53 (~104 days), the float64 intermediate loses integer
   * precision; callers advancing simulation across long offscreen spans
   * should chunk the jump into repeated bounded `advance()` calls rather
   * than passing one huge delta.
   */
  advance(realDeltaSeconds: number): number {
    if (!Number.isFinite(realDeltaSeconds) || realDeltaSeconds < 0) {
      throw new RangeError(`realDeltaSeconds must be a finite number >= 0, got ${realDeltaSeconds}`);
    }
    if (this.paused || this.speedMultiplier === 0) {
      return 0;
    }

    // Error-diffused rounding: fold the previous call's rounding remainder
    // back in before rounding again, so the cumulative nanoseconds fed into
    // the accumulator track the true elapsed time regardless of how it was
    // chunked across calls. See the class doc comment.
    const exactNs = realDeltaSeconds * 1e9 + this.nsRoundingCarry;
    const roundedNs = Math.round(exactNs);
    this.nsRoundingCarry = exactNs - roundedNs;

    const deltaNs = BigInt(roundedNs) * BigInt(this.speedMultiplier);
    this.accumulatorNs += deltaNs;

    let ticksProcessed = 0;
    while (this.accumulatorNs >= this.tickDurationNs) {
      this.accumulatorNs -= this.tickDurationNs;
      this.stepOneTick();
      ticksProcessed++;
    }
    return ticksProcessed;
  }

  /**
   * Steps the clock forward by exactly `count` ticks, directly -- no real
   * time, no accumulator, no rounding involved at all. This is a distinct,
   * deliberately separate entry point from `advance()`, for a distinct
   * audience: `advance()` is for an interactive render loop that only
   * knows elapsed wall-clock time and must respect `pause`/`speed` to stay
   * controllable by the player; `advanceTicks()` is for a headless
   * test/CI harness (P0-11) that wants an exact, unsurprising number of
   * ticks to happen right now, regardless of `pause`/`speed` -- gating it
   * on `paused` would make "simulate N ticks" silently simulate zero
   * whenever a test forgot to call `resume()` first, which is exactly the
   * kind of surprise a deterministic test harness must not have. Both
   * methods drive the same authoritative `stepOneTick()`, so tick
   * listeners, scheduled callbacks, and tick/simulationTimeSeconds
   * advancement behave identically either way -- only the input unit and
   * the pause/speed interaction differ.
   */
  advanceTicks(count: number): void {
    if (!Number.isInteger(count) || count < 0) {
      throw new RangeError(`count must be a non-negative integer, got ${count}`);
    }
    for (let i = 0; i < count; i++) {
      this.stepOneTick();
    }
  }

  getDebugState(): SimulationClockDebugState {
    const pendingScheduled = this.scheduled
      .toSortedArraySnapshot()
      .map((entry) => ({ tick: entry.tick, label: entry.label }));
    return {
      tick: this.tickIndex,
      simulationTimeSeconds: this.simulationTimeSeconds,
      paused: this.paused,
      speedMultiplier: this.speedMultiplier,
      tickRateHz: this.tickRateHzValue,
      accumulatorFraction: Number(this.accumulatorNs) / Number(this.tickDurationNs),
      pendingScheduledCount: pendingScheduled.length,
      pendingScheduled,
      tickListenerCount: this.tickListeners.length,
      tickListenerLabels: this.tickListeners.map((entry) => entry.label),
    };
  }

  toSnapshot(): SimulationClockSnapshot {
    return {
      version: SIMULATION_CLOCK_SNAPSHOT_VERSION,
      tickRateHz: this.tickRateHzValue,
      tickIndex: this.tickIndex,
      paused: this.paused,
      speedMultiplier: this.speedMultiplier,
      accumulatorNanosecondsExact: this.accumulatorNs.toString(),
      nsRoundingCarry: this.nsRoundingCarry,
    };
  }

  /**
   * Reconstructs a clock from a snapshot. Validates the accumulator
   * invariant `advance()` itself maintains -- `0 <= accumulatorNs <
   * tickDurationNs` (the drain loop never leaves a full tick's worth of
   * nanoseconds unconsumed) -- so a corrupted or hand-edited snapshot can't
   * silently produce a clock that fires an extra tick (or none) on its
   * very next `advance()` call.
   */
  static fromSnapshot(snapshot: SimulationClockSnapshot): SimulationClock {
    if (snapshot.version !== SIMULATION_CLOCK_SNAPSHOT_VERSION) {
      throw new RangeError(
        `unsupported SimulationClock snapshot version ${snapshot.version}, expected ${SIMULATION_CLOCK_SNAPSHOT_VERSION}`,
      );
    }
    const clock = new SimulationClock({ tickRateHz: snapshot.tickRateHz });
    if (!Number.isInteger(snapshot.tickIndex) || snapshot.tickIndex < 0) {
      throw new RangeError(`corrupt snapshot: tickIndex must be a non-negative integer, got ${snapshot.tickIndex}`);
    }
    if (
      !Number.isInteger(snapshot.speedMultiplier) ||
      snapshot.speedMultiplier < 0 ||
      snapshot.speedMultiplier > MAX_SPEED_MULTIPLIER
    ) {
      throw new RangeError(
        `corrupt snapshot: speedMultiplier must be an integer in [0, ${MAX_SPEED_MULTIPLIER}], got ${snapshot.speedMultiplier}`,
      );
    }
    if (!Number.isFinite(snapshot.nsRoundingCarry) || Math.abs(snapshot.nsRoundingCarry) >= NS_ROUNDING_CARRY_BOUND) {
      throw new RangeError(
        `corrupt snapshot: nsRoundingCarry must be within (-${NS_ROUNDING_CARRY_BOUND}, ${NS_ROUNDING_CARRY_BOUND}), got ${snapshot.nsRoundingCarry}`,
      );
    }
    let accumulatorNs: bigint;
    try {
      accumulatorNs = BigInt(snapshot.accumulatorNanosecondsExact);
    } catch {
      throw new RangeError(
        `corrupt snapshot: accumulatorNanosecondsExact must be an integer string, got ${JSON.stringify(snapshot.accumulatorNanosecondsExact)}`,
      );
    }
    if (accumulatorNs < 0n || accumulatorNs >= clock.tickDurationNs) {
      throw new RangeError(
        `corrupt snapshot: accumulator (${accumulatorNs}ns) must be in [0, ${clock.tickDurationNs}ns) -- advance() never leaves a full tick undrained`,
      );
    }
    clock.tickIndex = snapshot.tickIndex;
    clock.paused = snapshot.paused;
    clock.speedMultiplier = snapshot.speedMultiplier;
    clock.accumulatorNs = accumulatorNs;
    clock.nsRoundingCarry = snapshot.nsRoundingCarry;
    return clock;
  }

  private stepOneTick(): void {
    this.tickIndex++;

    for (;;) {
      const next = this.scheduled.peek();
      if (next === undefined || next.tick > this.tickIndex) break;
      this.scheduled.pop();
      next.callback();
    }

    const simTime = this.simulationTimeSeconds;
    for (const entry of this.tickListeners) {
      entry.listener(this.tickIndex, simTime);
    }
  }
}
