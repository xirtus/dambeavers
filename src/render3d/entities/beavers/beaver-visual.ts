/**
 * Beaver visual controller (threejs_layer.md §11): one articulated
 * procedural rig per stable beaver id (7 beavers -> individual rigs are
 * the right fidelity; crowd LOD is R5-12). Every pose/motion is driven by
 * the projected RenderActivity (itself a projection of REAL components);
 * position interpolates between authoritative cells (Law R4) and never
 * feeds back.
 *
 * The rig: plump body, head w/ snout+ears+eyes, flat leathery tail, four
 * paddling feet. Animations are hand-tuned procedural gaits keyed by
 * activity; a subtle breathing/idle layer always runs.
 */
import { Group, Mesh, MeshStandardNodeMaterial, CapsuleGeometry, SphereGeometry, BoxGeometry, Vector3, Color } from "three/webgpu";
import { float, Fn, mix, positionGeometry, sin, texture, vec3, vertexColor } from "three/tsl";
import type { DataTexture } from "three";
import type { RenderActivity, RenderEntityRecord } from "../../../presentation/contracts/render-entity.js";

export interface BeaverPalette {
  readonly fur: Color;
  readonly belly: Color;
  readonly tail: Color;
  readonly dark: Color;
}

const FUR = new Color(0.42, 0.29, 0.17);
const BELLY = new Color(0.55, 0.42, 0.28);
const TAIL = new Color(0.23, 0.16, 0.1);
const DARK = new Color(0.05, 0.04, 0.03);

function furMaterial(noise: DataTexture): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial();
  material.colorNode = Fn(() => {
    const fuzz = texture(noise, positionGeometry.xy.mul(3.1)).g;
    return vec3(FUR.r, FUR.g, FUR.b).mul(float(0.85).add(fuzz.mul(0.3)));
  })();
  material.roughnessNode = float(0.95);
  return material;
}

function flatMaterial(color: Color, roughness = 0.9): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial();
  material.colorNode = vec3(color.r, color.g, color.b);
  material.roughnessNode = float(roughness);
  return material;
}

export class BeaverVisual {
  readonly group = new Group();
  private readonly body = new Group();
  private readonly head = new Group();
  private readonly tailMesh: Mesh;
  private readonly feet: Mesh[] = [];
  private readonly carryAnchor = new Group();
  private activity: RenderActivity = "idle";
  private activityTime = 0;
  private heading = 0;
  private targetHeading = 0;
  /** Current rendered position (interpolated between authoritative cells). */
  readonly renderPosition = new Vector3();
  private fromCell = new Vector3();
  private toCell = new Vector3();
  private blend = 1;
  private readonly seed: number;

  constructor(readonly entityId: number, noise: DataTexture) {
    this.seed = (entityId * 2654435761 % 1000) / 1000;
    const fur = furMaterial(noise);
    const belly = flatMaterial(BELLY);
    const tailMat = flatMaterial(TAIL, 0.72);
    const dark = flatMaterial(DARK, 0.4);

    // Body: plump capsule, beaver proportions (~0.9 long).
    const bodyMesh = new Mesh(new CapsuleGeometry(0.26, 0.42, 6, 12), fur);
    bodyMesh.rotation.x = Math.PI / 2;
    bodyMesh.position.y = 0.34;
    bodyMesh.castShadow = true;
    this.body.add(bodyMesh);
    const bellyMesh = new Mesh(new CapsuleGeometry(0.22, 0.36, 6, 10), belly);
    bellyMesh.rotation.x = Math.PI / 2;
    bellyMesh.position.set(0, 0.28, 0.02);
    this.body.add(bellyMesh);

    // Head: rounded, slight snout, ears, bead eyes, orange incisors hint.
    const headMesh = new Mesh(new SphereGeometry(0.17, 12, 10), fur);
    headMesh.scale.set(1, 0.92, 1.05);
    headMesh.castShadow = true;
    this.head.add(headMesh);
    const snout = new Mesh(new SphereGeometry(0.09, 10, 8), fur);
    snout.position.set(0, -0.03, 0.16);
    snout.scale.set(0.9, 0.75, 1.1);
    this.head.add(snout);
    const nose = new Mesh(new SphereGeometry(0.028, 8, 6), dark);
    nose.position.set(0, 0.005, 0.25);
    this.head.add(nose);
    for (const side of [-1, 1]) {
      const ear = new Mesh(new SphereGeometry(0.045, 8, 6), fur);
      ear.position.set(side * 0.1, 0.13, -0.02);
      ear.scale.set(1, 1, 0.6);
      this.head.add(ear);
      const eye = new Mesh(new SphereGeometry(0.022, 8, 6), dark);
      eye.position.set(side * 0.09, 0.045, 0.13);
      this.head.add(eye);
    }
    const teeth = new Mesh(new BoxGeometry(0.035, 0.035, 0.012), flatMaterial(new Color(0.85, 0.55, 0.2), 0.5));
    teeth.position.set(0, -0.075, 0.23);
    this.head.add(teeth);
    this.head.position.set(0, 0.48, 0.32);
    this.body.add(this.head);

    // Tail: the signature paddle.
    this.tailMesh = new Mesh(new BoxGeometry(0.2, 0.045, 0.42), tailMat);
    this.tailMesh.position.set(0, 0.24, -0.5);
    this.tailMesh.castShadow = true;
    this.body.add(this.tailMesh);

    // Feet.
    for (const [fx, fz] of [[-0.14, 0.22], [0.14, 0.22], [-0.15, -0.18], [0.15, -0.18]] as const) {
      const foot = new Mesh(new SphereGeometry(0.055, 8, 6), dark);
      foot.scale.set(1, 0.6, 1.3);
      foot.position.set(fx, 0.06, fz);
      this.body.add(foot);
      this.feet.push(foot);
    }

    this.carryAnchor.position.set(0, 0.32, 0.42);
    this.body.add(this.carryAnchor);
    this.group.add(this.body);
  }

