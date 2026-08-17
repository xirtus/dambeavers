/**
 * Headless acceptance test for P3-14 -- Bridges and elevated routes.
 *
 * Roadmap acceptance test: "a completed bridge creates a valid route
 * above water; structural failure removes it."
 *
 * A map-spanning river blocks a non-swimmer completely. One completed
 * bridge construction applies real solid terrain whose deck clears the
 * water surface, displacing the column's open water, and `findPath`
 * finds a route across the river THROUGH that deck where none existed
 * before. Flood stress then collapses the segment: the deck terrain is
 * excavated, the displaced water is released back, and the route is gone.
 */
import { describe, expect, it } from "vitest";
import { EntityIdRegistry, type EntityId } from "../../src/sim/core/EntityId.js";
import { ComponentStore } from "../../src/sim/core/ComponentStore.js";
import { SimulationClock } from "../../src/sim/core/SimulationClock.js";
import { RandomStreams } from "../../src/sim/core/Random.js";
import { WorldGrid } from "../../src/sim/world/WorldGrid.js";
import { TerrainField } from "../../src/sim/world/TerrainField.js";
import { EventLog } from "../../src/sim/history/EventLog.js";
import { MaterialRegistry } from "../../src/sim/materials/Material.js";
import { registerStandardMaterials } from "../../src/sim/materials/standardMaterials.js";
import { WaterField } from "../../src/sim/hydrology/WaterField.js";
import { Weather } from "../../src/sim/weather/Weather.js";
import type { World } from "../../src/sim/persistence/WorldSnapshot.js";
import type { NavigationProfile } from "../../src/sim/navigation/Pathfinding.js";
import { findPath } from "../../src/sim/navigation/Pathfinding.js";
import { setConstruction } from "../../src/sim/labor/Construction.js";
import { applyBridgeSegment, tickBridgeStructure, getBridgeSegment } from "../../src/sim/structures/Bridge.js";
import { getGood } from "../../src/sim/economy/Good.js";

const PROFILE: NavigationProfile = { canSwim: false, maxWadingDepth: 0.5 };

function buildWorld(): { world: World; materials: MaterialRegistry } {
  const entities = new EntityIdRegistry();
  const components = new ComponentStore(entities);
  const grid = new WorldGrid({ sizeX: 20, sizeY: 12, sizeZ: 20 }, entities);
  const materials = new MaterialRegistry();
  registerStandardMaterials(materials);
  const terrain = new TerrainField(grid, materials);
  for (let x = 0; x < 20; x++) for (let z = 0; z < 20; z++) for (let y = 0; y <= 2; y++) terrain.setMaterial(x, y, z, "soil");
  const water = new WaterField(grid);
  const weather = new Weather();
  const clock = new SimulationClock({ tickRateHz: 20 });
  const random = new RandomStreams(114);
  const events = new EventLog(entities);
  return { world: { clock, random, entities, components, grid, terrain, events, water, weather }, materials };
}

function completeBridgeConstruction(world: World, x: number, z: number): EntityId {
  const id = world.entities.create("construction");
  setConstruction(world.components, id, { designationId: id, kind: "bridge", site: { x, z }, requiredMaterialId: "wood", requiredMassKg: 1, workDone: 1, workRequired: 1, status: "complete" });
  return applyBridgeSegment(world, id);
}

describe("P3-14 -- Bridges and elevated routes", () => {
  it("a completed bridge creates a route above water and structural failure removes it", () => {
    const { world, materials } = buildWorld();
    // A river spans the whole map at x=11 -- a non-swimmer cannot cross.
    for (let z = 0; z < 20; z++) world.water.setDepth(11, z, 1);
    const start = { x: 9, z: 10 };
    const goal = { x: 13, z: 10 };

    const before = findPath(world.grid, world.terrain, world.water, materials, start, goal, PROFILE);
    expect(before).toBeUndefined(); // the river is too deep to wade, and the profile cannot swim

    // One completed bridge over the river: real solid deck clearing the
    // water surface (surface y=3, deck y=4), water displaced below it.
    const waterSurfaceBefore = world.water.waterSurfaceY(11, 10)!;
    const bridgeId = completeBridgeConstruction(world, 11, 10);
    const bridge = getBridgeSegment(world.components, bridgeId)!;
    expect(bridge.y).toBeGreaterThan(waterSurfaceBefore);
    expect(world.terrain.materialAt(11, bridge.y, 10)).toBe("wood");
    expect(world.grid.isSolid(11, bridge.y, 10)).toBe(true);
    expect(bridge.displacedDepthL).toBe(1);
    expect(world.water.depthAt(11, 10)).toBe(0); // no open water above the deck

    // A valid route above water now exists -- and it crosses the river
    // exactly through the decked column.
    const after = findPath(world.grid, world.terrain, world.water, materials, start, goal, PROFILE);
    expect(after).toBeDefined();
    expect(after!.columns.some((c) => c.x === 11 && c.z === 10)).toBe(true);

    // Structural failure: sustained flood stress exhausts the segment,
    // the deck is excavated, the displaced water is released, and the
    // route is gone.
    world.water.setDepth(11, 10, 500);
    let result: "intact" | "collapsed" = "intact";
    for (let i = 0; i < 1000 && result === "intact"; i++) {
      result = tickBridgeStructure(world, materials, bridgeId);
    }
    expect(result).toBe("collapsed");
    expect(world.terrain.materialAt(11, bridge.y, 10)).toBeUndefined();
    expect(world.water.depthAt(11, 10)).toBe(500); // released water joins the flood
    expect(findPath(world.grid, world.terrain, world.water, materials, start, goal, PROFILE)).toBeUndefined();

    // The deck's material reappears as real debris, never erased.
    const debris = world.entities.liveIdsOfKind("good").map((id) => getGood(world.components, id)!).filter((g) => g.goodKind === "debris");
    expect(debris.length).toBeGreaterThan(0);
    expect(debris[0]!.materialId).toBe("wood");
  });
});
