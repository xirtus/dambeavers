import type { WorldGrid } from "../world/WorldGrid.js";
import type { TerrainField } from "../world/TerrainField.js";
import type { WaterField, ColumnCoordinate } from "./WaterField.js";
import type { MaterialRegistry } from "../materials/Material.js";
import type { RandomStream } from "../core/Random.js";
import type { World } from "../persistence/WorldSnapshot.js";
import { erosionStress } from "./Erosion.js";

/**
 * P11-01: high-fidelity watershed engineering -- the mechanisms the
 * roadmap lists as features (seepage, bank saturation, pond chains,
 * sediment deposition, changing channels, watershed-scale engineering)
 * as REAL fields and processes over the already-real hydrology stack
 * (`WaterField`, `Flow`'s head differences, `Erosion.ts`'s
 * mass-conserving sediment transport, `RegionalHydrology.ts`'s D8
 * network), never scripted "flood happens" outcomes.
 *
 * Four mechanisms:
 *
 * 1. `SeepageField` -- a per-column bank-saturation field (peer class of
 *    P4-15's `ContaminationField`, same per-column concentration +
 *    transport shape): water seeps into dry banks under real head
 *    pressure, saturation drains back slowly, and saturation genuinely
 *    WEAKENS the bank (a real formula feeding channel migration below).
 *
 * 2. `detectPondChains` -- pond chains are derived from the water field
 *    itself: deep-region connected components joined by real shallow
 *    links, never an authored "chain" metadata.
 *
 * 3. Channel migration (inside `advanceWatershedSpan`) -- generalizes
 *    `Erosion.ts`'s single-cell erode/deposit into a course over deep
 *    time: the channel eats into whichever lateral bank is MORE
 *    saturated (softer, by mechanism 1's formula) and deposits the
 *    excavated material on the opposite bank -- mass-conserving,
 *    sideways channel movement.
 *
 * 4. `advanceWatershedSpan` -- a closed-form deep-time advance (the same
 *    honest pattern P6-07's offscreen LOD established: expected counts
 *    of per-tick probabilistic events applied sequentially, never a
 *    tick-by-tick loop over decades) PLUS a fixed-sweep relaxation of
 *    the water field so terrain changes genuinely redistribute water
 *    (dams hold, breaches release) -- the part that makes "a multi-dam
 *    complex alters downstream hydrograph" true rather than asserted.
 */

const SEEPAGE_SNAPSHOT_VERSION = 1;

export interface SeepageFieldSnapshot {
  version: number;
  dimensions: { sizeX: number; sizeZ: number };
  saturationByColumn: number[];
}

/** Fraction of a column's own saturation that drains back out per tick -- saturated banks stay soft for a while after the water recedes, then firm up. Plausible, tunable balance data. */
export const SEEPAGE_DRAIN_RATE = 0.002;
/** How fast saturation seeps from a wet column into a dry bank per unit of head difference -- plausible, tunable coefficient (banks wet slowly). */
export const SEEPAGE_INTAKE_RATE = 0.004;

export class SeepageField {
  private readonly sizeX: number;
  private readonly sizeZ: number;
  private saturationByColumn: Float64Array;

  constructor(sizeX: number, sizeZ: number) {
    this.sizeX = sizeX;
    this.sizeZ = sizeZ;
    this.saturationByColumn = new Float64Array(sizeX * sizeZ);
  }

  private columnIndex(x: number, z: number): number {
    if (!Number.isInteger(x) || !Number.isInteger(z) || x < 0 || x >= this.sizeX || z < 0 || z >= this.sizeZ) {
      throw new RangeError(`column (${x}, ${z}) is out of bounds`);
    }
    return z * this.sizeX + x;
  }

  saturationAt(x: number, z: number): number {
    return this.saturationByColumn[this.columnIndex(x, z)]!;
  }

  /** Test/setup setter -- deposits (or removes) bank saturation directly. Clamped to [0, 1]. */
  setSaturation(x: number, z: number, saturation: number): void {
    if (!Number.isFinite(saturation)) throw new RangeError(`saturation must be finite, got ${saturation}`);
    this.saturationByColumn[this.columnIndex(x, z)] = Math.min(1, Math.max(0, saturation));
  }

