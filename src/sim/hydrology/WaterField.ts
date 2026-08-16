import type { WorldGrid } from "../world/WorldGrid.js";

const WATER_FIELD_SNAPSHOT_VERSION = 1;

export interface ColumnCoordinate {
  readonly x: number;
  readonly z: number;
}

export interface WaterFieldDebugState {
  wetColumnCount: number;
  totalVolume: number;
  maxDepth: number;
}

export interface WaterFieldSnapshot {
  version: number;
  dimensions: { sizeX: number; sizeZ: number };
  /** Depth per column, 0 for dry, in the same (z*sizeX+x) order this class uses internally. */
  depthByColumn: number[];
}

function isInt(n: number): boolean {
  return Number.isInteger(n);
}

/**
 * Local water quantity/depth, per grid COLUMN (x,z) -- one of the
 * representations ARCHITECTURE_CONTRACT §12 explicitly allows ("cells,
 * columns, heightfields, shallow-water approximations"), chosen here for
 * the same reason `TerrainField` uses columns/heightfields: M0's single
 * watershed doesn't need full 3D voxel water, and a column-based depth
 * field is the simplest representation that is still genuinely
 * volumetric (never "merely a binary flooded flag," per that same
 * contract section).
 *
 * `depthAt`/`waterSurfaceY`/`isSubmerged` occupy REAL world space: they
 * answer directly against `WorldGrid.surfaceY()` (the actual terrain
 * floor), so nothing here is a separately-maintained 3D water grid that
 * could drift out of sync with terrain -- the same "derive, don't
 * duplicate" choice P0-09 made for solidity-from-material.
 *
 * Deliberately STATIC storage only: set/add/remove depth at a column, and
 * query it. This class does not move water between columns, know about
 * neighbors, or simulate flow over time -- that is P1-03's job, layered
 * on top of this the same way P1-01's terrain generation layers on top of
 * P0-09's `TerrainField`. `fillBasin()` below is a closed-form GEOMETRY
 * calculation (what uniform depth does a known volume settle to within a
 * bounded region), not a time-stepped solver -- the same way a bathtub's
 * water level can be computed from its shape and the amount poured in
 * without simulating the pour itself.
 */
export class WaterField {
  private readonly grid: WorldGrid;
  private readonly depthByColumn: Float64Array;

  constructor(grid: WorldGrid) {
    this.grid = grid;
    this.depthByColumn = new Float64Array(grid.dims.sizeX * grid.dims.sizeZ);
  }

  get dims(): { sizeX: number; sizeZ: number } {
    const { sizeX, sizeZ } = this.grid.dims;
    return { sizeX, sizeZ };
  }

  /** The `WorldGrid` this field's columns rest on -- exposed (mirroring `TerrainField.worldGrid`) so free functions like `fillBasin` below can query terrain floor elevation without reaching into this class's internals. */
  get worldGrid(): WorldGrid {
    return this.grid;
  }

  private columnIndex(x: number, z: number): number {
    const dims = this.grid.dims;
    if (!isInt(x) || !isInt(z) || x < 0 || x >= dims.sizeX || z < 0 || z >= dims.sizeZ) {
      throw new RangeError(`column (${x}, ${z}) is out of bounds`);
    }
    return z * dims.sizeX + x;
  }

  /**
   * The terrain floor elevation this column's water rests on --
   * `WorldGrid.surfaceY()`, or `-1` (just below the grid's own y=0 floor)
   * for a column with no solid terrain at all, so an ungenerated/open
   * column still has a well-defined floor to hold water rather than an
   * undefined one.
   */
  private floorElevation(x: number, z: number): number {
    return this.grid.surfaceY(x, z) ?? -1;
  }

  /** Current water depth at a column, in cell-height units. 0 for a dry column. */
  depthAt(x: number, z: number): number {
    return this.depthByColumn[this.columnIndex(x, z)]!;
  }

