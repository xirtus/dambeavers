import { describe, expect, it } from "vitest";
import { WorldGrid } from "../../src/sim/world/WorldGrid.js";
import { TerrainField, applyHeightfield, type StrataLayer } from "../../src/sim/world/TerrainField.js";
import { EntityIdRegistry } from "../../src/sim/core/EntityId.js";
import { MaterialRegistry } from "../../src/sim/materials/Material.js";
import { registerStandardMaterials } from "../../src/sim/materials/standardMaterials.js";

function makeWorld(sizeX = 5, sizeY = 6, sizeZ = 5) {
  const entityRegistry = new EntityIdRegistry();
  const grid = new WorldGrid({ sizeX, sizeY, sizeZ }, entityRegistry);
  const materials = new MaterialRegistry();
  registerStandardMaterials(materials);
  const terrain = new TerrainField(grid, materials);
  return { grid, materials, terrain };
}

describe("TerrainField material assignment and solidity sync", () => {
  it("setMaterial fills a cell and marks it solid", () => {
    const { grid, terrain } = makeWorld();
    terrain.setMaterial(1, 1, 1, "stone");
    expect(terrain.materialAt(1, 1, 1)).toBe("stone");
    expect(grid.isSolid(1, 1, 1)).toBe(true);
  });

  it("clearing material (excavate) makes the cell non-solid", () => {
    const { grid, terrain } = makeWorld();
    terrain.setMaterial(1, 1, 1, "soil");
    terrain.excavate(1, 1, 1);
    expect(terrain.materialAt(1, 1, 1)).toBeUndefined();
    expect(grid.isSolid(1, 1, 1)).toBe(false);
  });

  it("solidity always agrees with material presence, cell by cell, across arbitrary mutation", () => {
    const { grid, terrain } = makeWorld(4, 4, 4);
    const ops: Array<[number, number, number, string | undefined]> = [
      [0, 0, 0, "soil"],
      [1, 0, 0, "stone"],
      [0, 0, 0, undefined],
      [2, 2, 2, "wood"],
      [1, 0, 0, undefined],
    ];
    for (const [x, y, z, mat] of ops) {
      terrain.setMaterial(x, y, z, mat);
      expect(grid.isSolid(x, y, z)).toBe(mat !== undefined);
    }
  });

  it("rejects an unknown material id", () => {
    const { terrain } = makeWorld();
    expect(() => terrain.setMaterial(0, 0, 0, "unobtainium")).toThrow(RangeError);
  });

  it("propagates WorldGrid's own bounds validation", () => {
    const { terrain } = makeWorld(3, 3, 3);
    expect(() => terrain.setMaterial(9, 0, 0, "stone")).toThrow(RangeError);
  });
});

describe("TerrainField debug observability", () => {
  it("reports filled cell count and per-material counts", () => {
    const { terrain } = makeWorld();
    terrain.setMaterial(0, 0, 0, "soil");
    terrain.setMaterial(0, 1, 0, "soil");
    terrain.setMaterial(1, 0, 0, "stone");

    const state = terrain.getDebugState();
    expect(state.filledCellCount).toBe(3);
    expect(state.materialCounts).toEqual([
      { materialId: "soil", count: 2 },
      { materialId: "stone", count: 1 },
    ]);
  });
});