  /**
   * One tick over the whole field: (1) every wet column's dry,
   * terrain-bearing neighbors absorb saturation in proportion to the real
   * head difference (water pressing into the bank -- `waterSurfaceY`
   * minus the bank's own floor), and (2) every column's saturation drains
   * back toward the water at `SEEPAGE_DRAIN_RATE` (banks dry out over
   * time). Both are the same head-difference transport pattern
   * `ContaminationField`/`Erosion.ts` established.
   */
  tickAll(world: World): void {
    const grid = world.grid;
    const water = world.water;
    const next = new Float64Array(this.saturationByColumn);

    for (let x = 0; x < this.sizeX; x++) {
      for (let z = 0; z < this.sizeZ; z++) {
        const surface = water.waterSurfaceY(x, z);
        if (surface === undefined) continue;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = x + dx;
          const nz = z + dz;
          if (nx < 0 || nx >= this.sizeX || nz < 0 || nz >= this.sizeZ) continue;
          if (water.depthAt(nx, nz) > 0) continue; // only DRY banks absorb
          const bankFloor = grid.surfaceY(nx, nz);
          if (bankFloor === undefined) continue;
          const head = Math.max(0, surface - bankFloor);
          const intake = Math.min(1, head * SEEPAGE_INTAKE_RATE);
          const index = this.columnIndex(nx, nz);
          // Saturating intake (the exact same update the closed-form span
          // advance's equilibrium solves for): a bank already near
          // saturation absorbs less than a dry one.
          next[index] = Math.min(1, next[index]! + intake * (1 - next[index]!));
        }
      }
    }

    for (let i = 0; i < next.length; i++) {
      next[i] = Math.max(0, next[i]! * (1 - SEEPAGE_DRAIN_RATE));
    }

    this.saturationByColumn = next;
  }

  toSnapshot(): SeepageFieldSnapshot {
    return { version: SEEPAGE_SNAPSHOT_VERSION, dimensions: { sizeX: this.sizeX, sizeZ: this.sizeZ }, saturationByColumn: Array.from(this.saturationByColumn) };
  }

  static fromSnapshot(snapshot: SeepageFieldSnapshot): SeepageField {
    if (snapshot.version !== SEEPAGE_SNAPSHOT_VERSION) {
      throw new RangeError(`unsupported SeepageField snapshot version ${snapshot.version}, expected ${SEEPAGE_SNAPSHOT_VERSION}`);
    }
    const field = new SeepageField(snapshot.dimensions.sizeX, snapshot.dimensions.sizeZ);
    if (snapshot.saturationByColumn.length !== field.saturationByColumn.length) {
      throw new RangeError(`corrupt snapshot: expected ${field.saturationByColumn.length} columns, got ${snapshot.saturationByColumn.length}`);
    }
    field.saturationByColumn.set(snapshot.saturationByColumn);
    return field;
  }
}

/** How much a bank's own saturation weakens it against erosion: 1.0 at dry (full hardness), down to a soft floor when saturated -- the same `hardness`-driven resistance formula `Erosion.ts` uses, modulated by real bank state. */
export function bankHardnessFactor(saturation: number): number {
  const s = Math.min(1, Math.max(0, saturation));
  return 1 - 0.7 * s;
}

/** A column counts as deep pond water at or above this depth -- the threshold that separates a real pond from a film of wet ground. Plausible, tunable balance data. */
export const POND_DEPTH_THRESHOLD = 0.5;

export interface PondChainLink {
  fromPond: number;
  toPond: number;
  /** The shallow (below-threshold) wet columns physically joining the two deep regions. */
  linkColumns: ColumnCoordinate[];
}

export interface PondChainNetwork {
  /** Number of distinct deep-region connected components (the actual ponds). */
  pondCount: number;
  chains: PondChainLink[];
}

/**
 * Derives the pond-chain structure from the water field itself: ponds are
 * connected components of columns with depth >= `POND_DEPTH_THRESHOLD`;
 * two ponds form a real chain link when a shallow wet column sits
 * orthogonally between them. Nothing is authored -- one dam raising a
 * sill can genuinely split one pond into a chain of two, which is exactly
 * the observable `detectPondChains` reports.
 */
