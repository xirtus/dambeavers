/**
 * RENDER CONTRACT — terrain & water chunks (threejs_layer.md §3.2).
 *
 * Terrain state is large and changes in bursts (digging, dam application,
 * collapse), so it is projected per CHUNK with a revision: the renderer
 * rebuilds a chunk mesh only when that chunk's revision changes.
 *
 * All data here is packed, JSON-plain, and derived from authoritative
 * state (TerrainField material ids, WaterField depths/surfaces). Water
 * surface/flow facts are per-COLUMN because the sim's WaterField is
 * per-column; the renderer smooths them visually (Law R4/R5) but may not
 * invent water where the sim has none (Law §9.1).
 */

/** Fixed logical chunk footprint (XxZ cells). Y always spans the full grid height in R1 (worlds are shallow); a future deep world can sub-chunk vertically without changing this contract. */
export const CHUNK_SIZE_X = 16;
export const CHUNK_SIZE_Z = 16;

export interface ChunkCoordinate {
  readonly cx: number;
  readonly cz: number;
}

/**
 * Packed per-cell terrain for one chunk. Indexing follows the same
 * `(localZ * sizeY + y) * sizeX + localX` convention as WorldGrid.indexOf,
 * applied to the chunk's local extents (sizeX/sizeZ clamped at map edges).
 */
export interface RenderChunkTerrain {
  readonly coord: ChunkCoordinate;
  /** Chunk-local extents (<= CHUNK_SIZE_X/Z at edges) and full grid height. */
  readonly sizeX: number;
  readonly sizeY: number;
  readonly sizeZ: number;
  /** World-space origin cell of this chunk. */
  readonly originX: number;
  readonly originZ: number;
  /** Material palette index per cell; 0 = empty (air). Palette maps 1:1 to `materialPalette`. */
  readonly materialIndex: Uint16Array;
  /** Material ids for `materialIndex`; index 0 is always "air". */
  readonly materialPalette: readonly string[];
  /** Monotonic revision; changes exactly when any cell in this chunk changes. */
  readonly revision: number;
}

/** Per-column authoritative water facts for one chunk (z-major, matching columnIndex). */
export interface RenderChunkWater {
  readonly coord: ChunkCoordinate;
  readonly sizeX: number;
  readonly sizeZ: number;
  readonly originX: number;
  readonly originZ: number;
  /** Authoritative depth per column (0 = dry). NEVER painted by the renderer. */
  readonly depth: Float32Array;
  /** Authoritative water surface elevation (floor + depth) per wet column; 0 where dry -- consult `depth` first. */
  readonly surfaceY: Float32Array;
  /** Monotonic revision of the water field slice covering this chunk. */
  readonly revision: number;
}
