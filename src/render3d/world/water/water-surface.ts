/**
 * Water surface geometry (threejs_layer.md §9): built ONLY from
 * authoritative per-column water facts (Law §9.1 -- never painted into dry
 * columns). Three honest pieces per wet column:
 *
 *  - SURFACE quads at the real surface elevation, corner heights averaged
 *    across the 4 columns sharing each corner (visual smoothing of real
 *    state; Law R4);
 *  - FALL CURTAINS where a wet column's surface stands > threshold above
 *    its downstream neighbor's surface (real hydraulic drop);
 *  - EDGE SKIRTS where a wet column borders a dry column whose ground lies
 *    below the surface -- the pond's visible "wall of water" at shorelines
 *    and dam faces, so water reads volumetric, never as a floating sheet.
 *
 * Per-vertex attributes carry the authoritative facts the material shades
 * from: aDepth (column depth), aFlow (gradient-derived flow dir*speed),
 * aFoam (real gradient/obstruction foam factor).
 *
 * Pure geometry module (no three scene graph) -- headless-testable.
 */

export interface WaterField2D {
  readonly sizeX: number;
  readonly sizeZ: number;
  /** Authoritative depth at column (0 = dry). */
  depthAt(x: number, z: number): number;
  /** Authoritative surface elevation at column (undefined if dry). */
  surfaceAt(x: number, z: number): number | undefined;
  /** Terrain floor (surfaceY) at column, for skirt bottoms. */
  floorAt(x: number, z: number): number;
}

export interface WaterMeshData {
  readonly surface: {
    readonly positions: Float32Array;
    readonly depth: Float32Array;
    readonly flow: Float32Array;
    readonly foam: Float32Array;
    readonly indices: Uint32Array;
  };
  readonly curtains: {
    readonly positions: Float32Array;
    readonly depth: Float32Array;
    readonly flow: Float32Array;
    readonly foam: Float32Array;
    readonly indices: Uint32Array;
    /** 1 for fall curtains (streaky foam), 0 for edge skirts (murky body). */
    readonly kind: Float32Array;
  };
  readonly wetColumns: number;
}

const FALL_THRESHOLD = 0.32;

interface ColumnFacts {
  depth: number;
  surface: number;
}

function factsAt(field: WaterField2D, x: number, z: number): ColumnFacts | undefined {
  if (x < 0 || z < 0 || x >= field.sizeX || z >= field.sizeZ) return undefined;
  const depth = field.depthAt(x, z);
  if (depth <= 0) return undefined;
  const surface = field.surfaceAt(x, z);
  if (surface === undefined) return undefined;
  return { depth, surface };
}

/** Corner height = average of the wet columns sharing corner (cx, cz) in column-corner space. Falls back to the column's own surface. */
function cornerHeight(field: WaterField2D, cornerX: number, cornerZ: number, fallback: number): number {
  let sum = 0;
  let count = 0;
  for (let dz = -1; dz <= 0; dz++) {
    for (let dx = -1; dx <= 0; dx++) {
      const f = factsAt(field, cornerX + dx, cornerZ + dz);
      if (f !== undefined) {
        sum += f.surface;
        count++;
      }
    }
  }
  return count === 0 ? fallback : sum / count;
}

/** Gradient-derived flow (water runs down the surface slope) at a column, from authoritative neighbor surfaces. */
function flowAt(field: WaterField2D, x: number, z: number): { fx: number; fz: number; magnitude: number } {
  const here = factsAt(field, x, z);
  if (here === undefined) return { fx: 0, fz: 0, magnitude: 0 };
  const east = factsAt(field, x + 1, z)?.surface ?? here.surface;
  const west = factsAt(field, x - 1, z)?.surface ?? here.surface;
  const south = factsAt(field, x, z + 1)?.surface ?? here.surface;
  const north = factsAt(field, x, z - 1)?.surface ?? here.surface;
  const gx = (west - east) * 0.5;
  const gz = (north - south) * 0.5;
  const magnitude = Math.hypot(gx, gz);
  if (magnitude < 1e-5) return { fx: 0, fz: 1, magnitude: 0 };
  return { fx: gx / magnitude, fz: gz / magnitude, magnitude };
}

/** Obstruction foam: a solid bank/obstacle rising toward the surface beside a wet column churns it. */
function obstructionFoam(field: WaterField2D, x: number, z: number, surface: number): number {
  let foam = 0;
  const neighbors = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const;
  for (const [dx, dz] of neighbors) {
    const nx = x + dx;
    const nz = z + dz;
    if (nx < 0 || nz < 0 || nx >= field.sizeX || nz >= field.sizeZ) continue;
    if (factsAt(field, nx, nz) !== undefined) continue; // wet neighbor: no wall
    const floor = field.floorAt(nx, nz);
    if (floor + 1 > surface - 0.15) foam = Math.max(foam, 0.85);
  }
  return foam;
}

