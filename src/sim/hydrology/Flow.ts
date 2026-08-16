import type { WaterField } from "./WaterField.js";
import type { TerrainField } from "../world/TerrainField.js";
import type { MaterialRegistry } from "../materials/Material.js";

/** Neighbors per column on a 4-connected grid -- the basis for `stepFlow`'s stability cap (see its doc comment). */
const MAX_NEIGHBORS_PER_COLUMN = 4;

export interface StepFlowOptions {
  /**
   * Flow-rate coefficient (volume per elevation-unit of head difference
   * per elevation-unit of cross-section per second). Unlike an earlier
   * version of this function, larger values can no longer cause
   * oscillation or overshoot -- see the function doc comment's stability
   * cap -- so this purely trades off how quickly a step approaches
   * equilibrium, not correctness. Defaults to 0.5.
   */
  conductance?: number;
}

/**
 * Advances `field` by one explicit flow step of `dtSeconds`, exchanging
 * water between every pair of orthogonally adjacent columns. This is
 * P1-03's dynamic counterpart to P1-02's `fillBasin` (a static
 * equilibrium calculation): repeatedly stepping this function drives the
 * same kind of basin toward the same equilibrium `fillBasin` would jump
 * to directly, but arriving at it gradually, tick by tick, the way real
 * water actually moves -- which is what lets inflow/outflow/obstruction
 * changes produce visible, inspectable INTERMEDIATE states instead of an
 * instantaneous jump.
 *
 * For each adjacent pair (A, B), the "sill" between them is
 * `max(floorA, floorB)` -- the higher of the two floors, i.e. the actual
 * physical constriction water has to pass over to get from one column to
 * the other. The flow depth available at that sill is
 * `max(0, max(surfaceA, surfaceB) - sill)` -- the SOURCE side's own
 * excess above the sill (deliberately not `min(surfaceA, surfaceB)`,
 * which would collapse to exactly 0 whenever the receiving column starts
 * dry, since a dry column's "surface" defaults to its own floor, at or
 * below the sill by definition -- that formula was tried, found to make
 * water physically unable to ever begin flowing into any dry neighbor at
 * all, and replaced). It grows as either surface rises above the sill.
 * This single formula is what makes "narrowing a channel" (raising the
 * sill by adding terrain, or lowering the flow depth by shrinking the
 * channel's cross-section) mechanically reduce throughput, and what makes
 * "overtopping" (water finally rising above an obstruction) mechanically
 * resume flow -- both are the SAME formula at different sill heights, not
 * two different code paths, let alone a scripted "if narrowed then reduce
 * flow" rule.
 *
 * The sill's own material (`TerrainField.materialOrAirAt` AT the sill
 * elevation itself, on whichever of the two columns has the higher floor)
 * additionally scales the flow by its real `permeability` (P0-07) -- an
 * open sill (air, permeability 1) passes flow freely; a dense,
 * low-permeability material throttles it, tying "permeability" (a
 * required roadmap capability) directly to the same material system
 * every other physical property in this project comes from, rather than
 * inventing a separate obstruction flag.
 *
 * Stability: the raw `conductance * permeability * flowDepth * headDiff *
 * dt` formula has no inherent bound -- for a large enough `flowDepth`
 * (which itself grows as depth accumulates, e.g. at a continuously-fed
 * source) or `dt`, a single step could transfer MORE than the amount
 * needed to equalize a pair, overshooting past equilibrium; the next step
 * would then reverse just as hard, an undamped, growing oscillation that
 * empirically reproduces even at conservative-looking `conductance`
 * values under ordinary continuous inflow (exactly the roadmap's own
 * "inflow" requirement) -- an earlier version of this function had
 * exactly this defect. This is fixed with a per-pair cap: each pair's
 * desired transfer is clamped to
 * `permeability * |headDiff| / (2 * MAX_NEIGHBORS_PER_COLUMN)`. Halving
 * prevents a single pair from ever transferring past THAT pair's own
 * equilibrium in one step; dividing by the maximum possible neighbor
 * count is the standard safety margin for an explicit multi-neighbor
 * diffusion update (the classic risk being N neighbors each
 * independently transferring up to their own half-equilibrium amount
 * toward one shallow column simultaneously, whose SUM could still
 * overshoot if each pair were capped only by its own half-equilibrium
 * bound with no shared budget). Scaling the cap ITSELF by `permeability`
 * (not just the raw formula, which already had that factor) is load-
 * bearing, not decorative: an earlier version of this cap was
 * permeability-independent, which made two sills of very different
 * permeability clamp to the identical value once either raw transfer
 * exceeded the cap -- silently erasing "permeability" as an observable
 * difference at exactly the depths/conductances where the cap actually
 * engages, found and fixed during review. This makes the scheme
 * unconditionally stable regardless of `conductance`, `dt`, or
 * accumulated depth, while keeping a low-permeability sill meaningfully
 * slower to reach equilibrium than an open one across the FULL depth
 * range, not just while both are still below the cap.
 *
 * `conductance` still controls convergence speed at ordinary depths, but
 * its effect is attenuated once `flowDepth` grows large enough that the
 * cap dominates the raw formula (a `flowDepth` on the order of a few
 * units, at this function's own default `conductance`) -- this is an
 * inherent property of any explicit scheme with an unconditional
 * stability bound, not a defect: the alternative (letting `conductance`
 * remain fully expressive at every depth) is exactly the unbounded
 * formula that caused the oscillation this cap exists to prevent.
 *
 * Computed in two passes -- (1) compute every pairwise flow (after the
 * stability cap above), accumulate each column's total desired outflow,
 * and cap it AGAIN so no column can be asked to give up more than its own
 * current depth this step; (2) apply every flow at its (possibly
 * scaled-down) actual value -- so the update is simultaneous
 * (Jacobi-style, not order-dependent on which pair is processed first)
 * and can never drive a column negative.
 */