  /** Where a carried item's visual should attach (mouth/chest carry). */
  getCarryAnchor(): Group {
    return this.carryAnchor;
  }

  /** New authoritative state: retarget interpolation (never teleport). */
  applyRecord(record: RenderEntityRecord, tickSeconds: number): void {
    const next = new Vector3(record.x + 0.5, record.y, record.z + 0.5);
    if (!next.equals(this.toCell)) {
      this.fromCell.copy(this.renderPosition.lengthSq() === 0 ? next : this.renderPosition);
      if (this.renderPosition.lengthSq() === 0) this.fromCell.copy(next);
      this.toCell.copy(next);
      this.blend = 0;
      const dx = next.x - this.fromCell.x;
      const dz = next.z - this.fromCell.z;
      if (Math.abs(dx) + Math.abs(dz) > 0.01) {
        this.targetHeading = Math.atan2(dx, dz);
      }
    }
    if (record.activity !== this.activity) {
      this.activity = record.activity;
      this.activityTime = 0;
    }
    this.tickSeconds = tickSeconds;
  }

  private tickSeconds = 1 / 20;

  /** Per-render-frame update: interpolation + procedural animation. */
  update(dt: number, visualTime: number): void {
    this.blend = Math.min(1, this.blend + dt / Math.max(0.001, this.tickSeconds));
    const t = this.blend * this.blend * (3 - 2 * this.blend);
    this.renderPosition.lerpVectors(this.fromCell, this.toCell, t);
    this.group.position.copy(this.renderPosition);

    // Heading smoothing (shortest arc).
    let delta = this.targetHeading - this.heading;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    this.heading += delta * Math.min(1, dt * 7);
    this.group.rotation.y = this.heading;

    this.activityTime += dt;
    this.animate(dt, visualTime);
  }

  private animate(dt: number, time: number): void {
    const t = time + this.seed * 10;
    const a = this.activity;
    const body = this.body;
    // Reset baseline each frame (animations compose from a neutral pose).
    body.position.set(0, 0, 0);
    body.rotation.set(0, 0, 0);
    body.scale.set(1, 1, 1);
    this.head.rotation.set(0, 0, 0);

    // Breathing always runs.
    const breath = 1 + Math.sin(t * 2.1) * 0.015;
    body.scale.set(breath, 1 / Math.sqrt(breath), breath);

    switch (a) {
      case "walking":
      case "hauling": {
        const speed = a === "hauling" ? 6.5 : 8.5;
        const phase = t * speed;
        body.position.y = Math.abs(Math.sin(phase)) * 0.045;
        body.rotation.z = Math.sin(phase * 0.5) * 0.05;
        this.tailMesh.rotation.x = 0.35 + Math.sin(phase * 0.5) * 0.1;
        for (let i = 0; i < this.feet.length; i++) {
          this.feet[i]!.position.y = 0.06 + Math.max(0, Math.sin(phase + (i % 2) * Math.PI + (i > 1 ? 0.6 : 0))) * 0.06;
        }
        if (a === "hauling") {
          this.head.rotation.x = -0.22; // head up, log in mouth
        }
        break;
      }
      case "swimming": {
        body.position.y = -0.16;
        body.rotation.x = 0.1;
        this.tailMesh.rotation.y = Math.sin(t * 4.2) * 0.4; // sculling
        this.tailMesh.rotation.x = 0.15;
        this.head.rotation.x = -0.12;
        break;
      }
      case "cutting-tree": {
        const gnaw = Math.sin(t * 14);
        body.rotation.x = -0.28 + gnaw * 0.04; // reared up against the trunk
        body.position.y = 0.1;
        this.head.rotation.x = 0.35 + gnaw * 0.18;
        this.tailMesh.rotation.x = 0.5;
        break;
      }
      case "building":
      case "digging": {
        const paw = Math.sin(t * 9);
        body.rotation.x = -0.12;
        this.head.rotation.x = 0.25 + paw * 0.1;
        body.position.y = Math.abs(paw) * 0.02;
        break;
      }
      case "eating": {
        body.rotation.x = -0.1;
        this.head.rotation.x = 0.42 + Math.sin(t * 6) * 0.06; // nibbling
        this.head.rotation.y = Math.sin(t * 0.7) * 0.15;
        break;
      }
      case "drinking": {
        body.rotation.x = -0.06;
        this.head.rotation.x = 0.55 + Math.sin(t * 2.2) * 0.05;
        break;
      }
      case "sleeping": {
        body.rotation.z = 0.9; // curled on side
        body.position.y = -0.08;
        const slowBreath = 1 + Math.sin(t * 0.9) * 0.03;
        body.scale.set(slowBreath, 1 / Math.sqrt(slowBreath), slowBreath);
        this.tailMesh.rotation.x = 0.1;
        break;
      }
      case "dead": {
        body.rotation.z = Math.PI / 2;
        body.position.y = -0.12;
        body.scale.set(1, 1, 1);
        break;
      }
      case "crafting":
      case "burying":
      case "idle":
      default: {
        // Idle: look around, occasional tail slap.
        this.head.rotation.y = Math.sin(t * 0.45) * 0.5 + Math.sin(t * 1.3) * 0.12;
        const slap = Math.max(0, Math.sin(t * 0.8 + 2)) > 0.985 ? Math.sin(t * 18) * 0.3 : 0;
        this.tailMesh.rotation.x = 0.2 + slap;
        break;
      }
    }
  }
}
