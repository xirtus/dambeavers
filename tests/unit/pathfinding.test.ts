import { describe, expect, it } from "vitest";
import { EntityIdRegistry } from "../../src/sim/core/EntityId.js";
import { WorldGrid } from "../../src/sim/world/WorldGrid.js";
import { TerrainField } from "../../src/sim/world/TerrainField.js";
import { MaterialRegistry } from "../../src/sim/materials/Material.js";
import { registerStandardMaterials } from "../../src/sim/materials/standardMaterials.js";
import { WaterField } from "../../src/sim/hydrology/WaterField.js";
import { findPath, reachableColumns, describeEdgeBlock, type NavigationProfile } from "../../src/sim/navigation/Pathfinding.js";

function buildFlatWorld(sizeX = 8, sizeY = 8, sizeZ = 8, floor = 2) {
  const entities = new EntityIdRegistry();
  const grid = new WorldGrid({ sizeX, sizeY, sizeZ }, entities);
  const materials = new MaterialRegistry();
  registerStandardMaterials(materials);
  const terrain = new TerrainField(grid, materials);
  for (let x = 0; x < sizeX; x++) {
    for (let z = 0; z < sizeZ; z++) {
      for (let y = 0; y <= floor; y++) terrain.setMaterial(x, y, z, "soil");
    }
  }
  const water = new WaterField(grid);
  return { grid, terrain, materials, water };
}

const WALKER: NavigationProfile = { canSwim: false, maxWadingDepth: 0.5 };
const SWIMMER: NavigationProfile = { canSwim: true, maxWadingDepth: 0.5 };

describe("findPath basic routing", () => {
  it("finds a straight route across flat open ground", () => {
    const { grid, terrain, water, materials } = buildFlatWorld();
    const result = findPath(grid, terrain, water, materials, { x: 0, z: 0 }, { x: 5, z: 0 }, WALKER);
    expect(result).toBeDefined();
    expect(result!.columns[0]).toEqual({ x: 0, z: 0 });
    expect(result!.columns[result!.columns.length - 1]).toEqual({ x: 5, z: 0 });
  });

  it("returns a trivial zero-cost single-column result when start equals goal", () => {
    const { grid, terrain, water, materials } = buildFlatWorld();
    const result = findPath(grid, terrain, water, materials, { x: 3, z: 3 }, { x: 3, z: 3 }, WALKER);
    expect(result).toEqual({ columns: [{ x: 3, z: 3 }], cost: 0 });
  });

  it("the path is a connected sequence of orthogonally-adjacent columns", () => {
    const { grid, terrain, water, materials } = buildFlatWorld();
    const result = findPath(grid, terrain, water, materials, { x: 0, z: 0 }, { x: 6, z: 6 }, WALKER)!;
    for (let i = 1; i < result.columns.length; i++) {
      const a = result.columns[i - 1]!;
      const b = result.columns[i]!;
      const manhattan = Math.abs(a.x - b.x) + Math.abs(a.z - b.z);
      expect(manhattan).toBe(1);
    }
  });

  it("rejects out-of-bounds start/goal columns", () => {
    const { grid, terrain, water, materials } = buildFlatWorld();
    expect(() => findPath(grid, terrain, water, materials, { x: -1, z: 0 }, { x: 5, z: 0 }, WALKER)).toThrow(
      RangeError,
    );
    expect(() => findPath(grid, terrain, water, materials, { x: 0, z: 0 }, { x: 99, z: 0 }, WALKER)).toThrow(
      RangeError,
    );
  });

  it("rejects an invalid maxWadingDepth", () => {
    const { grid, terrain, water, materials } = buildFlatWorld();
    expect(() =>
      findPath(grid, terrain, water, materials, { x: 0, z: 0 }, { x: 5, z: 0 }, { canSwim: false, maxWadingDepth: -1 }),
    ).toThrow(RangeError);
  });
});

