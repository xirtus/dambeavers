/**
 * Water manager: owns the full-map authoritative water snapshot (filled
 * from bridge water chunks), rebuilds surface/curtain meshes when water
 * revisions change, and exposes the debug overlay data (wet source cells
 * beneath the pretty water -- Law R10).
 *
 * RENDER-SPACE MAPPING: the sim measures a column's water surface as
 * floor + depth, where "floor" is the topmost SOLID cell's index. Rendered
 * terrain slabs span [y, y+1], so the solid surface a creature stands on
 * is at floor+1 -- and the water rests ON that slab: render surface =
 * floor + 1 + depth. The +1 is purely the cell-geometry boundary mapping
 * (a cell OCCUPIES [y, y+1]); depths, flow, and presence are untouched
 * authoritative facts.
 */
import { BufferGeometry, BufferAttribute, Mesh } from "three";
import type { ChunkCoordinate } from "../../../presentation/contracts/render-chunk.js";
import type { SimBridge } from "../../../presentation/bridge/sim-bridge.js";
import { buildWaterMesh, type WaterField2D } from "./water-surface.js";
import { createWaterSurfaceMaterial, createWaterCurtainMaterial, type WaterMaterialOptions } from "./water-material.js";

export class WaterManager implements WaterField2D {
  private readonly depths: Float32Array;
  private readonly surfaces: Float32Array;
  private readonly floors: Float32Array;
  readonly sizeX: number;
  readonly sizeZ: number;
  private surfaceMesh: Mesh | undefined;
  private curtainMesh: Mesh | undefined;
  private readonly surfaceMaterial;
  private readonly curtainMaterial;
  private waterRevisionSeen = new Map<string, number>();

  constructor(
    private readonly bridge: SimBridge,
    private readonly parent: { add(mesh: Mesh): void; remove(mesh: Mesh): void },
    options: WaterMaterialOptions,
  ) {
    const focus = bridge.getFrame().focus;
    this.sizeX = focus.sizeX;
    this.sizeZ = focus.sizeZ;
    this.depths = new Float32Array(this.sizeX * this.sizeZ);
    this.surfaces = new Float32Array(this.sizeX * this.sizeZ);
    this.floors = new Float32Array(this.sizeX * this.sizeZ);
    this.surfaceMaterial = createWaterSurfaceMaterial(options);
    this.curtainMaterial = createWaterCurtainMaterial(options);
  }

  depthAt(x: number, z: number): number {
    return this.depths[z * this.sizeX + x] ?? 0;
  }

  surfaceAt(x: number, z: number): number | undefined {
    const d = this.depths[z * this.sizeX + x] ?? 0;
    return d > 0 ? this.surfaces[z * this.sizeX + x]! : undefined;
  }

  floorAt(x: number, z: number): number {
    return this.floors[z * this.sizeX + x] ?? 0;
  }

  /** Refresh the full-map snapshot from the bridge for dirty chunks; rebuild meshes if any changed. */
  sync(dirtyCoords: readonly ChunkCoordinate[]): void {
    if (dirtyCoords.length === 0) return;
    let anyChange = false;
    for (const coord of dirtyCoords) {
      const key = `${coord.cx},${coord.cz}`;
      const chunk = this.bridge.getWaterChunk(coord);
      if (this.waterRevisionSeen.get(key) === chunk.revision) continue;
      this.waterRevisionSeen.set(key, chunk.revision);
      anyChange = true;
      for (let lz = 0; lz < chunk.sizeZ; lz++) {
        for (let lx = 0; lx < chunk.sizeX; lx++) {
          const x = chunk.originX + lx;
          const z = chunk.originZ + lz;
          const i = z * this.sizeX + x;
          this.depths[i] = chunk.depth[lz * chunk.sizeX + lx]!;
          this.surfaces[i] = chunk.surfaceY[lz * chunk.sizeX + lx]! + 1; // slab-top offset (see class doc)
        }
      }
    }
    if (!anyChange) return;
    // Floors from terrain: recomputed lazily here from the terrain chunks
    // (top solid cell per column) so skirts reach the real ground.
    for (let z = 0; z < this.sizeZ; z++) {
      for (let x = 0; x < this.sizeX; x++) {
        this.floors[z * this.sizeX + x] = this.computeFloor(x, z);
      }
    }
    this.rebuild();
  }

  private computeFloor(x: number, z: number): number {
    // The terrain chunk payload holds the full column; find top solid.
    const coord = { cx: Math.floor(x / 16), cz: Math.floor(z / 16) };
    const terrain = this.bridge.getTerrainChunk(coord);
    const lx = x - terrain.originX;
    const lz = z - terrain.originZ;
    for (let y = terrain.sizeY - 1; y >= 0; y--) {
      if (terrain.materialIndex[(lz * terrain.sizeY + y) * terrain.sizeX + lx]! > 0) return y + 1; // slab top (see class doc)
    }
    return 0;
  }

  private rebuild(): void {
    const data = buildWaterMesh(this);
    if (this.surfaceMesh !== undefined) {
      this.parent.remove(this.surfaceMesh);
      this.surfaceMesh.geometry.dispose();
    }
    if (this.curtainMesh !== undefined) {
      this.parent.remove(this.curtainMesh);
      this.curtainMesh.geometry.dispose();
    }
    if (data.wetColumns === 0) {
      this.surfaceMesh = undefined;
      this.curtainMesh = undefined;
      return;
    }
    const sg = new BufferGeometry();
    sg.setAttribute("position", new BufferAttribute(data.surface.positions, 3));
    sg.setAttribute("aDepth", new BufferAttribute(data.surface.depth, 1));
    sg.setAttribute("aFlow", new BufferAttribute(data.surface.flow, 2));
    sg.setAttribute("aFoam", new BufferAttribute(data.surface.foam, 1));
    sg.setIndex(new BufferAttribute(data.surface.indices, 1));
    sg.computeBoundingSphere();
    this.surfaceMesh = new Mesh(sg, this.surfaceMaterial);
    this.surfaceMesh.renderOrder = 10;
    this.surfaceMesh.receiveShadow = true;

    const cg = new BufferGeometry();
    cg.setAttribute("position", new BufferAttribute(data.curtains.positions, 3));
    cg.setAttribute("aDepth", new BufferAttribute(data.curtains.depth, 1));
    cg.setAttribute("aFlow", new BufferAttribute(data.curtains.flow, 2));
    cg.setAttribute("aFoam", new BufferAttribute(data.curtains.foam, 1));
    cg.setAttribute("aKind", new BufferAttribute(data.curtains.kind, 1));
    cg.setIndex(new BufferAttribute(data.curtains.indices, 1));
    cg.computeBoundingSphere();
    this.curtainMesh = new Mesh(cg, this.curtainMaterial);
    this.curtainMesh.renderOrder = 11;

    this.parent.add(this.surfaceMesh);
    this.parent.add(this.curtainMesh);
  }

  /** Pickable water meshes (surface only -- curtains are decoration). */
  *pickMeshes(): IterableIterator<Mesh> {
    if (this.surfaceMesh !== undefined) yield this.surfaceMesh;
  }

  clear(): void {
    if (this.surfaceMesh) {
      this.parent.remove(this.surfaceMesh);
      this.surfaceMesh.geometry.dispose();
      this.surfaceMesh = undefined;
    }
    if (this.curtainMesh) {
      this.parent.remove(this.curtainMesh);
      this.curtainMesh.geometry.dispose();
      this.curtainMesh = undefined;
    }
    this.waterRevisionSeen = new Map();
    this.depths.fill(0);
  }
}
