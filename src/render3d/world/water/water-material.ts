/**
 * Water materials (TSL; WebGPU + WebGL2). All macro state (surface height,
 * depth, flow hints, foam from real gradients/obstructions) arrives as
 * geometry attributes baked from the authoritative WaterField; the shader
 * adds ONLY micro-motion (Law §9.3: "visual micro-motion may be synthetic;
 * macro hydraulic state may not be").
 *
 * Shading follows poseidon's ocean: fresnel blends the depth-absorbed body
 * against the SHARED analytic sky (lighting-rig.skyColorNode), a sun-glint
 * disc sparkles, foam is shaded as a near-Lambertian surface (never flat
 * paint), noise breaks up foam/ripples at two scrolling, flow-aligned
 * scales. The curtain variant adds downward-streaking fall foam and murky
 * skirt walls.
 */
import { MeshBasicNodeMaterial, DoubleSide, type DataTexture } from "three/webgpu";
import {
  Fn,
  abs,
  attribute,
  cameraPosition,
  dot,
  float,
  max,
  mix,
  normalize,
  positionGeometry,
  positionLocal,
  positionWorld,
  pow,
  reflect,
  saturate,
  sin,
  cos,
  smoothstep,
  texture,
  varying,
  vec2,
  vec3,
} from "three/tsl";
import { skyColorNode, type SkyUniforms } from "../../lighting/lighting-rig.js";
import type { VisualClock } from "../../materials/visual-clock.js";

export interface WaterMaterialOptions {
  readonly sky: SkyUniforms;
  readonly noise: DataTexture;
  /** Shared visual clock uniform (pinned in deterministic mode). */
  readonly timeU: VisualClock;
  readonly deepColor: readonly [number, number, number];
  readonly shallowColor: readonly [number, number, number];
}

export function createWaterSurfaceMaterial(options: WaterMaterialOptions): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial();
  material.side = DoubleSide;
  material.transparent = true;
  material.depthWrite = false;

  const aDepth = attribute("aDepth", "float" as const);
  const aFlow = attribute("aFlow", "vec2" as const);
  const aFoam = attribute("aFoam", "float" as const);
  const vDepth = varying(aDepth);
  const vFlow = varying(aFlow);
  const vFoam = varying(aFoam);

  const t = options.timeU;

  // Micro-bob: tiny, synthetic, visual-only. (positionLocal, not
  // positionGeometry: positionNode REPLACES positionLocal post-instancing,
  // so always compose on top of it.)
  material.positionNode = Fn(() => {
    const bob = sin(t.mul(1.4).add(positionGeometry.x.mul(0.9))).mul(cos(t.mul(1.1).add(positionGeometry.z.mul(0.8)))).mul(0.022);
    const lap = sin(t.mul(2.3).add(positionGeometry.x.mul(2.2)).add(positionGeometry.z.mul(1.7))).mul(0.012);
    return positionLocal.add(vec3(0, bob.add(lap), 0));
  })();

  material.colorNode = Fn(() => {
    const depthCells = vDepth;
    const flowSpeed = saturate(vFlow.length().mul(2));

    // -- ripple normal: two flow-aligned scrolling noise reads --
    const scroll1 = vFlow.mul(t.mul(0.4));
    const scroll2 = vFlow.mul(t.mul(-0.27));
    const drift = vec2(t.mul(0.014), t.mul(0.011));
    const r1 = texture(options.noise, positionWorld.xz.mul(0.38).add(scroll1).add(drift)).rg.sub(0.5);
    const r2 = texture(options.noise, positionWorld.xz.mul(1.1).add(scroll2).sub(drift.mul(1.7))).rg.sub(0.5);
    const rippleStrength = float(0.1).add(flowSpeed.mul(0.32));
    const ripple = r1.add(r2.mul(0.55)).mul(rippleStrength);
    const N = normalize(vec3(ripple.x, 1, ripple.y));

    // -- body: Beer-Lambert absorption along the view ray's water path --
    // shallow cell edges stay glassy-bright, real depth goes dark teal.
    const V = normalize(cameraPosition.sub(positionWorld));
    const viewFlat = saturate(float(1).sub(abs(V.y)).mul(1.4));
    const pathLength = depthCells.mul(float(1).add(viewFlat.mul(2.2)));
    const absorb = float(1).sub(float(2.71828).pow(pathLength.mul(-1.35)));
    const shallow = vec3(options.shallowColor[0], options.shallowColor[1], options.shallowColor[2]);
    const deep = vec3(options.deepColor[0], options.deepColor[1], options.deepColor[2]);
    const body = mix(shallow, deep, absorb);

    // -- fresnel sky reflection --
    const fresnel = float(0.02).add(float(0.98).mul(pow(float(1).sub(max(dot(N, V), 0)), 5)));
    const R = reflect(V.negate(), N);
    const reflection = skyColorNode(normalize(vec3(R.x, max(abs(R.y), 0.03), R.z)), options.sky);

    // -- sun glint --
    const sunSpec = pow(max(dot(R, options.sky.sunDir), 0), 700).mul(2.0);

    const water0 = mix(body, reflection, saturate(fresnel.mul(0.92)));
    let water = water0.add(options.sky.sunColor.mul(sunSpec)).mul(0.98);

    // -- foam: real gradients/obstructions (vFoam) + shorelines (shallow), noise-broken, lambertian-shaded --
    const fNoise1 = texture(options.noise, positionWorld.xz.mul(0.85).sub(scroll1.mul(1.4))).r;
    const fNoise2 = texture(options.noise, positionWorld.xz.mul(2.1).add(drift.mul(2.2))).g;
    const foamMask = smoothstep(float(0.52), float(0.9), vFoam.mul(fNoise1.mul(0.75).add(fNoise2.mul(0.45)).add(0.14)));
    const foamLight = float(0.5).add(saturate(dot(N, options.sky.sunDir)).mul(0.45));
    const foamColor = vec3(0.88, 0.94, 0.95).mul(foamLight);
    water = mix(water, foamColor, foamMask);
    return water.mul(options.sky.lightLevel);
  })();

  // colorNode above computes RGB; alpha via separate node keeps it legible.
  material.opacityNode = Fn(() => {
    const depth = saturate(vDepth.div(2.2));
    const absorb = float(1).sub(float(2.71828).pow(depth.mul(-3.4)));
    const fNoise1 = texture(options.noise, positionWorld.xz.mul(0.85)).r;
    const foamMask = smoothstep(float(0.42), float(0.78), vFoam.mul(fNoise1.mul(0.9).add(0.3)));
    return saturate(mix(float(0.68), float(0.96), absorb).add(foamMask.mul(0.3)));
  })();

  return material;
}