  /** Authoritative setter -- the value P1-03's future flow solver (and this file's own `fillBasin`) would ultimately write through. */
  setDepth(x: number, z: number, depth: number): void {
    if (!Number.isFinite(depth) || depth < 0) {
      throw new RangeError(`water depth must be a non-negative finite number, got ${depth}`);
    }
    this.depthByColumn[this.columnIndex(x, z)] = depth;
  }

  /**
   * Adds (or, with a negative `volume`, removes) water at a column.
   * `volume` and `depth` are numerically identical here since each
   * column's footprint is exactly 1 cell^2 by `WorldGrid`'s convention --
   * named `addVolume` rather than `addDepth` because callers (a future
   * rain/inflow/outflow system) reason in terms of an amount of water
   * added, not directly in terms of a height.
   */
  addVolume(x: number, z: number, volume: number): void {
    if (!Number.isFinite(volume)) {
      throw new RangeError(`volume must be finite, got ${volume}`);
    }
    const current = this.depthAt(x, z);
    const next = current + volume;
    if (next < 0) {
      throw new RangeError(
        `cannot remove ${-volume} volume from column (${x}, ${z}): only ${current} present`,
      );
    }
    this.setDepth(x, z, next);
  }

  /** The water's top surface elevation at a column (floor + depth), or `undefined` if the column is dry (depth 0) -- a dry column has no water surface to report. */
  waterSurfaceY(x: number, z: number): number | undefined {
    const depth = this.depthAt(x, z);
    if (depth <= 0) return undefined;
    return this.floorElevation(x, z) + depth;
  }

  /** Whether a specific 3D cell is underwater: its `y` is above this column's floor and at or below the water surface. */
  isSubmerged(x: number, y: number, z: number): boolean {
    const surface = this.waterSurfaceY(x, z);
    if (surface === undefined) return false;
    return y > this.floorElevation(x, z) && y <= surface;
  }

  /** O(sizeX*sizeZ) -- scans every column. Fine for an on-demand debug UI (P0-12) or test assertions; do not call from a per-tick hot path once maps grow large, mirroring every other O(n) debug-scan method in this codebase. */
  getDebugState(): WaterFieldDebugState {
    let wetColumnCount = 0;
    let totalVolume = 0;
    let maxDepth = 0;
    for (const depth of this.depthByColumn) {
      if (depth > 0) wetColumnCount++;
      totalVolume += depth;
      if (depth > maxDepth) maxDepth = depth;
    }
    return { wetColumnCount, totalVolume, maxDepth };
  }

  toSnapshot(): WaterFieldSnapshot {
    return {
      version: WATER_FIELD_SNAPSHOT_VERSION,
      dimensions: this.dims,
      depthByColumn: Array.from(this.depthByColumn),
    };
  }

  static fromSnapshot(snapshot: WaterFieldSnapshot, grid: WorldGrid): WaterField {
    if (snapshot.version !== WATER_FIELD_SNAPSHOT_VERSION) {
      throw new RangeError(
        `unsupported WaterField snapshot version ${snapshot.version}, expected ${WATER_FIELD_SNAPSHOT_VERSION}`,
      );
    }
    if (snapshot.dimensions.sizeX !== grid.dims.sizeX || snapshot.dimensions.sizeZ !== grid.dims.sizeZ) {
      throw new RangeError(
        `corrupt snapshot: dimensions ${JSON.stringify(snapshot.dimensions)} don't match the provided grid (${grid.dims.sizeX}x${grid.dims.sizeZ})`,
      );
    }
    const expectedLength = grid.dims.sizeX * grid.dims.sizeZ;
    if (snapshot.depthByColumn.length !== expectedLength) {
      throw new RangeError(
        `corrupt snapshot: expected ${expectedLength} columns, got ${snapshot.depthByColumn.length}`,
      );
    }
    const field = new WaterField(grid);
    for (let i = 0; i < snapshot.depthByColumn.length; i++) {
      const depth = snapshot.depthByColumn[i]!;
      if (!Number.isFinite(depth) || depth < 0) {
        throw new RangeError(`corrupt snapshot: depthByColumn[${i}] must be a non-negative finite number, got ${depth}`);
      }
      field.depthByColumn[i] = depth;
    }
    return field;
  }
}