describe("findPath cost composition", () => {
  it("prefers a lower-friction route over a higher-friction one of the same length", () => {
    const { grid, terrain, water, materials } = buildFlatWorld(6, 8, 3);
    // two parallel 1-wide lanes from z=0 to z=2 at x=0 (sand, low friction) and x=1 (stone, high friction)
    for (let z = 0; z < 3; z++) {
      terrain.setMaterial(0, 2, z, "sand");
      terrain.setMaterial(1, 2, z, "stone");
    }
    const resultViaSand = findPath(grid, terrain, water, materials, { x: 0, z: 0 }, { x: 0, z: 2 }, WALKER)!;
    const resultViaStone = findPath(grid, terrain, water, materials, { x: 1, z: 0 }, { x: 1, z: 2 }, WALKER)!;
    expect(resultViaSand.cost).toBeLessThan(resultViaStone.cost);
  });

  it("adds a slope penalty for elevation changes between columns", () => {
    const { grid, terrain, water, materials } = buildFlatWorld(3, 8, 3, 2);
    terrain.setMaterial(1, 5, 0, "soil"); // a tall step at (1,0), floor jumps from 2 to 5
    const stepResult = findPath(grid, terrain, water, materials, { x: 1, z: 1 }, { x: 1, z: 0 }, WALKER)!;
    const flatResult = findPath(grid, terrain, water, materials, { x: 1, z: 1 }, { x: 2, z: 1 }, WALKER)!;
    expect(stepResult.cost).toBeGreaterThan(flatResult.cost);
  });

  it("chooses the genuinely cheaper of two coexisting full routes within ONE query, not merely a connecting one", () => {
    // (1,0) -> (1,3), with the direct middle lane (x=1, z=1..2) walled off
    // (no headroom), forces the search to go around via one of two
    // symmetric, equal-length side lanes: x=0 (sand, friction 0.6) or x=2
    // (stone, friction 0.8, pricier). Both are real, fully-connected
    // candidate routes of identical hop count -- only their cost differs --
    // so a pathfinder that merely proves reachability, rather than
    // computing true lowest-cost routing, could easily settle for the
    // pricier one.
    const { grid, terrain, water, materials } = buildFlatWorld(3, 8, 4);
    for (const z of [1, 2]) {
      for (let y = 3; y < 8; y++) terrain.setMaterial(1, y, z, "stone"); // wall off the middle lane entirely
    }
    terrain.setMaterial(0, 2, 1, "sand");
    terrain.setMaterial(0, 2, 2, "sand");
    terrain.setMaterial(2, 2, 1, "stone");
    terrain.setMaterial(2, 2, 2, "stone");

    const result = findPath(grid, terrain, water, materials, { x: 1, z: 0 }, { x: 1, z: 3 }, WALKER)!;
    expect(result).toBeDefined();
    expect(result.columns).toContainEqual({ x: 0, z: 1 });
    expect(result.columns).toContainEqual({ x: 0, z: 2 });
    expect(result.columns).not.toContainEqual({ x: 2, z: 1 });
    expect(result.columns).not.toContainEqual({ x: 2, z: 2 });
    // soil(1.5) + sand(1.6) + sand(1.6) + soil(1.5) + soil(1.5) -- cheaper than the stone lane's
    // soil(1.5) + stone(1.8) + stone(1.8) + soil(1.5) + soil(1.5), even though both are the same length
    expect(result.cost).toBeCloseTo(1.5 + 1.6 + 1.6 + 1.5 + 1.5, 10);
  });

  it("is fully unreachable through a genuine multi-column maze, not just a single blocked hop", () => {
    const { grid, terrain, water, materials } = buildFlatWorld(5, 8, 5, 2);
    for (let x = 0; x < 5; x++) {
      for (let y = 3; y < 8; y++) terrain.setMaterial(x, y, 2, "stone"); // an unbroken wall across the whole map width
    }
    const result = findPath(grid, terrain, water, materials, { x: 2, z: 0 }, { x: 2, z: 4 }, WALKER);
    expect(result).toBeUndefined();
  });
});

