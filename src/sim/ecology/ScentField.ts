import type { World } from "../persistence/WorldSnapshot.js";

/**
 * P11-16: scent/chemical traces -- a real, transported, decaying
 * per-column concentration field (peer class of P4-15's
 * `ContaminationField`, the same per-column + transport-rate shape),
 * deposited by creature movement, corpses, and food, moved downstream
 * WITH water, and consumed by a real gradient-following predator
 * targeting path (`preyByScent` below) instead of omniscient
 * nearest-prey distance. A predator finds prey along a real deposited
 * trail and loses it when the trail is disrupted or has aged out --
 * because the field IS the only thing it can follow.
 */

const SCENT_SNAPSHOT_VERSION = 1;

export interface ScentFieldSnapshot {
  version: number;
  dimensions: { sizeX: number; sizeZ: number };
  concentrationByColumn: number[];
}

/** Fraction of a column's own scent that decays per tick -- trails genuinely age out. Plausible, tunable balance data. */
export const SCENT_DECAY_RATE = 0.01;
/** Fraction of a column's own scent moved downstream per tick (the same transport-rate pattern `ContaminationField` established). */
export const SCENT_TRANSPORT_RATE = 0.05;
/** Below this concentration a column's scent is effectively gone (trails end). */
export const SCENT_MIN_CONCENTRATION = 0.005;
/** A predator can follow a trail this many gradient steps -- beyond it, the trail has faded too far to follow. */
export const MAX_SCENT_STEPS = 24;

export class ScentField {
  private readonly sizeX: number;
  private readonly sizeZ: number;
  private concentrationByColumn: Float64Array;

  constructor(sizeX: number, sizeZ: number) {
    this.sizeX = sizeX;
    this.sizeZ = sizeZ;
    this.concentrationByColumn = new Float64Array(sizeX * sizeZ);
  }

  get dims(): { sizeX: number; sizeZ: number } {
    return { sizeX: this.sizeX, sizeZ: this.sizeZ };
  }

  private columnIndex(x: number, z: number): number {
    if (!Number.isInteger(x) || !Number.isInteger(z) || x < 0 || x >= this.sizeX || z < 0 || z >= this.sizeZ) {
      throw new RangeError(`column (${x}, ${z}) is out of bounds`);
    }
    return z * this.sizeX + x;
  }

  concentrationAt(x: number, z: number): number {
    return this.concentrationByColumn[this.columnIndex(x, z)]!;
  }

  /** Deposits a real scent amount at a column (creature movement, a corpse, food) -- clamped to a saturation cap of 1. */
  deposit(x: number, z: number, amount: number): void {
    if (!(Number.isFinite(amount) && amount >= 0)) throw new RangeError(`scent deposit must be a non-negative finite number, got ${amount}`);
    const index = this.columnIndex(x, z);
    this.concentrationByColumn[index] = Math.min(1, this.concentrationByColumn[index]! + amount);
  }

  /** Test/disruption setter: clears or sets a column's scent directly (the "trail disrupted" case). */
  setConcentration(x: number, z: number, concentration: number): void {
    if (!Number.isFinite(concentration) || concentration < 0) throw new RangeError(`scent concentration must be a non-negative finite number, got ${concentration}`);
    this.concentrationByColumn[this.columnIndex(x, z)] = Math.min(1, concentration);
  }

  private neighborsOf(x: number, z: number): Array<{ x: number; z: number }> {
    return [
      { x: x + 1, z },
      { x: x - 1, z },
      { x, z: z + 1 },
      { x, z: z - 1 },
    ].filter((n) => n.x >= 0 && n.x < this.sizeX && n.z >= 0 && n.z < this.sizeZ);
  }

