/**
 * Headless acceptance test for P7-07 -- Territory.
 *
 * Roadmap acceptance test: "overlapping claims can be represented and
 * become a cause of conflict."
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
  claimTerritory, claimsOfSite, claimedCellsOfSite, overlappingClaimCells, territoryTension, getTerritoryClaim,
} from "../../src/sim/politics/Territory.js";
import { territorialWarCause } from "../../src/sim/politics/WarPlanning.js";

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
  const random = new RandomStreams(707);
  const events = new EventLog(entities);
  return {
    world: { clock, random, entities, components, grid, terrain, events, water, weather },
    regionMap: new RegionMap(16, 16),
  };
}

describe("P7-07 -- Territory", () => {
  it("overlapping claims can be represented and become a cause of conflict", () => {
    const { world, regionMap } = buildWorld();
    const siteA = createSite(world, regionMap, 5, 5, 5, 100);
    const siteB = createSite(world, regionMap, 7, 5, 5, 100);
    const farSite = createSite(world, regionMap, 13, 13, 5, 100);

    // Real claims: radius-2 blocks around each site's real region cell.
    const claimA = claimTerritory(world, regionMap, siteA, 2);
    const claimB = claimTerritory(world, regionMap, siteB, 2);
    claimTerritory(world, regionMap, farSite, 2);
    expect(claimedCellsOfSite(world, siteA).length).toBe(25);
    expect(claimsOfSite(world, siteA)).toEqual([claimA]);
    expect(getTerritoryClaim(world.components, claimA)!.ownerSiteId).toBe(siteA);
    expect(world.events.eventsOfType("territory-claimed").length).toBe(3);

    // Overlap is REAL, represented state -- both sites genuinely claim
    // the same cells.
    const overlap = overlappingClaimCells(world, siteA, siteB);
    expect(overlap.length).toBeGreaterThan(0);
    expect(overlappingClaimCells(world, siteA, farSite)).toEqual([]);
    expect(territoryTension(world, siteA, siteB)).toBeGreaterThan(0);
    expect(territoryTension(world, siteA, farSite)).toBe(0);

    // The overlap BECOMES a cause of conflict: with genuinely hostile
    // standing, the real territorial war cause resolves to a real
    // recorded claim event (walkable causal history).
    world.events.record({ tick: world.clock.tick, eventType: "war-declared", subjectIds: [siteA, siteB], objectIds: [world.entities.create("war")], location: { x: 0, y: 0, z: 0 } });
    const cause = territorialWarCause(world, siteA, siteB);
    expect(cause).toBeDefined();
    expect(world.events.get(cause!).eventType).toBe("territory-claimed");
    // No tension + no hostility = no cause.
    expect(territorialWarCause(world, siteA, farSite)).toBeUndefined();

    // Persistence: claims and their cells survive save/reload.
    const restoredMaterials = new MaterialRegistry();
    registerStandardMaterials(restoredMaterials);
    const restored = restoreWorld(JSON.parse(JSON.stringify(snapshotWorld(world))), { componentTypes: ALL_COMPONENT_TYPES, materials: restoredMaterials });
    expect(claimedCellsOfSite(restored, siteA).length).toBe(25);
    expect(overlappingClaimCells(restored, siteA, siteB).length).toBe(overlap.length);
  });
});
