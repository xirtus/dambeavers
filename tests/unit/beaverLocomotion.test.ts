import { describe, expect, it } from "vitest";
import { EntityIdRegistry } from "../../src/sim/core/EntityId.js";
import { ComponentStore } from "../../src/sim/core/ComponentStore.js";
import { WorldGrid } from "../../src/sim/world/WorldGrid.js";
import { TerrainField } from "../../src/sim/world/TerrainField.js";
import { MaterialRegistry } from "../../src/sim/materials/Material.js";
import { registerStandardMaterials } from "../../src/sim/materials/standardMaterials.js";
import { WaterField } from "../../src/sim/hydrology/WaterField.js";
import { setLocomotion, setSwimmer, setIdentity } from "../../src/sim/creatures/Beaver.js";
import { advanceTowards } from "../../src/sim/creatures/BeaverLocomotion.js";

function buildFlatWorld(sizeX = 8, sizeY = 8, sizeZ = 8, floor = 2) {
  const entities = new EntityIdRegistry();
  const components = new ComponentStore(entities);
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
  return { entities, components, grid, terrain, materials, water };
}

function spawnTestCreature(
  world: ReturnType<typeof buildFlatWorld>,
  at: { x: number; z: number },
  options: { speed: number; canSwim: boolean; maxWadingDepth: number },
) {
  const id = world.entities.create("beaver");
  const floor = world.grid.surfaceY(at.x, at.z)!;
  world.grid.setEntityPosition(id, at.x, floor + 1, at.z);
  setIdentity(world.components, id, { name: "Test Beaver" });
  setLocomotion(world.components, id, { speed: options.speed });
  setSwimmer(world.components, id, { canSwim: options.canSwim, maxWadingDepth: options.maxWadingDepth });
  return id;
}

