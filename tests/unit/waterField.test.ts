import { describe, expect, it } from "vitest";
import { EntityIdRegistry } from "../../src/sim/core/EntityId.js";
import { WorldGrid } from "../../src/sim/world/WorldGrid.js";
import { WaterField, fillBasin } from "../../src/sim/hydrology/WaterField.js";

function makeGrid(sizeX = 10, sizeY = 10, sizeZ = 10): WorldGrid {
  const entities = new EntityIdRegistry();
  return new WorldGrid({ sizeX, sizeY, sizeZ }, entities);
}

/** Fills solid ground up through `floor` (inclusive) at every column, uniformly. */
function fillFlatFloor(grid: WorldGrid, floor: number): void {
  const dims = grid.dims;
  for (let x = 0; x < dims.sizeX; x++) {
    for (let z = 0; z < dims.sizeZ; z++) {
      for (let y = 0; y <= floor; y++) grid.setSolid(x, y, z, true);
    }
  }
}

/** A bowl: flat interior floor at `interiorFloor`, taller walls at `wallFloor` on the outer ring (columns with x/z inside [1, sizeX-2]x[1, sizeZ-2] are interior; everything else is wall). */
function buildBowlGrid(sizeX = 15, sizeY = 10, sizeZ = 15, interiorFloor = 2, wallFloor = 8): WorldGrid {
  const grid = makeGrid(sizeX, sizeY, sizeZ);
  for (let x = 0; x < sizeX; x++) {
    for (let z = 0; z < sizeZ; z++) {
      const isWall = x < 2 || x >= sizeX - 2 || z < 2 || z >= sizeZ - 2;
      const floor = isWall ? wallFloor : interiorFloor;
      for (let y = 0; y <= floor; y++) grid.setSolid(x, y, z, true);
    }
  }
  return grid;
}

/**
 * Chamber A (8 columns, floor=2) connects through a single sill column
 * (floor=5) to a much larger, lower chamber B (16 columns, floor=0). All
 * enclosed by high walls (floor=9). A's capacity to the sill is 8*3=24;
 * the moment the sill opens, chamber B must backfill to level 5
 * atomically (16*5=80 more), so the minimum volume to touch B at all is
 * 104 -- any target strictly between 24 and 104 has no valid uniform
 * surface anywhere in this basin.
 */
function buildMultiChamberGrid(): WorldGrid {
  const sizeX = 20;
  const sizeY = 12;
  const sizeZ = 10;
  const grid = makeGrid(sizeX, sizeY, sizeZ);
  const wallFloor = 9;
  for (let x = 0; x < sizeX; x++) {
    for (let z = 0; z < sizeZ; z++) {
      for (let y = 0; y <= wallFloor; y++) grid.setSolid(x, y, z, true);
    }
  }
  const carveTo = (x: number, z: number, floor: number): void => {
    for (let y = floor + 1; y <= wallFloor; y++) grid.setSolid(x, y, z, false);
  };
  for (let x = 1; x <= 4; x++) for (let z = 1; z <= 2; z++) carveTo(x, z, 2); // chamber A: 8 columns, floor=2
  carveTo(5, 1, 5); // sill: 1 column, floor=5
  for (let x = 6; x <= 13; x++) for (let z = 1; z <= 2; z++) carveTo(x, z, 0); // chamber B: 16 columns, floor=0
  return grid;
}