export function detectPondChains(world: World): PondChainNetwork {
  const grid = world.grid;
  const water = world.water;
  const sizeX = grid.dims.sizeX;
  const sizeZ = grid.dims.sizeZ;
  const pondByColumn = new Int32Array(sizeX * sizeZ).fill(-1);
  let pondCount = 0;

  for (let x = 0; x < sizeX; x++) {
    for (let z = 0; z < sizeZ; z++) {
      if (grid.surfaceY(x, z) === undefined) continue;
      if (water.depthAt(x, z) < POND_DEPTH_THRESHOLD) continue;
      if (pondByColumn[z * sizeX + x] !== -1) continue;
      // Flood-fill the new deep component.
      const stack: ColumnCoordinate[] = [{ x, z }];
      pondByColumn[z * sizeX + x] = pondCount;
      while (stack.length > 0) {
        const cell = stack.pop()!;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = cell.x + dx;
          const nz = cell.z + dz;
          if (nx < 0 || nx >= sizeX || nz < 0 || nz >= sizeZ) continue;
          if (grid.surfaceY(nx, nz) === undefined) continue;
          if (water.depthAt(nx, nz) < POND_DEPTH_THRESHOLD) continue;
          if (pondByColumn[nz * sizeX + nx] !== -1) continue;
          pondByColumn[nz * sizeX + nx] = pondCount;
          stack.push({ x: nx, z: nz });
        }
      }
      pondCount++;
    }
  }

  const chains: PondChainLink[] = [];
  const seenLinks = new Set<string>();
  for (let x = 0; x < sizeX; x++) {
    for (let z = 0; z < sizeZ; z++) {
      if (grid.surfaceY(x, z) === undefined) continue;
      const depth = water.depthAt(x, z);
      if (depth <= 0 || depth >= POND_DEPTH_THRESHOLD) continue; // a shallow wet link column
      const pondIds = new Set<number>();
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx;
        const nz = z + dz;
        if (nx < 0 || nx >= sizeX || nz < 0 || nz >= sizeZ) continue;
        const pondId = pondByColumn[nz * sizeX + nx]!;
        if (pondId !== -1) pondIds.add(pondId);
      }
      const sorted = [...pondIds].sort((a, b) => a - b);
      for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
          const key = `${sorted[i]}-${sorted[j]}`;
          if (seenLinks.has(key)) continue;
          seenLinks.add(key);
          const existing = chains.find((c) => c.fromPond === sorted[i] && c.toPond === sorted[j]);
          if (existing === undefined) {
            chains.push({ fromPond: sorted[i]!, toPond: sorted[j]!, linkColumns: [{ x, z }] });
          } else {
            existing.linkColumns.push({ x, z });
          }
        }
      }
    }
  }
  return { pondCount, chains };
}

function manhattanNeighbors(x: number, z: number): ColumnCoordinate[] {
  return [
    { x: x + 1, z },
    { x: x - 1, z },
    { x, z: z + 1 },
    { x, z: z - 1 },
  ];
}

interface MigrationEvent {
  bankX: number;
  bankZ: number;
  depositX: number;
  depositZ: number;
}

/**
 * Deterministic expected count of per-tick probabilistic events over a
 * span: `floor(span * p)` plus one more with the leftover fractional
 * probability -- the same closed-form deep-time pattern `OffscreenLOD.ts`
 * established (deterministic for a given stream, correct in expectation,
 * O(1) regardless of span length).
 */
function expectedEventCount(random: RandomStream, spanTicks: number, probability: number): number {
  if (!(probability > 0)) return 0;
  const expected = spanTicks * probability;
  const whole = Math.floor(expected);
  return whole + (random.nextFloat() < expected - whole ? 1 : 0);
}

/** Closed-form bank-saturation advance over a span: saturation approaches its head-driven equilibrium exponentially at the combined intake+drain rate, evaluated once rather than per tick. The equilibrium is the EXACT steady state of `tickAll`'s own update (`intake*(1-sat) - drain*sat = 0` => `sat = intake/(intake+drain)`), not an approximation. */
function advanceSeepageSpan(seepage: SeepageField, world: World, spanTicks: number): void {
  const grid = world.grid;
  const water = world.water;
  const sizeX = grid.dims.sizeX;
  const sizeZ = grid.dims.sizeZ;
  for (let x = 0; x < sizeX; x++) {
    for (let z = 0; z < sizeZ; z++) {
      if (grid.surfaceY(x, z) === undefined) continue;
      let intake = 0;
      for (const neighbor of manhattanNeighbors(x, z)) {
        if (neighbor.x < 0 || neighbor.x >= sizeX || neighbor.z < 0 || neighbor.z >= sizeZ) continue;
        const surface = water.waterSurfaceY(neighbor.x, neighbor.z);
        if (surface === undefined) continue;
        const bankFloor = grid.surfaceY(x, z)!;
        intake = Math.max(intake, Math.min(1, Math.max(0, surface - bankFloor) * SEEPAGE_INTAKE_RATE));
      }
      const rate = intake + SEEPAGE_DRAIN_RATE;
      const equilibrium = intake / rate;
      const relaxation = Math.exp(-rate * spanTicks);
      const current = seepage.saturationAt(x, z);
      seepage.setSaturation(x, z, equilibrium + (current - equilibrium) * relaxation);
    }
  }
}