describe("advanceTowards", () => {
  it("returns 'already-there' and does not move when goal equals current column", () => {
    const world = buildFlatWorld();
    const id = spawnTestCreature(world, { x: 3, z: 3 }, { speed: 5, canSwim: true, maxWadingDepth: 0.5 });
    const before = world.grid.positionOf(id);

    const result = advanceTowards(world.grid, world.terrain, world.water, world.materials, world.components, id, {
      x: 3,
      z: 3,
    });

    expect(result).toEqual({ outcome: "already-there", columnsAdvanced: 0 });
    expect(world.grid.positionOf(id)).toEqual(before);
  });

  it("reaches the goal in one call when speed comfortably covers the whole route", () => {
    const world = buildFlatWorld();
    const id = spawnTestCreature(world, { x: 0, z: 0 }, { speed: 100, canSwim: true, maxWadingDepth: 0.5 });

    const result = advanceTowards(world.grid, world.terrain, world.water, world.materials, world.components, id, {
      x: 3,
      z: 0,
    });

    expect(result.outcome).toBe("arrived");
    const floor = world.grid.surfaceY(3, 0)!;
    expect(world.grid.positionOf(id)).toEqual({ x: 3, y: floor + 1, z: 0 });
  });

  it("makes only partial progress over multiple calls when speed is small relative to the route", () => {
    const world = buildFlatWorld();
    const id = spawnTestCreature(world, { x: 0, z: 0 }, { speed: 0.1, canSwim: true, maxWadingDepth: 0.5 });

    const first = advanceTowards(world.grid, world.terrain, world.water, world.materials, world.components, id, {
      x: 5,
      z: 0,
    });
    expect(first.outcome).toBe("moved");
    expect(first.columnsAdvanced).toBe(1); // budget of 0.1 can't cover a second edge, but the first is mandatory
    expect(world.grid.positionOf(id)).toEqual({ x: 1, y: world.grid.surfaceY(1, 0)! + 1, z: 0 });
  });

  it("always advances at least one column per call, even with an arbitrarily tiny budget", () => {
    const world = buildFlatWorld();
    const id = spawnTestCreature(world, { x: 0, z: 0 }, { speed: 0.0001, canSwim: true, maxWadingDepth: 0.5 });

    const result = advanceTowards(world.grid, world.terrain, world.water, world.materials, world.components, id, {
      x: 5,
      z: 0,
    });

    expect(result.columnsAdvanced).toBe(1);
    expect(world.grid.positionOf(id)).toEqual({ x: 1, y: world.grid.surfaceY(1, 0)! + 1, z: 0 });
  });

  it("eventually arrives across repeated calls, one budget-limited step at a time", () => {
    const world = buildFlatWorld();
    const id = spawnTestCreature(world, { x: 0, z: 0 }, { speed: 1.6, canSwim: true, maxWadingDepth: 0.5 });

    let result;
    let iterations = 0;
    do {
      result = advanceTowards(world.grid, world.terrain, world.water, world.materials, world.components, id, {
        x: 4,
        z: 0,
      });
      iterations++;
      expect(iterations).toBeLessThan(20); // sanity bound -- must not loop forever
    } while (result.outcome === "moved");

    expect(result.outcome).toBe("arrived");
    expect(world.grid.positionOf(id)).toEqual({ x: 4, y: world.grid.surfaceY(4, 0)! + 1, z: 0 });
  });

  it("returns 'unreachable' for a non-swimmer facing water deeper than it can wade, with no throw and no movement", () => {
    const world = buildFlatWorld(3, 8, 3);
    world.water.setDepth(1, 1, 3); // deep water directly ahead, no detour in a 3-wide map
    const id = spawnTestCreature(world, { x: 1, z: 0 }, { speed: 5, canSwim: false, maxWadingDepth: 0.5 });
    const before = world.grid.positionOf(id);

    const result = advanceTowards(world.grid, world.terrain, world.water, world.materials, world.components, id, {
      x: 1,
      z: 1,
    });

    expect(result).toEqual({ outcome: "unreachable", columnsAdvanced: 0 });
    expect(world.grid.positionOf(id)).toEqual(before);
  });

  it("a swimmer succeeds on the exact same deep-water route that blocks a non-swimmer", () => {
    const world = buildFlatWorld(3, 8, 3);
    world.water.setDepth(1, 1, 3);
    const id = spawnTestCreature(world, { x: 1, z: 0 }, { speed: 100, canSwim: true, maxWadingDepth: 0.5 });

    const result = advanceTowards(world.grid, world.terrain, world.water, world.materials, world.components, id, {
      x: 1,
      z: 1,
    });

    expect(result.outcome).toBe("arrived");
  });

  it("re-evaluates world state fresh on every call -- a route blocked at spawn opens up once water recedes", () => {
    const world = buildFlatWorld(3, 8, 3);
    world.water.setDepth(1, 1, 3);
    const id = spawnTestCreature(world, { x: 1, z: 0 }, { speed: 100, canSwim: false, maxWadingDepth: 0.5 });

    expect(
      advanceTowards(world.grid, world.terrain, world.water, world.materials, world.components, id, { x: 1, z: 1 })
        .outcome,
    ).toBe("unreachable");

    world.water.setDepth(1, 1, 0);
    expect(
      advanceTowards(world.grid, world.terrain, world.water, world.materials, world.components, id, { x: 1, z: 1 })
        .outcome,
    ).toBe("arrived");
  });

  it("two creatures moving toward different goals never interfere with each other's route or position", () => {
    const world = buildFlatWorld(8, 8, 8);
    const a = spawnTestCreature(world, { x: 0, z: 0 }, { speed: 100, canSwim: true, maxWadingDepth: 0.5 });
    const b = spawnTestCreature(world, { x: 7, z: 7 }, { speed: 100, canSwim: true, maxWadingDepth: 0.5 });

    const resultA = advanceTowards(world.grid, world.terrain, world.water, world.materials, world.components, a, {
      x: 7,
      z: 0,
    });
    const resultB = advanceTowards(world.grid, world.terrain, world.water, world.materials, world.components, b, {
      x: 0,
      z: 7,
    });

    expect(resultA.outcome).toBe("arrived");
    expect(resultB.outcome).toBe("arrived");
    expect(world.grid.positionOf(a)).toEqual({ x: 7, y: world.grid.surfaceY(7, 0)! + 1, z: 0 });
    expect(world.grid.positionOf(b)).toEqual({ x: 0, y: world.grid.surfaceY(0, 7)! + 1, z: 7 });
  });

  it("throws for an entity missing Locomotion or Swimmer", () => {
    const world = buildFlatWorld();
    const bare = world.entities.create("beaver");
    world.grid.setEntityPosition(bare, 0, world.grid.surfaceY(0, 0)! + 1, 0);
    expect(() =>
      advanceTowards(world.grid, world.terrain, world.water, world.materials, world.components, bare, { x: 1, z: 0 }),
    ).toThrow(RangeError);
  });

  it("throws for an entity with no grid position", () => {
    const world = buildFlatWorld();
    const unplaced = world.entities.create("beaver");
    setLocomotion(world.components, unplaced, { speed: 1 });
    setSwimmer(world.components, unplaced, { canSwim: true, maxWadingDepth: 0.5 });
    expect(() =>
      advanceTowards(world.grid, world.terrain, world.water, world.materials, world.components, unplaced, {
        x: 1,
        z: 0,
      }),
    ).toThrow(RangeError);
  });
});
