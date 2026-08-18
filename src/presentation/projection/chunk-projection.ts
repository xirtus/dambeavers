/**
 * Chunk projection (threejs_layer.md §3.2): packs TerrainField/WaterField
 * slices into per-chunk payloads with revisions, so the renderer rebuilds
 * GPU geometry only for chunks whose authoritative state actually changed.
 *
 * Revisions are content hashes over the authoritative cells/columns --
 * derived fresh from the world on every projection (never a cached dirty
 * flag that could drift). Water depth hashing quantizes to 1/1000 cell so
 * sub-millimeter numerical ripple doesn't force invisible geometry
 * rebuilds; the PAYLOAD always carries the full float truth.
 */
import type { World } from "../../sim/persistence/WorldSnapshot.js";
import {
  CHUNK_SIZE_X,
  CHUNK_SIZE_Z,
  type ChunkCoordinate,
  type RenderChunkTerrain,
  type RenderChunkWater,
} from "../contracts/render-chunk.js";

function fnv1aBytes(values: ArrayLike<number>, stride = 1): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < values.length; i += stride) {
    const v = values[i]! >>> 0;
    hash ^= v & 0xff;
    hash = Math.imul(hash, 0x01000193);
    hash ^= (v >>> 8) & 0xff;
    hash = Math.imul(hash, 0x01000193);
    hash ^= (v >>> 16) & 0xff;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export interface ChunkGrid {
  readonly chunksX: number;
  readonly chunksZ: number;
  readonly coords: readonly ChunkCoordinate[];
}

export function chunkGridFor(sizeX: number, sizeZ: number): ChunkGrid {
  const chunksX = Math.ceil(sizeX / CHUNK_SIZE_X);
  const chunksZ = Math.ceil(sizeZ / CHUNK_SIZE_Z);
  const coords: ChunkCoordinate[] = [];
  for (let cz = 0; cz < chunksZ; cz++) {
    for (let cx = 0; cx < chunksX; cx++) {
      coords.push({ cx, cz });
    }
  }
  return { chunksX, chunksZ, coords };
}

/**
 * Projects terrain and water per chunk. Payloads are produced on demand
 * via `terrainChunk`/`waterChunk`; per-frame cost is only the revision
 * hashes (O(cells), sub-millisecond at M0 map sizes).
 */
export class ChunkProjector {
  private readonly terrainRevisions = new Map<string, number>();
  private readonly waterRevisions = new Map<string, number>();
  private nextRevision = 1;
  readonly grid: ChunkGrid;

  constructor(world: World) {
    const dims = world.grid.dims;
    this.grid = chunkGridFor(dims.sizeX, dims.sizeZ);
  }

  static key(coord: ChunkCoordinate): string {
    return `${coord.cx},${coord.cz}`;
  }

  /** Recomputes all revision hashes; returns the chunks whose content changed since the last scan. */
  scan(world: World): { dirtyTerrain: ChunkCoordinate[]; dirtyWater: ChunkCoordinate[] } {
    const dirtyTerrain: ChunkCoordinate[] = [];
    const dirtyWater: ChunkCoordinate[] = [];
    for (const coord of this.grid.coords) {
      const key = ChunkProjector.key(coord);
      const terrainHash = this.hashTerrain(world, coord);
      if (this.terrainRevisions.get(key) !== terrainHash) {
        this.terrainRevisions.set(key, terrainHash);
        dirtyTerrain.push(coord);
      }
      const waterHash = this.hashWater(world, coord);
      if (this.waterRevisions.get(key) !== waterHash) {
        this.waterRevisions.set(key, waterHash);
        dirtyWater.push(coord);
      }
    }
    return { dirtyTerrain, dirtyWater };
  }

  terrainRevision(coord: ChunkCoordinate): number {
    return this.terrainRevisions.get(ChunkProjector.key(coord)) ?? 0;
  }

  waterRevision(coord: ChunkCoordinate): number {
    return this.waterRevisions.get(ChunkProjector.key(coord)) ?? 0;
  }

  /** Full terrain payload for one chunk -- material palette + per-cell palette indices. */
  terrainChunk(world: World, coord: ChunkCoordinate): RenderChunkTerrain {
    const dims = world.grid.dims;
    const originX = coord.cx * CHUNK_SIZE_X;
    const originZ = coord.cz * CHUNK_SIZE_Z;
    const sizeX = Math.min(CHUNK_SIZE_X, dims.sizeX - originX);
    const sizeZ = Math.min(CHUNK_SIZE_Z, dims.sizeZ - originZ);
    const sizeY = dims.sizeY;

    const palette: string[] = ["air"];
    const paletteIndex = new Map<string, number>([["air", 0]]);
    const materialIndex = new Uint16Array(sizeX * sizeY * sizeZ);
    for (let lz = 0; lz < sizeZ; lz++) {
      for (let y = 0; y < sizeY; y++) {
        for (let lx = 0; lx < sizeX; lx++) {
          const material = world.terrain.materialAt(originX + lx, y, originZ + lz);
          let index = 0;
          if (material !== undefined) {
            index = paletteIndex.get(material) ?? palette.length;
            if (index === palette.length) {
              palette.push(material);
              paletteIndex.set(material, index);
            }
          }
          materialIndex[(lz * sizeY + y) * sizeX + lx] = index;
        }
      }
    }
    return {
      coord,
      sizeX,
      sizeY,
      sizeZ,
      originX,
      originZ,
      materialIndex,
      materialPalette: palette,
      revision: this.terrainRevision(coord) || this.nextRevision++,
    };
  }

  /** Full water payload for one chunk -- authoritative per-column depth and surface elevation. */
  waterChunk(world: World, coord: ChunkCoordinate): RenderChunkWater {
    const dims = world.grid.dims;
    const originX = coord.cx * CHUNK_SIZE_X;
    const originZ = coord.cz * CHUNK_SIZE_Z;
    const sizeX = Math.min(CHUNK_SIZE_X, dims.sizeX - originX);
    const sizeZ = Math.min(CHUNK_SIZE_Z, dims.sizeZ - originZ);
    const depth = new Float32Array(sizeX * sizeZ);
    const surfaceY = new Float32Array(sizeX * sizeZ);
    for (let lz = 0; lz < sizeZ; lz++) {
      for (let lx = 0; lx < sizeX; lx++) {
        const wx = originX + lx;
        const wz = originZ + lz;
        const d = world.water.depthAt(wx, wz);
        depth[lz * sizeX + lx] = d;
        surfaceY[lz * sizeX + lx] = d > 0 ? (world.water.waterSurfaceY(wx, wz) ?? 0) : 0;
      }
    }
    return { coord, sizeX, sizeZ, originX, originZ, depth, surfaceY, revision: this.waterRevision(coord) || this.nextRevision++ };
  }

  /** Hash over each cell's material identity (string hash folded per cell), in chunk-local scan order. */
  private hashTerrain(world: World, coord: ChunkCoordinate): number {
    const dims = world.grid.dims;
    const originX = coord.cx * CHUNK_SIZE_X;
    const originZ = coord.cz * CHUNK_SIZE_Z;
    const sizeX = Math.min(CHUNK_SIZE_X, dims.sizeX - originX);
    const sizeZ = Math.min(CHUNK_SIZE_Z, dims.sizeZ - originZ);
    let hash = 0x811c9dc5;
    for (let lz = 0; lz < sizeZ; lz++) {
      for (let y = 0; y < dims.sizeY; y++) {
        for (let lx = 0; lx < sizeX; lx++) {
          const material = world.terrain.materialAt(originX + lx, y, originZ + lz);
          // One char-code fold per material id; distinct ids virtually never collide per cell sequence.
          if (material !== undefined) {
            for (let c = 0; c < material.length; c++) {
              hash ^= material.charCodeAt(c);
              hash = Math.imul(hash, 0x01000193);
            }
            hash ^= 0x9e;
            hash = Math.imul(hash, 0x01000193);
          } else {
            hash ^= 0x20;
            hash = Math.imul(hash, 0x01000193);
          }
        }
      }
    }
    return (hash >>> 0) || 1;
  }

  /** Hash over quantized depths (1/1000 cell) -- see this file's doc comment. */
  private hashWater(world: World, coord: ChunkCoordinate): number {
    const dims = world.grid.dims;
    const originX = coord.cx * CHUNK_SIZE_X;
    const originZ = coord.cz * CHUNK_SIZE_Z;
    const sizeX = Math.min(CHUNK_SIZE_X, dims.sizeX - originX);
    const sizeZ = Math.min(CHUNK_SIZE_Z, dims.sizeZ - originZ);
    const quantized = new Uint32Array(sizeX * sizeZ);
    for (let lz = 0; lz < sizeZ; lz++) {
      for (let lx = 0; lx < sizeX; lx++) {
        quantized[lz * sizeX + lx] = Math.round(world.water.depthAt(originX + lx, originZ + lz) * 1000);
      }
    }
    return fnv1aBytes(quantized) || 1;
  }
}
