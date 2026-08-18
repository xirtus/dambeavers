/**
 * Selection highlight (threejs_layer.md §15): a crisp, readable ring +
 * marker at the selected entity/cell that tracks interpolation. Pure
 * overlay -- never gameplay state.
 */
import { Group, Mesh, MeshBasicNodeMaterial, RingGeometry, BoxGeometry, Color } from "three/webgpu";
import { vec3 } from "three/tsl";
import type { EntityVisualRegistry } from "../entities/registry/entity-visual-registry.js";

function flatMaterial(color: Color, opacity: number): MeshBasicNodeMaterial {
  const m = new MeshBasicNodeMaterial();
  m.transparent = true;
  m.opacity = opacity;
  m.depthWrite = false;
  m.colorNode = vec3(color.r, color.g, color.b);
  return m;
}

export class SelectionHighlight {
  private readonly group = new Group();
  private readonly ring: Mesh;
  private readonly cellBox: Mesh;
  private trackedEntity: number | undefined;
  private flashUntil = 0;
  private time = 0;

  constructor(parent: { add(o: Group): void }) {
    this.ring = new Mesh(new RingGeometry(0.42, 0.55, 28), flatMaterial(new Color(0.95, 0.8, 0.3), 0.9));
    this.ring.rotation.x = -Math.PI / 2;
    this.cellBox = new Mesh(new BoxGeometry(1.04, 1.04, 1.04), flatMaterial(new Color(0.95, 0.8, 0.3), 0.14));
    this.group.add(this.ring, this.cellBox);
    this.group.visible = false;
    parent.add(this.group);
  }

  showEntity(registry: EntityVisualRegistry, entityId: number): void {
    this.trackedEntity = entityId;
    this.group.visible = true;
    this.ring.visible = true;
    this.cellBox.visible = false;
    const record = registry.recordOf(entityId);
    if (record !== undefined) this.group.position.set(record.x + 0.5, record.y + 0.05, record.z + 0.5);
  }

  showCell(x: number, z: number, groundY: number): void {
    this.trackedEntity = undefined;
    this.group.visible = true;
    this.ring.visible = false;
    this.cellBox.visible = true;
    this.group.position.set(x + 0.5, groundY + 0.5, z + 0.5);
  }

  flashEntity(registry: EntityVisualRegistry, entityId: number): void {
    this.showEntity(registry, entityId);
    this.flashUntil = this.time + 0.6;
  }

  hide(): void {
    this.group.visible = false;
    this.trackedEntity = undefined;
  }

  update(registry: EntityVisualRegistry): void {
    this.time += 1 / 60;
    if (this.trackedEntity !== undefined) {
      const visual = registry.beaverVisual(this.trackedEntity);
      if (visual !== undefined) {
        this.group.position.set(visual.renderPosition.x, visual.renderPosition.y + 0.06, visual.renderPosition.z);
      } else {
        const record = registry.recordOf(this.trackedEntity);
        if (record !== undefined) this.group.position.set(record.x + 0.5, record.y + 0.05, record.z + 0.5);
      }
      const pulse = this.time < this.flashUntil ? 1.35 : 1 + Math.sin(this.time * 3.2) * 0.06;
      this.ring.scale.setScalar(pulse);
    }
  }
}
