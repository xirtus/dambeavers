/**
 * Picking (threejs_layer.md §15.1): raycasts resolve to STABLE GAME
 * IDENTIFIERS -- entity ids via instance-slot lookup tables and visual
 * registry tags, cells via terrain/water raycast against authoritative
 * geometry. Never a bare Three object with no id.
 */
import { InstancedMesh, Mesh, Raycaster, Vector2, type Camera, type Object3D } from "three/webgpu";
import type { EntityVisualRegistry } from "../entities/registry/entity-visual-registry.js";

export type PickResult =
  | { readonly type: "entity"; readonly entityId: number; readonly kind: string; readonly point: { x: number; y: number; z: number } }
  | { readonly type: "cell"; readonly x: number; readonly z: number; readonly groundY: number; readonly point: { x: number; y: number; z: number } };

export interface PickTargets {
  readonly terrainMeshes: () => Iterable<Mesh>;
  readonly waterMeshes: () => Iterable<Mesh>;
  readonly registry: EntityVisualRegistry;
  readonly treeMeshes: () => Iterable<InstancedMesh>;
  readonly logMesh: () => InstancedMesh | undefined;
}

const raycaster = new Raycaster();

export function pick(ndc: Vector2, camera: Camera, targets: PickTargets): PickResult | undefined {
  raycaster.setFromCamera(ndc, camera);

  // 1. Entities first (beaver rigs, then instanced trees/logs).
  const beaverHits: { id: number; kind: string; distance: number; point: { x: number; y: number; z: number } }[] = [];
  for (const record of targets.registry.allRecords()) {
    if (record.kind !== "beaver" && record.kind !== "corpse") continue;
    const visual = targets.registry.beaverVisual(record.id);
    if (visual === undefined) continue;
    const hits = raycaster.intersectObject(visual.group, true);
    if (hits.length > 0) {
      const hit = hits[0]!;
      beaverHits.push({ id: record.id, kind: record.kind, distance: hit.distance, point: { x: hit.point.x, y: hit.point.y, z: hit.point.z } });
    }
  }
  if (beaverHits.length > 0) {
    beaverHits.sort((a, b) => a.distance - b.distance);
    const hit = beaverHits[0]!;
    return { type: "entity", entityId: hit.id, kind: hit.kind, point: hit.point };
  }

  for (const mesh of targets.treeMeshes()) {
    const hits = raycaster.intersectObject(mesh, false);
    if (hits.length > 0 && hits[0]!.instanceId !== undefined) {
      const entityId = targets.registry.trees.entityAtInstance(mesh, hits[0]!.instanceId!);
      if (entityId !== undefined) {
        return { type: "entity", entityId, kind: "tree", point: { x: hits[0]!.point.x, y: hits[0]!.point.y, z: hits[0]!.point.z } };
      }
    }
  }
  const logMesh = targets.logMesh();
  if (logMesh !== undefined) {
    const hits = raycaster.intersectObject(logMesh, false);
    if (hits.length > 0 && hits[0]!.instanceId !== undefined) {
      const entityId = targets.registry.logs.entityAtInstance(hits[0]!.instanceId!);
      if (entityId !== undefined) {
        return { type: "entity", entityId, kind: "log", point: { x: hits[0]!.point.x, y: hits[0]!.point.y, z: hits[0]!.point.z } };
      }
    }
  }

  // 2. Terrain cells.
  const cellHits: { x: number; z: number; groundY: number; distance: number; point: { x: number; y: number; z: number } }[] = [];
  for (const mesh of targets.terrainMeshes()) {
    const hits = raycaster.intersectObject(mesh, false);
    if (hits.length > 0) {
      const hit = hits[0]!;
      const normal = hit.face?.normal ?? { x: 0, y: 1, z: 0 };
      // Step half a cell INTO the solid along the inverse face normal to find the cell.
      const cx = Math.floor(hit.point.x - normal.x * 0.5);
      const cz = Math.floor(hit.point.z - normal.z * 0.5);
      const gy = Math.floor(hit.point.y - normal.y * 0.5 + (normal.y > 0.5 ? 0 : 0.999));
      cellHits.push({ x: cx, z: cz, groundY: normal.y > 0.5 ? Math.floor(hit.point.y - 0.001) : gy, distance: hit.distance, point: { x: hit.point.x, y: hit.point.y, z: hit.point.z } });
    }
  }
  // 3. Water surface -> underlying column.
  for (const mesh of targets.waterMeshes()) {
    const hits = raycaster.intersectObject(mesh, false);
    if (hits.length > 0) {
      const hit = hits[0]!;
      cellHits.push({ x: Math.floor(hit.point.x), z: Math.floor(hit.point.z), groundY: Math.floor(hit.point.y - 0.5), distance: hit.distance + 0.01, point: { x: hit.point.x, y: hit.point.y, z: hit.point.z } });
    }
  }
  if (cellHits.length > 0) {
    cellHits.sort((a, b) => a.distance - b.distance);
    const hit = cellHits[0]!;
    return { type: "cell", x: hit.x, z: hit.z, groundY: hit.groundY, point: hit.point };
  }
  return undefined;
}
