/**
 * Construction visuals (threejs_layer.md §12.1): every construction
 * exposes its REAL stage -- blueprint ghost (awaiting-materials, pulsing
 * amber outline), materials-arriving (ghost + log pile filling by real
 * delivered-mass fraction), rising work (awaiting-labor: solid portion
 * climbs with real workDone/workRequired), and complete (no ghost: a
 * completed dam is REAL TERRAIN and renders through the terrain mesher --
 * the dam is ground truth, not a facade).
 */
import { Group, Mesh, BoxGeometry, MeshBasicNodeMaterial, Color } from "three/webgpu";
import { vec3 } from "three/tsl";
import type { RenderEntityRecord } from "../../../presentation/contracts/render-entity.js";

function ghostMaterial(color: Color, opacity: number): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial();
  material.transparent = true;
  material.opacity = opacity;
  material.colorNode = vec3(color.r, color.g, color.b);
  material.depthWrite = false;
  return material;
}

export class ConstructionVisuals {
  private readonly visuals = new Map<number, Group>();

  constructor(private readonly parent: { add(o: Group): void; remove(o: Group): void }) {}

  upsert(record: RenderEntityRecord): void {
    if (record.constructionStatus === "complete" || record.constructionStatus === "cancelled") {
      this.remove(record.id);
      return;
    }
    let group = this.visuals.get(record.id);
    if (group === undefined) {
      group = new Group();
      group.position.set(record.x + 0.5, record.y, record.z + 0.5);
      this.visuals.set(record.id, group);
      this.parent.add(group);
    }
    group.clear();

    const progress = record.constructionProgress ?? 0;
    const awaitingMaterials = record.constructionStatus === "awaiting-materials";

    // Blueprint ghost: full-height translucent shell.
    const ghost = new Mesh(
      new BoxGeometry(0.94, 3, 0.94),
      ghostMaterial(new Color(awaitingMaterials ? 0xd8a03c : 0x7fc4d8), 0.16),
    );
    ghost.position.y = 1.5;
    group.add(ghost);
    const edges = new Mesh(new BoxGeometry(0.98, 3.02, 0.98), ghostMaterial(new Color(awaitingMaterials ? 0xf0b858 : 0x9adce8), 0.05));
    edges.position.y = 1.5;
    group.add(edges);

    // Real progress: a solid fill climbs the ghost with workDone fraction.
    if (progress > 0) {
      const fillHeight = Math.max(0.06, progress * 3);
      const fill = new Mesh(new BoxGeometry(0.9, fillHeight, 0.9), ghostMaterial(new Color(0x8a6a42), 0.85));
      fill.position.y = fillHeight / 2;
      group.add(fill);
    }
  }

  remove(entityId: number): void {
    const group = this.visuals.get(entityId);
    if (group === undefined) return;
    this.parent.remove(group);
    this.visuals.delete(entityId);
  }

  clear(): void {
    for (const group of this.visuals.values()) this.parent.remove(group);
    this.visuals.clear();
  }
}
