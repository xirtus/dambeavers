import type { EntityId, EntityIdRegistry } from "../core/EntityId.js";

/**
 * Integer cell coordinates. `y` is the vertical axis (matches the Y-up
 * convention this project's eventual Three.js presentation layer will use
 * -- ARCHITECTURE_CONTRACT §3 -- so there is no axis remapping between
 * simulation and renderer later). `x`/`z` are horizontal.
 */
export interface CellCoordinate {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface WorldGridDimensions {
  sizeX: number;
  sizeY: number;
  sizeZ: number;
}

export interface WorldGridDebugState {
  dimensions: WorldGridDimensions;
  solidCellCount: number;
  occupiedCellCount: number;
  trackedEntityCount: number;
  /** Entities currently positioned at a solid cell (e.g. a buried root, or a real bug walking something into rock). Not itself an error -- P0-05 deliberately doesn't validate occupancy against solidity (that's P1-04 navigation's job) -- but a nonzero count here for anything that *shouldn't* be embedded is the first place to look. */
  entitiesInSolidCells: number;
}

const WORLD_GRID_SNAPSHOT_VERSION = 1;

export interface WorldGridSnapshot {
  version: number;
  dimensions: WorldGridDimensions;
  /** 0/1 per cell, in the same (z*sizeY+y)*sizeX+x order the grid uses internally. */
  solid: number[];
  entities: Array<{ id: EntityId; x: number; y: number; z: number }>;
}

function isInt(n: number): boolean {
  return Number.isInteger(n);
}

function cellKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

/**
 * The generic spatial substrate: a bounded, dense 3D grid of cells, each
 * either solid or empty, plus tracking of which entities currently occupy
 * which cell. This is deliberately NOT terrain (no material/soil/rock
 * identity -- that's P0-09, layered on top the same way P0-07 material
 * definitions layer onto MaterialBody components) and NOT a continuous
 * position/Transform component (that belongs to whichever future system
 * first needs sub-cell movement, e.g. P1-04 navigation) -- WorldGrid only
 * answers "what occupies this integer cell" and "how are cells related in
 * space." Entities are positioned at whole cells for now; a future
 * continuous-position component can exist alongside this without WorldGrid
 * needing to change.
 *
 * Storage is a dense flat array sized to the full bounding box. Correct
 * and simple for one small M0 watershed map; revisit only if profiling
 * shows a sparse representation is needed for a much larger world
 * (ARCHITECTURE_CONTRACT §20: optimize demonstrated bottlenecks).
 */
export class WorldGrid {
  private readonly dimensions: WorldGridDimensions;
  private readonly solid: Uint8Array;
  private readonly registry: EntityIdRegistry;
  private readonly entitiesByCell = new Map<string, Set<EntityId>>();
  private readonly cellByEntity = new Map<EntityId, CellCoordinate>();
  private readonly unsubscribeFromDestroy: () => void;
  private disposed = false;

  constructor(dimensions: WorldGridDimensions, registry: EntityIdRegistry) {
    if (!isInt(dimensions.sizeX) || dimensions.sizeX <= 0) {
      throw new RangeError(`sizeX must be a positive integer, got ${dimensions.sizeX}`);
    }
    if (!isInt(dimensions.sizeY) || dimensions.sizeY <= 0) {
      throw new RangeError(`sizeY must be a positive integer, got ${dimensions.sizeY}`);
    }
    if (!isInt(dimensions.sizeZ) || dimensions.sizeZ <= 0) {
      throw new RangeError(`sizeZ must be a positive integer, got ${dimensions.sizeZ}`);
    }
    this.dimensions = { ...dimensions };
    this.solid = new Uint8Array(dimensions.sizeX * dimensions.sizeY * dimensions.sizeZ);
    this.registry = registry;
    this.unsubscribeFromDestroy = registry.onDestroy((id) => {
      if (this.cellByEntity.has(id)) this.clearEntityPosition(id);
    });
  }

  get dims(): WorldGridDimensions {
    return { ...this.dimensions };
  }

  inBounds(x: number, y: number, z: number): boolean {
    return (
      isInt(x) &&
      isInt(y) &&
      isInt(z) &&
      x >= 0 &&
      x < this.dimensions.sizeX &&
      y >= 0 &&
      y < this.dimensions.sizeY &&
      z >= 0 &&
      z < this.dimensions.sizeZ
    );
  }

