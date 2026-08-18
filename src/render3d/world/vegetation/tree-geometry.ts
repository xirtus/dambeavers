/**
 * Procedural tree geometry (R1 placeholder-grade-AAA: stylized but
 * crafted, per §22 "procedural placeholders until the asset gate").
 * One merged BufferGeometry per species with vertex colors and an `aWind`
 * attribute (0 = trunk, 1 = canopy) for shader wind sway. Deterministic
 * per-seed variation comes from the caller's instance transforms (never
 * baked here), so one geometry serves every instance of a species.
 *
 * Aspen: pale straight trunk, rounded fluttering crown.
 * Willow: thick gnarled trunk, broad drooping curtain canopy.
 */
import { BufferGeometry, BufferAttribute, CylinderGeometry, IcosahedronGeometry, SphereGeometry, Matrix4, Vector3 } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

function paintSolid(geometry: BufferGeometry, color: readonly [number, number, number], wind: number): BufferGeometry {
  const count = geometry.attributes["position"]!.count;
  const colors = new Float32Array(count * 3);
  const winds = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = color[0];
    colors[i * 3 + 1] = color[1];
    colors[i * 3 + 2] = color[2];
    winds[i] = wind;
  }
  geometry.setAttribute("color", new BufferAttribute(colors, 3));
  geometry.setAttribute("aWind", new BufferAttribute(winds, 1));
  return geometry;
}

function jittered(geometry: BufferGeometry, amount: number, seed: number): BufferGeometry {
  const pos = geometry.attributes["position"]!;
  for (let i = 0; i < pos.count; i++) {
    const h = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453;
    const r = h - Math.floor(h);
    const h2 = Math.sin(i * 269.5 + seed * 183.3) * 28001.8384;
    const r2 = h2 - Math.floor(h2);
    pos.setXYZ(
      i,
      pos.getX(i) + (r - 0.5) * amount,
      pos.getY(i) + (r2 - 0.5) * amount * 0.7,
      pos.getZ(i) + (r - 0.5) * amount,
    );
  }
  geometry.computeVertexNormals();
  return geometry;
}

function transformed(geometry: BufferGeometry, matrix: Matrix4): BufferGeometry {
  geometry.applyMatrix4(matrix);
  return geometry;
}

function makeMatrix(x: number, y: number, z: number, sx: number, sy: number, sz: number, ry = 0): Matrix4 {
  const m = new Matrix4();
  m.makeRotationY(ry);
  m.scale(new Vector3(sx, sy, sz));
  m.setPosition(x, y, z);
  return m;
}

const ASPEN_BARK: readonly [number, number, number] = [0.62, 0.58, 0.5];
const ASPEN_LEAF: readonly [number, number, number] = [0.34, 0.55, 0.2];
const WILLOW_BARK: readonly [number, number, number] = [0.33, 0.24, 0.15];
const WILLOW_LEAF: readonly [number, number, number] = [0.4, 0.56, 0.26];

export function buildTreeGeometry(speciesId: string): BufferGeometry {
  if (speciesId === "willow") return buildWillow();
  return buildAspen();
}

function buildAspen(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  // trunk: gently tapered, ~2.6 tall (a mature aspen ~0.3 m3 reads ~2.5-3 cells)
  const trunk = new CylinderGeometry(0.09, 0.16, 2.6, 7, 3);
  transformed(trunk, makeMatrix(0, 1.3, 0, 1, 1, 1));
  parts.push(paintSolid(trunk, ASPEN_BARK, 0));
  // crown: 4 jittered blobs clustered above the trunk
  const blobs: [number, number, number, number][] = [
    [0, 3.1, 0, 1.05],
    [0.55, 2.75, 0.3, 0.75],
    [-0.5, 2.85, -0.25, 0.7],
    [0.1, 2.6, -0.5, 0.65],
  ];
  for (const [bx, by, bz, s] of blobs) {
    const blob = new IcosahedronGeometry(s, 1);
    jittered(blob, 0.34, bx * 7 + by);
    transformed(blob, makeMatrix(bx, by, bz, 1, 0.88, 1));
    parts.push(paintSolid(blob, ASPEN_LEAF, 1));
  }
  return mergeGeometries(parts.map((p) => p.toNonIndexed()), false)!;
}

function buildWillow(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const trunk = new CylinderGeometry(0.16, 0.3, 2.0, 7, 2);
  transformed(trunk, makeMatrix(0, 1.0, 0, 1, 1, 1, 0.4));
  parts.push(paintSolid(jittered(trunk, 0.08, 3), WILLOW_BARK, 0));
  // canopy curtain: a flattened dome + drooping skirt lobes
  const dome = new SphereGeometry(1.35, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55);
  jittered(dome, 0.3, 5);
  transformed(dome, makeMatrix(0, 2.6, 0, 1.15, 0.75, 1.15));
  parts.push(paintSolid(dome, WILLOW_LEAF, 1));
  const lobeCount = 7;
  for (let i = 0; i < lobeCount; i++) {
    const angle = (i / lobeCount) * Math.PI * 2;
    const lx = Math.cos(angle) * 1.05;
    const lz = Math.sin(angle) * 1.05;
    const lobe = new SphereGeometry(0.55, 7, 6);
    jittered(lobe, 0.18, i * 13);
    transformed(lobe, makeMatrix(lx, 1.9, lz, 1, 1.5, 1));
    parts.push(paintSolid(lobe, WILLOW_LEAF, 1));
  }
  return mergeGeometries(parts.map((p) => p.toNonIndexed()), false)!;
}