export function stepFlow(
  field: WaterField,
  terrain: TerrainField,
  materials: MaterialRegistry,
  dtSeconds: number,
  options: StepFlowOptions = {},
): void {
  if (!Number.isFinite(dtSeconds) || dtSeconds < 0) {
    throw new RangeError(`dtSeconds must be a non-negative finite number, got ${dtSeconds}`);
  }
  const conductance = options.conductance ?? 0.5;
  if (!Number.isFinite(conductance) || conductance < 0) {
    throw new RangeError(`conductance must be a non-negative finite number, got ${conductance}`);
  }
  if (dtSeconds === 0 || conductance === 0) return;

  const grid = terrain.worldGrid;
  const dims = grid.dims;
  const floorOf = (x: number, z: number): number => grid.surfaceY(x, z) ?? -1;
  const columnCount = dims.sizeX * dims.sizeZ;
  const index = (x: number, z: number): number => z * dims.sizeX + x;

  interface PairFlow {
    ax: number;
    az: number;
    bx: number;
    bz: number;
    /** Desired (pre-cap) volume moved from A to B this step; negative means B to A. */
    desired: number;
  }
  const pairs: PairFlow[] = [];
  const desiredOutflow = new Float64Array(columnCount);

  /**
   * The permeability of the sill itself -- the material AT `sillY`
   * (the higher of the two columns' own solid floor), not the cell above
   * it. `sillY`, by construction, is always exactly the topmost solid
   * cell of whichever column is higher (`WorldGrid.surfaceY`'s own
   * definition guarantees the cell immediately ABOVE that is never solid
   * -- checking there would always find air, making a permeability check
   * placed one cell too high permanently unable to observe any real
   * material, a dead check on any terrain built through the ordinary
   * `TerrainField.setMaterial` path). Checking AT the sill directly ties
   * "permeability" to the same real material properties every other
   * physical calculation in this project already uses (P0-07): a sill
   * made of dense stone (low permeability) throttles flow more than the
   * identical GEOMETRIC height made of loose sand -- a second,
   * independent obstruction effect layered on top of the purely
   * geometric one (`flowDepth` shrinking as `sillY` rises), not a
   * replacement for it. A future structure (P1-11's dam) built by placing
   * its own low-permeability material as a column's topmost solid layer
   * throttles flow automatically through this exact path, with zero
   * changes needed here.
   *
   * Checks BOTH columns' `(x,z)` at `sillY` and takes the more
   * restrictive (lower) permeability: whichever column is NOT the higher
   * one has no material exactly at `sillY` (its own floor is lower, so
   * that height is open air for it) and correctly falls back to air via
   * `materialOrAirAt`, while the higher column's real surface material is
   * what actually governs the sill.
   */
  function sillPermeability(ax: number, az: number, bx: number, bz: number, sillY: number): number {
    const materialAtA = terrain.materialOrAirAt(ax, sillY, az);
    const materialAtB = terrain.materialOrAirAt(bx, sillY, bz);
    return Math.min(materials.get(materialAtA).permeability, materials.get(materialAtB).permeability);
  }

  for (let x = 0; x < dims.sizeX; x++) {
    for (let z = 0; z < dims.sizeZ; z++) {
      // Only the +x and +z neighbor of each column, so every unordered adjacent pair is processed exactly once.
      for (const [dx, dz] of [
        [1, 0],
        [0, 1],
      ] as const) {
        const bx = x + dx;
        const bz = z + dz;
        if (bx >= dims.sizeX || bz >= dims.sizeZ) continue;

        const surfaceA = field.waterSurfaceY(x, z) ?? floorOf(x, z);
        const surfaceB = field.waterSurfaceY(bx, bz) ?? floorOf(bx, bz);
        const headDiff = surfaceA - surfaceB;
        if (headDiff === 0) continue;

        const floorA = floorOf(x, z);
        const floorB = floorOf(bx, bz);
        const sillY = Math.max(floorA, floorB);
        // Available cross-section is driven by the SOURCE side's excess
        // above the sill -- not `min(surfaceA, surfaceB)`, which would
        // collapse to 0 whenever the receiving column is dry (its
        // "surface" defaults to its own floor, at or below the sill) and
        // so would wrongly forbid water from ever starting to flow into a
        // dry neighbor, exactly the ordinary case this needs to handle.
        const sourceSurface = Math.max(surfaceA, surfaceB);
        const flowDepth = Math.max(0, sourceSurface - sillY);
        if (flowDepth <= 0) continue;

        const permeability = sillPermeability(x, z, bx, bz, sillY);
        if (permeability <= 0) continue;

        const rawDesired = conductance * permeability * flowDepth * headDiff * dtSeconds;
        // Stability cap -- see the function doc comment. Independent of
        // `conductance`/`dt`/`flowDepth` (no single pair can ever be
        // asked to transfer more than a safe fraction of its own head
        // difference, however large those get), but scaled by
        // `permeability`: without this factor, a low-permeability sill
        // and a fully open one would clamp to the IDENTICAL cap value
        // once either raw transfer exceeds it, silently erasing
        // "permeability" as an observable difference at exactly the
        // depths/conductances where the cap actually engages -- found
        // during review, when a 0.05-permeability sill and a
        // 0.3-permeability sill (same geometry) produced byte-identical
        // flow at this project's own documented default conductance.
        // Scaling the cap itself by permeability keeps a low-permeability
        // sill meaningfully slower to reach equilibrium than an open one
        // even once both are cap-limited, not just while both are still
        // in the raw formula's un-capped regime -- and only ever makes
        // the bound MORE conservative (permeability <= 1), so the
        // stability guarantee itself is unaffected.
        const maxSafeMagnitude = (permeability * Math.abs(headDiff)) / (2 * MAX_NEIGHBORS_PER_COLUMN);
        const desired = Math.sign(rawDesired) * Math.min(Math.abs(rawDesired), maxSafeMagnitude);
        pairs.push({ ax: x, az: z, bx, bz, desired });
        if (desired > 0) desiredOutflow[index(x, z)]! += desired;
        else desiredOutflow[index(bx, bz)]! += -desired;
      }
    }
  }

  if (pairs.length === 0) return;

  const scale = new Float64Array(columnCount).fill(1);
  for (let i = 0; i < columnCount; i++) {
    const out = desiredOutflow[i]!;
    if (out <= 0) continue;
    const x = i % dims.sizeX;
    const z = Math.floor(i / dims.sizeX);
    const available = field.depthAt(x, z);
    // A hair under 1 (not exactly `available / out`) so that summing
    // several independently-scaled outflows from the same column back
    // together can never overshoot `available` by floating-point
    // residue -- `addVolume` would otherwise occasionally throw on a
    // depth of e.g. -1e-15 from a column that was meant to drain to
    // exactly (not below) zero.
    if (out > available) scale[i] = (available / out) * (1 - 1e-9);
  }

  const delta = new Float64Array(columnCount);
  for (const { ax, az, bx, bz, desired } of pairs) {
    const sourceIndex = desired > 0 ? index(ax, az) : index(bx, bz);
    const actual = desired * scale[sourceIndex]!;
    delta[index(ax, az)]! -= actual;
    delta[index(bx, bz)]! += actual;
  }

  for (let i = 0; i < columnCount; i++) {
    let d = delta[i]!;
    if (d === 0) continue;
    const x = i % dims.sizeX;
    const z = Math.floor(i / dims.sizeX);
    // Final safety clamp against any remaining floating-point overshoot:
    // never ask a column to give up more than it actually has.
    if (d < 0) d = Math.max(d, -field.depthAt(x, z));
    if (d === 0) continue;
    field.addVolume(x, z, d);
  }
}