  /**
   * The flat array index for a cell, in the same (z*sizeY+y)*sizeX+x order
   * `solid` and `WorldGridSnapshot.solid` use. Exposed (not just used
   * internally for `solid`) so a future per-cell data layer -- P0-09's
   * material/strata identity, P1-02's water depth -- can index its own
   * parallel dense array by the exact same convention instead of
   * reimplementing bounds-checked indexing and risking it drifting out of
   * sync with this one. `solid` itself is a convenience flag, not a
   * separate source of truth: once P0-09 exists, prefer deriving
   * solidity from "is there a material occupying this cell" rather than
   * maintaining `solid` independently, so terrain fill state can't
   * disagree with material state the way ARCHITECTURE_CONTRACT §13 warns
   * against for item location.
   */
  indexOf(x: number, y: number, z: number): number {
    this.assertInBounds(x, y, z);
    return (z * this.dimensions.sizeY + y) * this.dimensions.sizeX + x;
  }

  /** Total number of cells (sizeX * sizeY * sizeZ) -- the length any parallel per-cell array indexed via indexOf() should have. */
  get cellCount(): number {
    return this.solid.length;
  }

  private assertInBounds(x: number, y: number, z: number): void {
    if (!this.inBounds(x, y, z)) {
      throw new RangeError(
        `cell (${x}, ${y}, ${z}) is out of bounds for a ${this.dimensions.sizeX}x${this.dimensions.sizeY}x${this.dimensions.sizeZ} grid`,
      );
    }
  }

  private indexOfUnchecked(x: number, y: number, z: number): number {
    return (z * this.dimensions.sizeY + y) * this.dimensions.sizeX + x;
  }

  isSolid(x: number, y: number, z: number): boolean {
    this.assertInBounds(x, y, z);
    return this.solid[this.indexOfUnchecked(x, y, z)] === 1;
  }

  setSolid(x: number, y: number, z: number, value: boolean): void {
    this.assertInBounds(x, y, z);
    this.solid[this.indexOfUnchecked(x, y, z)] = value ? 1 : 0;
  }

  /** The topmost solid cell's y in this column, or undefined if the column has no solid cells (open air/void all the way down). */
  surfaceY(x: number, z: number): number | undefined {
    if (!isInt(x) || !isInt(z) || x < 0 || x >= this.dimensions.sizeX || z < 0 || z >= this.dimensions.sizeZ) {
      throw new RangeError(`column (${x}, ${z}) is out of bounds`);
    }
    for (let y = this.dimensions.sizeY - 1; y >= 0; y--) {
      if (this.solid[this.indexOfUnchecked(x, y, z)] === 1) return y;
    }
    return undefined;
  }

  /** The 6 orthogonal (face-adjacent) neighbors of a cell that lie within bounds -- includes vertical (above/below) and horizontal neighbors alike. */
  neighbors6(x: number, y: number, z: number): CellCoordinate[] {
    this.assertInBounds(x, y, z);
    const candidates: CellCoordinate[] = [
      { x: x + 1, y, z },
      { x: x - 1, y, z },
      { x, y: y + 1, z },
      { x, y: y - 1, z },
      { x, y, z: z + 1 },
      { x, y, z: z - 1 },
    ];
    return candidates.filter((c) => this.inBounds(c.x, c.y, c.z));
  }

  above(x: number, y: number, z: number): CellCoordinate | undefined {
    this.assertInBounds(x, y, z);
    return this.inBounds(x, y + 1, z) ? { x, y: y + 1, z } : undefined;
  }

  below(x: number, y: number, z: number): CellCoordinate | undefined {
    this.assertInBounds(x, y, z);
    return this.inBounds(x, y - 1, z) ? { x, y: y - 1, z } : undefined;
  }

  /** True if `b` is one of `a`'s 6 orthogonal neighbors. */
  isAdjacent(a: CellCoordinate, b: CellCoordinate): boolean {
    this.assertInBounds(a.x, a.y, a.z);
    this.assertInBounds(b.x, b.y, b.z);
    const dx = Math.abs(a.x - b.x);
    const dy = Math.abs(a.y - b.y);
    const dz = Math.abs(a.z - b.z);
    return dx + dy + dz === 1;
  }

  /** Places (or moves, if already tracked) an entity at a cell. The entity must be live in this grid's registry. */
  setEntityPosition(id: EntityId, x: number, y: number, z: number): void {
    if (!this.registry.isLive(id)) {
      throw new RangeError(`cannot position entity id ${id}: not a live entity in this grid's registry`);
    }
    this.assertInBounds(x, y, z);
    const previous = this.cellByEntity.get(id);
    if (previous !== undefined) {
      this.entitiesByCell.get(cellKey(previous.x, previous.y, previous.z))?.delete(id);
    }
    const key = cellKey(x, y, z);
    let occupants = this.entitiesByCell.get(key);
    if (occupants === undefined) {
      occupants = new Set();
      this.entitiesByCell.set(key, occupants);
    }
    occupants.add(id);
    this.cellByEntity.set(id, { x, y, z });
  }

