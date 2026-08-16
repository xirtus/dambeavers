import { describe, expect, it } from "vitest";
import { WorldGrid } from "../../src/sim/world/WorldGrid.js";
import { EntityIdRegistry } from "../../src/sim/core/EntityId.js";

function makeGrid(sizeX = 5, sizeY = 5, sizeZ = 5) {
  const registry = new EntityIdRegistry();
  const grid = new WorldGrid({ sizeX, sizeY, sizeZ }, registry);
  return { registry, grid };
}

describe("WorldGrid construction", () => {
  it("rejects non-positive or non-integer dimensions", () => {
    const registry = new EntityIdRegistry();
    expect(() => new WorldGrid({ sizeX: 0, sizeY: 1, sizeZ: 1 }, registry)).toThrow(RangeError);
    expect(() => new WorldGrid({ sizeX: 1, sizeY: -1, sizeZ: 1 }, registry)).toThrow(RangeError);
    expect(() => new WorldGrid({ sizeX: 1, sizeY: 1, sizeZ: 1.5 }, registry)).toThrow(RangeError);
  });
});

describe("WorldGrid bounds and solidity", () => {
  it("reports bounds correctly", () => {
    const { grid } = makeGrid(3, 3, 3);
    expect(grid.inBounds(0, 0, 0)).toBe(true);
    expect(grid.inBounds(2, 2, 2)).toBe(true);
    expect(grid.inBounds(3, 0, 0)).toBe(false);
    expect(grid.inBounds(-1, 0, 0)).toBe(false);
    expect(grid.inBounds(1.5, 0, 0)).toBe(false);
  });

  it("starts entirely empty and reflects setSolid", () => {
    const { grid } = makeGrid();
    expect(grid.isSolid(1, 1, 1)).toBe(false);
    grid.setSolid(1, 1, 1, true);
    expect(grid.isSolid(1, 1, 1)).toBe(true);
    grid.setSolid(1, 1, 1, false);
    expect(grid.isSolid(1, 1, 1)).toBe(false);
  });

  it("throws for out-of-bounds isSolid/setSolid", () => {
    const { grid } = makeGrid(3, 3, 3);
    expect(() => grid.isSolid(5, 0, 0)).toThrow(RangeError);
    expect(() => grid.setSolid(0, 5, 0, true)).toThrow(RangeError);
  });
});

describe("WorldGrid.indexOf / cellCount", () => {
  it("gives every in-bounds cell a distinct index within [0, cellCount)", () => {
    const { grid } = makeGrid(3, 4, 5);
    expect(grid.cellCount).toBe(3 * 4 * 5);
    const seen = new Set<number>();
    for (let x = 0; x < 3; x++) {
      for (let y = 0; y < 4; y++) {
        for (let z = 0; z < 5; z++) {
          const idx = grid.indexOf(x, y, z);
          expect(idx).toBeGreaterThanOrEqual(0);
          expect(idx).toBeLessThan(grid.cellCount);
          seen.add(idx);
        }
      }
    }
    expect(seen.size).toBe(grid.cellCount);
  });

  it("throws for an out-of-bounds indexOf call", () => {
    const { grid } = makeGrid(3, 3, 3);
    expect(() => grid.indexOf(9, 0, 0)).toThrow(RangeError);
  });
});

describe("WorldGrid.surfaceY", () => {
  it("returns undefined for an all-empty column", () => {
    const { grid } = makeGrid();
    expect(grid.surfaceY(2, 2)).toBeUndefined();
  });

  it("returns the topmost solid y in the column", () => {
    const { grid } = makeGrid(3, 5, 3);
    grid.setSolid(1, 0, 1, true);
    grid.setSolid(1, 1, 1, true);
    grid.setSolid(1, 3, 1, true); // a floating solid cell above a gap
    expect(grid.surfaceY(1, 1)).toBe(3);
  });

  it("throws for an out-of-bounds column", () => {
    const { grid } = makeGrid(3, 3, 3);
    expect(() => grid.surfaceY(9, 0)).toThrow(RangeError);
  });
});

