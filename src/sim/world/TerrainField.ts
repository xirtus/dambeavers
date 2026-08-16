import type { MaterialId, MaterialRegistry } from "../materials/Material.js";
import type { WorldGrid } from "./WorldGrid.js";

const TERRAIN_FIELD_SNAPSHOT_VERSION = 1;

export interface TerrainFieldDebugState {
  filledCellCount: number;
  materialCounts: Array<{ materialId: MaterialId; count: number }>;
}

export interface TerrainFieldSnapshot {
  version: number;
  /** Parallel to WorldGrid.indexOf's ordering; `null` (not `undefined` -- JSON has no undefined) means no material at that cell. */
  materialByCell: Array<MaterialId | null>;
}

/**
 * Empty (never-filled or excavated) cells have no material recorded. For
 * any per-property lookup (permeability, density, thermal conductivity --
 * exactly what P1-02/P1-03 hydrology will need per cell), treat an empty
 * cell as this material rather than inventing a separate "no data"
 * convention: `materialOrAirAt()` already does this resolution.
 */
export const AIR_MATERIAL_ID: MaterialId = "air";

/**
 * Attaches material identity to WorldGrid cells -- soil, rock, and
 * whatever else P0-07 defines. This is deliberately the authoritative
 * source for whether a cell is filled: `setMaterial`/`excavate` also
 * update the underlying `WorldGrid.solid` flag to match, so "is this cell
 * terrain" has exactly one source of truth once a TerrainField is in use,
 * rather than `solid` and material presence being two independently
 * maintained facts that could disagree (the gap WorldGrid's own doc
 * comment flagged when P0-05 was reviewed: "P0-09 should ultimately
 * derive solidity from material rather than maintain it separately").
 *
 * "Excavatable/alterable" (P0-09's roadmap requirement) is not a separate
 * mechanism: it's just `setMaterial(x, y, z, undefined)` on a previously
 * filled cell -- clearing material IS digging it out, and the grid's
 * solidity updates as an ordinary consequence, not a special case.
 *
 * Scope of authority: this class only asserts solidity for cells it has
 * actually been told about (via `setMaterial`/`excavate`, or restored from
 * its own snapshot). A cell's `grid.solid` can still be set directly
 * through `WorldGrid.setSolid()` for something P0-09 doesn't model (e.g. a
 * future non-terrain obstruction) without TerrainField ever touching or
 * clobbering it -- see `fromSnapshot`'s doc comment for how that survives
 * a save/load round trip.
 */
export class TerrainField {
  private readonly grid: WorldGrid;
  private readonly materials: MaterialRegistry;
  private readonly materialByCell: Array<MaterialId | undefined>;

  constructor(grid: WorldGrid, materials: MaterialRegistry) {
    this.grid = grid;
    this.materials = materials;
    this.materialByCell = new Array(grid.cellCount).fill(undefined);
  }

  /** The WorldGrid this TerrainField manages cells for. */
  get worldGrid(): WorldGrid {
    return this.grid;
  }

  /** Fills (or, with `undefined`, excavates/clears) a cell. Keeps `grid.solid` in sync as a direct consequence. */
  setMaterial(x: number, y: number, z: number, materialId: MaterialId | undefined): void {
    if (materialId !== undefined && !this.materials.has(materialId)) {
      throw new RangeError(`unknown material id "${materialId}"`);
    }
    const index = this.grid.indexOf(x, y, z); // validates bounds
    this.materialByCell[index] = materialId;
    this.grid.setSolid(x, y, z, materialId !== undefined);
  }

  /** Clears a cell's material, the general mechanism digging/excavation is built from. Equivalent to `setMaterial(x, y, z, undefined)`. */
  excavate(x: number, y: number, z: number): void {
    this.setMaterial(x, y, z, undefined);
  }

  materialAt(x: number, y: number, z: number): MaterialId | undefined {
    return this.materialByCell[this.grid.indexOf(x, y, z)];
  }

  /** Like `materialAt`, but an empty cell resolves to `AIR_MATERIAL_ID` instead of `undefined` -- the convention any per-cell property lookup (permeability, density, ...) should use. */
  materialOrAirAt(x: number, y: number, z: number): MaterialId {
    return this.materialAt(x, y, z) ?? AIR_MATERIAL_ID;
  }

  /** O(cellCount) -- scans every cell. Fine for an on-demand debug UI (P0-12); do not call this from a per-tick hot path once the grid grows toward a full watershed map, mirroring WorldGrid.getDebugState()'s equivalent warning. */
  getDebugState(): TerrainFieldDebugState {
    const counts = new Map<MaterialId, number>();
    let filledCellCount = 0;
    for (const materialId of this.materialByCell) {
      if (materialId === undefined) continue;
      filledCellCount++;
      counts.set(materialId, (counts.get(materialId) ?? 0) + 1);
    }
    const materialCounts = [...counts.entries()]
      .map(([materialId, count]) => ({ materialId, count }))
      .sort((a, b) => a.materialId.localeCompare(b.materialId));
    return { filledCellCount, materialCounts };
  }