describe("describeEdgeBlock", () => {
  it("reports 'no-ground' for a column with no terrain at all", () => {
    const entities = new EntityIdRegistry();
    const grid = new WorldGrid({ sizeX: 3, sizeY: 5, sizeZ: 3 }, entities);
    const materials = new MaterialRegistry();
    registerStandardMaterials(materials);
    const terrain = new TerrainField(grid, materials);
    const water = new WaterField(grid);
    expect(describeEdgeBlock(grid, water, WALKER, { x: 1, z: 1 })).toBe("no-ground");
  });

  it("reports 'no-headroom' for a column solid to the grid's ceiling", () => {
    const { grid, terrain, water } = buildFlatWorld(3, 5, 3, 2);
    for (let y = 3; y < 5; y++) terrain.setMaterial(1, y, 1, "stone");
    expect(describeEdgeBlock(grid, water, WALKER, { x: 1, z: 1 })).toBe("no-headroom");
  });

  it("reports 'too-deep-to-cross' for a non-swimmer facing water past its wading depth", () => {
    const { grid, water } = buildFlatWorld(3, 8, 3);
    water.setDepth(1, 1, 3);
    expect(describeEdgeBlock(grid, water, WALKER, { x: 1, z: 1 })).toBe("too-deep-to-cross");
    expect(describeEdgeBlock(grid, water, SWIMMER, { x: 1, z: 1 })).toBeUndefined();
  });

  it("reports undefined for a genuinely passable column", () => {
    const { grid, water } = buildFlatWorld(3, 8, 3);
    expect(describeEdgeBlock(grid, water, WALKER, { x: 1, z: 1 })).toBeUndefined();
  });
});

describe("reachableColumns", () => {
  it("includes the start column itself at zero cost", () => {
    const { grid, terrain, water, materials } = buildFlatWorld(3, 8, 3);
    const result = reachableColumns(grid, terrain, water, materials, { x: 1, z: 1 }, WALKER);
    expect(result).toContainEqual({ column: { x: 1, z: 1 }, cost: 0 });
  });

  it("agrees with findPath's cost for a column it can reach", () => {
    const { grid, terrain, water, materials } = buildFlatWorld(4, 8, 4);
    const start = { x: 0, z: 0 };
    const goal = { x: 3, z: 3 };
    const direct = findPath(grid, terrain, water, materials, start, goal, WALKER)!;
    const reachable = reachableColumns(grid, terrain, water, materials, start, WALKER);
    const goalEntry = reachable.find((r) => r.column.x === goal.x && r.column.z === goal.z);
    expect(goalEntry).toBeDefined();
    expect(goalEntry!.cost).toBeCloseTo(direct.cost, 10);
  });

  it("excludes a column that is genuinely unreachable, and includes everything that is", () => {
    const { grid, terrain, water, materials } = buildFlatWorld(5, 8, 5, 2);
    for (let x = 0; x < 5; x++) {
      for (let y = 3; y < 8; y++) terrain.setMaterial(x, y, 2, "stone"); // wall across the whole width, as above
    }
    const result = reachableColumns(grid, terrain, water, materials, { x: 2, z: 0 }, WALKER);
    const keys = new Set(result.map((r) => `${r.column.x},${r.column.z}`));
    for (let x = 0; x < 5; x++) {
      expect(keys.has(`${x},0`)).toBe(true);
      expect(keys.has(`${x},1`)).toBe(true);
      expect(keys.has(`${x},4`)).toBe(false); // beyond the wall -- unreachable
    }
  });

  it("rejects an out-of-bounds start column", () => {
    const { grid, terrain, water, materials } = buildFlatWorld();
    expect(() => reachableColumns(grid, terrain, water, materials, { x: -1, z: 0 }, WALKER)).toThrow(RangeError);
  });
});

describe("findPath blocked cells", () => {
  it("a column filled solid all the way to the top of the grid is impassable (no room to stand)", () => {
    const { grid, terrain, water, materials } = buildFlatWorld(5, 8, 5, 2);
    for (let y = 3; y < 8; y++) terrain.setMaterial(2, y, 2, "stone"); // fills (2,2) clear up to the grid's ceiling
    const result = findPath(grid, terrain, water, materials, { x: 0, z: 2 }, { x: 2, z: 2 }, WALKER);
    expect(result).toBeUndefined();
  });

  it("a column with no terrain at all is impassable", () => {
    const entities = new EntityIdRegistry();
    const grid = new WorldGrid({ sizeX: 3, sizeY: 5, sizeZ: 3 }, entities);
    const materials = new MaterialRegistry();
    registerStandardMaterials(materials);
    const terrain = new TerrainField(grid, materials);
    terrain.setMaterial(0, 0, 1, "soil");
    terrain.setMaterial(2, 0, 1, "soil");
    // (1,1) is never given any material -- an open void column between them
    const water = new WaterField(grid);
    const result = findPath(grid, terrain, water, materials, { x: 0, z: 1 }, { x: 2, z: 1 }, WALKER);
    expect(result).toBeUndefined();
  });
});

