const UINT32_RANGE = 4294967296; // 2^32
// Independent version constants: RandomStream and RandomStreams are nested
// but separately-evolvable schemas (a manager wraps a collection of
// streams). Sharing one constant would force a version bump/rejection on
// one shape whenever the other changes, even though it didn't.
const RANDOM_STREAM_SNAPSHOT_VERSION = 1;
const RANDOM_STREAMS_SNAPSHOT_VERSION = 1;

function isValidUint32(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < UINT32_RANGE;
}

/** Deterministic string -> uint32 hash (FNV-1a). Used to normalize string seeds and to derive subsystem sub-seeds; platform-independent (only integer char-code arithmetic, no locale/host dependence). */
function fnv1a32(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function normalizeSeed(seed: number | string): number {
  if (typeof seed === "string") return fnv1a32(seed);
  if (!Number.isInteger(seed)) {
    throw new RangeError(`numeric seed must be an integer, got ${seed}`);
  }
  return seed >>> 0; // wrap into uint32 range
}

/**
 * splitmix32: a simple, fast state expander used only to turn one seed
 * integer into well-mixed initial state words for xoshiro128 (which
 * forbids an all-zero state and produces poor output from a
 * barely-mixed seed if fed directly). Not used as the simulation's actual
 * draw source.
 */
function makeSplitMix32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x9e3779b9) >>> 0;
    let z = state;
    // Large-constant multiplies: intermediate products exceed 2^32, so
    // Math.imul (exact 32-bit wraparound multiply) is required -- plain
    // `*` would lose precision here, unlike the small-constant multiplies
    // in xoshiro128's own step function below.
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    z = (z ^ (z >>> 16)) >>> 0;
    return z;
  };
}

function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

export interface RandomStreamSnapshot {
  version: number;
  s0: number;
  s1: number;
  s2: number;
  s3: number;
  /** Purely observational (see RandomStreamDebugState) -- never consulted by nextUint32() or any derived draw, so its own value can't affect determinism. Still persisted so a reloaded stream's debug/inspection view (P0-12) doesn't misreport a fresh stream as never having been drawn from. */
  drawCount: number;
}

export interface RandomStreamDebugState {
  drawCount: number;
  state: readonly [number, number, number, number];
}

/**
 * A single deterministic random draw source: xoshiro128** (Blackman &
 * Vigna), 128 bits of state, period 2^128-1, no cryptographic goal --
 * chosen for speed, good statistical quality, and a period far beyond any
 * realistic per-stream draw count over a multi-year play session (a
 * 32-bit-period generator like mulberry32 is fine for a one-off scratch
 * PRNG but is a real long-horizon risk here). Pure integer bitwise/imul
 * arithmetic only: no `Math.random`, no wall-clock, nothing
 * platform-dependent -- draws are a pure function of the seed and draw
 * sequence, satisfying AGENTS.md 1.8 (determinism where practical).
 *
 * Construct via `RandomStream.fromSeed` or `RandomStream.fromSnapshot`,
 * never `new` directly (the constructor takes raw internal state, not a
 * seed, to keep seeding and snapshot-restore unambiguous at the call site).
 */
export class RandomStream {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;
  private drawCount = 0;

  private constructor(s0: number, s1: number, s2: number, s3: number, drawCount = 0) {
    this.s0 = s0;
    this.s1 = s1;
    this.s2 = s2;
    this.s3 = s3;
    this.drawCount = drawCount;
  }

  static fromSeed(seed: number | string): RandomStream {
    const normalized = normalizeSeed(seed);
    const gen = makeSplitMix32(normalized);
    let s0 = gen();
    let s1 = gen();
    let s2 = gen();
    let s3 = gen();
    if ((s0 | s1 | s2 | s3) === 0) {
      // Astronomically unlikely from a well-mixed splitmix32 stream, but
      // xoshiro128 is mathematically undefined (stuck at all-zero forever)
      // from this exact state, so guard it explicitly rather than trust
      // probability.
      s0 = 1;
    }
    return new RandomStream(s0, s1, s2, s3);
  }