  /** Stops tracking an entity's position. Called automatically on entity destruction; also callable directly. */
  clearEntityPosition(id: EntityId): void {
    const previous = this.cellByEntity.get(id);
    if (previous === undefined) {
      throw new RangeError(`entity id ${id} has no tracked position in this grid`);
    }
    this.entitiesByCell.get(cellKey(previous.x, previous.y, previous.z))?.delete(id);
    this.cellByEntity.delete(id);
  }

  positionOf(id: EntityId): CellCoordinate | undefined {
    const cell = this.cellByEntity.get(id);
    // Defensive copy: the stored object is this grid's own bookkeeping
    // (also referenced by entitiesByCell's key derivation), not the
    // caller's to mutate. Returning it directly would let an in-place
    // mutation desync cellByEntity from entitiesByCell with nothing to
    // catch it -- occupancy queries would silently start lying.
    return cell === undefined ? undefined : { ...cell };
  }

  entitiesAt(x: number, y: number, z: number): EntityId[] {
    this.assertInBounds(x, y, z);
    const occupants = this.entitiesByCell.get(cellKey(x, y, z));
    return occupants === undefined ? [] : [...occupants];
  }

  /**
   * O(sizeX*sizeY*sizeZ) -- scans every cell to count solid/in-solid-entity
   * state. Fine for an on-demand debug UI (P0-12, click-to-inspect); do
   * not call this from a per-tick hot path once the grid grows toward a
   * full watershed map (hundreds of thousands to low millions of cells).
   */
  getDebugState(): WorldGridDebugState {
    let solidCellCount = 0;
    for (let i = 0; i < this.solid.length; i++) {
      if (this.solid[i] === 1) solidCellCount++;
    }
    let occupiedCellCount = 0;
    for (const occupants of this.entitiesByCell.values()) {
      if (occupants.size > 0) occupiedCellCount++;
    }
    let entitiesInSolidCells = 0;
    for (const cell of this.cellByEntity.values()) {
      if (this.solid[this.indexOfUnchecked(cell.x, cell.y, cell.z)] === 1) entitiesInSolidCells++;
    }
    return {
      dimensions: this.dims,
      solidCellCount,
      occupiedCellCount,
      trackedEntityCount: this.cellByEntity.size,
      entitiesInSolidCells,
    };
  }

  /** Stops auto-cleanup on entity destruction. Only needed when discarding a grid while its registry stays alive (e.g. test isolation), mirroring ComponentStore's dispose(). */
  dispose(): void {
    if (this.disposed) return;
    this.unsubscribeFromDestroy();
    this.disposed = true;
  }

  toSnapshot(): WorldGridSnapshot {
    const entities: WorldGridSnapshot["entities"] = [];
    for (const [id, cell] of this.cellByEntity) {
      entities.push({ id, x: cell.x, y: cell.y, z: cell.z });
    }
    return {
      version: WORLD_GRID_SNAPSHOT_VERSION,
      dimensions: this.dims,
      solid: Array.from(this.solid),
      entities,
    };
  }

  /** Requires the same (or an equivalently populated) EntityIdRegistry the original grid used -- entity positions only restore for ids that are live in `registry`, so grid and identity state should be reloaded together as part of one broader world-load sequence. */
  static fromSnapshot(snapshot: WorldGridSnapshot, registry: EntityIdRegistry): WorldGrid {
    if (snapshot.version !== WORLD_GRID_SNAPSHOT_VERSION) {
      throw new RangeError(
        `unsupported WorldGrid snapshot version ${snapshot.version}, expected ${WORLD_GRID_SNAPSHOT_VERSION}`,
      );
    }
    const grid = new WorldGrid(snapshot.dimensions, registry);
    const expectedLength = snapshot.dimensions.sizeX * snapshot.dimensions.sizeY * snapshot.dimensions.sizeZ;
    if (snapshot.solid.length !== expectedLength) {
      throw new RangeError(
        `corrupt snapshot: expected ${expectedLength} solid cells for these dimensions, got ${snapshot.solid.length}`,
      );
    }
    for (let i = 0; i < snapshot.solid.length; i++) {
      const value = snapshot.solid[i];
      if (value !== 0 && value !== 1) {
        throw new RangeError(`corrupt snapshot: solid[${i}] must be 0 or 1, got ${value}`);
      }
      grid.solid[i] = value;
    }
    const seenIds = new Set<EntityId>();
    for (const entry of snapshot.entities) {
      if (seenIds.has(entry.id)) {
        throw new RangeError(`corrupt snapshot: duplicate entity id ${entry.id}`);
      }
      seenIds.add(entry.id);
      if (!registry.isLive(entry.id)) {
        throw new RangeError(`corrupt snapshot: entity id ${entry.id} is not live in the provided registry`);
      }
      grid.setEntityPosition(entry.id, entry.x, entry.y, entry.z); // validates bounds
    }
    return grid;
  }
}