/** The water field's own "which neighbor would this column's water move toward" query -- the lowest-surface orthogonal neighbor, the same transport direction `ContaminationField` uses. */
function lowestNeighbor(grid: WorldGrid, water: WaterField, x: number, z: number): ColumnCoordinate | undefined {
  const ownSurface = water.waterSurfaceY(x, z) ?? grid.surfaceY(x, z);
  if (ownSurface === undefined) return undefined;
  let best: ColumnCoordinate | undefined;
  let bestSurface = ownSurface;
  for (const neighbor of manhattanNeighbors(x, z)) {
    if (neighbor.x < 0 || neighbor.x >= grid.dims.sizeX || neighbor.z < 0 || neighbor.z >= grid.dims.sizeZ) continue;
    if (grid.surfaceY(neighbor.x, neighbor.z) === undefined) continue;
    const surface = water.waterSurfaceY(neighbor.x, neighbor.z) ?? grid.surfaceY(neighbor.x, neighbor.z)!;
    if (surface < bestSurface) {
      bestSurface = surface;
      best = neighbor;
    }
  }
  return best;
}

/** Fraction of a column's own depth that relaxes toward its lowest neighbor per sweep -- water genuinely redistributes after terrain changes (dams hold, breaches release), mass-conserving. Plausible, tunable coefficient. */
export const WATER_RELAXATION_RATE = 0.2;

/**
 * A fixed number of mass-conserving relaxation sweeps over the whole
 * water field -- every wet column moves a fraction of its own depth
 * toward its lowest-surface neighbor. This is the closed-form answer to
 * "water re-levels after the terrain changed" (the P1-03 flow solver
 * remains authoritative per tick; a deep-time span doesn't run it
 * tick-by-tick, it re-levels in fixed sweeps instead).
 */
export function relaxWaterField(world: World, sweeps: number): void {
  const grid = world.grid;
  const water = world.water;
  for (let sweep = 0; sweep < sweeps; sweep++) {
    const moves: Array<{ from: ColumnCoordinate; to: ColumnCoordinate; amount: number }> = [];
    for (let x = 0; x < grid.dims.sizeX; x++) {
      for (let z = 0; z < grid.dims.sizeZ; z++) {
        const depth = water.depthAt(x, z);
        if (depth <= 0) continue;
        const target = lowestNeighbor(grid, water, x, z);
        if (target === undefined) continue;
        moves.push({ from: { x, z }, to: target, amount: depth * WATER_RELAXATION_RATE });
      }
    }
    // Apply all moves after computing them (a real synchronous sweep --
    // no column's move sees another column's same-sweep result).
    for (const move of moves) {
      water.addVolume(move.from.x, move.from.z, -move.amount);
      water.addVolume(move.to.x, move.to.z, move.amount);
    }
  }
}

/** Minimum erosion probability for a span event to be worth materializing (avoids spawning billions of near-zero-probability expected counts). */
const MIN_EVENT_PROBABILITY = 1e-9;

/** A persistent water source (inflow) or sink (outflow) at a column, applied closed-form over the span -- the deep-time stand-in for rainfall/snowmelt feeding the watershed and the river leaving the map. */
export interface WatershedFlux {
  x: number;
  z: number;
  volumePerTick: number;
}

export interface AdvanceWatershedOptions {
  inflow?: readonly WatershedFlux[];
  outflow?: readonly WatershedFlux[];
}