  static fromSnapshot(snapshot: RandomStreamSnapshot): RandomStream {
    if (snapshot.version !== RANDOM_STREAM_SNAPSHOT_VERSION) {
      throw new RangeError(
        `unsupported RandomStream snapshot version ${snapshot.version}, expected ${RANDOM_STREAM_SNAPSHOT_VERSION}`,
      );
    }
    for (const [key, value] of Object.entries({ s0: snapshot.s0, s1: snapshot.s1, s2: snapshot.s2, s3: snapshot.s3 })) {
      if (!isValidUint32(value)) {
        throw new RangeError(`corrupt snapshot: ${key} must be a uint32, got ${value}`);
      }
    }
    if ((snapshot.s0 | snapshot.s1 | snapshot.s2 | snapshot.s3) === 0) {
      throw new RangeError("corrupt snapshot: all-zero xoshiro128 state is invalid");
    }
    if (!Number.isInteger(snapshot.drawCount) || snapshot.drawCount < 0) {
      throw new RangeError(`corrupt snapshot: drawCount must be a non-negative integer, got ${snapshot.drawCount}`);
    }
    return new RandomStream(snapshot.s0, snapshot.s1, snapshot.s2, snapshot.s3, snapshot.drawCount);
  }

  /** Raw 32-bit unsigned integer, uniform over [0, 2^32). The fundamental draw; every other method derives from this. */
  nextUint32(): number {
    const result = (Math.imul(rotl(Math.imul(this.s1, 5) >>> 0, 7), 9)) >>> 0;
    const t = (this.s1 << 9) >>> 0;
    this.s2 = (this.s2 ^ this.s0) >>> 0;
    this.s3 = (this.s3 ^ this.s1) >>> 0;
    this.s1 = (this.s1 ^ this.s2) >>> 0;
    this.s0 = (this.s0 ^ this.s3) >>> 0;
    this.s2 = (this.s2 ^ t) >>> 0;
    this.s3 = rotl(this.s3, 11);
    this.drawCount++;
    return result;
  }

  /**
   * Uniform float in [0, 1). Precision comes from 32 bits (not JS's full
   * 53-bit double mantissa) -- adequate for game-scale randomness; a
   * future system needing more precision should combine two draws itself
   * rather than this method silently changing shape.
   */
  nextFloat(): number {
    return this.nextUint32() / UINT32_RANGE;
  }

  /**
   * Integer in [min, max) -- max exclusive, matching array-index/range
   * idioms. Uses floor(uniform-float * range): for a range that doesn't
   * evenly divide 2^32 this has a small, known modulo bias (some outcomes
   * are up to ~1/2^32 more likely than others). Accepted as negligible at
   * game scale rather than paying for a rejection-sampling loop; revisit
   * only if a system is ever shown to need exact uniformity.
   */
  nextInt(minInclusive: number, maxExclusive: number): number {
    if (!Number.isInteger(minInclusive) || !Number.isInteger(maxExclusive) || maxExclusive <= minInclusive) {
      throw new RangeError(
        `nextInt requires integers with maxExclusive > minInclusive, got [${minInclusive}, ${maxExclusive})`,
      );
    }
    const range = maxExclusive - minInclusive;
    return minInclusive + Math.floor(this.nextFloat() * range);
  }

  nextBool(probabilityTrue = 0.5): boolean {
    if (!(probabilityTrue >= 0 && probabilityTrue <= 1)) {
      throw new RangeError(`probabilityTrue must be in [0, 1], got ${probabilityTrue}`);
    }
    return this.nextFloat() < probabilityTrue;
  }

  /**
   * A uniformly random element of `items`. Provided so "pick a random
   * beaver/tree/site" doesn't get hand-rolled slightly differently at
   * every future call site (P1-05 spawning, job tiebreaks, world-gen
   * sampling, ...).
   */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new RangeError("pick() requires a non-empty array");
    }
    return items[this.nextInt(0, items.length)]!;
  }

  /**
   * Returns a new array containing every element of `items` in a
   * uniformly random order (Fisher-Yates), without mutating the input.
   */
  shuffle<T>(items: readonly T[]): T[] {
    const result = items.slice();
    for (let i = result.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i + 1);
      const temp = result[i]!;
      result[i] = result[j]!;
      result[j] = temp;
    }
    return result;
  }

  getDebugState(): RandomStreamDebugState {
    return { drawCount: this.drawCount, state: [this.s0, this.s1, this.s2, this.s3] };
  }

  toSnapshot(): RandomStreamSnapshot {
    return {
      version: RANDOM_STREAM_SNAPSHOT_VERSION,
      s0: this.s0,
      s1: this.s1,
      s2: this.s2,
      s3: this.s3,
      drawCount: this.drawCount,
    };
  }
}

