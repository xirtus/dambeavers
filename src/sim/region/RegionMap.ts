import type { EntityId } from "../core/EntityId.js";

/**
 * P6-01: a new, coarser spatial layer ABOVE the existing per-watershed
 * `WorldGrid` (P0-05) -- one `RegionMap` cell represents an entire
 * potential watershed/site location, not a single voxel. This is
 * deliberately a SEPARATE coordinate space (`RegionCoordinate`, never
 * confused with `CellCoordinate`/`ColumnCoordinate`) so "many local
 * sites can exist inside a larger spatial region with stable
 * coordinates" (the literal acceptance test) holds without needing to
 * inflate the existing detailed simulation's own grid to continent
 * scale -- exactly the same "column vs. voxel, different resolution for
 * a different real purpose" precedent `WaterField`'s own file doc
 * comment already established for hydrology vs. terrain.
 */
export interface RegionCoordinate {
  readonly regionX: number;
  readonly regionZ: number;
}

const REGION_MAP_SNAPSHOT_VERSION = 1;

export interface RegionMapSnapshot {
  version: number;
  dimensions: { sizeX: number; sizeZ: number };
  elevationByCell: number[];
  siteIdByCell: Array<number | null>;
}

function isInt(n: number): boolean {
  return Number.isInteger(n);
}

export class RegionMap {
  readonly sizeX: number;
  readonly sizeZ: number;
  private readonly elevationByCell: Float64Array;
  private readonly siteIdByCell: Array<EntityId | undefined>;

  constructor(sizeX: number, sizeZ: number) {
    if (!isInt(sizeX) || sizeX <= 0 || !isInt(sizeZ) || sizeZ <= 0) {
      throw new RangeError(`RegionMap dimensions must be positive integers, got ${sizeX}x${sizeZ}`);
    }
    this.sizeX = sizeX;
    this.sizeZ = sizeZ;
    this.elevationByCell = new Float64Array(sizeX * sizeZ);
    this.siteIdByCell = new Array(sizeX * sizeZ).fill(undefined);
  }

  inBounds(x: number, z: number): boolean {
    return isInt(x) && isInt(z) && x >= 0 && x < this.sizeX && z >= 0 && z < this.sizeZ;
  }

  private index(x: number, z: number): number {
    if (!this.inBounds(x, z)) throw new RangeError(`region cell (${x}, ${z}) is out of bounds`);
    return z * this.sizeX + x;
  }

  elevationAt(x: number, z: number): number {
    return this.elevationByCell[this.index(x, z)]!;
  }

  setElevation(x: number, z: number, elevation: number): void {
    if (!Number.isFinite(elevation)) throw new RangeError(`region elevation must be finite, got ${elevation}`);
    this.elevationByCell[this.index(x, z)] = elevation;
  }

  siteIdAt(x: number, z: number): EntityId | undefined {
    return this.siteIdByCell[this.index(x, z)];
  }

  /** Registers `siteId` as occupying region cell `(x, z)` -- throws if that cell already holds a different live site (a region cell hosts at most one site, the same "one physical resource, one real owner" discipline this codebase applies everywhere else). */
  placeSite(x: number, z: number, siteId: EntityId): void {
    const index = this.index(x, z);
    const existing = this.siteIdByCell[index];
    if (existing !== undefined && existing !== siteId) {
      throw new RangeError(`region cell (${x}, ${z}) already holds site ${existing} -- cannot place site ${siteId} there`);
    }
    this.siteIdByCell[index] = siteId;
  }

  /** Every neighbor cell orthogonally AND diagonally adjacent to `(x, z)` that's in bounds -- the real 8-connectivity D8 hydrology (P6-02/P6-03) and travel-network (P6-09) systems both need. */
  neighbors8(x: number, z: number): RegionCoordinate[] {
    const out: RegionCoordinate[] = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (dx === 0 && dz === 0) continue;
        const nx = x + dx;
        const nz = z + dz;
        if (this.inBounds(nx, nz)) out.push({ regionX: nx, regionZ: nz });
      }
    }
    return out;
  }

  toSnapshot(): RegionMapSnapshot {
    return {
      version: REGION_MAP_SNAPSHOT_VERSION,
      dimensions: { sizeX: this.sizeX, sizeZ: this.sizeZ },
      elevationByCell: Array.from(this.elevationByCell),
      siteIdByCell: this.siteIdByCell.map((id) => id ?? null),
    };
  }

  static fromSnapshot(snapshot: RegionMapSnapshot): RegionMap {
    if (snapshot.version !== REGION_MAP_SNAPSHOT_VERSION) {
      throw new RangeError(`unsupported RegionMap snapshot version ${snapshot.version}, expected ${REGION_MAP_SNAPSHOT_VERSION}`);
    }
    const map = new RegionMap(snapshot.dimensions.sizeX, snapshot.dimensions.sizeZ);
    if (snapshot.elevationByCell.length !== map.elevationByCell.length) {
      throw new RangeError(`corrupt snapshot: expected ${map.elevationByCell.length} cells, got ${snapshot.elevationByCell.length}`);
    }
    map.elevationByCell.set(snapshot.elevationByCell);
    for (let i = 0; i < snapshot.siteIdByCell.length; i++) {
      const id = snapshot.siteIdByCell[i];
      if (id !== null && id !== undefined) {
        if (!Number.isInteger(id) || id < 1) throw new RangeError(`corrupt snapshot: invalid siteId ${id} at cell ${i}`);
        map.siteIdByCell[i] = id as EntityId;
      }
    }
    return map;
  }
}