export function createWaterCurtainMaterial(options: WaterMaterialOptions): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial();
  material.side = DoubleSide;
  material.transparent = true;
  material.depthWrite = false;

  const aFlow = attribute("aFlow", "vec2" as const);
  const aFoam = attribute("aFoam", "float" as const);
  const aKind = attribute("aKind", "float" as const);
  const vFlow = varying(aFlow);
  const vFoam = varying(aFoam);
  const vKind = varying(aKind);

  const t = options.timeU;

  material.colorNode = Fn(() => {
    // Falls: streaks race DOWN the curtain (uv.y = world Y), flow leans them.
    const along = positionWorld.x.mul(abs(vFlow.x)).add(positionWorld.z.mul(abs(vFlow.y)));
    const streaks = texture(options.noise, vec2(along.mul(1.6), positionWorld.y.mul(0.5).sub(t.mul(0.9)))).rg;
    const streaks2 = texture(options.noise, vec2(along.mul(3.4).add(0.4), positionWorld.y.mul(1.1).sub(t.mul(1.6)))).g;
    const fallFoam = saturate(streaks.r.mul(1.15).add(streaks2.mul(0.65))).mul(vFoam);

    const bodyDeep = vec3(options.deepColor[0], options.deepColor[1], options.deepColor[2]);
    const bodyShallow = vec3(options.shallowColor[0], options.shallowColor[1], options.shallowColor[2]);
    // Skirts (vKind=0): murky body. Falls (vKind=1): aerated white-green.
    const skirt = mix(bodyDeep.mul(0.75), bodyShallow.mul(0.9), 0.35);
    const fall = mix(bodyShallow.mul(1.12), vec3(0.94, 0.98, 0.99), fallFoam);
    return mix(skirt, fall, vKind).mul(options.sky.lightLevel);
  })();

  material.opacityNode = Fn(() => {
    return mix(float(0.9), float(0.96), vKind).mul(saturate(vFoam.add(0.55)));
  })();

  return material;
}
