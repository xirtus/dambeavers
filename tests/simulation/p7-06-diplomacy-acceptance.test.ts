/**
 * Headless acceptance test for P7-06 -- Diplomacy.
 *
 * Roadmap acceptance test: "group relations change from actual
 * interactions, treaties, harms, aid, and interests."
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
import { snapshotWorld, restoreWorld } from "../../src/sim/persistence/WorldSnapshot.js";
import { ALL_COMPONENT_TYPES } from "../../src/sim/persistence/AllComponentTypes.js";
import { RegionMap } from "../../src/sim/region/RegionMap.js";
import { createSite } from "../../src/sim/region/Site.js";
import {
  diplomaticStanding, signTreaty, breakTreaty, activeTreatiesOf, relationKind, getTreaty,
} from "../../src/sim/politics/Diplomacy.js";
import { claimTerritory, territoryTension } from "../../src/sim/politics/Territory.js";

function buildWorld(): { world: World; regionMap: RegionMap } {
  const entities = new EntityIdRegistry();
  const components = new ComponentStore(entities);
  const grid = new WorldGrid({ sizeX: 20, sizeY: 10, sizeZ: 20 }, entities);
  const materials = new MaterialRegistry();
  registerStandardMaterials(materials);
  const terrain = new TerrainField(grid, materials);
  for (let x = 0; x < 20; x++) for (let z = 0; z < 20; z++) for (let y = 0; y <= 2; y++) terrain.setMaterial(x, y, z, "soil");
  const water = new WaterField(grid);
  const weather = new Weather();
  const clock = new SimulationClock({ tickRateHz: 20 });
  const random = new RandomStreams(706);
  const events = new EventLog(entities);
  return {
    world: { clock, random, entities, components, grid, terrain, events, water, weather },
    regionMap: new RegionMap(16, 16),
  };
}

describe("P7-06 -- Diplomacy", () => {
  it("group relations change from actual interactions, treaties, harms, aid, and interests", () => {
    const { world, regionMap } = buildWorld();
    const siteA = createSite(world, regionMap, 2, 2, 5, 100);
    const siteB = createSite(world, regionMap, 7, 5, 5, 100);
    const siteC = createSite(world, regionMap, 12, 3, 5, 100);

    // No shared history = genuinely neutral.
    expect(diplomaticStanding(world, siteA, siteB)).toBe(0);
    expect(relationKind(world, siteA, siteB)).toBe("neutral");

    // Aid: a real delivery event between them improves standing.
    world.events.record({ tick: world.clock.tick, eventType: "trade-goods-delivered", subjectIds: [siteA], objectIds: [siteB], location: { x: 0, y: 0, z: 0 } });
    world.events.record({ tick: world.clock.tick, eventType: "trade-goods-delivered", subjectIds: [siteA], objectIds: [siteB], location: { x: 0, y: 0, z: 0 } });
    const afterAid = diplomaticStanding(world, siteA, siteB);
    expect(afterAid).toBeGreaterThan(0);
    // Unshared history contributes nothing.
    expect(diplomaticStanding(world, siteA, siteC)).toBe(0);

    // Harm: a real raid arrival sours the relation.
    world.events.record({ tick: world.clock.tick, eventType: "raid-arrived", subjectIds: [siteA], objectIds: [siteB], location: { x: 0, y: 0, z: 0 } });
    world.events.record({ tick: world.clock.tick, eventType: "raid-looted", subjectIds: [siteA], objectIds: [siteB], location: { x: 0, y: 0, z: 0 } });
    const afterHarms = diplomaticStanding(world, siteA, siteB);
    expect(afterHarms).toBeLessThan(afterAid);

    // Treaties: real persistent entities that shift standing, and whose
    // breaking is itself a real event.
    const treatyId = signTreaty(world, [siteA, siteB], "alliance");
    expect(activeTreatiesOf(world, siteA)).toContain(treatyId);
    expect(relationKind(world, siteA, siteB)).toBe("allied");
    expect(diplomaticStanding(world, siteA, siteB)).toBeGreaterThan(afterHarms);
    const brokenEvent = world.events.record({ tick: world.clock.tick, eventType: "raid-arrived", subjectIds: [siteA], objectIds: [siteB], location: { x: 0, y: 0, z: 0 } });
    breakTreaty(world, treatyId, brokenEvent);
    expect(getTreaty(world.components, treatyId)!.status).toBe("broken");
    expect(activeTreatiesOf(world, siteA)).not.toContain(treatyId);
    expect(diplomaticStanding(world, siteA, siteB)).toBeLessThan(afterHarms);

    // Interests: overlapping territory is real diplomatic pressure data.
    claimTerritory(world, regionMap, siteA, 3);
    claimTerritory(world, regionMap, siteB, 3);
    expect(territoryTension(world, siteA, siteB)).toBeGreaterThan(0);

    // Persistence: treaties and standing survive save/reload (standing is
    // derived from the same surviving events).
    const restoredMaterials = new MaterialRegistry();
    registerStandardMaterials(restoredMaterials);
    const restored = restoreWorld(JSON.parse(JSON.stringify(snapshotWorld(world))), { componentTypes: ALL_COMPONENT_TYPES, materials: restoredMaterials });
    expect(getTreaty(restored.components, treatyId)!.status).toBe("broken");
    expect(diplomaticStanding(restored, siteA, siteB)).toBe(diplomaticStanding(world, siteA, siteB));
  });
});
