/**
 * Terrain chunk manager: owns chunk payload snapshots from the bridge,
 * (re)builds chunk meshes via the voxel mesher ONLY when a chunk's
 * authoritative revision changes (threejs_layer.md §3.2), and bakes the
 * shared water data texture (surface/depth/moisture) that terrain and
 * other materials read. Cross-chunk-border sampling goes through the
 * manager's payload map so edge faces/AO are exact.
 */
import { BufferGeometry, BufferAttribute, Mesh, DataTexture, RGBAFormat, HalfFloatType, LinearFilter } from "three";
// DataTexture's typing predates Float16Array; half-float data textures are
// the standard vehicle for HDR-ish per-column data on both backends.
import type { ChunkCoordinate, RenderChunkTerrain } from "../../../presentation/contracts/render-chunk.js";
import type { SimBridge } from "../../../presentation/bridge/sim-bridge.js";
import { meshChunk, type CellSampler } from "./voxel-mesher.js";
import { materialVisual } from "../../materials/material-visuals.js";
import { createTerrainMaterial, type TerrainMaterialHandles } from "./terrain-material.js";
import type { DataTexture as NoiseTexture } from "three";

interface TerrainChunkEntry {
  payload: RenderChunkTerrain;
  mesh: Mesh;
  revision: number;
}

function chunkKey(coord: ChunkCoordinate): string {
  return `${coord.cx},${coord.cz}`;
}

function neighborCoords(coord: ChunkCoordinate): ChunkCoordinate[] {
  return [
    { cx: coord.cx + 1, cz: coord.cz },
    { cx: coord.cx - 1, cz: coord.cz },
    { cx: coord.cx, cz: coord.cz + 1 },
    { cx: coord.cx, cz: coord.cz - 1 },
  ].filter((c) => c.cx >= 0 && c.cz >= 0);
}

export class TerrainChunkManager {
  private readonly chunks = new Map<string, TerrainChunkEntry>();
  private readonly payloads = new Map<string, RenderChunkTerrain>();
  private readonly material: TerrainMaterialHandles;
  private readonly waterDataArray: Float16Array;
  readonly waterTexture: DataTexture;
  private readonly mapSizeX: number;
  private readonly mapSizeZ: number;
  private builtOnce = false;

  constructor(
    private readonly bridge: SimBridge,
    private readonly parent: { add(mesh: Mesh): void; remove(mesh: Mesh): void },
    noise: NoiseTexture,
  ) {
    const focus = bridge.getFrame().focus;
    this.mapSizeX = focus.sizeX;
    this.mapSizeZ = focus.sizeZ;
    this.waterDataArray = new Float16Array(this.mapSizeX * this.mapSizeZ * 4);
    this.waterDataArray.fill(-1000);
    this.waterTexture = new DataTexture(this.waterDataArray as unknown as Uint8Array, this.mapSizeX, this.mapSizeZ, RGBAFormat, HalfFloatType);
    this.waterTexture.magFilter = LinearFilter;
    this.waterTexture.minFilter = LinearFilter;
    this.waterTexture.needsUpdate = true;
    this.material = createTerrainMaterial({ waterData: this.waterTexture, mapSizeX: this.mapSizeX, mapSizeZ: this.mapSizeZ, noise });
  }

  get materialHandles(): TerrainMaterialHandles {
    return this.material;
  }

  /** Live chunk meshes (picking/perf). */
  *meshes(): IterableIterator<Mesh> {
    for (const entry of this.chunks.values()) yield entry.mesh;
  }

  /** Number of live chunk meshes (debug/perf surface). */
  get chunkCount(): number {
    return this.chunks.size;
  }

  /** Rebuilds meshes for every dirty chunk coordinate in the merged frame. Two passes: store ALL payloads first (border culling/AO sample across chunk edges), then rebuild. */
  syncTerrain(dirtyCoords: readonly ChunkCoordinate[]): void {
    if (dirtyCoords.length === 0) return;
    for (const coord of dirtyCoords) {
      this.payloads.set(chunkKey(coord), this.bridge.getTerrainChunk(coord));
    }
    for (const coord of dirtyCoords) {
      const key = chunkKey(coord);
      const payload = this.payloads.get(key)!;
      const existing = this.chunks.get(key);
      if (existing !== undefined && existing.revision === payload.revision && this.builtOnce) continue;
      const mesh = this.buildMesh(payload);
      if (existing !== undefined) {
        this.parent.remove(existing.mesh);
        existing.mesh.geometry.dispose();
      }
      this.parent.add(mesh);
      this.chunks.set(key, { payload, mesh, revision: payload.revision });
    }
    // A rebuilt chunk changes the exposed faces of its neighbors along the
    // shared border: rebuild direct neighbors too when their geometry is
    // affected (cheap at this map scale, exact at any scale).
    for (const coord of dirtyCoords) {
      for (const n of neighborCoords(coord)) {
        const nKey = chunkKey(n);
        if (this.payloads.has(nKey) === false) continue;
        if (dirtyCoords.some((c) => c.cx === n.cx && c.cz === n.cz)) continue;
        const neighbor = this.chunks.get(nKey);
        if (neighbor === undefined) continue;
        const mesh = this.buildMesh(this.payloads.get(nKey)!);
        this.parent.remove(neighbor.mesh);
        neighbor.mesh.geometry.dispose();
        this.parent.add(mesh);
        this.chunks.set(nKey, { payload: this.payloads.get(nKey)!, mesh, revision: neighbor.revision });
      }
    }
    this.builtOnce = true;
  }

