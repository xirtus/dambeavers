import { describe, expect, it } from "vitest";
import { EntityIdRegistry } from "../../src/sim/core/EntityId.js";
import { WorldGrid } from "../../src/sim/world/WorldGrid.js";
import { TerrainField } from "../../src/sim/world/TerrainField.js";
import { MaterialRegistry } from "../../src/sim/materials/Material.js";
import { registerStandardMaterials } from "../../src/sim/materials/standardMaterials.js";
import { WaterField } from "../../src/sim/hydrology/WaterField.js";
import { stepFlow, applyEdgeDrainage } from "../../src/sim/hydrology/Flow.js";

function buildFlatWorld(sizeX = 8, sizeY = 10, sizeZ = 8, floor = 2) {
  const entities = new EntityIdRegistry();
  const grid = new WorldGrid({ sizeX, sizeY, sizeZ }, entities);
  const materials = new MaterialRegistry();
  registerStandardMaterials(materials);
  const terrain = new TerrainField(grid, materials);
  // Real material assignment (not raw grid.setSolid), so every floor cell
  // has an actual material -- stepFlow's sill-permeability check reads
  // real terrain material, so a test terrain with no material anywhere
  // would silently make every sill permeability check meaningless (always
  // falling back to "air").
  for (let x = 0; x < sizeX; x++) {
    for (let z = 0; z < sizeZ; z++) {
      for (let y = 0; y <= floor; y++) terrain.setMaterial(x, y, z, "soil");
    }
  }
  const water = new WaterField(grid);
  return { grid, terrain, materials, water };
}