describe("findPath water depth / swimming", () => {
  it("shallow water (within maxWadingDepth) is walkable at a strictly higher cost than dry land", () => {
    const { grid, terrain, water, materials } = buildFlatWorld();
    water.setDepth(3, 0, 0.3);
    const dryResult = findPath(grid, terrain, water, materials, { x: 2, z: 0 }, { x: 2, z: 1 }, WALKER)!;
    const wetResult = findPath(grid, terrain, water, materials, { x: 3, z: 1 }, { x: 3, z: 0 }, WALKER)!;
    expect(wetResult.cost).toBeGreaterThan(dryResult.cost);
  });

  it("wading cost scales with depth -- deeper (but still wadable) water costs strictly more than barely-wet water", () => {
    const { grid, terrain, water, materials } = buildFlatWorld();
    water.setDepth(3, 0, 0.1);
    const shallowResult = findPath(grid, terrain, water, materials, { x: 3, z: 1 }, { x: 3, z: 0 }, WALKER)!;
    water.setDepth(3, 0, 0.5); // still within maxWadingDepth (0.5), but at its ceiling
    const deeperResult = findPath(grid, terrain, water, materials, { x: 3, z: 1 }, { x: 3, z: 0 }, WALKER)!;
    expect(deeperResult.cost).toBeGreaterThan(shallowResult.cost);
  });

  it("water depth exactly at maxWadingDepth is still walkable (the boundary is inclusive)", () => {
    const { grid, terrain, water, materials } = buildFlatWorld(3, 8, 3);
    water.setDepth(1, 1, 0.5); // == WALKER.maxWadingDepth
    const result = findPath(grid, terrain, water, materials, { x: 1, z: 0 }, { x: 1, z: 1 }, WALKER);
    expect(result).toBeDefined();
  });

  it("deep water blocks a non-swimming agent", () => {
    const { grid, terrain, water, materials } = buildFlatWorld(3, 8, 3);
    water.setDepth(1, 1, 3);
    const result = findPath(grid, terrain, water, materials, { x: 1, z: 0 }, { x: 1, z: 1 }, WALKER);
    expect(result).toBeUndefined();
  });

  it("deep water is traversable for a swimming-capable agent", () => {
    const { grid, terrain, water, materials } = buildFlatWorld(3, 8, 3);
    water.setDepth(1, 1, 3);
    const result = findPath(grid, terrain, water, materials, { x: 1, z: 0 }, { x: 1, z: 1 }, SWIMMER);
    expect(result).toBeDefined();
  });

  it("swimming costs more than an equivalent dry crossing", () => {
    const { grid, terrain, water, materials } = buildFlatWorld();
    water.setDepth(3, 0, 3);
    const swimResult = findPath(grid, terrain, water, materials, { x: 2, z: 0 }, { x: 3, z: 0 }, SWIMMER)!;
    const dryResult = findPath(grid, terrain, water, materials, { x: 2, z: 0 }, { x: 1, z: 0 }, SWIMMER)!;
    expect(swimResult.cost).toBeGreaterThan(dryResult.cost);
  });

  it("reflects current water state live -- no caching/staleness across successive calls", () => {
    const { grid, terrain, water, materials } = buildFlatWorld(3, 8, 3);
    const before = findPath(grid, terrain, water, materials, { x: 1, z: 0 }, { x: 1, z: 1 }, WALKER);
    expect(before).toBeDefined();
    water.setDepth(1, 1, 3);
    const afterDeepened = findPath(grid, terrain, water, materials, { x: 1, z: 0 }, { x: 1, z: 1 }, WALKER);
    expect(afterDeepened).toBeUndefined();
    water.setDepth(1, 1, 0);
    const afterDrained = findPath(grid, terrain, water, materials, { x: 1, z: 0 }, { x: 1, z: 1 }, WALKER);
    expect(afterDrained).toBeDefined();
  });
});

describe("findPath determinism", () => {
  it("the same map and query produce an identical result", () => {
    const { grid, terrain, water, materials } = buildFlatWorld();
    const resultA = findPath(grid, terrain, water, materials, { x: 0, z: 0 }, { x: 7, z: 7 }, WALKER);
    const resultB = findPath(grid, terrain, water, materials, { x: 0, z: 0 }, { x: 7, z: 7 }, WALKER);
    expect(resultB).toEqual(resultA);
  });
});
