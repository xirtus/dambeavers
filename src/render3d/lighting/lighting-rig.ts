/**
 * Sky + lighting rig (threejs_layer.md §18): an analytic gradient sky dome
 * with sun disc, a shadow-casting directional sun, and hemisphere ambient,
 * all driven by the REAL day phase from the authoritative clock (updated
 * per frame from RenderEnvironment.dayPhase -- never wall time). The sky
 * color function is shared with the water material's reflections so
 * reflected sky and actual sky always match (poseidon technique).
 */
import { DirectionalLight, HemisphereLight, Mesh, SphereGeometry, MeshBasicNodeMaterial, BackSide, Color, Vector3 } from "three/webgpu";
import { Fn, dot, float, max, mix, normalize, pow, smoothstep, uniform, positionWorld } from "three/tsl";
import type { Node } from "three/webgpu";

export function createSkyUniforms() {
  return {
    sunDir: uniform(new Vector3(0.5, 0.8, 0.3)),
    zenith: uniform(new Vector3(0.19, 0.4, 0.72)),
    horizon: uniform(new Vector3(0.78, 0.84, 0.88)),
    sunColor: uniform(new Vector3(1, 0.94, 0.82)),
    /** Scene light level [0.06 night .. 1 day] for UNLIT materials (water, foam) that must still honor the authoritative day/night cycle. */
    lightLevel: uniform(1),
  };
}

export type SkyUniforms = ReturnType<typeof createSkyUniforms>;

/** Shared analytic sky color for a world-space direction. */
export function skyColorNode(dir: Node<"vec3">, u: SkyUniforms): Node<"vec3"> {
  const t = smoothstep(float(-0.08), float(0.45), dir.y);
  const grad = mix(u.horizon, u.zenith, t);
  const sd = max(dot(dir, u.sunDir), 0);
  const disc = pow(sd, float(1400)).mul(u.sunColor).mul(6);
  const halo = pow(sd, float(6)).mul(u.sunColor).mul(0.3);
  return grad.add(disc).add(halo);
}

export interface LightingRig {
  readonly sun: DirectionalLight;
  readonly hemisphere: HemisphereLight;
  readonly skyMesh: Mesh;
  readonly skyUniforms: SkyUniforms;
  /** Push the authoritative day phase [0,1) into sun position, sky, and light intensities. */
  setDayPhase(dayPhase: number, ambientTemperature: number, centerX: number, centerZ: number): void;
}

export function createLightingRig(options: { shadowMapSize: number; mapRadius: number }): LightingRig {
  const skyUniforms = createSkyUniforms();

  const skyMaterial = new MeshBasicNodeMaterial();
  skyMaterial.side = BackSide;
  skyMaterial.fog = false;
  skyMaterial.colorNode = Fn(() => skyColorNode(normalize(positionWorld), skyUniforms))();
  const skyMesh = new Mesh(new SphereGeometry(Math.max(200, options.mapRadius * 6), 32, 16), skyMaterial);
  skyMesh.frustumCulled = false;
  skyMesh.renderOrder = -1000;

  const sun = new DirectionalLight(new Color(1, 0.96, 0.88), 3.1);
  sun.castShadow = true;
  const r = options.mapRadius;
  sun.shadow.camera.left = -r;
  sun.shadow.camera.right = r;
  sun.shadow.camera.top = r;
  sun.shadow.camera.bottom = -r;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = r * 6;
  sun.shadow.mapSize.set(options.shadowMapSize, options.shadowMapSize);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.05;

  const hemisphere = new HemisphereLight(new Color(0.5, 0.62, 0.78), new Color(0.42, 0.36, 0.28), 0.85);

  const lerp3 = (a: readonly number[], b: readonly number[], t: number): [number, number, number] => [
    a[0]! + (b[0]! - a[0]!) * t,
    a[1]! + (b[1]! - a[1]!) * t,
    a[2]! + (b[2]! - a[2]!) * t,
  ];

  return {
    sun,
    hemisphere,
    skyMesh,
    skyUniforms,
    setDayPhase(dayPhase: number, ambientTemperature: number, centerX: number, centerZ: number): void {
      // dayPhase: 0.25 dawn, 0.5 noon, 0.75 dusk (Weather.ts convention).
      const sunAngle = (dayPhase - 0.25) * Math.PI * 2;
      const elevation = Math.sin(sunAngle);
      const azimuth = sunAngle * 0.35 + 0.6;
      const planar = Math.max(0.12, Math.sqrt(Math.max(0, 1 - elevation * elevation)));
      const len = Math.hypot(Math.cos(azimuth) * planar, elevation, Math.sin(azimuth) * planar) || 1;
      const nx = (Math.cos(azimuth) * planar) / len;
      const ny = elevation / len;
      const nz = (Math.sin(azimuth) * planar) / len;
      skyUniforms.sunDir.value.set(nx, ny, nz);

      const dayFactor = Math.max(0, Math.min(1, elevation * 2.2 + 0.15));
      const duskFactor = Math.max(0, 1 - Math.abs(elevation) * 3.5) * (elevation > -0.05 ? 1 : 0);

      sun.intensity = 3.2 * dayFactor + 0.25; // the +0.25 is moonlight's floor
      sun.color.setRGB(1, 0.96 - duskFactor * 0.25, 0.88 - duskFactor * 0.38);
      sun.position.set(centerX + nx * 60, Math.max(4, ny * 60), centerZ + nz * 60);
      sun.target.position.set(centerX, 0, centerZ);
      sun.target.updateMatrixWorld();

      hemisphere.intensity = 0.32 + 0.55 * dayFactor;

      const dayZen = [0.19, 0.42, 0.74] as const;
      const nightZen = [0.015, 0.03, 0.08] as const;
      const dayHor = [0.76, 0.83, 0.88] as const;
      const nightHor = [0.04, 0.06, 0.11] as const;
      const duskHor = [0.98, 0.62, 0.36] as const;
      const zen = lerp3(nightZen, dayZen, dayFactor);
      let hor = lerp3(nightHor, dayHor, dayFactor);
      hor = lerp3(hor, duskHor, duskFactor * 0.7);
      skyUniforms.zenith.value.set(...zen);
      skyUniforms.horizon.value.set(...hor);
      const warm = duskFactor * 0.5 + (1 - dayFactor) * 0.1;
      skyUniforms.sunColor.value.set(1, 0.94 - warm * 0.3, 0.82 - warm * 0.35);
      skyUniforms.lightLevel.value = 0.1 + dayFactor * 0.9;

      hemisphere.color.setRGB(0.5 + ambientTemperature * 0.08, 0.6, 0.78 - ambientTemperature * 0.06);
    },
  };
}