  toSnapshot(): TerrainFieldSnapshot {
    return {
      version: TERRAIN_FIELD_SNAPSHOT_VERSION,
      materialByCell: this.materialByCell.map((m) => m ?? null),
    };
  }

  /**
   * Restores material data, asserting solidity (via `setMaterial`) only
   * for cells this snapshot actually recorded a material for. Cells with
   * no recorded material are left untouched here -- NOT forced to
   * non-solid -- so `grid.solid` for anything not managed by TerrainField
   * (see the class doc comment's "scope of authority" note) survives
   * exactly as `WorldGrid`'s own snapshot restored it. The intended order
   * is: restore the grid first, then this. This asymmetry (assert true,
   * never assert false) is deliberate: it is how TerrainField can be
   * authoritative for the cells it manages without being destructive
   * toward cells it doesn't.
   */
  static fromSnapshot(snapshot: TerrainFieldSnapshot, grid: WorldGrid, materials: MaterialRegistry): TerrainField {
    if (snapshot.version !== TERRAIN_FIELD_SNAPSHOT_VERSION) {
      throw new RangeError(
        `unsupported TerrainField snapshot version ${snapshot.version}, expected ${TERRAIN_FIELD_SNAPSHOT_VERSION}`,
      );
    }
    if (snapshot.materialByCell.length !== grid.cellCount) {
      throw new RangeError(
        `corrupt snapshot: expected ${grid.cellCount} cells for this grid, got ${snapshot.materialByCell.length}`,
      );
    }
    const terrain = new TerrainField(grid, materials);
    const dims = grid.dims;
    for (let x = 0; x < dims.sizeX; x++) {
      for (let y = 0; y < dims.sizeY; y++) {
        for (let z = 0; z < dims.sizeZ; z++) {
          const materialId = snapshot.materialByCell[grid.indexOf(x, y, z)];
          if (materialId === null || materialId === undefined) continue; // leave grid.solid as WorldGrid's own restore set it
          if (!materials.has(materialId)) {
            throw new RangeError(`corrupt snapshot: unknown material id "${materialId}"`);
          }
          terrain.setMaterial(x, y, z, materialId);
        }
      }
    }
    return terrain;
  }
}

export interface StrataLayer {
  materialId: MaterialId;
  /** Thickness in cells, from the surface downward. The LAST layer in a profile implicitly extends to the bottom of the grid (y=0) once shallower layers are exhausted -- "underlying rock" needs no explicit infinite depth value. */
  depth: number;
}

/**
 * Fills each column up to `heightAt(x,z)` (inclusive, clamped to the
 * grid's vertical extent) with the given strata profile, topmost layer
 * first. A minimal, general elevation+strata applicator -- NOT a
 * watershed/map generator (that's P1-01's job, built by supplying whatever
 * elevation function it likes to this, including calling this more than
 * once for layered features like a stream channel carved into a base
 * elevation pass).
 *
 * Idempotent/repeatable by design: calling this again over the same
 * `terrain` -- with a different `heightAt`, including a LOWER one for some
 * columns -- correctly excavates whatever was previously solid above the
 * new surface in each affected column, rather than leaving stale material
 * behind from an earlier call. Cells below the new surface are always
 * freshly (re)written from the given strata profile; cells above it are
 * left/made unfilled (air).
 */
export function applyHeightfield(
  terrain: TerrainField,
  heightAt: (x: number, z: number) => number,
  strata: readonly StrataLayer[],
): void {
  if (strata.length === 0) {
    throw new RangeError("applyHeightfield requires at least one stratum");
  }
  for (const layer of strata) {
    if (!Number.isInteger(layer.depth) || layer.depth <= 0) {
      throw new RangeError(`stratum "${layer.materialId}" depth must be a positive integer, got ${layer.depth}`);
    }
  }

  const grid = terrain.worldGrid;
  const dims = grid.dims;
  for (let x = 0; x < dims.sizeX; x++) {
    for (let z = 0; z < dims.sizeZ; z++) {
      const rawHeight = heightAt(x, z);
      if (!Number.isFinite(rawHeight)) {
        throw new RangeError(`heightAt(${x}, ${z}) returned a non-finite value: ${rawHeight}`);
      }
      const surfaceY = Math.max(0, Math.min(Math.round(rawHeight), dims.sizeY - 1));

      // Excavate anything left solid above the new surface from an
      // earlier call over this same column -- otherwise a second,
      // lower pass would silently leave stale material behind.
      const previousSurfaceY = grid.surfaceY(x, z);
      if (previousSurfaceY !== undefined) {
        for (let y = previousSurfaceY; y > surfaceY; y--) {
          terrain.setMaterial(x, y, z, undefined);
        }
      }

      let layerIndex = 0;
      let remainingInLayer = strata[0]!.depth;
      for (let y = surfaceY; y >= 0; y--) {
        while (remainingInLayer <= 0 && layerIndex < strata.length - 1) {
          layerIndex++;
          remainingInLayer = strata[layerIndex]!.depth;
        }
        terrain.setMaterial(x, y, z, strata[layerIndex]!.materialId);
        remainingInLayer--;
      }
    }
  }
}