  /** Rebakes water surface/depth/moisture for the dirty water chunks (moisture bleeds across chunk edges by construction). */
  syncWater(dirtyCoords: readonly ChunkCoordinate[]): void {
    if (dirtyCoords.length === 0) return;
    for (const coord of dirtyCoords) {
      const water = this.bridge.getWaterChunk(coord);
      for (let lz = 0; lz < water.sizeZ; lz++) {
        for (let lx = 0; lx < water.sizeX; lx++) {
          const x = water.originX + lx;
          const z = water.originZ + lz;
          const i = (z * this.mapSizeX + x) * 4;
          const depth = water.depth[lz * water.sizeX + lx]!;
          // +1 slab-top render-space offset (see WaterManager's doc).
          this.waterDataArray[i] = depth > 0 ? water.surfaceY[lz * water.sizeX + lx]! + 1 : -1000;
          this.waterDataArray[i + 1] = depth;
        }
      }
    }
    // Moisture: for each column, max water presence within radius 5 with
    // linear falloff. Derived from the authoritative depths just written.
    for (let z = 0; z < this.mapSizeZ; z++) {
      for (let x = 0; x < this.mapSizeX; x++) {
        let moisture = 0;
        for (let dz = -5; dz <= 5; dz++) {
          for (let dx = -5; dx <= 5; dx++) {
            const nx = x + dx;
            const nz = z + dz;
            if (nx < 0 || nz < 0 || nx >= this.mapSizeX || nz >= this.mapSizeZ) continue;
            const depth = this.waterDataArray[(nz * this.mapSizeX + nx) * 4 + 1]!;
            if (depth <= 0) continue;
            const dist = Math.sqrt(dx * dx + dz * dz);
            const candidate = Math.max(0, 1 - dist / 5) * Math.min(1, depth * 2.5);
            if (candidate > moisture) moisture = candidate;
          }
        }
        this.waterDataArray[(z * this.mapSizeX + x) * 4 + 2] = moisture;
      }
    }
    this.waterTexture.needsUpdate = true;
  }

  /** Disposes every chunk mesh (load/teardown). */
  clear(): void {
    for (const entry of this.chunks.values()) {
      this.parent.remove(entry.mesh);
      entry.mesh.geometry.dispose();
    }
    this.chunks.clear();
    this.payloads.clear();
    this.builtOnce = false;
  }

  private buildMesh(payload: RenderChunkTerrain): Mesh {
    const paletteVisuals = payload.materialPalette.map((id) => materialVisual(id));
    const sampler: CellSampler = {
      isSolid: (x, y, z) => this.sampleMaterialIndex(x, y, z) > 0,
      colorAt: (x, y, z) => {
        const index = this.sampleMaterialIndex(x, y, z);
        if (index === 0) return undefined;
        const owner = this.payloadOwner(x, z);
        if (owner === undefined) return undefined;
        const visual = paletteVisualsFor(owner, this.payloads)[index];
        return visual?.color ?? [0.5, 0.44, 0.38];
      },
    };
    const meshed = meshChunk(sampler, payload.originX, payload.originZ, payload.sizeX, payload.sizeY, payload.sizeZ);

    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(meshed.positions, 3));
    geometry.setAttribute("normal", new BufferAttribute(meshed.normals, 3));
    geometry.setAttribute("color", new BufferAttribute(meshed.colors, 3));
    geometry.setAttribute("ao", new BufferAttribute(meshed.ao, 1));
    // Material class per vertex for the shader's class-driven logic.
    const classes = new Float32Array(meshed.positions.length / 3);
    let vi = 0;
    for (let lz = 0; lz < payload.sizeZ; lz++) {
      for (let y = 0; y < payload.sizeY; y++) {
        for (let lx = 0; lx < payload.sizeX; lx++) {
          const index = payload.materialIndex[(lz * payload.sizeY + y) * payload.sizeX + lx]!;
          if (index === 0) continue;
          const visual = paletteVisuals[index];
          const classId = visual?.classId ?? 0;
          // The mesher emits this cell's exposed faces in face order; we
          // can't recover the count here, so recompute exposure directly.
          const x = payload.originX + lx;
          const z = payload.originZ + lz;
          const exposed = exposedFaceCount(sampler, x, y, z);
          for (let q = 0; q < exposed * 4; q++) {
            classes[vi++] = classId;
          }
        }
      }
    }
    geometry.setAttribute("aMat", new BufferAttribute(classes, 1));
    geometry.setIndex(new BufferAttribute(meshed.indices, 1));
    geometry.computeBoundingSphere();

    const mesh = new Mesh(geometry, this.material.material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    return mesh;
  }

  /** Material palette index at a world cell, across chunk borders. 0 = empty/outside. */
  private sampleMaterialIndex(x: number, y: number, z: number): number {
    const owner = this.payloadOwner(x, z);
    if (owner === undefined) return 0;
    if (y < 0 || y >= owner.sizeY) return 0;
    const lx = x - owner.originX;
    const lz = z - owner.originZ;
    return owner.materialIndex[(lz * owner.sizeY + y) * owner.sizeX + lx]!;
  }

  private payloadOwner(x: number, z: number): RenderChunkTerrain | undefined {
    const cx = Math.floor(x / 16);
    const cz = Math.floor(z / 16);
    return this.payloads.get(`${cx},${cz}`);
  }
}

function paletteVisualsFor(payload: RenderChunkTerrain, payloads: Map<string, RenderChunkTerrain>) {
  const live = payloads.get(`${payload.coord.cx},${payload.coord.cz}`) ?? payload;
  return live.materialPalette.map((id) => materialVisual(id));
}

const FACE_DIRS = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
] as const;

function exposedFaceCount(sampler: CellSampler, x: number, y: number, z: number): number {
  let count = 0;
  for (const dir of FACE_DIRS) {
    if (!sampler.isSolid(x + dir[0], y + dir[1], z + dir[2])) count++;
  }
  return count;
}