describe("WorldGrid adjacency", () => {
  it("returns all 6 neighbors for an interior cell", () => {
    const { grid } = makeGrid(5, 5, 5);
    const neighbors = grid.neighbors6(2, 2, 2);
    expect(neighbors).toHaveLength(6);
  });

  it("returns fewer neighbors at a corner", () => {
    const { grid } = makeGrid(5, 5, 5);
    const neighbors = grid.neighbors6(0, 0, 0);
    expect(neighbors).toHaveLength(3);
  });

  it("above/below return undefined at the vertical extremes", () => {
    const { grid } = makeGrid(3, 3, 3);
    expect(grid.above(1, 2, 1)).toBeUndefined();
    expect(grid.below(1, 0, 1)).toBeUndefined();
    expect(grid.above(1, 0, 1)).toEqual({ x: 1, y: 1, z: 1 });
    expect(grid.below(1, 2, 1)).toEqual({ x: 1, y: 1, z: 1 });
  });

  it("isAdjacent is true only for face-adjacent cells, not diagonals or the same cell", () => {
    const { grid } = makeGrid(5, 5, 5);
    const center = { x: 2, y: 2, z: 2 };
    expect(grid.isAdjacent(center, { x: 3, y: 2, z: 2 })).toBe(true);
    expect(grid.isAdjacent(center, { x: 2, y: 3, z: 2 })).toBe(true);
    expect(grid.isAdjacent(center, { x: 3, y: 3, z: 2 })).toBe(false); // diagonal
    expect(grid.isAdjacent(center, center)).toBe(false);
    expect(grid.isAdjacent(center, { x: 4, y: 2, z: 2 })).toBe(false); // 2 cells away
  });
});

describe("WorldGrid entity occupancy", () => {
  it("places, moves, and clears an entity's position", () => {
    const { grid, registry } = makeGrid();
    const id = registry.create("beaver");

    grid.setEntityPosition(id, 1, 1, 1);
    expect(grid.positionOf(id)).toEqual({ x: 1, y: 1, z: 1 });
    expect(grid.entitiesAt(1, 1, 1)).toEqual([id]);

    grid.setEntityPosition(id, 2, 2, 2); // move
    expect(grid.positionOf(id)).toEqual({ x: 2, y: 2, z: 2 });
    expect(grid.entitiesAt(1, 1, 1)).toEqual([]); // vacated
    expect(grid.entitiesAt(2, 2, 2)).toEqual([id]);

    grid.clearEntityPosition(id);
    expect(grid.positionOf(id)).toBeUndefined();
    expect(grid.entitiesAt(2, 2, 2)).toEqual([]);
  });

  it("supports multiple entities occupying the same cell", () => {
    const { grid, registry } = makeGrid();
    const a = registry.create("beaver");
    const b = registry.create("fish");
    grid.setEntityPosition(a, 1, 1, 1);
    grid.setEntityPosition(b, 1, 1, 1);
    expect(grid.entitiesAt(1, 1, 1).sort()).toEqual([a, b].sort());
  });

  it("rejects positioning a non-live entity", () => {
    const { grid, registry } = makeGrid();
    const id = registry.create("beaver");
    registry.destroy(id);
    expect(() => grid.setEntityPosition(id, 0, 0, 0)).toThrow(RangeError);
  });

  it("rejects an out-of-bounds position", () => {
    const { grid, registry } = makeGrid(3, 3, 3);
    const id = registry.create("beaver");
    expect(() => grid.setEntityPosition(id, 9, 0, 0)).toThrow(RangeError);
  });

  it("rejects clearing a position for an entity that has none", () => {
    const { grid, registry } = makeGrid();
    const id = registry.create("beaver");
    expect(() => grid.clearEntityPosition(id)).toThrow(RangeError);
  });

  it("returns a defensive copy from positionOf, so mutating the result can't desync internal state", () => {
    const { grid, registry } = makeGrid();
    const id = registry.create("beaver");
    grid.setEntityPosition(id, 1, 1, 1);

    const cell = grid.positionOf(id)!;
    (cell as { x: number }).x = 99;

    expect(grid.positionOf(id)).toEqual({ x: 1, y: 1, z: 1 }); // unaffected
    expect(grid.entitiesAt(1, 1, 1)).toEqual([id]); // still correctly indexed
  });

  it("automatically clears position when the registry destroys the entity", () => {
    const { grid, registry } = makeGrid();
    const id = registry.create("beaver");
    grid.setEntityPosition(id, 1, 1, 1);

    registry.destroy(id);

    expect(grid.positionOf(id)).toBeUndefined();
    expect(grid.entitiesAt(1, 1, 1)).toEqual([]);
  });

  it("stops auto-cleanup after dispose()", () => {
    const { grid, registry } = makeGrid();
    const id = registry.create("beaver");
    grid.setEntityPosition(id, 1, 1, 1);

    grid.dispose();
    registry.destroy(id);

    expect(grid.positionOf(id)).toEqual({ x: 1, y: 1, z: 1 });
  });
});

