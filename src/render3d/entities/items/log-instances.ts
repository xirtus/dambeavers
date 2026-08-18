/**
 * Physical log visuals (threejs_layer.md §13): one InstancedMesh, slot <->
 * stable log entity id. A log being CARRIED (real Held component) is
 * removed from the ground pool and parented to its carrier's mouth anchor
 * -- the same stable id, a different visual ownership (§11.4). Mass scales
 * the log's girth (real massKg).
 */
import { InstancedMesh, Matrix4, Mesh, MeshStandardNodeMaterial, Quaternion, Vector3, CylinderGeometry, Group } from "three/webgpu";
import { float, vec3 } from "three/tsl";
import type { RenderEntityRecord } from "../../../presentation/contracts/render-entity.js";

const MAX_LOGS = 1024;

function logGeometry(): CylinderGeometry {
  const geometry = new CylinderGeometry(0.09, 0.1, 0.85, 9, 1);
  geometry.rotateX(Math.PI / 2); // lie along +z for heading alignment
  return geometry;
}

function logMaterial(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial();
  material.colorNode = vec3(0.4, 0.27, 0.15);
  material.roughnessNode = float(0.85);
  return material;
}

export class LogInstanceSystem {
  private pool: InstancedMesh | undefined;
  private readonly slotToEntity: (number | undefined)[] = new Array(MAX_LOGS).fill(undefined);
  private readonly entityToSlot = new Map<number, number>();
  private readonly freeSlots: number[] = [];
  private readonly carried = new Map<number, Mesh>();
  private readonly dummyMatrix = new Matrix4();

  constructor(private readonly parent: { add(o: InstancedMesh): void; remove(o: InstancedMesh): void }) {
    for (let i = MAX_LOGS - 1; i >= 0; i--) this.freeSlots.push(i);
  }

  entityAtInstance(instanceId: number): number | undefined {
    return this.slotToEntity[instanceId];
  }

  poolMesh(): InstancedMesh | undefined {
    return this.pool;
  }

  isCarried(entityId: number): boolean {
    return this.carried.has(entityId);
  }

  /** Reconcile one log's visual with its authoritative record. `resolveCarrier` returns the carrier's anchor if the log is held. */
  upsert(record: RenderEntityRecord, resolveCarrier: (beaverId: number) => Group | undefined): void {
    if (record.heldBy !== undefined) {
      this.removeFromPool(record.id);
      let mesh = this.carried.get(record.id);
      if (mesh === undefined) {
        mesh = new Mesh(logGeometry(), logMaterial());
        mesh.castShadow = true;
        const s = this.scaleForMass(record.massKg);
        mesh.scale.set(s, s, 1);
        this.carried.set(record.id, mesh);
      }
      const anchor = resolveCarrier(record.heldBy);
      if (anchor !== undefined && mesh.parent !== anchor) {
        anchor.add(mesh);
        mesh.position.set(0, 0.02, 0.05);
        mesh.rotation.set(0, 0, 0);
      }
      return;
    }
    // Lying in the world (or freshly dropped).
    const carriedMesh = this.carried.get(record.id);
    if (carriedMesh !== undefined) {
      carriedMesh.removeFromParent();
      this.carried.delete(record.id);
    }
    let slot = this.entityToSlot.get(record.id);
    if (slot === undefined) {
      slot = this.freeSlots.pop();
      if (slot === undefined) return;
      this.entityToSlot.set(record.id, slot);
      this.slotToEntity[slot] = record.id;
      this.ensurePool();
    }
    const s = this.scaleForMass(record.massKg);
    const rot = (record.id * 2.399963) % (Math.PI * 2);
    this.dummyMatrix.compose(
      new Vector3(record.x + 0.5, record.y + 0.09 * s, record.z + 0.5),
      new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), rot),
      new Vector3(s, s, 0.7 + s * 0.3),
    );
    this.pool!.setMatrixAt(slot, this.dummyMatrix);
    this.pool!.count = Math.max(this.pool!.count, slot + 1);
    this.pool!.instanceMatrix.needsUpdate = true;
  }

  remove(entityId: number): void {
    const mesh = this.carried.get(entityId);
    if (mesh !== undefined) {
      mesh.removeFromParent();
      this.carried.delete(entityId);
    }
    this.removeFromPool(entityId);
  }

  private removeFromPool(entityId: number): void {
    const slot = this.entityToSlot.get(entityId);
    if (slot === undefined || this.pool === undefined) return;
    this.entityToSlot.delete(entityId);
    this.slotToEntity[slot] = undefined;
    this.freeSlots.push(slot);
    this.dummyMatrix.makeScale(0, 0, 0);
    this.pool.setMatrixAt(slot, this.dummyMatrix);
    this.pool.instanceMatrix.needsUpdate = true;
  }

  clear(): void {
    for (const mesh of this.carried.values()) mesh.removeFromParent();
    this.carried.clear();
    this.entityToSlot.clear();
    this.slotToEntity.fill(undefined);
    this.freeSlots.length = 0;
    for (let i = MAX_LOGS - 1; i >= 0; i--) this.freeSlots.push(i);
    if (this.pool !== undefined) {
      this.parent.remove(this.pool);
      this.pool.geometry.dispose();
      this.pool = undefined;
    }
  }

  private scaleForMass(massKg: number | undefined): number {
    const mass = massKg ?? 12;
    return Math.max(0.45, Math.min(1.6, Math.cbrt(mass / 14)));
  }

  private ensurePool(): void {
    if (this.pool !== undefined) return;
    this.pool = new InstancedMesh(logGeometry(), logMaterial(), MAX_LOGS);
    this.pool.castShadow = true;
    this.pool.receiveShadow = true;
    this.pool.count = 0;
    this.pool.frustumCulled = false;
    this.parent.add(this.pool);
  }
}