describe("WaterField basic depth storage", () => {
  it("starts every column dry", () => {
    const field = new WaterField(makeGrid());
    expect(field.depthAt(3, 3)).toBe(0);
  });

  it("setDepth/depthAt round-trip", () => {
    const field = new WaterField(makeGrid());
    field.setDepth(2, 2, 4.5);
    expect(field.depthAt(2, 2)).toBe(4.5);
  });

  it("rejects a negative or non-finite depth", () => {
    const field = new WaterField(makeGrid());
    expect(() => field.setDepth(0, 0, -1)).toThrow(RangeError);
    expect(() => field.setDepth(0, 0, Number.NaN)).toThrow(RangeError);
    expect(() => field.setDepth(0, 0, Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it("rejects an out-of-bounds column", () => {
    const field = new WaterField(makeGrid(5, 5, 5));
    expect(() => field.depthAt(10, 0)).toThrow(RangeError);
    expect(() => field.setDepth(0, 10, 1)).toThrow(RangeError);
  });

  it("addVolume increases depth, removal decreases it", () => {
    const field = new WaterField(makeGrid());
    field.addVolume(1, 1, 5);
    expect(field.depthAt(1, 1)).toBe(5);
    field.addVolume(1, 1, -2);
    expect(field.depthAt(1, 1)).toBe(3);
  });

  it("rejects removing more volume than is present", () => {
    const field = new WaterField(makeGrid());
    field.addVolume(1, 1, 2);
    expect(() => field.addVolume(1, 1, -5)).toThrow(RangeError);
  });
});

describe("WaterField.waterSurfaceY / isSubmerged", () => {
  it("a dry column has no water surface", () => {
    const grid = makeGrid();
    fillFlatFloor(grid, 2);
    const field = new WaterField(grid);
    expect(field.waterSurfaceY(1, 1)).toBeUndefined();
  });

  it("water surface is floor + depth", () => {
    const grid = makeGrid();
    fillFlatFloor(grid, 2);
    const field = new WaterField(grid);
    field.setDepth(1, 1, 3);
    expect(field.waterSurfaceY(1, 1)).toBe(5); // floor=2, +3
  });

  it("isSubmerged is true strictly above the floor and at/below the surface", () => {
    const grid = makeGrid();
    fillFlatFloor(grid, 2);
    const field = new WaterField(grid);
    field.setDepth(1, 1, 3); // surface at y=5
    expect(field.isSubmerged(1, 2, 1)).toBe(false); // the floor cell itself (solid ground, not water)
    expect(field.isSubmerged(1, 3, 1)).toBe(true);
    expect(field.isSubmerged(1, 5, 1)).toBe(true); // at the surface
    expect(field.isSubmerged(1, 6, 1)).toBe(false); // above the surface
  });

  it("a column with no terrain at all still has a well-defined floor (-1)", () => {
    const grid = makeGrid(); // nothing solid anywhere
    const field = new WaterField(grid);
    field.setDepth(1, 1, 2);
    expect(field.waterSurfaceY(1, 1)).toBe(1); // -1 + 2
  });
});

describe("WaterField debug observability", () => {
  it("reports wet column count, total volume, and max depth", () => {
    const field = new WaterField(makeGrid());
    field.setDepth(0, 0, 2);
    field.setDepth(1, 1, 5);
    const state = field.getDebugState();
    expect(state.wetColumnCount).toBe(2);
    expect(state.totalVolume).toBe(7);
    expect(state.maxDepth).toBe(5);
  });
});

describe("WaterField snapshot/restore", () => {
  it("round-trips depth data", () => {
    const grid = makeGrid();
    const field = new WaterField(grid);
    field.setDepth(2, 3, 4.5);
    const restored = WaterField.fromSnapshot(field.toSnapshot(), grid);
    expect(restored.depthAt(2, 3)).toBe(4.5);
  });

  it("survives a real JSON.stringify/JSON.parse round trip", () => {
    const grid = makeGrid();
    const field = new WaterField(grid);
    field.setDepth(1, 1, 3);
    const revived = JSON.parse(JSON.stringify(field.toSnapshot()));
    const restored = WaterField.fromSnapshot(revived, grid);
    expect(restored.depthAt(1, 1)).toBe(3);
  });

  it("rejects an unsupported snapshot version", () => {
    const grid = makeGrid();
    const field = new WaterField(grid);
    const snapshot = field.toSnapshot();
    expect(() => WaterField.fromSnapshot({ ...snapshot, version: 999 }, grid)).toThrow(RangeError);
  });

  it("rejects a snapshot whose dimensions don't match the provided grid", () => {
    const grid = makeGrid();
    const field = new WaterField(grid);
    const snapshot = field.toSnapshot();
    const otherGrid = makeGrid(20, 10, 20);
    expect(() => WaterField.fromSnapshot(snapshot, otherGrid)).toThrow(RangeError);
  });

  it("rejects a corrupt negative depth value in the snapshot", () => {
    const grid = makeGrid();
    const field = new WaterField(grid);
    const snapshot = field.toSnapshot();
    snapshot.depthByColumn[0] = -5;
    expect(() => WaterField.fromSnapshot(snapshot, grid)).toThrow(RangeError);
  });
});

describe("fillBasin", () => {
  it("a flat-floor bowl reaches the exact expected uniform depth for a known volume", () => {
    const grid = buildBowlGrid();
    const field = new WaterField(grid);
    const interiorColumns = 11 * 11; // x,z in [2,12]
    const targetDepth = 3;
    const result = fillBasin(field, { x: 7, z: 7 }, interiorColumns * targetDepth);

    expect(result.columns).toHaveLength(interiorColumns);
    expect(result.surfaceElevation).toBeCloseTo(2 + targetDepth, 1);
    expect(field.depthAt(7, 7)).toBeCloseTo(targetDepth, 1);
    expect(field.depthAt(2, 2)).toBeCloseTo(targetDepth, 1); // bowl corner, same floor -> same depth
    expect(field.depthAt(0, 0)).toBe(0); // outside the bowl (wall), untouched
  });

  it("a bowl with a varying floor produces a flat top surface, with per-column depth compensating for floor height", () => {
    const grid = buildBowlGrid(15, 12, 15, /* interiorFloor unused, custom below */ 2, 9);
    // Carve a deeper pit at (7,7): lower its floor by clearing one extra solid layer.
    grid.setSolid(7, 2, 7, false);
    const field = new WaterField(grid);
    const volume = 11 * 11 * 3 + 1; // roughly enough to reach depth ~3 over the interior, plus the pit's extra capacity
    const result = fillBasin(field, { x: 7, z: 7 }, volume);

    // Every reached column shares the SAME surface elevation...
    for (const { x, z } of result.columns) {
      const floor = grid.surfaceY(x, z) ?? -1;
      expect(floor + field.depthAt(x, z)).toBeCloseTo(result.surfaceElevation, 1);
    }
    // ...so the deeper pit column has strictly more depth than a normal-floor interior column.
    expect(field.depthAt(7, 7)).toBeGreaterThan(field.depthAt(3, 3));
  });

  it("zero target volume leaves the seed column dry", () => {
    const grid = buildBowlGrid();
    const field = new WaterField(grid);
    const result = fillBasin(field, { x: 7, z: 7 }, 0);
    expect(result.deliveredVolume).toBe(0);
    expect(field.depthAt(7, 7)).toBe(0);
  });

  it("throws when the requested volume overflows a closed basin's rim", () => {
    const grid = buildBowlGrid(15, 12, 15, 2, 8);
    const field = new WaterField(grid);
    expect(() => fillBasin(field, { x: 7, z: 7 }, 121 * 20)).toThrow(RangeError);
  });

  it("throws (rather than hang) when the reachable region has no walls at all", () => {
    const grid = makeGrid(30, 10, 30);
    fillFlatFloor(grid, 2); // flat floor everywhere, no walls anywhere on the map
    const field = new WaterField(grid);
    expect(() => fillBasin(field, { x: 15, z: 15 }, 10, { maxColumns: 50 })).toThrow(RangeError);
  });

  it("rejects a negative target volume", () => {
    const grid = buildBowlGrid();
    const field = new WaterField(grid);
    expect(() => fillBasin(field, { x: 7, z: 7 }, -1)).toThrow(RangeError);
  });

  it("is deterministic: the same basin and target volume always converge to the same result", () => {
    const gridA = buildBowlGrid();
    const gridB = buildBowlGrid();
    const fieldA = new WaterField(gridA);
    const fieldB = new WaterField(gridB);
    const resultA = fillBasin(fieldA, { x: 7, z: 7 }, 400);
    const resultB = fillBasin(fieldB, { x: 7, z: 7 }, 400);
    expect(resultB.surfaceElevation).toBeCloseTo(resultA.surfaceElevation, 9);
    expect(resultB.columns.length).toBe(resultA.columns.length);
  });
});

describe("fillBasin multi-chamber basins (discontinuous volume-vs-elevation)", () => {
  // Regression coverage for a genuine correctness bug an earlier
  // single-elevation-binary-search implementation had: volume as a
  // function of surface elevation is monotonic but NOT continuous
  // whenever a sill opens into a lower secondary chamber -- re-flood-
  // filling independently at each candidate elevation could converge to
  // an elevation whose region silently included the newly-opened chamber,
  // delivering a volume arbitrarily far (3x+, unbounded in general) from
  // what was requested, with no error. The current incremental
  // priority-flood implementation must both (a) deliver an EXACT result
  // for any target actually achievable by a single uniform surface, and
  // (b) throw for any target that falls in the genuine physical gap
  // between two connectivity states, rather than silently misdelivering.

  it("a target within the first chamber's capacity stays confined to it", () => {
    const grid = buildMultiChamberGrid();
    const field = new WaterField(grid);
    const result = fillBasin(field, { x: 2, z: 1 }, 20); // < 24 (chamber A's capacity to the sill)
    expect(result.deliveredVolume).toBeCloseTo(20, 6);
    expect(result.surfaceElevation).toBeLessThan(5);
    expect(field.depthAt(10, 1)).toBe(0); // chamber B untouched
  });

  it("a target exactly at the connection threshold fills the sill with chamber B still dry", () => {
    const grid = buildMultiChamberGrid();
    const field = new WaterField(grid);
    const result = fillBasin(field, { x: 2, z: 1 }, 24);
    expect(result.deliveredVolume).toBeCloseTo(24, 6);
    expect(field.depthAt(10, 1)).toBe(0);
  });

  it("a target in the unsatisfiable gap between the two connectivity states throws, rather than silently delivering the wrong volume", () => {
    // Nothing between 24 (chamber A full) and 104 (chamber A+sill+B all
    // backfilled to the sill level) is achievable by any single uniform
    // surface in this basin.
    const grid = buildMultiChamberGrid();
    const field = new WaterField(grid);
    expect(() => fillBasin(field, { x: 2, z: 1 }, 30)).toThrow(RangeError);
    expect(() => fillBasin(field, { x: 2, z: 1 }, 24.5)).toThrow(RangeError);
    expect(() => fillBasin(field, { x: 2, z: 1 }, 103.9)).toThrow(RangeError);
  });

  it("a target comfortably past the connection threshold delivers EXACTLY the requested volume, not an overshoot", () => {
    const grid = buildMultiChamberGrid();
    const field = new WaterField(grid);
    const result = fillBasin(field, { x: 2, z: 1 }, 150); // > 104
    expect(result.deliveredVolume).toBeCloseTo(150, 6);
    expect(result.surfaceElevation).toBeGreaterThan(5); // above the sill
    expect(field.depthAt(10, 1)).toBeGreaterThan(0); // chamber B now genuinely holds water
  });

  it("a wide flat plateau at a single floor height connects and delivers exact volume in one batch (exercises the at-current-surface absorb boundary)", () => {
    // A large, perfectly flat chamber reachable through a sill at the SAME
    // floor height as the whole chamber -- every plateau column becomes
    // eligible for absorption simultaneously the instant the sill opens,
    // exercising the "column at exactly currentSurface" boundary at scale
    // rather than one column at a time.
    const grid = makeGrid(30, 10, 30);
    const wallFloor = 8;
    for (let x = 0; x < 30; x++) for (let z = 0; z < 30; z++) for (let y = 0; y <= wallFloor; y++) grid.setSolid(x, y, z, true);
    const carveTo = (x: number, z: number, floor: number): void => {
      for (let y = floor + 1; y <= wallFloor; y++) grid.setSolid(x, y, z, false);
    };
    carveTo(2, 15, 3); // seed column, floor=3
    carveTo(3, 15, 3); // sill at the SAME floor as the plateau
    for (let x = 4; x <= 25; x++) for (let z = 4; z <= 25; z++) carveTo(x, z, 3); // 22x22=484 column flat plateau, same floor=3

    const field = new WaterField(grid);
    const result = fillBasin(field, { x: 2, z: 15 }, 972); // 486 columns total (2 seed/sill + 484 plateau) * depth 2 = 972
    expect(result.deliveredVolume).toBeCloseTo(972, 6);
    expect(result.surfaceElevation).toBeCloseTo(5, 6); // floor 3 + depth 2
    expect(result.columns.length).toBe(486);
    expect(field.depthAt(15, 15)).toBeCloseTo(2, 6);
  });
});
