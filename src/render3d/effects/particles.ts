/**
 * Event particles (threejs_layer.md §5): CPU-simulated point sprites
 * triggered ONLY by real projected events/state (wood chips while a real
 * cut job works a real tree, splashes at real water entries, dust at real
 * digging). Particles are pure visual feedback -- they never carry state.
 */
import { Points, BufferGeometry, BufferAttribute, PointsNodeMaterial, AdditiveBlending } from "three/webgpu";
import { float, texture, vec4 } from "three/tsl";
import type { DataTexture } from "three";

interface Particle {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number;
  maxLife: number;
  r: number; g: number; b: number;
  size: number;
}

const MAX_PARTICLES = 2048;

export class ParticleSystem {
  private readonly points: Points;
  private readonly positions = new Float32Array(MAX_PARTICLES * 3);
  private readonly colors = new Float32Array(MAX_PARTICLES * 4);
  private readonly sizes = new Float32Array(MAX_PARTICLES);
  private readonly particles: Particle[] = [];
  private multiplier = 1;

  constructor(parent: { add(o: Points): void }, noise: DataTexture) {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(this.positions, 3));
    geometry.setAttribute("color", new BufferAttribute(this.colors, 4));
    geometry.setAttribute("aSize", new BufferAttribute(this.sizes, 1));
    const material = new PointsNodeMaterial();
    material.size = 0.12;
    material.transparent = true;
    material.depthWrite = false;
    material.blending = AdditiveBlending;
    material.opacityNode = texture(noise).r;
    this.points = new Points(geometry, material);
    this.points.frustumCulled = false;
    parent.add(this.points);
  }

  setMultiplier(m: number): void {
    this.multiplier = m;
  }

  /** Wood chips bursting off a real tree being really cut. */
  burstWoodChips(x: number, y: number, z: number): void {
    this.spawn(Math.round(3 * this.multiplier), x, y, z, {
      speed: 1.6, up: 2.2, life: 0.7, color: [0.72, 0.55, 0.3], size: 0.09, spread: 0.25,
    });
  }

  /** Splash at a real water entry. */
  burstSplash(x: number, y: number, z: number): void {
    this.spawn(Math.round(8 * this.multiplier), x, y, z, {
      speed: 1.2, up: 2.8, life: 0.55, color: [0.75, 0.88, 0.95], size: 0.1, spread: 0.35,
    });
  }

  /** Dust at a real dig/build site. */
  burstDust(x: number, y: number, z: number): void {
    this.spawn(Math.round(4 * this.multiplier), x, y, z, {
      speed: 0.9, up: 1.1, life: 0.9, color: [0.6, 0.52, 0.4], size: 0.13, spread: 0.4,
    });
  }

  private spawn(count: number, x: number, y: number, z: number, o: { speed: number; up: number; life: number; color: readonly [number, number, number]; size: number; spread: number }): void {
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
      const angle = Math.random() * Math.PI * 2;
      const speed = (0.4 + Math.random() * 0.6) * o.speed;
      this.particles.push({
        x: x + (Math.random() - 0.5) * o.spread,
        y: y + (Math.random() - 0.5) * o.spread * 0.4,
        z: z + (Math.random() - 0.5) * o.spread,
        vx: Math.cos(angle) * speed,
        vy: o.up * (0.6 + Math.random() * 0.6),
        vz: Math.sin(angle) * speed,
        life: 0,
        maxLife: o.life * (0.7 + Math.random() * 0.6),
        r: o.color[0], g: o.color[1], b: o.color[2],
        size: o.size,
      });
    }
  }

  update(dt: number): void {
    let w = 0;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i]!;
      p.life += dt;
      if (p.life >= p.maxLife) continue;
      p.vy -= 9.8 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      this.particles[w++] = p;
      const idx = w - 1;
      this.positions[idx * 3] = p.x;
      this.positions[idx * 3 + 1] = p.y;
      this.positions[idx * 3 + 2] = p.z;
      const fade = 1 - p.life / p.maxLife;
      this.colors[idx * 4] = p.r;
      this.colors[idx * 4 + 1] = p.g;
      this.colors[idx * 4 + 2] = p.b;
      this.colors[idx * 4 + 3] = fade * 0.85;
      this.sizes[idx] = p.size * (0.6 + fade * 0.6);
    }
    this.particles.length = w;
    this.points.geometry.setDrawRange(0, w);
    (this.points.geometry.attributes["position"] as BufferAttribute).needsUpdate = true;
    (this.points.geometry.attributes["color"] as BufferAttribute).needsUpdate = true;
    (this.points.geometry.attributes["aSize"] as BufferAttribute).needsUpdate = true;
  }
}
