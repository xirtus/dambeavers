import { describe, expect, it } from "vitest";
import { EntityIdRegistry } from "../../src/sim/core/EntityId.js";
import { WorldGrid } from "../../src/sim/world/WorldGrid.js";
import { TerrainField } from "../../src/sim/world/TerrainField.js";
import { MaterialRegistry } from "../../src/sim/materials/Material.js";
import { registerStandardMaterials } from "../../src/sim/materials/standardMaterials.js";
import { WaterField } from "../../src/sim/hydrology/WaterField.js";
import {
  setBreath,
  getBreath,
  assertValidBreath,
  applyBreathTick,
  canBreatheAt,
  BASELINE_BREATH,
  BREATH_DEPLETION_PER_TICK,
  BREATH_RECOVERY_PER_TICK,
} from "../../src/sim/creatures/Respiration.js";
import { ComponentStore } from "../../src/sim/core/ComponentStore.js";

function buildFlatWorld(sizeX = 10, sizeY = 10, sizeZ = 10, floor = 2) {
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

describe("Breath component", () => {
  it("round-trips a valid fraction", () => {
    const world = buildFlatWorld();
    const id = world.entities.create("beaver");
    setBreath(world.components, id, { fraction: 0.42 });
    expect(getBreath(world.components, id)).toEqual({ fraction: 0.42 });
  });

  it("BASELINE_BREATH is a full breath", () => {
    expect(BASELINE_BREATH).toEqual({ fraction: 1 });
  });

  it("rejects a fraction outside [0, 1]", () => {
    expect(() => assertValidBreath({ fraction: -0.01 })).toThrow(RangeError);
    expect(() => assertValidBreath({ fraction: 1.01 })).toThrow(RangeError);
    expect(() => assertValidBreath({ fraction: NaN })).toThrow(RangeError);
  });
});

describe("applyBreathTick", () => {
  it("depletes while unable to breathe", () => {
    const result = applyBreathTick(BASELINE_BREATH, false);
    expect(result.fraction).toBeCloseTo(1 - BREATH_DEPLETION_PER_TICK, 10);
  });

  it("recovers while able to breathe", () => {
    const low = { fraction: 0.1 };
    const result = applyBreathTick(low, true);
    expect(result.fraction).toBeCloseTo(0.1 + BREATH_RECOVERY_PER_TICK, 10);
  });

  it("recovery is faster than depletion -- a beaver doesn't stay winded for long once it can breathe again", () => {
    expect(BREATH_RECOVERY_PER_TICK).toBeGreaterThan(BREATH_DEPLETION_PER_TICK);
  });

  it("clamps to [0, 1]", () => {
    expect(applyBreathTick({ fraction: 0.01 }, false).fraction).toBeGreaterThanOrEqual(0);
    expect(applyBreathTick({ fraction: 0.99 }, true).fraction).toBeLessThanOrEqual(1);
  });

  it("rejects an already-invalid input", () => {
    expect(() => applyBreathTick({ fraction: 1.5 }, true)).toThrow(RangeError);
  });
});

describe("canBreatheAt", () => {
  it("a dry column is always breathable", () => {
    const world = buildFlatWorld();
    const floor = world.grid.surfaceY(3, 3)!;
    expect(canBreatheAt(world.grid, world.water, 3, floor + 1, 3)).toBe(true);
  });

  it("a wet column with open air above the water surface is breathable -- ordinary swimming, not drowning", () => {
    const world = buildFlatWorld();
    const floor = world.grid.surfaceY(3, 3)!;
    world.water.setDepth(3, 3, 2); // deep water, but nothing capping the column above it
    expect(canBreatheAt(world.grid, world.water, 3, floor + 1, 3)).toBe(true);
  });

  it("REGRESSION (P1-16 acceptance): a beaver in a fully sealed, flooded chamber cannot breathe -- genuinely unable to surface", () => {
    const world = buildFlatWorld(10, 8, 10, 2);
    const floor = world.grid.surfaceY(3, 3)!; // captured BEFORE the ceiling is placed
    // Seal a solid ceiling directly above the water at (3,3), leaving no air gap.
    world.water.setDepth(3, 3, 4); // fills from floor+1 up through floor+4
    world.terrain.setMaterial(3, floor + 5, 3, "stone"); // ceiling just above the water surface

    expect(canBreatheAt(world.grid, world.water, 3, floor + 1, 3)).toBe(false);
  });

  it("REGRESSION (critic review): the sealed-chamber case genuinely detects the ceiling on a LARGE map, not merely by coincidentally hitting the map's own vertical extent -- the exact scenario a prior version of this function got wrong by re-deriving 'floor' via grid.surfaceY(x, z), which silently returns the ceiling's own y once one is placed above the real floor", () => {
    const world = buildFlatWorld(30, 30, 30, 2); // plenty of headroom above the map's own vertical extent -- the y >= sizeY fallback can never accidentally paper over a bug here
    const floor = world.grid.surfaceY(4, 4)!; // captured BEFORE the ceiling is placed
    world.water.setDepth(4, 4, 4);
    world.terrain.setMaterial(4, floor + 5, 4, "stone");

    // Confirms the exact failure mode found during critic review: without
    // anchoring on the beaver's own known y, grid.surfaceY(4, 4) after the
    // ceiling is placed returns the CEILING's y (now the topmost solid
    // cell), silently corrupting the whole calculation into reporting
    // "breathable" on a map large enough that the y >= sizeY fallback
    // never engages to accidentally mask it.
    expect(canBreatheAt(world.grid, world.water, 4, floor + 1, 4)).toBe(false);
  });

  it("a solid ceiling that sits ABOVE the water surface (a real air gap beneath it) is still breathable", () => {
    const world = buildFlatWorld(10, 12, 10, 2);
    const floor = world.grid.surfaceY(3, 3)!; // captured BEFORE the ceiling is placed
    world.water.setDepth(3, 3, 1); // shallow-ish, well below the ceiling
    world.terrain.setMaterial(3, floor + 6, 3, "stone"); // far above the water surface -- real air gap remains

    expect(canBreatheAt(world.grid, world.water, 3, floor + 1, 3)).toBe(true);
  });

  it("water filling the map's entire vertical extent (no ceiling needed) is unbreathable", () => {
    const world = buildFlatWorld(10, 6, 10, 2); // small vertical extent
    const floor = world.grid.surfaceY(3, 3)!;
    const roomAbove = world.grid.dims.sizeY - (floor + 1);
    world.water.setDepth(3, 3, roomAbove + 1); // deep enough to reach (and exceed) the map ceiling

    expect(canBreatheAt(world.grid, world.water, 3, floor + 1, 3)).toBe(false);
  });
});