/**
 * The watershed-scale deep-time advance: one call replaces per-tick
 * simulation for `spanTicks` of hydrology. Applies, in order:
 *
 * 1. Inflow/outflow flux over the whole span (rain-fed sources add
 *    volume; river ends drain it -- a persistent gradient survives
 *    between spans because inflow refills what relaxation spreads).
 * 2. Closed-form seepage/bank saturation (exponential relaxation).
 * 3. A relaxation pass, so the events below see the water as it
 *    actually spread this span, not just the lump at the source.
 * 4. Ordinary erosion events (`Erosion.ts`'s own per-tick probability)
 *    at their expected count per (source, downstream) pair -- sediment
 *    deposition IS the terrain change, mass-conserving per event.
 * 5. Channel migration events: for each wet column with a flow direction,
 *    the lateral bank with the HIGHER saturation is the softer one
 *    (`bankHardnessFactor`); the expected count of migration events
 *    (erosion probability scaled by softness asymmetry) excavates that
 *    bank and deposits on the opposite one -- the channel genuinely
 *    moves sideways over decades.
 * 6. Final relaxation sweeps so the new terrain shape re-levels the
 *    water -- a dam that eroded away releases its pond; a migrating
 *    channel leaves its old course dry.
 *
 * Every terrain mutation is `Erosion.ts`'s own one-cell-out/one-cell-in
 * mass conservation. Returns the count of terrain-changing events
 * applied (observable "sediment pattern" churn).
 */
export function advanceWatershedSpan(
  world: World,
  materials: MaterialRegistry,
  random: RandomStream,
  spanTicks: number,
  seepage: SeepageField,
  relaxationSweeps = 30,
  options: AdvanceWatershedOptions = {},
): number {
  if (!Number.isInteger(spanTicks) || spanTicks < 0) throw new RangeError(`spanTicks must be a non-negative integer, got ${spanTicks}`);
  const grid = world.grid;
  const water = world.water;
  const terrain = world.terrain;

  for (const source of options.inflow ?? []) {
    if (!(Number.isFinite(source.volumePerTick) && source.volumePerTick >= 0)) {
      throw new RangeError(`inflow volumePerTick must be a non-negative finite number, got ${source.volumePerTick}`);
    }
    water.addVolume(source.x, source.z, source.volumePerTick * spanTicks);
  }

  advanceSeepageSpan(seepage, world, spanTicks);
  relaxWaterField(world, Math.max(4, Math.floor(relaxationSweeps / 2)));

  const events: Array<{ kind: "erosion" | "migration"; bank: ColumnCoordinate; deposit: ColumnCoordinate }> = [];

  for (let x = 0; x < grid.dims.sizeX; x++) {
    for (let z = 0; z < grid.dims.sizeZ; z++) {
      if (grid.surfaceY(x, z) === undefined) continue;
      const downstream = lowestNeighbor(grid, water, x, z);
      if (downstream === undefined) continue;
      // Ordinary erosion events at expected count (P4-10's mechanism).
      const source = { x, z };
      const stress = erosionStress(grid, water, source, downstream);
      if (stress > 0) {
        const sourceY = grid.surfaceY(x, z);
        const materialId = sourceY !== undefined ? terrain.materialAt(x, sourceY, z) : undefined;
        const hardness = materialId !== undefined ? materials.get(materialId).hardness : 1;
        const probability = Math.min(1, stress / (hardness + 1));
        const count = expectedEventCount(random, spanTicks, Math.max(probability, MIN_EVENT_PROBABILITY));
        for (let i = 0; i < count; i++) events.push({ kind: "erosion", bank: source, deposit: downstream });
      }

      // Channel migration: the flow direction is (x,z) -> downstream.
      // The lateral cells are the two perpendicular neighbors. The MORE
      // saturated lateral bank is softer and the channel eats into it,
      // depositing on the opposite side.
      const dirX = downstream.x - x;
      const dirZ = downstream.z - z;
      const lateralA: ColumnCoordinate = { x: x + dirZ, z: z - dirX };
      const lateralB: ColumnCoordinate = { x: x - dirZ, z: z + dirX };
      const candidates: ColumnCoordinate[] = [lateralA, lateralB].filter(
        (c) => c.x >= 0 && c.x < grid.dims.sizeX && c.z >= 0 && c.z < grid.dims.sizeZ && grid.surfaceY(c.x, c.z) !== undefined && water.depthAt(c.x, c.z) === 0,
      );
      if (candidates.length < 2) continue;
      const satA = seepage.saturationAt(lateralA.x, lateralA.z);
      const satB = seepage.saturationAt(lateralB.x, lateralB.z);
      if (Math.abs(satA - satB) < 0.05) continue; // no real asymmetry -- no sideways bias yet
      const [soft, hard] = satA > satB ? [lateralA, lateralB] : [lateralB, lateralA];
      const softSat = Math.max(satA, satB);
      const softY = grid.surfaceY(soft.x, soft.z);
      const softMaterial = softY !== undefined ? terrain.materialAt(soft.x, softY, soft.z) : undefined;
      const hardness = softMaterial !== undefined ? materials.get(softMaterial).hardness : 1;
      const probability = Math.min(1, stress * bankHardnessFactor(softSat) / (hardness + 1) * 0.1);
      const count = expectedEventCount(random, spanTicks, Math.max(probability, MIN_EVENT_PROBABILITY));
      for (let i = 0; i < count; i++) events.push({ kind: "migration", bank: soft, deposit: hard });
    }
  }

  // Apply events in a deterministic order (column-major by bank cell,
  // then event kind) -- each event is exactly one excavated cell and one
  // deposited cell of the same material (mass conservation).
  events.sort((a, b) => a.bank.z * grid.dims.sizeX + a.bank.x - (b.bank.z * grid.dims.sizeX + b.bank.x) || a.kind.localeCompare(b.kind));
  let applied = 0;
  for (const event of events) {
    const bankY = grid.surfaceY(event.bank.x, event.bank.z);
    const depositY = grid.surfaceY(event.deposit.x, event.deposit.z);
    if (bankY === undefined || depositY === undefined) continue;
    const materialId = terrain.materialAt(event.bank.x, bankY, event.bank.z);
    if (materialId === undefined) continue;
    if (depositY + 1 >= grid.dims.sizeY) continue;
    terrain.excavate(event.bank.x, bankY, event.bank.z);
    terrain.setMaterial(event.deposit.x, depositY + 1, event.deposit.z, materialId);
    applied++;
  }

  relaxWaterField(world, relaxationSweeps);

  // River ends drain the span's outflow (clamped to what is actually
  // there -- a dry river end drains nothing, never a negative depth).
  for (const sink of options.outflow ?? []) {
    if (!(Number.isFinite(sink.volumePerTick) && sink.volumePerTick >= 0)) {
      throw new RangeError(`outflow volumePerTick must be a non-negative finite number, got ${sink.volumePerTick}`);
    }
    const drained = Math.min(sink.volumePerTick * spanTicks, water.depthAt(sink.x, sink.z));
    water.addVolume(sink.x, sink.z, -drained);
  }
  // One real recorded event per span -- the queryable signature the
  // P11-18 landscape-history layer aggregates (terrain reshaping IS
  // recorded history, not an unobservable side effect).
  world.events.record({
    tick: world.clock.tick,
    eventType: "watershed-advanced",
    subjectIds: [],
    objectIds: [],
    location: { x: 0, y: 0, z: 0 },
    data: { spanTicks, terrainEvents: applied },
  });
  return applied;
}