describe("stepFlow basic exchange", () => {
  it("moves water from a wet column toward an adjacent dry column of equal floor", () => {
    const { terrain, materials, water } = buildFlatWorld();
    water.setDepth(3, 3, 4);
    stepFlow(water, terrain, materials, 1, { conductance: 0.5 });
    expect(water.depthAt(4, 3)).toBeGreaterThan(0);
    expect(water.depthAt(3, 3)).toBeLessThan(4);
  });

  it("conserves total volume exactly (no source/sink of its own)", () => {
    const { terrain, materials, water } = buildFlatWorld();
    water.setDepth(3, 3, 10);
    const before = water.getDebugState().totalVolume;
    for (let i = 0; i < 20; i++) stepFlow(water, terrain, materials, 1, { conductance: 0.4 });
    const after = water.getDebugState().totalVolume;
    expect(after).toBeCloseTo(before, 6);
  });

  it("spreads isotropically (lateral spread) to all 4 neighbors from a flat floor", () => {
    const { terrain, materials, water } = buildFlatWorld();
    water.setDepth(4, 4, 8);
    stepFlow(water, terrain, materials, 1, { conductance: 0.5 });
    expect(water.depthAt(5, 4)).toBeGreaterThan(0);
    expect(water.depthAt(3, 4)).toBeGreaterThan(0);
    expect(water.depthAt(4, 5)).toBeGreaterThan(0);
    expect(water.depthAt(4, 3)).toBeGreaterThan(0);
  });

  it("never drives a column negative even with a large conductance/dt", () => {
    const { terrain, materials, water } = buildFlatWorld();
    water.setDepth(3, 3, 5);
    for (let i = 0; i < 10; i++) {
      stepFlow(water, terrain, materials, 1, { conductance: 50 });
    }
    // Sample a broad grid of columns -- none should ever be negative (WaterField.setDepth would have thrown already if one were).
    for (let x = 0; x < 8; x++) {
      for (let z = 0; z < 8; z++) {
        expect(water.depthAt(x, z)).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("does not move water between two columns already at equal water surface", () => {
    const { terrain, materials, water } = buildFlatWorld();
    water.setDepth(3, 3, 4);
    water.setDepth(4, 3, 4);
    // A tiny conductance keeps each column's exchange with its OTHER
    // (dry) neighbors a small perturbation, isolating what this test
    // actually checks: the (3,3)/(4,3) pair itself, at equal surface,
    // exchanges nothing directly.
    stepFlow(water, terrain, materials, 1, { conductance: 0.001 });
    expect(water.depthAt(3, 3)).toBeCloseTo(water.depthAt(4, 3), 9);
    expect(water.depthAt(3, 3)).toBeCloseTo(4, 1);
  });

  it("is a no-op with zero dt or zero conductance", () => {
    const { terrain, materials, water } = buildFlatWorld();
    water.setDepth(3, 3, 4);
    stepFlow(water, terrain, materials, 0, { conductance: 0.5 });
    expect(water.depthAt(3, 3)).toBe(4);
    expect(water.depthAt(4, 3)).toBe(0);
    stepFlow(water, terrain, materials, 1, { conductance: 0 });
    expect(water.depthAt(3, 3)).toBe(4);
    expect(water.depthAt(4, 3)).toBe(0);
  });

  it("rejects a negative dtSeconds or negative conductance", () => {
    const { terrain, materials, water } = buildFlatWorld();
    expect(() => stepFlow(water, terrain, materials, -1)).toThrow(RangeError);
    expect(() => stepFlow(water, terrain, materials, 1, { conductance: -1 })).toThrow(RangeError);
  });
});

describe("stepFlow downhill / obstruction / overtopping", () => {
  it("flows from a higher-floor column to a lower-floor one, driven by terrain slope alone", () => {
    const { grid, terrain, materials, water } = buildFlatWorld(8, 10, 8, 3);
    // lower the floor of the neighbor at (4,3) by one cell
    grid.setSolid(4, 3, 3, false);
    water.setDepth(3, 3, 2); // higher floor (3), some depth
    stepFlow(water, terrain, materials, 1, { conductance: 0.5 });
    expect(water.depthAt(4, 3)).toBeGreaterThan(0);
  });

  it("a solid obstruction at the sill crest reduces flow relative to an open sill of the same geometry", () => {
    const worldOpen = buildFlatWorld();
    worldOpen.water.setDepth(3, 3, 6);

    const worldBlocked = buildFlatWorld();
    // Place a stone obstruction cell directly at the sill crest between (3,3) and (4,3): floor is 2, sill crest is y=3.
    worldBlocked.terrain.setMaterial(4, 3, 3, "stone"); // low-permeability material right above the neighbor's floor
    worldBlocked.water.setDepth(3, 3, 6);

    stepFlow(worldOpen.water, worldOpen.terrain, worldOpen.materials, 1, { conductance: 0.5 });
    stepFlow(worldBlocked.water, worldBlocked.terrain, worldBlocked.materials, 1, { conductance: 0.5 });

    expect(worldBlocked.water.depthAt(4, 3)).toBeLessThan(worldOpen.water.depthAt(4, 3));
  });

  it("a fully impermeable sill (permeability 0) blocks flow entirely, at the SAME geometric height as an open one", () => {
    const { terrain, materials, water, grid } = buildFlatWorld();
    materials.define({
      id: "impermeable-wall",
      displayName: "Impermeable Wall",
      density: 3000,
      hardness: 10,
      strength: 10,
      friction: 1,
      permeability: 0,
      buoyancy: 1,
      thermalConductivity: 1,
      organic: false,
      decayResistance: 1,
    });
    // Replace the material AT the existing floor height (y=2) rather than
    // adding a new cell above it -- isolates permeability's own effect
    // from the separate (and already-covered) geometric-obstruction
    // effect of a raised sill.
    terrain.setMaterial(4, 2, 3, "impermeable-wall");
    expect(grid.surfaceY(4, 3)).toBe(2); // same floor height as the open case -- only the material changed
    water.setDepth(3, 3, 6);
    stepFlow(water, terrain, materials, 1, { conductance: 0.5 });
    expect(water.depthAt(4, 3)).toBe(0);
  });

  it("overtopping: once water rises above an obstruction's height, flow resumes past it", () => {
    const { grid, terrain, materials, water } = buildFlatWorld(8, 10, 8, 2);
    // Raise a 1-cell-tall obstruction between (3,3) and (4,3) at the shared boundary height.
    grid.setSolid(4, 3, 3, true); // neighbor floor raised to 3 (was 2)
    water.setDepth(3, 3, 0.5); // surface at 2.5 -- below the obstruction (3), should not overtop yet
    stepFlow(water, terrain, materials, 1, { conductance: 0.5 });
    expect(water.depthAt(4, 3)).toBe(0);

    water.setDepth(3, 3, 3); // surface at 5 -- now well above the obstruction (3)
    stepFlow(water, terrain, materials, 1, { conductance: 0.5 });
    expect(water.depthAt(4, 3)).toBeGreaterThan(0);
  });
});

describe("stepFlow stability under continuous inflow", () => {
  // Regression coverage for a genuine correctness bug an earlier version
  // had: the raw conductance*permeability*flowDepth*headDiff*dt formula
  // has no inherent bound, so under continuous per-tick inflow at a fixed
  // source (exactly the roadmap's own "inflow" requirement -- and exactly
  // what the P1-03 acceptance test does), a single step could transfer
  // MORE than needed to equalize a pair, overshooting past equilibrium;
  // the next step reversed just as hard, producing an undamped, GROWING
  // oscillation that bounced between 0 and a rising peak every single
  // tick, even at the function's own previously-documented "conservative"
  // default. The fix caps each pair's transfer at a safe fraction of its
  // own head difference, independent of conductance/dt/depth magnitude.

  it("depth at a continuously-fed source rises smoothly, never bouncing back to (near) zero", () => {
    for (const conductance of [0.2, 0.5, 0.6, 2, 10]) {
      const { terrain, materials, water } = buildFlatWorld(9, 10, 9);
      const trace: number[] = [];
      for (let tick = 0; tick < 150; tick++) {
        water.addVolume(4, 4, 3);
        stepFlow(water, terrain, materials, 1, { conductance });
        trace.push(water.depthAt(4, 4));
      }
      const tail = trace.slice(-30);
      for (const depth of tail) {
        expect(depth, `conductance=${conductance}: source depth dropped near zero -- oscillating`).toBeGreaterThan(0.5);
      }
      // monotonically non-decreasing in the tail -- steady accumulation, no bounce
      for (let i = 1; i < tail.length; i++) {
        expect(
          tail[i]!,
          `conductance=${conductance} tick ${i}: depth decreased -- bounce detected`,
        ).toBeGreaterThanOrEqual(tail[i - 1]! - 1e-9);
      }
    }
  });

  it("a column with 4 deep neighbors pushing simultaneously never overshoots past their shared level", () => {
    const { terrain, materials, water } = buildFlatWorld(9, 10, 9);
    water.setDepth(3, 4, 10);
    water.setDepth(5, 4, 10);
    water.setDepth(4, 3, 10);
    water.setDepth(4, 5, 10);
    // center (4,4) starts dry, surrounded on all 4 sides by depth 10
    stepFlow(water, terrain, materials, 1, { conductance: 50 }); // aggressively large conductance
    expect(water.depthAt(4, 4)).toBeLessThanOrEqual(10 + 1e-9); // never overshoots past the neighbors' own level
    expect(water.depthAt(4, 4)).toBeGreaterThan(0); // but did receive real inflow
  });

  it("still converges toward the same equilibrium a single-dump-into-a-closed-basin would reach via fillBasin", () => {
    const { grid, terrain, materials, water } = buildFlatWorld(15, 10, 15);
    // wall off a closed 11x11 interior bowl (floor already 2 everywhere from buildFlatWorld's own setup)
    for (let x = 0; x < 15; x++) {
      for (let z = 0; z < 15; z++) {
        const isWall = x < 2 || x >= 13 || z < 2 || z >= 13;
        if (isWall) terrain.setMaterial(x, 3, z, "stone"); // raise walls to floor=3, above the interior's floor=2
      }
    }
    water.setDepth(7, 7, 121 * 3); // dump a large volume at the center in one shot (all in one column)
    for (let i = 0; i < 400; i++) stepFlow(water, terrain, materials, 1, { conductance: 1 });

    // roughly uniform depth across the interior (equilibrium reached), matching total volume conservation
    const centerDepth = water.depthAt(7, 7);
    const edgeOfInteriorDepth = water.depthAt(2, 2);
    expect(Math.abs(centerDepth - edgeOfInteriorDepth)).toBeLessThan(0.5);
    expect(grid.surfaceY(0, 0)).toBeGreaterThan(0); // sanity: walls exist
  });

  it("permeability differences remain observable even once the stability cap engages, at this function's own default conductance", () => {
    // Regression coverage for a second bug the stability-cap fix itself
    // introduced and this review caught before shipping: the cap was
    // originally permeability-INDEPENDENT, so two sills of very different
    // permeability clamped to the identical value once either raw
    // transfer exceeded the cap -- silently erasing "permeability" as an
    // observable difference at exactly the depths/conductances where the
    // cap engages (including this project's own documented default).
    const worldLow = buildFlatWorld();
    worldLow.terrain.setMaterial(4, 2, 3, "stone"); // permeability 0.05
    worldLow.water.setDepth(3, 3, 6);

    const worldHigh = buildFlatWorld();
    worldHigh.materials.define({
      id: "medium-permeable",
      displayName: "Medium Permeable",
      density: 1500,
      hardness: 2,
      strength: 2,
      friction: 0.5,
      permeability: 0.3,
      buoyancy: 1,
      thermalConductivity: 1,
      organic: false,
      decayResistance: 1,
    });
    worldHigh.terrain.setMaterial(4, 2, 3, "medium-permeable"); // permeability 0.3
    worldHigh.water.setDepth(3, 3, 6);

    stepFlow(worldLow.water, worldLow.terrain, worldLow.materials, 1); // default conductance, no override
    stepFlow(worldHigh.water, worldHigh.terrain, worldHigh.materials, 1);

    expect(worldHigh.water.depthAt(4, 3)).toBeGreaterThan(worldLow.water.depthAt(4, 3));
  });
});

describe("stepFlow determinism", () => {
  it("the same starting state and parameters produce identical results", () => {
    const worldA = buildFlatWorld();
    const worldB = buildFlatWorld();
    worldA.water.setDepth(3, 3, 7);
    worldB.water.setDepth(3, 3, 7);
    for (let i = 0; i < 15; i++) {
      stepFlow(worldA.water, worldA.terrain, worldA.materials, 1, { conductance: 0.3 });
      stepFlow(worldB.water, worldB.terrain, worldB.materials, 1, { conductance: 0.3 });
    }
    for (let x = 0; x < 8; x++) {
      for (let z = 0; z < 8; z++) {
        expect(worldB.water.depthAt(x, z)).toBe(worldA.water.depthAt(x, z));
      }
    }
  });
});

describe("applyEdgeDrainage", () => {
  it("removes water proportional to depth at columns touching the map boundary", () => {
    const { water } = buildFlatWorld();
    water.setDepth(0, 3, 10); // x=0 touches the edge
    applyEdgeDrainage(water, 1, { drainRate: 0.5 });
    expect(water.depthAt(0, 3)).toBeCloseTo(5, 6);
  });

  it("does not touch interior columns", () => {
    const { water } = buildFlatWorld();
    water.setDepth(4, 4, 10); // interior, doesn't touch any edge
    applyEdgeDrainage(water, 1, { drainRate: 0.5 });
    expect(water.depthAt(4, 4)).toBe(10);
  });

  it("never drains more than what's present", () => {
    const { water } = buildFlatWorld();
    water.setDepth(0, 0, 2);
    applyEdgeDrainage(water, 1, { drainRate: 5 > 1 ? 1 : 5 }); // drainRate clamped to valid range by the caller; use max legal 1
    expect(water.depthAt(0, 0)).toBeGreaterThanOrEqual(0);
  });

  it("rejects an out-of-range drainRate or negative dtSeconds", () => {
    const { water } = buildFlatWorld();
    expect(() => applyEdgeDrainage(water, 1, { drainRate: 1.5 })).toThrow(RangeError);
    expect(() => applyEdgeDrainage(water, 1, { drainRate: -0.1 })).toThrow(RangeError);
    expect(() => applyEdgeDrainage(water, -1, { drainRate: 0.5 })).toThrow(RangeError);
  });

  it("is a no-op with zero dt or zero drainRate", () => {
    const { water } = buildFlatWorld();
    water.setDepth(0, 0, 5);
    applyEdgeDrainage(water, 0, { drainRate: 0.5 });
    expect(water.depthAt(0, 0)).toBe(5);
    applyEdgeDrainage(water, 1, { drainRate: 0 });
    expect(water.depthAt(0, 0)).toBe(5);
  });
});