  /**
   * One tick over the whole field: every column's scent decays at
   * `SCENT_DECAY_RATE`, and wet columns move a real fraction downstream
   * toward their lowest-surface neighbor (scent rides the water, the
   * same head-difference transport `ContaminationField` uses).
   */
  tickAll(world: World): void {
    const grid = world.grid;
    const water = world.water;
    const next = new Float64Array(this.concentrationByColumn);

    for (let i = 0; i < next.length; i++) {
      next[i] = next[i]! * (1 - SCENT_DECAY_RATE);
    }

    for (let x = 0; x < this.sizeX; x++) {
      for (let z = 0; z < this.sizeZ; z++) {
        if (grid.surfaceY(x, z) === undefined) continue;
        const index = this.columnIndex(x, z);
        const own = this.concentrationByColumn[index]!;
        if (own <= 0) continue;
        const ownSurface = water.waterSurfaceY(x, z) ?? grid.surfaceY(x, z)!;
        let lowestNeighbor: { x: number; z: number } | undefined;
        let lowestSurface = ownSurface;
        for (const neighbor of this.neighborsOf(x, z)) {
          if (grid.surfaceY(neighbor.x, neighbor.z) === undefined) continue;
          const surface = water.waterSurfaceY(neighbor.x, neighbor.z) ?? grid.surfaceY(neighbor.x, neighbor.z)!;
          if (surface < lowestSurface) {
            lowestSurface = surface;
            lowestNeighbor = neighbor;
          }
        }
        if (lowestNeighbor === undefined) continue;
        const moved = own * SCENT_TRANSPORT_RATE;
        const neighborIndex = this.columnIndex(lowestNeighbor.x, lowestNeighbor.z);
        next[index] = next[index]! - moved;
        next[neighborIndex] = next[neighborIndex]! + moved;
      }
    }

    this.concentrationByColumn = next;
  }

  toSnapshot(): ScentFieldSnapshot {
    return { version: SCENT_SNAPSHOT_VERSION, dimensions: { sizeX: this.sizeX, sizeZ: this.sizeZ }, concentrationByColumn: Array.from(this.concentrationByColumn) };
  }

  static fromSnapshot(snapshot: ScentFieldSnapshot): ScentField {
    if (snapshot.version !== SCENT_SNAPSHOT_VERSION) {
      throw new RangeError(`unsupported ScentField snapshot version ${snapshot.version}, expected ${SCENT_SNAPSHOT_VERSION}`);
    }
    const field = new ScentField(snapshot.dimensions.sizeX, snapshot.dimensions.sizeZ);
    if (snapshot.concentrationByColumn.length !== field.concentrationByColumn.length) {
      throw new RangeError(`corrupt snapshot: expected ${field.concentrationByColumn.length} columns, got ${snapshot.concentrationByColumn.length}`);
    }
    field.concentrationByColumn.set(snapshot.concentrationByColumn);
    return field;
  }
}

/**
 * The real gradient-following perception query: from `start`, greedily
 * ascend the scent gradient (always moving to the unvisited neighbor
 * with the highest concentration above `SCENT_MIN_CONCENTRATION`) for at
 * most `MAX_SCENT_STEPS`. Returns the column reached when the gradient
 * ends (the trail's destination -- where the scent is strongest), or
 * `undefined` when there is no trail to follow. This is the non-
 * omniscient targeting primitive: a predator only knows what this walk
 * tells it.
 */
export function followScentGradient(scent: ScentField, start: { x: number; z: number }): { x: number; z: number } | undefined {
  let current = { x: start.x, z: start.z };
  const visited = new Set<string>([`${current.x},${current.z}`]);
  const currentConcentration = scent.concentrationAt(current.x, current.z);
  if (currentConcentration < SCENT_MIN_CONCENTRATION) return undefined;
  for (let step = 0; step < MAX_SCENT_STEPS; step++) {
    let best: { x: number; z: number } | undefined;
    let bestConcentration = scent.concentrationAt(current.x, current.z);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = current.x + dx;
      const nz = current.z + dz;
      if (nx < 0 || nx >= scent.dims.sizeX || nz < 0 || nz >= scent.dims.sizeZ) continue;
      const key = `${nx},${nz}`;
      if (visited.has(key)) continue;
      const concentration = scent.concentrationAt(nx, nz);
      if (concentration > bestConcentration) {
        bestConcentration = concentration;
        best = { x: nx, z: nz };
      }
    }
    if (best === undefined || bestConcentration < SCENT_MIN_CONCENTRATION) return current;
    visited.add(`${best.x},${best.z}`);
    current = best;
  }
  return current;
}