export function buildWaterMesh(field: WaterField2D): WaterMeshData {
  const sPos: number[] = [];
  const sDepth: number[] = [];
  const sFlow: number[] = [];
  const sFoam: number[] = [];
  const sIdx: number[] = [];
  const cPos: number[] = [];
  const cDepth: number[] = [];
  const cFlow: number[] = [];
  const cFoam: number[] = [];
  const cKind: number[] = [];
  const cIdx: number[] = [];
  let sVerts = 0;
  let cVerts = 0;
  let wetColumns = 0;

  for (let z = 0; z < field.sizeZ; z++) {
    for (let x = 0; x < field.sizeX; x++) {
      const facts = factsAt(field, x, z);
      if (facts === undefined) continue;
      wetColumns++;
      const { depth, surface } = facts;
      const flow = flowAt(field, x, z);
      const foamBase = Math.min(1, flow.magnitude * 2.4) * 0.8 + obstructionFoam(field, x, z, surface);
      // Shore foam: only a narrow very-shallow band, and only where some
      // real current runs (a still pond edge laps gently, it does not boil).
      const shoreFoam = depth < 0.2 ? (0.2 - depth) * 3.5 * Math.min(1, 0.25 + flow.magnitude * 4) : 0;
      const foam = Math.min(1, foamBase + shoreFoam);

      // -- surface quad (corners averaged across real wet neighbors) --
      const h00 = cornerHeight(field, x, z, surface);
      const h01 = cornerHeight(field, x, z + 1, surface);
      const h11 = cornerHeight(field, x + 1, z + 1, surface);
      const h10 = cornerHeight(field, x + 1, z, surface);
      sPos.push(x, h00, z, x, h01, z + 1, x + 1, h11, z + 1, x + 1, h10, z);
      for (let i = 0; i < 4; i++) {
        sDepth.push(depth);
        sFlow.push(flow.fx * Math.min(1, flow.magnitude * 3), flow.fz * Math.min(1, flow.magnitude * 3));
        sFoam.push(foam);
      }
      sIdx.push(sVerts, sVerts + 1, sVerts + 2, sVerts, sVerts + 2, sVerts + 3);
      sVerts += 4;

      // -- fall curtains + edge skirts per horizontal neighbor --
      const dirs = [
        { dx: 1, dz: 0, edge: [ [x + 1, z], [x + 1, z + 1] ] as const },
        { dx: -1, dz: 0, edge: [ [x, z + 1], [x, z] ] as const },
        { dx: 0, dz: 1, edge: [ [x + 1, z + 1], [x, z + 1] ] as const },
        { dx: 0, dz: -1, edge: [ [x, z], [x + 1, z] ] as const },
      ];
      for (const { dx, dz, edge } of dirs) {
        const nx = x + dx;
        const nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= field.sizeX || nz >= field.sizeZ) continue;
        const neighbor = factsAt(field, nx, nz);
        if (neighbor !== undefined) {
          // Fall curtain: my surface well above my neighbor's surface.
          // Emit only from the HIGHER side (each pair handled once).
          const drop = surface - neighbor.surface;
          if (drop > FALL_THRESHOLD) {
            const topH0 = cornerHeight(field, edge[0][0], edge[0][1], surface);
            const topH1 = cornerHeight(field, edge[1][0], edge[1][1], surface);
            const bottom = neighbor.surface;
            cPos.push(
              edge[0][0], topH0, edge[0][1],
              edge[1][0], topH1, edge[1][1],
              edge[1][0], bottom, edge[1][1],
              edge[0][0], bottom, edge[0][1],
            );
            for (let i = 0; i < 4; i++) {
              cDepth.push(depth);
              cFlow.push(dx * 1.2, dz * 1.2);
              cFoam.push(1);
              cKind.push(1);
            }
            cIdx.push(cVerts, cVerts + 1, cVerts + 2, cVerts, cVerts + 2, cVerts + 3);
            cVerts += 4;
          }
        } else {
          // Dry neighbor whose floor sits below my surface: skirt down to its floor.
          const floor = field.floorAt(nx, nz);
          if (surface - floor > 0.06) {
            const topH0 = cornerHeight(field, edge[0][0], edge[0][1], surface);
            const topH1 = cornerHeight(field, edge[1][0], edge[1][1], surface);
            cPos.push(
              edge[0][0], topH0, edge[0][1],
              edge[1][0], topH1, edge[1][1],
              edge[1][0], floor, edge[1][1],
              edge[0][0], floor, edge[0][1],
            );
            for (let i = 0; i < 4; i++) {
              cDepth.push(Math.max(0.3, depth));
              cFlow.push(dx * 0.15, dz * 0.15);
              cFoam.push(0.12);
              cKind.push(0);
            }
            cIdx.push(cVerts, cVerts + 1, cVerts + 2, cVerts, cVerts + 2, cVerts + 3);
            cVerts += 4;
          }
        }
      }
    }
  }

  return {
    surface: {
      positions: new Float32Array(sPos),
      depth: new Float32Array(sDepth),
      flow: new Float32Array(sFlow),
      foam: new Float32Array(sFoam),
      indices: new Uint32Array(sIdx),
    },
    curtains: {
      positions: new Float32Array(cPos),
      depth: new Float32Array(cDepth),
      flow: new Float32Array(cFlow),
      foam: new Float32Array(cFoam),
      indices: new Uint32Array(cIdx),
      kind: new Float32Array(cKind),
    },
    wetColumns,
  };
}
