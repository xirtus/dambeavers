/**
 * Headless acceptance test for P1-12 — Accessibility recomputation from water state.
 *
 * Roadmap acceptance test (DAMN_BEAVERS_MASTER_ROADMAP.md, P1-12):
 *   "a previously valid ground route disappears when pond depth exceeds
 *   walk threshold and reappears when water recedes."
 *
 * This task adds NO new production code: P1-04's `findPath`/`edgeCost`
 * already read `WaterField.depthAt` LIVE on every single call, with no
 * cache, no invalidation bookkeeping, and no hand-authored "walkable" map
 * flag anywhere in the codebase (confirmed by grep -- the only
 * "reachable"/"walkable" concepts anywhere are live, derived query
 * results, never stored state) -- exactly the roadmap's own framing:
 * "Pathfinding reacts to hydrological state, not hand-authored map
 * flags." `Pathfinding.ts`'s own doc comment already states this
 * explicitly: "calling this again after water rises... automatically
 * reflects the new reality." P1-12's entire deliverable is this literal,
 * end-to-end proof, using REAL, dynamic hydrology (`Flow.ts`'s `stepFlow`/
 * `applyEdgeDrainage`, P1-03, entirely unmodified) to actually raise and
 * then lower a real pond -- never a hand-set depth standing in for one.
 */
import { describe, expect, it } from "vitest";
import { EntityIdRegistry } from "../../src/sim/core/EntityId.js";
import { WorldGrid } from "../../src/sim/world/WorldGrid.js";
import { TerrainField, applyHeightfield, type StrataLayer } from "../../src/sim/world/TerrainField.js";
import { MaterialRegistry } from "../../src/sim/materials/Material.js";
import { registerStandardMaterials } from "../../src/sim/materials/standardMaterials.js";
import { WaterField } from "../../src/sim/hydrology/WaterField.js";
import { stepFlow, applyEdgeDrainage } from "../../src/sim/hydrology/Flow.js";
import { findPath, type NavigationProfile } from "../../src/sim/navigation/Pathfinding.js";

const SIZE_X = 5;
const SIZE_Y = 10;
const SIZE_Z = 16;
const SOURCE_X = 2;
const SOURCE_Z = 2;
const FORD_Z = 8; // the low midpoint of the channel a ground route must cross
const START = { x: SOURCE_X, z: 2 };
const GOAL = { x: SOURCE_X, z: 14 };
// A non-swimming ground traveler: real water deeper than this genuinely blocks it (P1-04's own "too-deep-to-cross").
const WALKER_PROFILE: NavigationProfile = { canSwim: false, maxWadingDepth: 0.3 };

function buildChannel() {
  const entities = new EntityIdRegistry();
  const grid = new WorldGrid({ sizeX: SIZE_X, sizeY: SIZE_Y, sizeZ: SIZE_Z }, entities);
  const materials = new MaterialRegistry();
  registerStandardMaterials(materials);
  const terrain = new TerrainField(grid, materials);
  const strata: StrataLayer[] = [
    { materialId: "soil", depth: 2 },
    { materialId: "stone", depth: 1000 },
  ];
  // The same open, uniform-width sloped channel geometry
  // p1-03-flow-acceptance.test.ts itself uses.
  applyHeightfield(terrain, (_x, z) => 5 - (z / (SIZE_Z - 1)) * 3, strata);
  const water = new WaterField(grid);
  return { grid, terrain, materials, water };
}

describe("P1-12 acceptance: a previously valid ground route disappears when pond depth exceeds walk threshold and reappears when water recedes", () => {
  it("holds via real, dynamic WaterField/Flow.ts mechanics -- no hand-set depth, no map flag, purely findPath reading live state", () => {
    const { grid, terrain, materials, water } = buildChannel();

    // Before any water: a real, valid ground route exists straight through the ford.
    const before = findPath(grid, terrain, water, materials, START, GOAL, WALKER_PROFILE);
    expect(before).toBeDefined();
    expect(water.depthAt(SOURCE_X, FORD_Z)).toBe(0);

    // A real pond forms: sustained upstream inflow, dynamically redistributed
    // downhill by stepFlow (P1-03, unmodified) -- not a hand-set depth.
    for (let tick = 0; tick < 60; tick++) {
      water.addVolume(SOURCE_X, SOURCE_Z, 5);
      stepFlow(water, terrain, materials, 1, { conductance: 0.8 });
    }
    // The whole channel width at the ford is now genuinely deep -- confirms
    // this is a real pond spanning the crossing, not a single lucky column.
    for (let x = 0; x < SIZE_X; x++) expect(water.depthAt(x, FORD_Z)).toBeGreaterThan(WALKER_PROFILE.maxWadingDepth);

    // The previously valid route now genuinely disappears -- no detour
    // exists in this channel width once the whole crossing is flooded.
    const flooded = findPath(grid, terrain, water, materials, START, GOAL, WALKER_PROFILE);
    expect(flooded).toBeUndefined();

    // The pond recedes: inflow stops, and REAL drainage (edge outflow,
    // P1-03's own `applyEdgeDrainage`, unmodified) combined with ongoing
    // redistribution lowers it over time -- not a hand-set depth reduction.
    for (let tick = 0; tick < 400; tick++) {
      stepFlow(water, terrain, materials, 1, { conductance: 0.8 });
      applyEdgeDrainage(water, 1, { drainRate: 0.3 });
    }
    expect(water.depthAt(SOURCE_X, FORD_Z)).toBeLessThan(WALKER_PROFILE.maxWadingDepth);

    // The route reappears -- the SAME findPath call, reading the SAME
    // live WaterField, with no separate "recompute accessibility" step
    // anywhere: recomputation IS just calling findPath again.
    const receded = findPath(grid, terrain, water, materials, START, GOAL, WALKER_PROFILE);
    expect(receded).toBeDefined();
  });
});