export interface FillBasinOptions {
  /** Floating-point slack used only to decide whether a tiny leftover/overshoot at the very end of the fill is "close enough to exactly done" rather than a genuine overflow. Not an approximation tolerance for the main result -- the algorithm below computes the exact answer via closed-form arithmetic, not iterative refinement. */
  volumeTolerance?: number;
  /** Safety cap on columns the basin is allowed to grow to -- fails fast (throws) rather than exploring an enormous or unbounded region. */
  maxColumns?: number;
}

export interface FillBasinResult {
  /** The uniform water-surface elevation the basin settled to. */
  surfaceElevation: number;
  /** Every column the basin actually covers at that surface elevation. */
  columns: ColumnCoordinate[];
  /** The actual volume delivered (sum of applied depths) -- within `volumeTolerance` of the requested `targetVolume`. */
  deliveredVolume: number;
}

const DEFAULT_VOLUME_TOLERANCE = 0.01;
const DEFAULT_MAX_COLUMNS = 4000;

function columnKey(x: number, z: number): string {
  return `${x},${z}`;
}

interface FrontierEntry {
  x: number;
  z: number;
  floor: number;
  seq: number;
}

/** Binary min-heap over `FrontierEntry`, ordered by (floor, seq) -- the same shape as `SimulationClock`'s internal `ScheduleHeap`, reused here for the identical reason: keeps each "which column connects next" lookup O(log n) as a basin grows into thousands of columns. The `seq` tiebreak (insertion order) makes ties between equal-floor columns resolve deterministically rather than depending on incidental heap-internal ordering. */
class FrontierHeap {
  private readonly items: FrontierEntry[] = [];

  get size(): number {
    return this.items.length;
  }

  private less(a: FrontierEntry, b: FrontierEntry): boolean {
    return a.floor !== b.floor ? a.floor < b.floor : a.seq < b.seq;
  }

