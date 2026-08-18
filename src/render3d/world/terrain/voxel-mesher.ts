/**
 * Exposed-face voxel mesher (threejs_layer.md §8.1): emits one quad per
 * solid/empty boundary face, with Minecraft-style per-vertex ambient
 * occlusion (4 levels, with the quad-diagonal flip that avoids AO
 * anisotropy stripes). Chunk payload in -> interleaved BufferGeometry out.
 *
 * Runs as a pure function over a sampler, so it is unit-testable headless
 * (no three scene needed) and movable into a worker (R2-08) without
 * changes: the sampler interface is the whole contract.
 *
 * Output attributes:
 *  - position (3f), normal (3f), color (3f, material base color x hash variation)
 *  - ao (1f): [0.45..1] vertex occlusion brightness
 */

export interface CellSampler {
  /** True if the world cell is solid terrain. Out-of-bounds: x/z edges count as EMPTY (map edge faces render); below y=0 is SOLID (sealed floor); above sizeY-1 EMPTY (open sky). */
  isSolid(x: number, y: number, z: number): boolean;
  /** Base color [r,g,b] 0..1 for the cell's material, before per-cell variation. Undefined for empty cells. */
  colorAt(x: number, y: number, z: number): readonly [number, number, number] | undefined;
}

export interface MeshedChunk {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly colors: Float32Array;
  readonly ao: Float32Array;
  readonly indices: Uint32Array;
  readonly quadCount: number;
}

/** Deterministic per-cell hash -> [0,1), for organic color variation that is stable across rebuilds (Law R11 determinism). */
export function cellHash(x: number, y: number, z: number): number {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

const FACES: readonly {
  readonly dir: readonly [number, number, number];
  /** 4 corners, CCW seen from outside; each corner = [x,y,z] offsets + the two tangent axes used for AO */
  readonly corners: readonly (readonly [number, number, number])[];
  readonly tangent1: readonly [number, number, number];
  readonly tangent2: readonly [number, number, number];
}[] = [
  { dir: [1, 0, 0], corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], tangent1: [0, 1, 0], tangent2: [0, 0, 1] },
  { dir: [-1, 0, 0], corners: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]], tangent1: [0, 1, 0], tangent2: [0, 0, -1] },
  { dir: [0, 1, 0], corners: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]], tangent1: [1, 0, 0], tangent2: [0, 0, 1] },
  { dir: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], tangent1: [1, 0, 0], tangent2: [0, 0, 1] },
  { dir: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], tangent1: [1, 0, 0], tangent2: [0, 1, 0] },
  { dir: [0, 0, -1], corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], tangent1: [-1, 0, 0], tangent2: [0, 1, 0] },
];

const AO_BRIGHTNESS = [0.42, 0.62, 0.82, 1.0] as const;

export function meshChunk(
  sampler: CellSampler,
  originX: number,
  originZ: number,
  sizeX: number,
  sizeY: number,
  sizeZ: number,
): MeshedChunk {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const aos: number[] = [];
  const indices: number[] = [];
  let vertexCount = 0;
  let quadCount = 0;

  const solidAt = (x: number, y: number, z: number): boolean => sampler.isSolid(x, y, z);

  for (let lz = 0; lz < sizeZ; lz++) {
    for (let y = 0; y < sizeY; y++) {
      for (let lx = 0; lx < sizeX; lx++) {
        const x = originX + lx;
        const z = originZ + lz;
        const baseColor = sampler.colorAt(x, y, z);
        if (baseColor === undefined) continue;

        for (const face of FACES) {
          const nx = x + face.dir[0];
          const ny = y + face.dir[1];
          const nz = z + face.dir[2];
          if (solidAt(nx, ny, nz)) continue; // hidden face

          // Per-vertex AO: the vertex's sign along each tangent axis from
          // the face center (corner offset 0 -> -1, 1 -> +1), then sample
          // the two edge neighbors and the diagonal on the EMPTY side of
          // the face: cell + normal + s*t (never corner-offset + normal,
          // which would double-count the face axis).
          const cornerAo: number[] = [];
          for (const corner of face.corners) {
            const cx = x + corner[0];
            const cy = y + corner[1];
            const cz = z + corner[2];
            const o1x = corner[0] === 0 ? -face.tangent1[0] : face.tangent1[0];
            const o1y = corner[1] === 0 ? -face.tangent1[1] : face.tangent1[1];
            const o1z = corner[2] === 0 ? -face.tangent1[2] : face.tangent1[2];
            const o2x = corner[0] === 0 ? -face.tangent2[0] : face.tangent2[0];
            const o2y = corner[1] === 0 ? -face.tangent2[1] : face.tangent2[1];
            const o2z = corner[2] === 0 ? -face.tangent2[2] : face.tangent2[2];
            const side1 = solidAt(x + face.dir[0] + o1x, y + face.dir[1] + o1y, z + face.dir[2] + o1z);
            const side2 = solidAt(x + face.dir[0] + o2x, y + face.dir[1] + o2y, z + face.dir[2] + o2z);
            const cornerSolid = solidAt(x + face.dir[0] + o1x + o2x, y + face.dir[1] + o1y + o2y, z + face.dir[2] + o1z + o2z);
            const level = side1 && side2 ? 0 : 3 - ((side1 ? 1 : 0) + (side2 ? 1 : 0) + (cornerSolid ? 1 : 0));
            cornerAo.push(AO_BRIGHTNESS[level]!);
            positions.push(cx, cy, cz);
            normals.push(face.dir[0], face.dir[1], face.dir[2]);
            const variation = 0.94 + cellHash(x, y, z) * 0.12;
            colors.push(
              Math.min(1, baseColor[0] * variation),
              Math.min(1, baseColor[1] * variation),
              Math.min(1, baseColor[2] * variation),
            );
          }
          aos.push(cornerAo[0]!, cornerAo[1]!, cornerAo[2]!, cornerAo[3]!);

          // Flip the quad diagonal toward the brighter pair to avoid AO banding.
          const flip = cornerAo[0]! + cornerAo[2]! < cornerAo[1]! + cornerAo[3]!;
          if (flip) {
            indices.push(vertexCount + 1, vertexCount + 2, vertexCount + 3, vertexCount + 1, vertexCount + 3, vertexCount);
          } else {
            indices.push(vertexCount, vertexCount + 1, vertexCount + 2, vertexCount, vertexCount + 2, vertexCount + 3);
          }
          vertexCount += 4;
          quadCount++;
        }
      }
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    colors: new Float32Array(colors),
    ao: new Float32Array(aos),
    indices: new Uint32Array(indices),
    quadCount,
  };
}