describe("TerrainField snapshot/restore", () => {
  it("round-trips material assignment and re-derives grid solidity on restore", () => {
    const { grid, materials, terrain } = makeWorld();
    terrain.setMaterial(0, 0, 0, "soil");
    terrain.setMaterial(1, 1, 1, "stone");
    const snapshot = terrain.toSnapshot();

    const entityRegistry2 = new EntityIdRegistry();
    const grid2 = WorldGrid.fromSnapshot(grid.toSnapshot(), entityRegistry2);
    const restored = TerrainField.fromSnapshot(snapshot, grid2, materials);

    expect(restored.materialAt(0, 0, 0)).toBe("soil");
    expect(restored.materialAt(1, 1, 1)).toBe("stone");
    expect(grid2.isSolid(0, 0, 0)).toBe(true);
    expect(grid2.isSolid(1, 1, 1)).toBe(true);
    expect(grid2.isSolid(2, 2, 2)).toBe(false);
  });

  it("rejects an unsupported snapshot version", () => {
    const { terrain } = makeWorld();
    const snapshot = terrain.toSnapshot();
    const { grid, materials } = makeWorld();
    expect(() => TerrainField.fromSnapshot({ ...snapshot, version: 999 }, grid, materials)).toThrow(RangeError);
  });

  it("rejects a snapshot whose cell count doesn't match the grid", () => {
    const { terrain } = makeWorld();
    const snapshot = terrain.toSnapshot();
    const { grid, materials } = makeWorld(9, 9, 9); // different cellCount
    const corrupt = { ...snapshot, materialByCell: snapshot.materialByCell.slice(0, 3) };
    expect(() => TerrainField.fromSnapshot(corrupt, grid, materials)).toThrow(RangeError);
  });

  it("rejects a snapshot referencing an unknown material id", () => {
    const { grid, materials, terrain } = makeWorld();
    const snapshot = terrain.toSnapshot();
    snapshot.materialByCell[0] = "unobtainium";
    expect(() => TerrainField.fromSnapshot(snapshot, grid, materials)).toThrow(RangeError);
  });

  it("does not clobber solidity set outside TerrainField for a cell it has no material data for", () => {
    // Simulates a future non-terrain obstruction: something calls
    // grid.setSolid() directly, never going through TerrainField.
    const { grid, materials, terrain } = makeWorld();
    grid.setSolid(2, 2, 2, true); // TerrainField never told about this cell
    const gridSnapshot = grid.toSnapshot();
    const terrainSnapshot = terrain.toSnapshot(); // empty -- terrain never touched (2,2,2)

    const entityRegistry2 = new EntityIdRegistry();
    const restoredGrid = WorldGrid.fromSnapshot(gridSnapshot, entityRegistry2);
    TerrainField.fromSnapshot(terrainSnapshot, restoredGrid, materials);

    // The documented restore order is grid first, then TerrainField; the
    // non-terrain solidity must survive TerrainField's restore step.
    expect(restoredGrid.isSolid(2, 2, 2)).toBe(true);
  });
});

