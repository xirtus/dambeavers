/**
 * Instanced tree pools (threejs_layer.md §24): one InstancedMesh per
 * species with DENSE swap-back slot compaction -- instance slot <-> stable
 * tree entity id, always resolvable (Law R2). Growth (real ageTicks ->
 * growthFraction) scales the instance; health (real Plant.health) tints it
 * through an instanced `aHealth` attribute (lush -> stressed amber ->
 * dying rust). Wind sway is shader-side micro-motion only (Law R4).
 */
import { InstancedMesh, InstancedBufferAttribute, Matrix4, MeshStandardNodeMaterial, Quaternion, Vector3 } from "three/webgpu";
import { Fn, attribute, float, mix, positionGeometry, positionLocal, sin, cos, varying, vec3, vertexColor } from "three/tsl";
import type { RenderEntityRecord } from "../../../presentation/contracts/render-entity.js";
import { buildTreeGeometry } from "./tree-geometry.js";
import type { VisualClock } from "../../materials/visual-clock.js";

const MAX_INSTANCES_PER_SPECIES = 4096;

interface SpeciesPool {
  readonly mesh: InstancedMesh;
  readonly health: InstancedBufferAttribute;
  /** Per-instance deterministic variation keyed to the STABLE ENTITY ID (never the slot index -- slots reshuffle under swap-back and reload, and Law R8/R11 demand identical visuals from identical state). */
  readonly jitter: InstancedBufferAttribute;
  readonly slotToEntity: number[];
  readonly entityToSlot: Map<number, number>;
}

export class TreeInstanceSystem {
  private readonly pools = new Map<string, SpeciesPool>();
  private readonly clockU: VisualClock;
  private readonly dummyMatrix = new Matrix4();
  private readonly dummyQuat = new Quaternion();
  private readonly up = new Vector3(0, 1, 0);

  constructor(private readonly parent: { add(mesh: InstancedMesh): void; remove(mesh: InstancedMesh): void }, clockU: VisualClock) {
    this.clockU = clockU;
  }

  get treeCount(): number {
    let total = 0;
    for (const pool of this.pools.values()) total += pool.mesh.count;
    return total;
  }

  /** Live species pool meshes (picking/perf). */
  *meshes(): IterableIterator<InstancedMesh> {
    for (const pool of this.pools.values()) yield pool.mesh;
  }

  entityAtInstance(speciesMesh: InstancedMesh, instanceId: number): number | undefined {
    for (const pool of this.pools.values()) {
      if (pool.mesh === speciesMesh) return pool.slotToEntity[instanceId];
    }
    return undefined;
  }

  upsert(record: RenderEntityRecord): void {
    const speciesId = record.speciesId ?? "aspen";
    const pool = this.poolFor(speciesId);
    let slot = pool.entityToSlot.get(record.id);
    if (slot === undefined) {
      if (pool.mesh.count >= MAX_INSTANCES_PER_SPECIES) return; // LOD aggregation is R4/R10 work
      slot = pool.mesh.count;
      pool.mesh.count++;
      pool.entityToSlot.set(record.id, slot);
      pool.slotToEntity[slot] = record.id;
    }
    const growth = Math.max(0.12, record.growthFraction ?? 1);
    const health = record.healthFraction ?? 1;
    // Deterministic per-entity rotation/squat from the stable id.
    const rot = (record.id * 2.399963) % (Math.PI * 2);
    const squat = 0.85 + ((record.id * 7919) % 100) / 400;
    this.dummyQuat.setFromAxisAngle(this.up, rot);
    this.dummyMatrix.compose(
      new Vector3(record.x + 0.5, record.y, record.z + 0.5),
      this.dummyQuat,
      new Vector3(squat * (0.45 + growth * 0.55), growth, squat * (0.45 + growth * 0.55)),
    );
    pool.mesh.setMatrixAt(slot, this.dummyMatrix);
    pool.mesh.instanceMatrix.needsUpdate = true;
    pool.health.setX(slot, health);
    pool.health.needsUpdate = true;
    pool.jitter.setX(slot, ((record.id * 2654435761) % 1000) / 1000);
    pool.jitter.needsUpdate = true;
  }

