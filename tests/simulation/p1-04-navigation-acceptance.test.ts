/**
 * Headless acceptance test for P1-04 — Unified terrestrial/aquatic navigation.
 *
 * Roadmap acceptance test (DAMN_BEAVERS_MASTER_ROADMAP.md, P1-04):
 *   "when a ford becomes too deep, a walking-only test agent loses the
 *   route while a swimming-capable beaver finds an aquatic route."
 *
 * There is no dam/beaver/job system yet (those are later Phase 1 tasks)
 * -- the water level change here is applied directly via `WaterField`
 * (P1-02), exactly the kind of world-state edit a future dam-building
 * system would eventually cause. `findPath` is never told "the ford
 * flooded"; it just re-reads current `WaterField` state on its next call,
 * per ARCHITECTURE_CONTRACT §11 / M0's navigation contract ("discover
 * changed traversability from world state," not be manually notified).
 */
import { describe, expect, it } from "vitest";
import { EntityIdRegistry } from "../../src/sim/core/EntityId.js";
import { WorldGrid } from "../../src/sim/world/WorldGrid.js";
import { TerrainField } from "../../src/sim/world/TerrainField.js";
import { MaterialRegistry } from "../../src/sim/materials/Material.js";
import { registerStandardMaterials } from "../../src/sim/materials/standardMaterials.js";
import { WaterField } from "../../src/sim/hydrology/WaterField.js";
import { findPath, type NavigationProfile } from "../../src/sim/navigation/Pathfinding.js";

const SIZE_X = 7;
const SIZE_Y = 8;
const SIZE_Z = 11;
const FORD_Z = 5; // the river band crossing the map at this z
const START = { x: 3, z: 1 };
const GOAL = { x: 3, z: 9 };

function buildFordMap() {
  const entities = new EntityIdRegistry();
  const grid = new WorldGrid({ sizeX: SIZE_X, sizeY: SIZE_Y, sizeZ: SIZE_Z }, entities);
  const materials = new MaterialRegistry();
  registerStandardMaterials(materials);
  const terrain = new TerrainField(grid, materials);
  for (let x = 0; x < SIZE_X; x++) {
    for (let z = 0; z < SIZE_Z; z++) {
      const floor = z === FORD_Z ? 1 : 2; // the river band is a shallow dip crossing the whole map width
      for (let y = 0; y <= floor; y++) terrain.setMaterial(x, y, z, "soil");
    }
  }
  const water = new WaterField(grid);
  return { grid, terrain, materials, water };
}

const WALKING_AGENT: NavigationProfile = { canSwim: false, maxWadingDepth: 0.5 };
const SWIMMING_BEAVER: NavigationProfile = { canSwim: true, maxWadingDepth: 0.5 };

describe("P1-04 acceptance: a deepening ford defeats a walker but not a swimmer", () => {
  it("both agents cross while the ford is shallow", () => {
    const { grid, terrain, water, materials } = buildFordMap();
    for (let x = 0; x < SIZE_X; x++) water.setDepth(x, FORD_Z, 0.3); // shallow -- within wading depth

    const walkerRoute = findPath(grid, terrain, water, materials, START, GOAL, WALKING_AGENT);
    const swimmerRoute = findPath(grid, terrain, water, materials, START, GOAL, SWIMMING_BEAVER);

    expect(walkerRoute).toBeDefined();
    expect(swimmerRoute).toBeDefined();
  });

  it("once the ford deepens past wading depth, the walking-only agent loses the route while the swimming-capable beaver still finds one", () => {
    const { grid, terrain, water, materials } = buildFordMap();
    for (let x = 0; x < SIZE_X; x++) water.setDepth(x, FORD_Z, 3); // deep -- across the whole river band, no dry detour

    const walkerRoute = findPath(grid, terrain, water, materials, START, GOAL, WALKING_AGENT);
    const swimmerRoute = findPath(grid, terrain, water, materials, START, GOAL, SWIMMING_BEAVER);

    expect(walkerRoute).toBeUndefined();
    expect(swimmerRoute).toBeDefined();
    // the swimmer's route genuinely crosses the deepened ford, not some other way around
    expect(swimmerRoute!.columns.some((c) => c.z === FORD_Z)).toBe(true);
  });

  it("the SAME query re-evaluated after the water recedes finds a walking route again -- no stale cache, no manual notification", () => {
    const { grid, terrain, water, materials } = buildFordMap();
    for (let x = 0; x < SIZE_X; x++) water.setDepth(x, FORD_Z, 3);
    expect(findPath(grid, terrain, water, materials, START, GOAL, WALKING_AGENT)).toBeUndefined();

    for (let x = 0; x < SIZE_X; x++) water.setDepth(x, FORD_Z, 0);
    expect(findPath(grid, terrain, water, materials, START, GOAL, WALKING_AGENT)).toBeDefined();
  });
});
