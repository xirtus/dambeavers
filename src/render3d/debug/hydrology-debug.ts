/**
 * Hydrology debug overlay (Law R10): exposes the authoritative source
 * cells beneath the pretty water -- depth heat + flow vectors, straight
 * from the WaterManager's authoritative snapshot.
 */
import { Group, Mesh, MeshBasicNodeMaterial, PlaneGeometry, BufferGeometry, BufferAttribute, LineSegments, LineBasicMaterial, Color, Vector3 } from "three/webgpu";
import { vec3 } from "three/tsl";
import type { WaterManager } from "../world/water/water-manager.js";

export class HydrologyDebugOverlay {
  private readonly group = new Group();
  private visible = false;
  private built = false;

  constructor(parent: { add(o: Group): void }) {
    parent.add(this.group);
  }

  toggle(water: WaterManager): void {
    this.visible = !this.visible;
    this.group.visible = this.visible;
    if (this.visible && !this.built) {
      this.build(water);
      this.built = true;
    }
  }

  private build(water: WaterManager): void {
    const depthPositions: number[] = [];
    const depthColors: number[] = [];
    const vectorPositions: number[] = [];
    const deep = new Color(0.1, 0.3, 0.9);
    const shallow = new Color(0.4, 0.9, 0.9);
    for (let z = 0; z < water.sizeZ; z++) {
      for (let x = 0; x < water.sizeX; x++) {
        const d = water.depthAt(x, z);
        if (d <= 0) continue;
        const surface = water.surfaceAt(x, z)!;
        const t = Math.min(1, d / 2);
        const c = shallow.clone().lerp(deep, t);
        // depth tile (thin plane just above the real surface)
        const g = new PlaneGeometry(0.9, 0.9);
        g.rotateX(-Math.PI / 2);
        g.translate(x + 0.5, surface + 0.06, z + 0.5);
        const pos = g.attributes["position"]!;
        for (let i = 0; i < pos.count; i++) {
          depthPositions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
          depthColors.push(c.r, c.g, c.b);
        }
        // flow vector from surface gradient (same derivation as the mesh attributes)
        const e = water.surfaceAt(x + 1, z) ?? surface;
        const w = water.surfaceAt(x - 1, z) ?? surface;
        const s = water.surfaceAt(x, z + 1) ?? surface;
        const n = water.surfaceAt(x, z - 1) ?? surface;
        const fx = (w - e) * 0.5;
        const fz = (n - s) * 0.5;
        const mag = Math.hypot(fx, fz);
        if (mag > 1e-4) {
          const dir = new Vector3(fx / mag, 0, fz / mag).multiplyScalar(Math.min(0.45, mag * 1.5));
          vectorPositions.push(x + 0.5, surface + 0.12, z + 0.5, x + 0.5 + dir.x, surface + 0.12, z + 0.5 + dir.z);
        }
      }
    }
    const dg = new BufferGeometry();
    dg.setAttribute("position", new BufferAttribute(new Float32Array(depthPositions), 3));
    dg.setAttribute("color", new BufferAttribute(new Float32Array(depthColors), 3));
    const dm = new MeshBasicNodeMaterial({ vertexColors: true, transparent: true, opacity: 0.5 });
    dm.colorNode = vec3(1, 1, 1);
    const depthMesh = new Mesh(dg, dm);
    this.group.add(depthMesh);

    const vg = new BufferGeometry();
    vg.setAttribute("position", new BufferAttribute(new Float32Array(vectorPositions), 3));
    const vectors = new LineSegments(vg, new LineBasicMaterial({ color: new Color(1, 0.6, 0.1) }));
    this.group.add(vectors);
    this.group.visible = false;
  }
}