export interface EdgeDrainageOptions {
  /** Fraction of an edge column's current depth removed from the system per second, [0, 1]. Represents the stream continuing past the edge of the generated/loaded map, not a special "map edge" rule -- any column that touches the map boundary drains, uniformly. */
  drainRate: number;
}

/**
 * Removes water at every column touching the map boundary, proportional
 * to its current depth -- the "drainage"/"outflow" requirement for water
 * that would otherwise continue flowing past the edge of the currently
 * generated/loaded map. A separate, optional, composable step from
 * `stepFlow` (a caller not modeling an open map edge, e.g. a fully
 * enclosed pond, simply doesn't call this).
 */
export function applyEdgeDrainage(field: WaterField, dtSeconds: number, options: EdgeDrainageOptions): void {
  if (!Number.isFinite(dtSeconds) || dtSeconds < 0) {
    throw new RangeError(`dtSeconds must be a non-negative finite number, got ${dtSeconds}`);
  }
  if (!(options.drainRate >= 0) || !(options.drainRate <= 1)) {
    throw new RangeError(`drainRate must be in [0, 1], got ${options.drainRate}`);
  }
  const grid = field.worldGrid;
  const dims = grid.dims;
  if (dtSeconds === 0 || options.drainRate === 0) return;

  for (let x = 0; x < dims.sizeX; x++) {
    for (let z = 0; z < dims.sizeZ; z++) {
      if (x !== 0 && x !== dims.sizeX - 1 && z !== 0 && z !== dims.sizeZ - 1) continue;
      const depth = field.depthAt(x, z);
      if (depth <= 0) continue;
      const drained = Math.min(depth, depth * options.drainRate * dtSeconds);
      field.addVolume(x, z, -drained);
    }
  }
}