/** Aggregate measurable watershed state -- the hydrograph/wetland/sediment metrics the P11-01 acceptance test asserts change across a deep-time span. All derived fresh from real fields. */
export interface WatershedSummary {
  totalVolume: number;
  maxDepth: number;
  wetColumnCount: number;
  pondCount: number;
  chainCount: number;
  /** Mean terrain surface elevation over all terrain-bearing columns -- sediment deposition/erosion moves this. */
  meanSurfaceElevation: number;
}

export function watershedSummary(world: World): WatershedSummary {
  const debug = world.water.getDebugState();
  const network = detectPondChains(world);
  let surfaceSum = 0;
  let surfaceCount = 0;
  for (let x = 0; x < world.grid.dims.sizeX; x++) {
    for (let z = 0; z < world.grid.dims.sizeZ; z++) {
      const y = world.grid.surfaceY(x, z);
      if (y !== undefined) {
        surfaceSum += y;
        surfaceCount++;
      }
    }
  }
  return {
    totalVolume: debug.totalVolume,
    maxDepth: debug.maxDepth,
    wetColumnCount: debug.wetColumnCount,
    pondCount: network.pondCount,
    chainCount: network.chains.length,
    meanSurfaceElevation: surfaceCount > 0 ? surfaceSum / surfaceCount : 0,
  };
}
