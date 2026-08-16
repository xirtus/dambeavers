import { describe, expect, it } from "vitest";
import { RandomStream, RandomStreams } from "../../src/sim/core/Random.js";

describe("RandomStream seeding", () => {
  it("produces an identical sequence from the same numeric seed", () => {
    const a = RandomStream.fromSeed(12345);
    const b = RandomStream.fromSeed(12345);
    const seqA = Array.from({ length: 50 }, () => a.nextUint32());
    const seqB = Array.from({ length: 50 }, () => b.nextUint32());
    expect(seqA).toEqual(seqB);
  });

  it("produces an identical sequence from the same string seed", () => {
    const a = RandomStream.fromSeed("watershed-alpha");
    const b = RandomStream.fromSeed("watershed-alpha");
    expect(a.nextUint32()).toBe(b.nextUint32());
    expect(a.nextUint32()).toBe(b.nextUint32());
  });

  it("produces different sequences from different seeds", () => {
    const a = RandomStream.fromSeed(1);
    const b = RandomStream.fromSeed(2);
    const seqA = Array.from({ length: 20 }, () => a.nextUint32());
    const seqB = Array.from({ length: 20 }, () => b.nextUint32());
    expect(seqA).not.toEqual(seqB);
  });

  it("rejects a non-integer or non-finite numeric seed", () => {
    expect(() => RandomStream.fromSeed(1.5)).toThrow(RangeError);
    expect(() => RandomStream.fromSeed(Number.NaN)).toThrow(RangeError);
    expect(() => RandomStream.fromSeed(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe("RandomStream algorithm regression (golden vector)", () => {
  it("matches an independently-computed xoshiro128** output for a known state", () => {
    // Pinned so an accidental change to the state-transition order (e.g.
    // swapping a pre-/post-update value in nextUint32, or the rotl amount)
    // fails CI loudly instead of just silently becoming "the new normal" --
    // every other test here is self-referential (same seed -> same output)
    // and would happily pass under a subtly wrong algorithm. Independently
    // verified against a from-scratch reference transcription of
    // xoshiro128** (Blackman & Vigna) starting from raw state (1,2,3,4).
    const stream = RandomStream.fromSnapshot({ version: 1, s0: 1, s1: 2, s2: 3, s3: 4, drawCount: 0 });
    const outputs = Array.from({ length: 8 }, () => stream.nextUint32());
    expect(outputs).toEqual([
      11520, 0, 5927040, 70819200, 2031721883, 1637235492, 1287239034, 3734860849,
    ]);
  });
});

describe("RandomStream draw methods", () => {
  it("nextFloat stays within [0, 1) over many draws", () => {
    const stream = RandomStream.fromSeed(7);
    for (let i = 0; i < 2000; i++) {
      const v = stream.nextFloat();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("nextInt stays within [min, max) and both extremes are reachable over many draws", () => {
    const stream = RandomStream.fromSeed(7);
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i++) {
      const v = stream.nextInt(3, 8);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThan(8);
      seen.add(v);
    }
    expect([...seen].sort()).toEqual([3, 4, 5, 6, 7]);
  });

  it("rejects an invalid nextInt range", () => {
    const stream = RandomStream.fromSeed(1);
    expect(() => stream.nextInt(5, 5)).toThrow(RangeError);
    expect(() => stream.nextInt(5, 3)).toThrow(RangeError);
    expect(() => stream.nextInt(1.5, 3)).toThrow(RangeError);
  });

  it("nextBool respects probability 0 and 1 deterministically", () => {
    const stream = RandomStream.fromSeed(1);
    for (let i = 0; i < 100; i++) expect(stream.nextBool(0)).toBe(false);
    for (let i = 0; i < 100; i++) expect(stream.nextBool(1)).toBe(true);
  });

  it("rejects an out-of-range probability", () => {
    const stream = RandomStream.fromSeed(1);
    expect(() => stream.nextBool(-0.1)).toThrow(RangeError);
    expect(() => stream.nextBool(1.1)).toThrow(RangeError);
  });

  it("tracks draw count in debug state", () => {
    const stream = RandomStream.fromSeed(1);
    stream.nextUint32();
    stream.nextFloat();
    stream.nextInt(0, 10);
    expect(stream.getDebugState().drawCount).toBe(3);
  });

  it("pick always returns an element actually present in the array", () => {
    const stream = RandomStream.fromSeed(1);
    const items = ["a", "b", "c", "d"];
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const picked = stream.pick(items);
      expect(items).toContain(picked);
      seen.add(picked);
    }
    expect(seen.size).toBe(items.length); // all reachable over enough draws
  });

  it("pick rejects an empty array", () => {
    const stream = RandomStream.fromSeed(1);
    expect(() => stream.pick([])).toThrow(RangeError);
  });

  it("shuffle returns a permutation without mutating the input", () => {
    const stream = RandomStream.fromSeed(1);
    const original = [1, 2, 3, 4, 5];
    const shuffled = stream.shuffle(original);
    expect(original).toEqual([1, 2, 3, 4, 5]); // untouched
    expect(shuffled.slice().sort()).toEqual(original.slice().sort()); // same multiset
    expect(shuffled).not.toBe(original);
  });

  it("shuffle is deterministic for a given seed and produces varied orderings", () => {
    const a = RandomStream.fromSeed(1).shuffle([1, 2, 3, 4, 5, 6, 7, 8]);
    const b = RandomStream.fromSeed(1).shuffle([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(b).toEqual(a);
    expect(a).not.toEqual([1, 2, 3, 4, 5, 6, 7, 8]); // seed 1 shouldn't happen to be identity
  });
});

describe("RandomStream snapshot/restore", () => {
  it("continues the identical sequence after a snapshot/restore round-trip", () => {
    const live = RandomStream.fromSeed(999);
    live.nextUint32();
    live.nextUint32();
    const snapshot = live.toSnapshot();

    const continuedLive = Array.from({ length: 10 }, () => live.nextUint32());
    const restored = RandomStream.fromSnapshot(snapshot);
    const continuedRestored = Array.from({ length: 10 }, () => restored.nextUint32());

    expect(continuedRestored).toEqual(continuedLive);
  });

  it("preserves drawCount across a round trip (observational only, doesn't affect output)", () => {
    const live = RandomStream.fromSeed(999);
    live.nextUint32();
    live.nextUint32();
    live.nextUint32();
    const restored = RandomStream.fromSnapshot(live.toSnapshot());
    expect(restored.getDebugState().drawCount).toBe(3);
  });

  it("rejects a negative or non-integer drawCount", () => {
    const snapshot = RandomStream.fromSeed(1).toSnapshot();
    expect(() => RandomStream.fromSnapshot({ ...snapshot, drawCount: -1 })).toThrow(RangeError);
    expect(() => RandomStream.fromSnapshot({ ...snapshot, drawCount: 1.5 })).toThrow(RangeError);
  });

  it("rejects an unsupported snapshot version", () => {
    const snapshot = RandomStream.fromSeed(1).toSnapshot();
    expect(() => RandomStream.fromSnapshot({ ...snapshot, version: 999 })).toThrow(RangeError);
  });

  it("rejects out-of-range or non-integer state words", () => {
    const snapshot = RandomStream.fromSeed(1).toSnapshot();
    expect(() => RandomStream.fromSnapshot({ ...snapshot, s0: -1 })).toThrow(RangeError);
    expect(() => RandomStream.fromSnapshot({ ...snapshot, s1: 1.5 })).toThrow(RangeError);
    expect(() => RandomStream.fromSnapshot({ ...snapshot, s2: 2 ** 32 })).toThrow(RangeError);
  });

  it("rejects an all-zero state", () => {
    expect(() =>
      RandomStream.fromSnapshot({ version: 1, s0: 0, s1: 0, s2: 0, s3: 0, drawCount: 0 }),
    ).toThrow(RangeError);
  });
});

describe("RandomStreams subsystem partitioning", () => {
  it("gives the same master seed + name the same sequence", () => {
    const a = new RandomStreams(42);
    const b = new RandomStreams(42);
    const seqA = Array.from({ length: 20 }, () => a.stream("hydrology").nextUint32());
    const seqB = Array.from({ length: 20 }, () => b.stream("hydrology").nextUint32());
    expect(seqA).toEqual(seqB);
  });

  it("gives different subsystem names different sequences under the same master seed", () => {
    const streams = new RandomStreams(42);
    const seqA = Array.from({ length: 20 }, () => streams.stream("hydrology").nextUint32());
    const seqB = Array.from({ length: 20 }, () => streams.stream("job-selection").nextUint32());
    expect(seqA).not.toEqual(seqB);
  });

  it("returns the same live stream instance on repeated access by name", () => {
    const streams = new RandomStreams(42);
    const first = streams.stream("hydrology");
    first.nextUint32();
    const second = streams.stream("hydrology");
    expect(second.getDebugState().drawCount).toBe(1);
  });

  it("is independent of the order streams are first accessed in", () => {
    const orderAB = new RandomStreams(42);
    const abFirst = Array.from({ length: 10 }, () => orderAB.stream("a").nextUint32());
    const abSecond = Array.from({ length: 10 }, () => orderAB.stream("b").nextUint32());

    const orderBA = new RandomStreams(42);
    const baSecond = Array.from({ length: 10 }, () => orderBA.stream("b").nextUint32());
    const baFirst = Array.from({ length: 10 }, () => orderBA.stream("a").nextUint32());

    expect(baFirst).toEqual(abFirst);
    expect(baSecond).toEqual(abSecond);
  });

  it("is unaffected by an unrelated third stream being introduced first", () => {
    // Regression guard for counter-based derivation schemes: introducing a
    // brand-new subsystem earlier in the access order must never perturb
    // an existing subsystem's sequence.
    const withoutExtra = new RandomStreams(42);
    const untouched = Array.from({ length: 10 }, () => withoutExtra.stream("hydrology").nextUint32());

    const withExtra = new RandomStreams(42);
    withExtra.stream("brand-new-subsystem").nextUint32();
    withExtra.stream("brand-new-subsystem").nextUint32();
    const stillMatches = Array.from({ length: 10 }, () => withExtra.stream("hydrology").nextUint32());

    expect(stillMatches).toEqual(untouched);
  });

  it("rejects an empty stream name", () => {
    const streams = new RandomStreams(1);
    expect(() => streams.stream("")).toThrow(RangeError);
  });
});

describe("RandomStreams debug observability", () => {
  it("reports per-stream derived seed and draw count", () => {
    const streams = new RandomStreams(42);
    streams.stream("hydrology").nextUint32();
    streams.stream("hydrology").nextUint32();
    streams.stream("jobs").nextUint32();

    const state = streams.getDebugState();
    expect(state.masterSeed).toBe(42);
    expect(state.streamCount).toBe(2);
    expect(state.streams.map((s) => s.name)).toEqual(["hydrology", "jobs"]);
    expect(state.streams.find((s) => s.name === "hydrology")?.drawCount).toBe(2);
    expect(state.streams.find((s) => s.name === "jobs")?.drawCount).toBe(1);
  });
});

describe("RandomStreams snapshot/restore", () => {
  it("continues every touched stream identically after a snapshot/restore round-trip", () => {
    const live = new RandomStreams(42);
    live.stream("hydrology").nextUint32();
    live.stream("jobs").nextUint32();
    live.stream("jobs").nextUint32();
    const snapshot = live.toSnapshot();

    const continuedHydrology = Array.from({ length: 5 }, () => live.stream("hydrology").nextUint32());
    const continuedJobs = Array.from({ length: 5 }, () => live.stream("jobs").nextUint32());

    const restored = RandomStreams.fromSnapshot(snapshot);
    const restoredHydrology = Array.from({ length: 5 }, () => restored.stream("hydrology").nextUint32());
    const restoredJobs = Array.from({ length: 5 }, () => restored.stream("jobs").nextUint32());

    expect(restoredHydrology).toEqual(continuedHydrology);
    expect(restoredJobs).toEqual(continuedJobs);
  });

  it("a freshly-touched stream after restore matches a fresh manager that never drew from it", () => {
    // Streams never yet accessed at snapshot time aren't in the snapshot
    // payload at all; touching them post-restore must still derive
    // correctly from the master seed.
    const live = new RandomStreams(42);
    live.stream("hydrology").nextUint32();
    const snapshot = live.toSnapshot();
    const restored = RandomStreams.fromSnapshot(snapshot);

    const reference = new RandomStreams(42);
    expect(restored.stream("ecology").nextUint32()).toBe(reference.stream("ecology").nextUint32());
  });

  it("rejects an unsupported snapshot version", () => {
    const snapshot = new RandomStreams(1).toSnapshot();
    expect(() => RandomStreams.fromSnapshot({ ...snapshot, version: 999 })).toThrow(RangeError);
  });

  it("rejects an invalid masterSeed", () => {
    const snapshot = new RandomStreams(1).toSnapshot();
    expect(() => RandomStreams.fromSnapshot({ ...snapshot, masterSeed: -1 })).toThrow(RangeError);
  });

  it("rejects duplicate stream names in the snapshot payload", () => {
    const snapshot = new RandomStreams(1).toSnapshot();
    const streamSnap = RandomStream.fromSeed(1).toSnapshot();
    const corrupt = {
      ...snapshot,
      streams: [
        { name: "hydrology", snapshot: streamSnap },
        { name: "hydrology", snapshot: streamSnap },
      ],
    };
    expect(() => RandomStreams.fromSnapshot(corrupt)).toThrow(RangeError);
  });

  it("rejects an empty or non-string stream name in the snapshot payload", () => {
    const snapshot = new RandomStreams(1).toSnapshot();
    const streamSnap = RandomStream.fromSeed(1).toSnapshot();
    const emptyName = { ...snapshot, streams: [{ name: "", snapshot: streamSnap }] };
    const numericName = { ...snapshot, streams: [{ name: 42 as unknown as string, snapshot: streamSnap }] };
    expect(() => RandomStreams.fromSnapshot(emptyName)).toThrow(RangeError);
    expect(() => RandomStreams.fromSnapshot(numericName)).toThrow(RangeError);
  });
});