  push(entry: FrontierEntry): void {
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

  peek(): FrontierEntry | undefined {
    return this.items[0];
  }

  pop(): FrontierEntry | undefined {
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
}

/**
 * Finds the uniform water-surface elevation that holds exactly
 * `targetVolume` within the closed basin reachable from `seed`, and
 * writes the resulting per-column depths into `field`. This is a static
 * geometry calculation over the CURRENT terrain shape -- like solving for
 * a bathtub's water level from its shape and the amount poured in, not
 * simulating the pour arriving and spreading over time (P1-03's job).
 *
 * Uses an incremental "priority flood" fill, NOT a single-elevation
 * binary search over a freshly-flood-filled region at each candidate.
 * That distinction is load-bearing: volume-as-a-function-of-surface-
 * elevation is monotonic but NOT continuous whenever raising the surface
 * connects to a new, lower-floored chamber through a sill -- the instant
 * that connection happens, the newly-joined chamber's ENTIRE floor-to-new-
 * surface volume counts at once, producing a genuine jump discontinuity.
 * A target volume can fall inside such a jump's gap, meaning no single
 * elevation actually delivers it exactly (only an elevation exactly AT
 * the sill can, with the connected chamber still dry) -- re-flood-filling
 * at each candidate elevation independently (an earlier version of this
 * function did this) cannot see that gap and can silently converge to an
 * elevation whose region includes the newly-joined chamber, delivering a
 * volume arbitrarily far from what was requested with no error.
 *
 * A genuine consequence of this physics, not a limitation of the
 * algorithm: connecting fluid at rest cannot have a non-uniform surface,
 * so the instant a sill opens into a deeper secondary chamber, EVERY
 * column of that chamber must backfill to the current surface atomically
 * (a mandatory, all-or-nothing volume cost) before the shared surface can
 * rise any further. If `targetVolume` falls strictly between "the
 * smaller sub-basin full to its sill" and "the sill plus the entire
 * newly-connected chamber backfilled to that same level," NO uniform
 * surface elevation delivers it exactly -- there is a genuine gap with no
 * valid answer, and this function throws rather than connect only part
 * of the newly-discovered chamber (which would fake a non-uniform
 * surface) or silently deliver a volume far from what was requested.
 *
 * The algorithm here instead grows the wet region one connection event at
 * a time, in ascending floor order (a min-heap frontier), computing the
 * EXACT volume needed to raise the currently-included region's uniform
 * surface up to each next event -- so it always knows precisely how much
 * volume is available before the region's shape would have to change, and
 * can therefore determine exactly whether `targetVolume` is satisfiable
 * within the CURRENT phase (closed-form: `deltaSurface =
 * remainingVolume / includedColumnCount`) or whether the region must grow
 * first. Reaching the map boundary while still needing to grow means the
 * basin is not closed for the requested volume -- this throws rather than
 * guess what lies beyond the edge (the same kind of cross-boundary flow
 * P1-03 would need to actually simulate).
 */
export function fillBasin(
  field: WaterField,
  seed: ColumnCoordinate,
  targetVolume: number,
  options: FillBasinOptions = {},
): FillBasinResult {
  if (!Number.isFinite(targetVolume) || targetVolume < 0) {
    throw new RangeError(`targetVolume must be a non-negative finite number, got ${targetVolume}`);
  }
  const volumeTolerance = options.volumeTolerance ?? DEFAULT_VOLUME_TOLERANCE;
  const maxColumns = options.maxColumns ?? DEFAULT_MAX_COLUMNS;
  const grid = field.worldGrid;
  const dims = grid.dims;
  const floorOf = (x: number, z: number): number => grid.surfaceY(x, z) ?? -1;
  const touchesMapEdge = (x: number, z: number): boolean =>
    x === 0 || x === dims.sizeX - 1 || z === 0 || z === dims.sizeZ - 1;

  const seedFloor = floorOf(seed.x, seed.z);
  if (targetVolume === 0) {
    field.setDepth(seed.x, seed.z, 0);
    return { surfaceElevation: seedFloor, columns: [{ x: seed.x, z: seed.z }], deliveredVolume: 0 };
  }

  const included: ColumnCoordinate[] = [{ x: seed.x, z: seed.z }];
  const queued = new Set<string>([columnKey(seed.x, seed.z)]); // included OR already on the frontier -- prevents duplicate pushes
  const frontier = new FrontierHeap();
  let seq = 0;
  // The lowest floor among included columns that touch the map edge: the
  // surface can never legally rise above this without spilling off the
  // map. `Infinity` means no included column touches the edge yet.
  let edgeCapFloor = touchesMapEdge(seed.x, seed.z) ? seedFloor : Number.POSITIVE_INFINITY;

  function pushNeighborsOf(x: number, z: number): void {
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx;
      const nz = z + dz;
      if (nx < 0 || nx >= dims.sizeX || nz < 0 || nz >= dims.sizeZ) continue; // truly off-grid: not a column, handled via edgeCapFloor instead
      const key = columnKey(nx, nz);
      if (queued.has(key)) continue;
      queued.add(key);
      frontier.push({ x: nx, z: nz, floor: floorOf(nx, nz), seq: seq++ });
    }
  }
  pushNeighborsOf(seed.x, seed.z);

  let currentSurface = seedFloor;
  let remainingVolume = targetVolume;

  for (;;) {
    // Absorb any frontier column whose OWN floor is already at or below
    // the current surface -- discovered through a neighbor that just
    // connected, but itself sitting lower (e.g. a deep secondary chamber
    // reached through a sill). Connected fluid at rest cannot have a
    // non-uniform surface, so the instant such a column connects it must
    // be backfilled to the current surface immediately, at zero further
    // surface rise -- but that backfill is a mandatory, atomic cost, not
    // something spendable gradually across a later phase. If a whole
    // chain of these (a deep chamber's own neighbors, also low) can't be
    // fully paid for, the requested `targetVolume` falls in the
    // unsatisfiable gap between "the smaller sub-basin full to the sill"
    // and "the sill plus the entire newly-connected chamber" -- there is
    // no uniform surface elevation that delivers it, so this throws
    // rather than silently connecting only PART of the newly-discovered
    // chamber (which would violate the single-uniform-surface invariant
    // this whole function exists to guarantee).
    while (frontier.peek() !== undefined && frontier.peek()!.floor <= currentSurface) {
      const submerged = frontier.pop()!;
      const backfill = currentSurface - submerged.floor;
      if (backfill > remainingVolume + volumeTolerance) {
        throw new RangeError(
          `fillBasin: ${targetVolume} volume falls in an unreachable gap for the basin at (${seed.x}, ${seed.z}) -- connecting to the chamber containing (${submerged.x}, ${submerged.z}) requires at least ${targetVolume - remainingVolume + backfill} volume, more than requested but less than the next larger closed sub-basin`,
        );
      }
      remainingVolume -= backfill;
      included.push({ x: submerged.x, z: submerged.z });
      if (included.length > maxColumns) {
        throw new RangeError(
          `fillBasin: exceeded maxColumns (${maxColumns}) while growing the basin from (${seed.x}, ${seed.z}) -- it may not be closed, or ${targetVolume} volume is too large for it`,
        );
      }
      if (touchesMapEdge(submerged.x, submerged.z)) {
        edgeCapFloor = Math.min(edgeCapFloor, submerged.floor);
      }
      pushNeighborsOf(submerged.x, submerged.z);
    }

    const next = frontier.peek();
    const nextConnectFloor = next?.floor ?? Number.POSITIVE_INFINITY;
    const phaseCeiling = Math.min(nextConnectFloor, edgeCapFloor);

    if (phaseCeiling === Number.POSITIVE_INFINITY) {
      // Structurally unreachable on a normal bounded rectangular grid: the
      // frontier can only become empty once every reachable column is
      // included, and a fully-connected map always contains edge columns,
      // which would have set `edgeCapFloor` (finite) at the latest connect
      // event before the frontier could ever run dry. Kept as a defensive
      // assertion rather than silently looping forever if that invariant
      // is ever violated (e.g. a future non-rectangular grid topology).
      throw new RangeError(
        `fillBasin: exhausted the frontier without finding a bound for the basin at (${seed.x}, ${seed.z}) -- this should be unreachable`,
      );
    }

    const capacityThisPhase = (phaseCeiling - currentSurface) * included.length;
    if (remainingVolume <= capacityThisPhase + volumeTolerance) {
      const finalSurface = currentSurface + remainingVolume / included.length;
      let deliveredVolume = 0;
      for (const { x, z } of included) {
        const depth = Math.max(0, finalSurface - floorOf(x, z));
        field.setDepth(x, z, depth);
        deliveredVolume += depth;
      }
      return { surfaceElevation: finalSurface, columns: included.slice(), deliveredVolume };
    }

    // Must grow the region to hold the remaining volume.
    if (phaseCeiling === edgeCapFloor) {
      // The only way to rise further is past a column that touches the
      // map edge -- that would mean water spilling off the map, which
      // this static geometry calculation refuses to guess the consequence
      // of (that is exactly the cross-boundary flow P1-03 would simulate).
      throw new RangeError(
        `fillBasin: the basin reachable from (${seed.x}, ${seed.z}) is not closed -- ${targetVolume} volume would spill past the map edge`,
      );
    }

    remainingVolume -= capacityThisPhase;
    currentSurface = phaseCeiling;
    const connected = frontier.pop()!; // phaseCeiling === nextConnectFloor here, since it won the Math.min and wasn't the edge cap
    included.push({ x: connected.x, z: connected.z });
    if (included.length > maxColumns) {
      throw new RangeError(
        `fillBasin: exceeded maxColumns (${maxColumns}) while growing the basin from (${seed.x}, ${seed.z}) -- it may not be closed, or ${targetVolume} volume is too large for it`,
      );
    }
    if (touchesMapEdge(connected.x, connected.z)) {
      edgeCapFloor = Math.min(edgeCapFloor, connected.floor);
    }
    pushNeighborsOf(connected.x, connected.z);
  }
}