  remove(entityId: number): void {
    for (const pool of this.pools.values()) {
      const slot = pool.entityToSlot.get(entityId);
      if (slot === undefined) continue;
      // Swap-back: move the LAST live instance into the freed slot so the pool stays dense.
      const lastSlot = pool.mesh.count - 1;
      const lastEntity = pool.slotToEntity[lastSlot]!;
      if (slot !== lastSlot) {
        pool.mesh.getMatrixAt(lastSlot, this.dummyMatrix);
        pool.mesh.setMatrixAt(slot, this.dummyMatrix);
        pool.health.setX(slot, pool.health.getX(lastSlot));
        pool.jitter.setX(slot, pool.jitter.getX(lastSlot));
        pool.slotToEntity[slot] = lastEntity;
        pool.entityToSlot.set(lastEntity, slot);
      }
      pool.mesh.count--;
      pool.slotToEntity.length = pool.mesh.count;
      pool.entityToSlot.delete(entityId);
      pool.mesh.instanceMatrix.needsUpdate = true;
      pool.health.needsUpdate = true;
      pool.jitter.needsUpdate = true;
      return;
    }
  }

  clear(): void {
    for (const pool of this.pools.values()) {
      this.parent.remove(pool.mesh);
      pool.mesh.geometry.dispose();
    }
    this.pools.clear();
  }

  private poolFor(speciesId: string): SpeciesPool {
    const existing = this.pools.get(speciesId);
    if (existing !== undefined) return existing;
    const geometry = buildTreeGeometry(speciesId);
    const health = new InstancedBufferAttribute(new Float32Array(MAX_INSTANCES_PER_SPECIES).fill(1), 1);
    geometry.setAttribute("aHealth", health);
    const jitter = new InstancedBufferAttribute(new Float32Array(MAX_INSTANCES_PER_SPECIES), 1);
    geometry.setAttribute("aJitter", jitter);
    const material = createTreeMaterial(this.clockU);
    const mesh = new InstancedMesh(geometry, material, MAX_INSTANCES_PER_SPECIES);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.count = 0;
    mesh.frustumCulled = false; // instances span the whole map; three can't cull per-instance
    const pool: SpeciesPool = { mesh, health, jitter, slotToEntity: [], entityToSlot: new Map() };
    this.pools.set(speciesId, pool);
    this.parent.add(mesh);
    return pool;
  }
}

function createTreeMaterial(clockU: VisualClock): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial();
  material.vertexColors = true;
  const aWind = attribute("aWind", "float" as const);
  // Wind: canopy verts only. IMPORTANT: positionNode must ADD to
  // positionLocal (which already holds instanceMatrix * positionGeometry
  // for InstancedMesh) -- returning a node built from positionGeometry
  // alone would REPLACE the instanced position and collapse every tree to
  // the origin. Visual-only micro-motion (Law R4).
  material.positionNode = Fn(() => {
    const phase = positionGeometry.x.add(positionGeometry.z);
    const swayX = sin(clockU.mul(1.3).add(phase)).mul(0.05);
    const swayZ = cos(clockU.mul(0.9).add(phase.mul(1.3))).mul(0.04);
    const heightFactor = positionGeometry.y.mul(0.4).max(0);
    return positionLocal.add(vec3(swayX, 0, swayZ).mul(aWind).mul(heightFactor));
  })();
  // Explicit varyings: overriding positionNode drops the automatic
  // vertex->fragment carry of attributes, so we carry what we need.
  const vColor = varying(vec3(vertexColor(0)), "vTreeColor");
  const aHealth = attribute("aHealth", "float" as const);
  const vHealth = varying(aHealth, "vTreeHealth");
  const vInstJitter = varying(attribute("aJitter", "float" as const), "vTreeJitter");
  material.colorNode = Fn(() => {
    // health: 1 = species-true; stressed -> amber; dying -> rust-brown
    const stress = float(1).sub(vHealth);
    const tint = mix(vec3(1, 1, 1), vec3(1.25, 0.72, 0.3), stress.mul(0.85));
    // per-instance hue drift so the forest never reads as copies
    const hueShift = vInstJitter.sub(0.5).mul(0.22);
    const jittered = vColor.add(vec3(hueShift.mul(0.6), hueShift, hueShift.mul(-0.35)));
    return jittered.mul(tint);
  })();
  material.roughnessNode = float(0.88);
  return material;
}
