/**
 * Headless acceptance test for P1-02 — Water volume.
 *
 * Roadmap acceptance test (DAMN_BEAVERS_MASTER_ROADMAP.md, P1-02):
 *   "adding a known water volume to a closed basin produces the expected
 *   water depth within tolerance."
 *
 * "Closed basin" is built here directly via `WorldGrid` (a bowl: flat
 * interior floor ringed by higher walls) -- there is no watershed-shaped
 * basin-detection system yet (that's a real hydrology/terrain-analysis
 * feature nothing has asked for), and `fillBasin` itself is a static
 * geometry calculation (P1-02's scope), not a flow/time simulation
 * (P1-03's job, not yet built).
 */
import { describe, expect, it } from "vitest";
import { EntityIdRegistry } from "../../src/sim/core/EntityId.js";
import { WorldGrid } from "../../src/sim/world/WorldGrid.js";
import { WaterField, fillBasin } from "../../src/sim/hydrology/WaterField.js";

const SIZE_X = 21;
const SIZE_Y = 12;
const SIZE_Z = 21;
const INTERIOR_FLOOR = 2;
const WALL_FLOOR = 9;
/** interior columns: x,z in [2, SIZE_X-3] / [2, SIZE_Z-3] */
const INTERIOR_MIN = 2;
const INTERIOR_MAX_X = SIZE_X - 3;
const INTERIOR_MAX_Z = SIZE_Z - 3;
const INTERIOR_COLUMN_COUNT = (INTERIOR_MAX_X - INTERIOR_MIN + 1) * (INTERIOR_MAX_Z - INTERIOR_MIN + 1);

function buildClosedBasin(): WorldGrid {
  const entities = new EntityIdRegistry();
  const grid = new WorldGrid({ sizeX: SIZE_X, sizeY: SIZE_Y, sizeZ: SIZE_Z }, entities);
  for (let x = 0; x < SIZE_X; x++) {
    for (let z = 0; z < SIZE_Z; z++) {
      const isWall = x < INTERIOR_MIN || x > INTERIOR_MAX_X || z < INTERIOR_MIN || z > INTERIOR_MAX_Z;
      const floor = isWall ? WALL_FLOOR : INTERIOR_FLOOR;
      for (let y = 0; y <= floor; y++) grid.setSolid(x, y, z, true);
    }
  }
  return grid;
}

describe("P1-02 acceptance: a known water volume added to a closed basin produces the expected depth", () => {
  it("holds for several different known volumes, within tolerance", () => {
    const testCases = [
      { volumeDepth: 1, tolerance: 0.05 },
      { volumeDepth: 4, tolerance: 0.05 },
      { volumeDepth: 6.5, tolerance: 0.1 },
    ];

    for (const { volumeDepth, tolerance } of testCases) {
      const grid = buildClosedBasin();
      const field = new WaterField(grid);
      const knownVolume = INTERIOR_COLUMN_COUNT * volumeDepth;

      const result = fillBasin(field, { x: 10, z: 10 }, knownVolume, { volumeTolerance: tolerance / 10 });

      // -- the expected depth, within tolerance, everywhere in the basin --
      const expectedSurface = INTERIOR_FLOOR + volumeDepth;
      expect(Math.abs(result.surfaceElevation - expectedSurface)).toBeLessThanOrEqual(tolerance);
      for (let x = INTERIOR_MIN; x <= INTERIOR_MAX_X; x += 3) {
        for (let z = INTERIOR_MIN; z <= INTERIOR_MAX_Z; z += 3) {
          expect(Math.abs(field.depthAt(x, z) - volumeDepth)).toBeLessThanOrEqual(tolerance);
        }
      }

      // -- water genuinely occupies world space: real 3D cells report submerged --
      expect(field.isSubmerged(10, INTERIOR_FLOOR + 1, 10)).toBe(true);
      expect(field.isSubmerged(0, INTERIOR_FLOOR + 1, 0)).toBe(false); // outside the basin (wall), dry

      // -- outside the basin remains completely dry --
      expect(field.depthAt(0, 0)).toBe(0);
    }
  });

  it("delivered volume matches the known input volume within tolerance (volume is conserved, not merely a depth guess)", () => {
    const grid = buildClosedBasin();
    const field = new WaterField(grid);
    const knownVolume = INTERIOR_COLUMN_COUNT * 3;
    const result = fillBasin(field, { x: 10, z: 10 }, knownVolume, { volumeTolerance: 0.01 });
    expect(Math.abs(result.deliveredVolume - knownVolume)).toBeLessThanOrEqual(0.1);
  });
});
