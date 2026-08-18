/**
 * Terrain material (TSL, runs on WebGPU + WebGL2): vertex-color base x AO,
 * class-driven surface logic --
 *   soil tops: grass whose lushness follows REAL moisture (baked from the
 *     authoritative water field into a data texture by the chunk manager);
 *   stone: geological strata banding;
 *   everything: wetness darkening + gloss when at/below the REAL local
 *     water surface (Law R5: derived from authoritative water state).
 *
 * Class masks are arithmetic (1 - min(abs(classId - k), 1)) so integer
 * class ids match exactly without TSL bool-node gymnastics.
 */
import { MeshStandardNodeMaterial, type DataTexture } from "three/webgpu";
import {
  Fn,
  abs,
  attribute,
  float,
  max,
  min,
  mix,
  normalWorld,
  positionWorld,
  saturate,
  smoothstep,
  texture,
  uniform,
  vec2,
  vec3,
  vertexColor,
} from "three/tsl";

export interface TerrainMaterialHandles {
  readonly material: MeshStandardNodeMaterial;
  /** R: surfaceY (-1000 = dry), G: depth, B: moisture [0,1], A: spare. sizeX x sizeZ, half float. */
  readonly waterData: DataTexture;
}

// Integer class-id mask: exactly 1 when the attribute equals `classId`.

export function createTerrainMaterial(options: {
  waterData: DataTexture;
  mapSizeX: number;
  mapSizeZ: number;
  noise: DataTexture;
}): TerrainMaterialHandles {
  const material = new MeshStandardNodeMaterial();
  material.vertexColors = true;

  const ao = attribute("ao", "float" as const);
  const aMat = attribute("aMat", "float" as const);
  const mapSize = uniform(vec2(options.mapSizeX, options.mapSizeZ));
  const isSoil = float(1).sub(min(abs(aMat.sub(1)), 1));
  const isStone = float(1).sub(min(abs(aMat.sub(2)), 1));
  

  const waterSample = Fn(() => {
    const uvw = vec2(positionWorld.x.add(0.5).div(mapSize.x), positionWorld.z.add(0.5).div(mapSize.y));
    return texture(options.waterData, uvw);
  });

  const isTop = saturate(normalWorld.y);

  const baseColor = Fn(() => {
    const vColor = vec3(vertexColor(0));
    const grain = texture(options.noise, positionWorld.xz.mul(0.35)).g;
    const mottle = texture(options.noise, positionWorld.xz.mul(0.045)).b;
    const detail = vColor.mul(float(0.9).add(grain.mul(0.2)).add(mottle.sub(0.5).mul(0.14)));

    const moisture = waterSample().b;
    const dryGrass = vec3(0.34, 0.44, 0.17);
    const lushGrass = vec3(0.12, 0.47, 0.15);
    const grassNoise = texture(options.noise, positionWorld.xz.mul(0.13)).r;
    const grass = mix(dryGrass, lushGrass, saturate(moisture.mul(1.6).add(grassNoise.sub(0.5).mul(0.3))));
    const soilResult = mix(detail, grass, isTop.mul(isSoil));

    const band = float(0.86).add(float(0.14).mul(smoothstep(0.3, 0.7, positionWorld.y.mod(3).div(3))));
    const withStone = mix(soilResult, soilResult.mul(band), isStone);
    // wood (dam cells): horizontal log courses -- dark gaps every ~1/3 cell
    const course = float(0.78).add(float(0.22).mul(smoothstep(0.12, 0.3, positionWorld.y.mul(3).mod(1))));
    const isWood = float(1).sub(min(abs(aMat.sub(3)), 1));
    return mix(withStone, withStone.mul(course), isWood);
  });

  const wetness = Fn(() => {
    const water = waterSample();
    const hasWater = smoothstep(-600, -400, water.r); // 1 where any water recorded
    const belowLine = smoothstep(water.r.add(0.55), water.r.sub(0.05), positionWorld.y);
    const shoreWet = saturate(water.b.mul(1.25).sub(0.12)).mul(smoothstep(water.r.add(1.1), water.r.add(0.1), positionWorld.y));
    return hasWater.mul(saturate(belowLine.add(shoreWet.mul(0.65))));
  });

  material.colorNode = Fn(() => {
    const base = baseColor();
    const wet = wetness();
    const wetColor = base.mul(vec3(0.52, 0.55, 0.58));
    return mix(base, wetColor, wet).mul(ao);
  })();

  material.roughnessNode = Fn(() => {
    const withStone = mix(float(0.93), float(0.82), isStone);
    return mix(withStone, float(0.45), wetness().mul(0.85));
  })();

  material.metalnessNode = float(0);

  return { material, waterData: options.waterData };
}
