/**
 * Colony camera (threejs_layer.md §14.1): orbit/pan/zoom with smooth
 * damping, cursor-centric zoom, keyboard pan, pitch limits, and a follow
 * mode that glides from watershed overview to one beaver's shoulder
 * without losing context. Camera state is presentation-only.
 */
import { PerspectiveCamera, Vector3 } from "three/webgpu";

export interface CameraInput {
  panX: number;
  panZ: number;
  rotate: number;
  pitch: number;
  zoomDelta: number;
  pointerNdc?: { x: number; y: number };
}

export class CameraController {
  readonly camera: PerspectiveCamera;
  target = new Vector3(20.5, 8, 30.5);
  private smoothedTarget = new Vector3(20.5, 8, 30.5);
  private distance = 34;
  private smoothedDistance = 34;
  private yaw = 0.8;
  private smoothedYaw = 0.8;
  private pitch = 0.72;
  private smoothedPitch = 0.72;
  private followGetter: (() => Vector3 | undefined) | undefined;

  constructor(aspect: number) {
    this.camera = new PerspectiveCamera(46, aspect, 0.1, 1200);
  }

  get minDistance(): number {
    return 2.2;
  }
  get maxDistance(): number {
    return 220;
  }

  follow(getter: (() => Vector3 | undefined) | undefined): void {
    this.followGetter = getter;
  }

  get following(): boolean {
    return this.followGetter !== undefined;
  }

  stopFollow(): void {
    this.followGetter = undefined;
  }

  update(dt: number, input: CameraInput): void {
    const followPos = this.followGetter?.();
    if (followPos !== undefined) {
      this.target.copy(followPos);
    } else {
      // Pan in view space.
      const panSpeed = this.smoothedDistance * 0.9;
      const forward = new Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      const right = new Vector3(-forward.z, 0, forward.x);
      this.target.addScaledVector(right, input.panX * panSpeed * dt);
      this.target.addScaledVector(forward, -input.panZ * panSpeed * dt);
    }
    this.yaw += input.rotate * dt * 2.2;
    this.pitch = Math.max(0.12, Math.min(1.45, this.pitch + input.pitch * dt * 1.6));

    if (input.zoomDelta !== 0) {
      const factor = Math.pow(1.18, -input.zoomDelta);
      this.distance = Math.max(this.minDistance, Math.min(this.maxDistance, this.distance * factor));
    }

    const k = 1 - Math.exp(-dt * 9);
    this.smoothedTarget.lerp(this.target, k);
    this.smoothedDistance += (this.distance - this.smoothedDistance) * k;
    this.smoothedYaw += (this.yaw - this.smoothedYaw) * k;
    this.smoothedPitch += (this.pitch - this.smoothedPitch) * k;

    const cp = this.smoothedPitch;
    const cy = this.smoothedYaw;
    const d = this.smoothedDistance;
    const offset = new Vector3(Math.sin(cy) * Math.cos(cp), Math.sin(cp), Math.cos(cy) * Math.cos(cp)).multiplyScalar(d);
    this.camera.position.copy(this.smoothedTarget).add(offset);
    this.camera.lookAt(this.smoothedTarget);
  }

  /** Smoothly recenters on a world point, keeping current orientation. */
  focusOn(point: Vector3): void {
    this.target.copy(point);
  }

  /** Drag-pan by pixel deltas, ground-plane projected. */
  dragPan(movementX: number, movementY: number): void {
    const scale = this.smoothedDistance * 0.0016;
    const dx = -movementX * scale;
    const dz = -movementY * scale;
    const cos = Math.cos(this.yaw);
    const sin = Math.sin(this.yaw);
    this.target.x += dx * -cos + dz * -sin;
    this.target.z += dx * sin + dz * -cos;
    this.stopFollow();
  }

  /** Hard-set for deterministic capture mode (Law R11 fixed camera). */
  setPose(target: Vector3, distance: number, yaw: number, pitch: number): void {
    this.target.copy(target);
    this.smoothedTarget.copy(target);
    this.distance = distance;
    this.smoothedDistance = distance;
    this.yaw = yaw;
    this.smoothedYaw = yaw;
    this.pitch = pitch;
    this.smoothedPitch = pitch;
    this.update(0.0001, { panX: 0, panZ: 0, rotate: 0, pitch: 0, zoomDelta: 0 });
  }
}