describe("applyHeightfield", () => {
  it("rejects an empty strata profile", () => {
    const { grid, terrain } = makeWorld();
    expect(() => applyHeightfield(terrain, () => 0, [])).toThrow(RangeError);
  });

  it("rejects a non-positive or non-integer stratum depth", () => {
    const { grid, terrain } = makeWorld();
    const bad: StrataLayer[] = [{ materialId: "soil", depth: 0 }];
    expect(() => applyHeightfield(terrain, () => 0, bad)).toThrow(RangeError);
  });

  it("rejects a non-finite heightAt result", () => {
    const { grid, terrain } = makeWorld();
    const strata: StrataLayer[] = [{ materialId: "stone", depth: 1 }];
    expect(() => applyHeightfield(terrain, () => Number.NaN, strata)).toThrow(RangeError);
  });

  it("fills each column from the surface down through layered strata, last layer to bedrock", () => {
    const { grid, terrain } = makeWorld(3, 6, 3);
    const strata: StrataLayer[] = [
      { materialId: "soil", depth: 2 },
      { materialId: "stone", depth: 1 }, // shallow second layer, so bedrock behavior is exercised
    ];
    applyHeightfield(terrain, () => 4, strata); // surface at y=4

    // top two cells (y=4,3): soil
    expect(terrain.materialAt(1, 4, 1)).toBe("soil");
    expect(terrain.materialAt(1, 3, 1)).toBe("soil");
    // y=2: the named stone layer
    expect(terrain.materialAt(1, 2, 1)).toBe("stone");
    // y=1,0: layers exhausted -> last layer (stone) repeats to bedrock
    expect(terrain.materialAt(1, 1, 1)).toBe("stone");
    expect(terrain.materialAt(1, 0, 1)).toBe("stone");
    // above the surface: untouched (air)
    expect(terrain.materialAt(1, 5, 1)).toBeUndefined();
    expect(grid.isSolid(1, 5, 1)).toBe(false);
  });

  it("clamps a height above the grid's vertical extent instead of throwing", () => {
    const { grid, terrain } = makeWorld(3, 4, 3);
    const strata: StrataLayer[] = [{ materialId: "stone", depth: 1 }];
    applyHeightfield(terrain, () => 999, strata);
    expect(terrain.materialAt(0, 3, 0)).toBe("stone"); // clamped to sizeY-1
  });

  it("rounds a genuinely fractional height, not just heights that already happen to be integers", () => {
    const { terrain: terrainA } = makeWorld(3, 6, 3);
    applyHeightfield(terrainA, () => 3.6, [{ materialId: "stone", depth: 1 }]);
    expect(terrainA.materialAt(0, 4, 0)).toBe("stone"); // rounds up to 4
    expect(terrainA.materialAt(0, 3, 0)).toBe("stone"); // still filled (below surface)
    expect(terrainA.materialAt(0, 5, 0)).toBeUndefined(); // above surface

    const { terrain: terrainB } = makeWorld(3, 6, 3);
    applyHeightfield(terrainB, () => 3.4, [{ materialId: "stone", depth: 1 }]);
    expect(terrainB.materialAt(0, 3, 0)).toBe("stone"); // rounds down to 3
    expect(terrainB.materialAt(0, 4, 0)).toBeUndefined();
  });

  it("excavates stale material left above a new, lower surface from an earlier call over the same terrain", () => {
    const { grid, terrain } = makeWorld(3, 6, 3);
    const strata: StrataLayer[] = [{ materialId: "soil", depth: 1000 }];

    applyHeightfield(terrain, () => 4, strata); // first pass: surface at y=4
    expect(grid.surfaceY(1, 1)).toBe(4);

    applyHeightfield(terrain, () => 2, strata); // second pass: a channel carved lower, same column

    // The old surface cells (y=3,4) must be excavated, not left as stale solid material.
    expect(grid.surfaceY(1, 1)).toBe(2);
    expect(terrain.materialAt(1, 4, 1)).toBeUndefined();
    expect(terrain.materialAt(1, 3, 1)).toBeUndefined();
    expect(grid.isSolid(1, 4, 1)).toBe(false);
    expect(grid.isSolid(1, 3, 1)).toBe(false);
    // The new surface and below remain correctly filled.
    expect(terrain.materialAt(1, 2, 1)).toBe("soil");
    expect(terrain.materialAt(1, 0, 1)).toBe("soil");
  });

  it("raising the surface on a second pass does not disturb cells still below the new surface", () => {
    const { terrain } = makeWorld(3, 6, 3);
    applyHeightfield(terrain, () => 2, [{ materialId: "soil", depth: 1000 }]);
    applyHeightfield(terrain, () => 4, [{ materialId: "stone", depth: 1000 }]);

    // Raising the surface should not have run any excavation (previousSurfaceY <= new surfaceY).
    expect(terrain.materialAt(1, 4, 1)).toBe("stone");
    expect(terrain.materialAt(1, 0, 1)).toBe("stone"); // re-filled fresh from the new pass, as documented
  });
});

describe("TerrainField.materialOrAirAt", () => {
  it("resolves an empty cell to the air material instead of undefined", () => {
    const { terrain } = makeWorld();
    expect(terrain.materialOrAirAt(0, 0, 0)).toBe("air");
    terrain.setMaterial(0, 0, 0, "stone");
    expect(terrain.materialOrAirAt(0, 0, 0)).toBe("stone");
  });
});