describe("WorldGrid debug observability", () => {
  it("reports solid, occupied, and tracked-entity counts", () => {
    const { grid, registry } = makeGrid();
    grid.setSolid(0, 0, 0, true);
    grid.setSolid(1, 0, 0, true);
    const a = registry.create("beaver");
    const b = registry.create("tree");
    grid.setEntityPosition(a, 2, 2, 2);
    grid.setEntityPosition(b, 2, 2, 2);

    const state = grid.getDebugState();
    expect(state.solidCellCount).toBe(2);
    expect(state.occupiedCellCount).toBe(1);
    expect(state.trackedEntityCount).toBe(2);
    expect(state.entitiesInSolidCells).toBe(0);
  });

  it("flags entities positioned inside solid cells", () => {
    const { grid, registry } = makeGrid();
    grid.setSolid(1, 1, 1, true);
    const buried = registry.create("root");
    const surface = registry.create("beaver");
    grid.setEntityPosition(buried, 1, 1, 1);
    grid.setEntityPosition(surface, 2, 2, 2);

    expect(grid.getDebugState().entitiesInSolidCells).toBe(1);
  });
});

describe("WorldGrid snapshot/restore", () => {
  it("round-trips solidity and entity positions", () => {
    const { grid, registry } = makeGrid(4, 4, 4);
    grid.setSolid(0, 0, 0, true);
    grid.setSolid(1, 0, 0, true);
    const id = registry.create("beaver");
    grid.setEntityPosition(id, 2, 2, 2);

    const snapshot = grid.toSnapshot();
    const restored = WorldGrid.fromSnapshot(snapshot, registry);

    expect(restored.isSolid(0, 0, 0)).toBe(true);
    expect(restored.isSolid(1, 0, 0)).toBe(true);
    expect(restored.isSolid(2, 0, 0)).toBe(false);
    expect(restored.positionOf(id)).toEqual({ x: 2, y: 2, z: 2 });
  });

  it("rejects an unsupported snapshot version", () => {
    const { grid, registry } = makeGrid();
    const snapshot = grid.toSnapshot();
    expect(() => WorldGrid.fromSnapshot({ ...snapshot, version: 999 }, registry)).toThrow(RangeError);
  });

  it("rejects a solid array whose length doesn't match the declared dimensions", () => {
    const { grid, registry } = makeGrid();
    const snapshot = grid.toSnapshot();
    const corrupt = { ...snapshot, solid: [0, 1] };
    expect(() => WorldGrid.fromSnapshot(corrupt, registry)).toThrow(RangeError);
  });

  it("rejects a solid array with values other than 0 or 1", () => {
    const { grid, registry } = makeGrid(2, 2, 2);
    const snapshot = grid.toSnapshot();
    const corrupt = { ...snapshot, solid: snapshot.solid.map((_, i) => (i === 0 ? 5 : 0)) };
    expect(() => WorldGrid.fromSnapshot(corrupt, registry)).toThrow(RangeError);
  });

  it("rejects an entity position for an id that is not live in the provided registry", () => {
    const { grid, registry } = makeGrid();
    const id = registry.create("beaver");
    grid.setEntityPosition(id, 1, 1, 1);
    const snapshot = grid.toSnapshot();

    const otherRegistry = new EntityIdRegistry(); // fresh registry, id never created here
    expect(() => WorldGrid.fromSnapshot(snapshot, otherRegistry)).toThrow(RangeError);
  });

  it("rejects duplicate entity ids in the snapshot payload", () => {
    const { grid, registry } = makeGrid();
    const id = registry.create("beaver");
    const snapshot = grid.toSnapshot();
    const corrupt = {
      ...snapshot,
      entities: [
        { id, x: 0, y: 0, z: 0 },
        { id, x: 1, y: 1, z: 1 },
      ],
    };
    expect(() => WorldGrid.fromSnapshot(corrupt, registry)).toThrow(RangeError);
  });
});