export interface RandomStreamsSnapshot {
  version: number;
  masterSeed: number;
  streams: Array<{ name: string; snapshot: RandomStreamSnapshot }>;
}

export interface RandomStreamsDebugState {
  masterSeed: number;
  streamCount: number;
  streams: Array<{ name: string; derivedSeed: number; drawCount: number }>;
}

/**
 * Owns one master seed and hands out independent, named RandomStream
 * instances per subsystem ("hydrology", "job-selection", "ecology", ...)
 * on first access. Each sub-stream's seed is `hash(masterSeed, name)` --
 * NOT a shared counter and NOT dependent on call order -- so:
 *
 *  - calling `stream("a")` before or after `stream("b")` never changes
 *    either one's sequence,
 *  - introducing a brand-new subsystem name anywhere in future code can
 *    never shift or perturb any OTHER subsystem's sequence (a real risk
 *    with counter-based derivation, where inserting a new caller earlier
 *    in an init order silently reseeds everyone after it),
 *  - the same master seed always reproduces the same per-subsystem
 *    sequences regardless of which subsystems happen to run this session.
 */
export class RandomStreams {
  private readonly masterSeed: number;
  private readonly streamsByName = new Map<string, RandomStream>();

  constructor(seed: number | string) {
    this.masterSeed = normalizeSeed(seed);
  }

  get seed(): number {
    return this.masterSeed;
  }

  stream(name: string): RandomStream {
    if (name.length === 0) {
      throw new RangeError("subsystem stream name must be non-empty");
    }
    let existing = this.streamsByName.get(name);
    if (existing === undefined) {
      existing = RandomStream.fromSeed(deriveSubSeed(this.masterSeed, name));
      this.streamsByName.set(name, existing);
    }
    return existing;
  }

  getDebugState(): RandomStreamsDebugState {
    const streams = [...this.streamsByName.entries()]
      .map(([name, stream]) => ({
        name,
        derivedSeed: deriveSubSeed(this.masterSeed, name),
        drawCount: stream.getDebugState().drawCount,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { masterSeed: this.masterSeed, streamCount: streams.length, streams };
  }

  toSnapshot(): RandomStreamsSnapshot {
    const streams = [...this.streamsByName.entries()].map(([name, stream]) => ({
      name,
      snapshot: stream.toSnapshot(),
    }));
    return { version: RANDOM_STREAMS_SNAPSHOT_VERSION, masterSeed: this.masterSeed, streams };
  }

  static fromSnapshot(snapshot: RandomStreamsSnapshot): RandomStreams {
    if (snapshot.version !== RANDOM_STREAMS_SNAPSHOT_VERSION) {
      throw new RangeError(
        `unsupported RandomStreams snapshot version ${snapshot.version}, expected ${RANDOM_STREAMS_SNAPSHOT_VERSION}`,
      );
    }
    if (!isValidUint32(snapshot.masterSeed)) {
      throw new RangeError(`corrupt snapshot: masterSeed must be a uint32, got ${snapshot.masterSeed}`);
    }
    const manager = new RandomStreams(snapshot.masterSeed);
    const seenNames = new Set<string>();
    for (const entry of snapshot.streams) {
      if (typeof entry.name !== "string" || entry.name.length === 0) {
        throw new RangeError(`corrupt snapshot: stream name must be a non-empty string, got ${JSON.stringify(entry.name)}`);
      }
      if (seenNames.has(entry.name)) {
        throw new RangeError(`corrupt snapshot: duplicate stream name "${entry.name}"`);
      }
      seenNames.add(entry.name);
      manager.streamsByName.set(entry.name, RandomStream.fromSnapshot(entry.snapshot));
    }
    return manager;
  }
}

function deriveSubSeed(masterSeed: number, name: string): number {
  return fnv1a32(`${masterSeed}:${name}`);
}
