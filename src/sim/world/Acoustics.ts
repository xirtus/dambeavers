import type { WorldGrid } from "./WorldGrid.js";
import type { WaterField } from "../hydrology/WaterField.js";
import type { World } from "../persistence/WorldSnapshot.js";
import type { EntityId } from "../core/EntityId.js";
import { getStress, setStress } from "../creatures/Stress.js";

/**
 * P11-15: environmental acoustics and signals -- a signal's reach
 * depends on source, distance, obstruction, and environment, instead of
 * global awareness. Propagation is a real line-of-sight attenuation:
 * every cell the straight path crosses costs distance, SOLID cells
 * block hard, and submerged cells (water) dampen more than air. The
 * consumer is creature AI -- an alarm call raises real stress in every
 * beaver that can genuinely hear it, and no one else.
 */

/** Base attenuation per unit distance in open air -- plausible, tunable balance data (sound falls off with distance). */
export const AIR_ATTENUATION_PER_CELL = 0.3;
/** Extra attenuation for each submerged path cell -- water genuinely dampens sound. */
export const WATER_ATTENUATION_PER_CELL = 0.35;
/** Extra attenuation for each SOLID path cell -- walls genuinely block sound (hard, but not perfectly: a very loud signal still leaks around a thin wall). */
export const SOLID_ATTENUATION_PER_CELL = 2.0;

export interface AcousticsSample {
  /** Total attenuation along the path, >= 1 (1.0 = no loss at all -- source and listener on the same cell). */
  attenuation: number;
  /** How many solid cells the straight path crossed. */
  solidCells: number;
  /** How many submerged cells the straight path crossed. */
  submergedCells: number;
  distance: number;
}

/** Bresenham line sampling between two columns -- the real cells the straight-line sound path crosses, in order, EXCLUDING the source cell itself. */
function lineCells(from: { x: number; z: number }, to: { x: number; z: number }): Array<{ x: number; z: number }> {
  const cells: Array<{ x: number; z: number }> = [];
  let x = from.x;
  let z = from.z;
  const dx = Math.abs(to.x - from.x);
  const dz = Math.abs(to.z - from.z);
  const sx = from.x < to.x ? 1 : -1;
  const sz = from.z < to.z ? 1 : -1;
  let err = dx - dz;
  for (let guard = 0; guard < dx + dz + 2 && (x !== to.x || z !== to.z); guard++) {
    const e2 = 2 * err;
    if (e2 > -dz) {
      err -= dz;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      z += sz;
    }
    cells.push({ x, z });
  }
  return cells;
}

/**
 * Real propagation attenuation from a source column to a listener
 * column. The sound travels the straight line between the two surface
 * elevations: a path column whose terrain rises INTO that line is a
 * real obstruction (a wall blocks sound), a column below the line with
 * standing water is the submerged case (water dampens), and open air
 * costs distance -- the roadmap's "source, distance, obstruction,
 * environment" sentence, one formula. `1.0` attenuation means no loss
 * at all (source and listener on the same column).
 */
export function signalAttenuation(grid: WorldGrid, water: WaterField, from: { x: number; z: number }, to: { x: number; z: number }): AcousticsSample {
  const fromSurface = water.waterSurfaceY(from.x, from.z) ?? grid.surfaceY(from.x, from.z) ?? 0;
  const toSurface = water.waterSurfaceY(to.x, to.z) ?? grid.surfaceY(to.x, to.z) ?? 0;
  const distance = Math.max(Math.abs(to.x - from.x), Math.abs(to.z - from.z));
  const path = lineCells(from, to);
  let attenuation = 1;
  let solidCells = 0;
  let submergedCells = 0;
  for (let i = 0; i < path.length; i++) {
    const cell = path[i]!;
    const progress = (i + 1) / (path.length + 1);
    const lineElevation = fromSurface + (toSurface - fromSurface) * progress;
    const cellSurface = grid.surfaceY(cell.x, cell.z);
    if (cellSurface !== undefined && cellSurface > lineElevation + 0.01) {
      solidCells++;
      attenuation += SOLID_ATTENUATION_PER_CELL;
    } else if (water.depthAt(cell.x, cell.z) > 0) {
      submergedCells++;
      attenuation += WATER_ATTENUATION_PER_CELL;
    } else {
      attenuation += AIR_ATTENUATION_PER_CELL;
    }
  }
  return { attenuation, solidCells, submergedCells, distance };
}

/** Can a listener at `to` hear a signal of `strength` emitted at `from`? A real threshold over the propagation attenuation -- loud signals carry further through the same physics. */
export function audibleAt(grid: WorldGrid, water: WaterField, from: { x: number; z: number }, to: { x: number; z: number }, strength: number): boolean {
  if (!(Number.isFinite(strength) && strength >= 0)) throw new RangeError(`signal strength must be a non-negative finite number, got ${strength}`);
  if (strength <= 0) return false;
  const { attenuation } = signalAttenuation(grid, water, from, to);
  return strength / attenuation >= 1;
}

/** Every beaver that can genuinely hear a signal of `strength` from `sourcePosition` -- the query a creature-AI consumer makes instead of a global-awareness flag. */
export function audibleBeavers(world: World, sourcePosition: { x: number; z: number }, strength: number): EntityId[] {
  const heard: EntityId[] = [];
  for (const beaverId of world.entities.liveIdsOfKind("beaver").sort((a: EntityId, b: EntityId) => a - b)) {
    const position = world.grid.positionOf(beaverId);
    if (position === undefined) continue;
    if (audibleAt(world.grid, world.water, sourcePosition, { x: position.x, z: position.z }, strength)) {
      heard.push(beaverId);
    }
  }
  return heard;
}

/** Real stress a heard alarm adds -- plausible, tunable balance data on Stress's own [0,1] level scale. */
export const ALARM_STRESS_RISE = 0.25;

/**
 * A real alarm call: every beaver who can genuinely HEAR it (through the
 * propagation physics above, never a global flag) gains real stress; a
 * beaver behind a wall or out of range hears nothing and feels nothing.
 * Returns who heard it (the observable reach).
 */
export function propagateAlarmCall(world: World, sourceId: EntityId, strength: number): EntityId[] {
  const sourcePosition = world.grid.positionOf(sourceId);
  if (sourcePosition === undefined) return [];
  const heard = audibleBeavers(world, { x: sourcePosition.x, z: sourcePosition.z }, strength);
  for (const beaverId of heard) {
    if (beaverId === sourceId) continue;
    const stress = getStress(world.components, beaverId);
    setStress(world.components, beaverId, { level: Math.min(1, (stress?.level ?? 0) + ALARM_STRESS_RISE) });
  }
  return heard.filter((id) => id !== sourceId);
}
