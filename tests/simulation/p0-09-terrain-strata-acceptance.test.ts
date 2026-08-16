/**
 * Headless acceptance test for P0-09 — Terrain and strata.
 *
 * Roadmap acceptance test (DAMN_BEAVERS_MASTER_ROADMAP.md, P0-09):
 *   "a generated watershed contains a continuous valley, banks, soil
 *   depth, and underlying rock with spatially queryable material layers."
 *
 * "Generated" here means produced by a general elevation function fed
 * through applyHeightfield() -- P0-09's own terrain/strata REPRESENTATION
 * mechanism -- not the full P1-01 watershed map generator (trees, dry
 * paths validated across 100 seeds, floodplain siting), which is a later,
 * larger task built on top of exactly this primitive.
 */
import { describe, expect, it } from "vitest";
import { WorldGrid } from "../../src/sim/world/WorldGrid.js";
import { TerrainField, applyHeightfield, type StrataLayer } from "../../src/sim/world/TerrainField.js";
import { EntityIdRegistry } from "../../src/sim/core/EntityId.js";
import { MaterialRegistry } from "../../src/sim/materials/Material.js";
import { registerStandardMaterials } from "../../src/sim/materials/standardMaterials.js";

const SIZE_X = 21; // across the valley
const SIZE_Y = 10; // vertical
const SIZE_Z = 6; // along the streambed
const VALLEY_CENTER_X = 10;

/** A simple valley cross-section: low in the middle (streambed), rising toward both banks. */
function valleyHeightAt(x: number, _z: number): number {
  return 2 + Math.round(Math.abs(x - VALLEY_CENTER_X) * 0.45);
}

describe("P0-09 acceptance: a generated valley with banks, soil, and rock", () => {
  it("produces a continuous valley whose material layers are spatially queryable", () => {
    const entityRegistry = new EntityIdRegistry();
    const grid = new WorldGrid({ sizeX: SIZE_X, sizeY: SIZE_Y, sizeZ: SIZE_Z }, entityRegistry);
    const materials = new MaterialRegistry();
    registerStandardMaterials(materials);
    const terrain = new TerrainField(grid, materials);

    const strata: StrataLayer[] = [
      { materialId: "soil", depth: 2 },
      { materialId: "stone", depth: 1000 }, // effectively "the rest is bedrock"
    ];
    applyHeightfield(terrain, valleyHeightAt, strata);

    // -- continuous: every column in the map has solid ground, no voids --
    for (let x = 0; x < SIZE_X; x++) {
      for (let z = 0; z < SIZE_Z; z++) {
        expect(grid.surfaceY(x, z), `column (${x}, ${z}) should have a surface`).toBeDefined();
      }
    }

    // -- valley + banks: the center is lower than both edges, for every z --
    for (let z = 0; z < SIZE_Z; z++) {
      const centerSurface = grid.surfaceY(VALLEY_CENTER_X, z)!;
      const leftBankSurface = grid.surfaceY(0, z)!;
      const rightBankSurface = grid.surfaceY(SIZE_X - 1, z)!;
      expect(centerSurface).toBeLessThan(leftBankSurface);
      expect(centerSurface).toBeLessThan(rightBankSurface);
    }

    // -- soil depth: the surface and the cell below it are soil, for a representative sample --
    for (const x of [0, VALLEY_CENTER_X, SIZE_X - 1]) {
      const surfaceY = grid.surfaceY(x, 0)!;
      expect(terrain.materialAt(x, surfaceY, 0)).toBe("soil");
      expect(terrain.materialAt(x, surfaceY - 1, 0)).toBe("soil");
    }

    // -- underlying rock: bedrock (y=0) is stone everywhere --
    for (let x = 0; x < SIZE_X; x++) {
      expect(terrain.materialAt(x, 0, 0)).toBe("stone");
    }

    // -- spatially queryable material layers: soil directly overlies stone at the valley floor --
    const floorSurface = grid.surfaceY(VALLEY_CENTER_X, 0)!;
    expect(terrain.materialAt(VALLEY_CENTER_X, floorSurface, 0)).toBe("soil");
    expect(terrain.materialAt(VALLEY_CENTER_X, floorSurface - 2, 0)).toBe("stone");
  });

  it("terrain is excavatable/alterable: digging out a cell changes solidity and the surface", () => {
    const entityRegistry = new EntityIdRegistry();
    const grid = new WorldGrid({ sizeX: SIZE_X, sizeY: SIZE_Y, sizeZ: SIZE_Z }, entityRegistry);
    const materials = new MaterialRegistry();
    registerStandardMaterials(materials);
    const terrain = new TerrainField(grid, materials);
    applyHeightfield(terrain, valleyHeightAt, [
      { materialId: "soil", depth: 2 },
      { materialId: "stone", depth: 1000 },
    ]);

    const bankX = 2;
    const originalSurface = grid.surfaceY(bankX, 0)!;
    expect(grid.isSolid(bankX, originalSurface, 0)).toBe(true);

    terrain.excavate(bankX, originalSurface, 0); // a beaver (or player) digs into the bank

    expect(grid.isSolid(bankX, originalSurface, 0)).toBe(false);
    expect(terrain.materialAt(bankX, originalSurface, 0)).toBeUndefined();
    expect(grid.surfaceY(bankX, 0)).toBe(originalSurface - 1); // the ground level itself has changed
  });
});
