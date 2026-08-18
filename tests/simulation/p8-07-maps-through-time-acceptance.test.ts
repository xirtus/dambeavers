/**
 * Headless acceptance test for P8-07 -- Maps through time.
 *
 * Roadmap acceptance test: "player can inspect political/site changes
 * at different historical dates."
 */
import { describe, expect, it } from "vitest";
import { EntityIdRegistry, type EntityId } from "../../src/sim/core/EntityId.js";
import { ComponentStore } from "../../src/sim/core/ComponentStore.js";
import { SimulationClock } from "../../src/sim/core/SimulationClock.js";
import { RandomStreams } from "../../src/sim/core/Random.js";
import { WorldGrid } from "../../src/sim/world/WorldGrid.js";
import { TerrainField } from "../../src/sim/world/TerrainField.js";
import { EventLog, type EventId } from "../../src/sim/history/EventLog.js";
import { MaterialRegistry } from "../../src/sim/materials/Material.js";
import { registerStandardMaterials } from "../../src/sim/materials/standardMaterials.js";
import { WaterField } from "../../src/sim/hydrology/WaterField.js";
import { Weather } from "../../src/sim/weather/Weather.js";
import type { World } from "../../src/sim/persistence/WorldSnapshot.js";
import { snapshotWorld, restoreWorld } from "../../src/sim/persistence/WorldSnapshot.js";
import { ALL_COMPONENT_TYPES } from "../../src/sim/persistence/AllComponentTypes.js";
import { RegionMap } from "../../src/sim/region/RegionMap.js";
import { createSite } from "../../src/sim/region/Site.js";
import { advanceWorldTicks } from "../../src/sim/region/DeepTime.js";
import { establishPolity } from "../../src/sim/politics/PoliticalEntity.js";
import { claimTerritory } from "../../src/sim/politics/Territory.js";
import { declareWar, endWar } from "../../src/sim/politics/War.js";
import { politicalMapAt, mapChangesBetween, sitesAt, claimantsAt } from "../../src/sim/chronicle/MapsThroughTime.js";

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
  const random = new RandomStreams(807);
  const events = new EventLog(entities);
  return {
    world: { clock, random, entities, components, grid, terrain, events, water, weather },
    regionMap: new RegionMap(16, 16),
  };
}

describe("P8-07 -- Maps through time", () => {
  it("political/site changes are inspectable at different historical dates", () => {
    const { world, regionMap } = buildWorld();
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) regionMap.setElevation(x, z, 0);

    // Two settlements with overlapping claims.
    const siteA = createSite(world, regionMap, 2, 2, 10, 100);
    const siteB = createSite(world, regionMap, 3, 2, 10, 100);
    establishPolity(world, siteA);
    establishPolity(world, siteB);
    const claimAEvent = claimTerritory(world, regionMap, siteA, 1); // cells x1-3, z1-3
    claimTerritory(world, regionMap, siteB, 1); // cells x2-4, z1-3 -- overlap x2-3
    const preWarTick = world.clock.tick;
    expect(preWarTick).toBe(0);

    // At this date: the overlap cells have BOTH claimants.
    expect(claimantsAt(world, regionMap, 2, 2, preWarTick)).toEqual([siteA, siteB]);
    expect(claimantsAt(world, regionMap, 4, 2, preWarTick)).toEqual([siteB]);
    expect(claimantsAt(world, regionMap, 1, 1, preWarTick)).toEqual([siteA]);
    expect(sitesAt(world, preWarTick)).toEqual([siteA, siteB]);

    // War breaks out and ends with a real cession.
    world.clock.advanceTicks(10);
    const warId = declareWar(world, siteA, siteB, "territory", claimAEvent as unknown as EventId);
    world.clock.advanceTicks(10);
    endWar(world, warId, siteA);
    const postWarTick = world.clock.tick;

    // At the later date: the contested cells now belong to A alone, and
    // B's claim shrank to its un-contested cells.
    expect(claimantsAt(world, regionMap, 2, 2, postWarTick)).toEqual([siteA]);
    expect(claimantsAt(world, regionMap, 4, 2, postWarTick)).toEqual([siteB]);

    // The change window reports exactly the ceded cells.
    const changes = mapChangesBetween(world, regionMap, preWarTick, postWarTick);
    const changedCells = changes.map((c) => `${c.regionX},${c.regionZ}`).sort();
    expect(changedCells).toEqual(["2,1", "2,2", "2,3", "3,1", "3,2", "3,3"]);
    for (const change of changes) {
      expect(change.before).toEqual([siteA, siteB]);
      expect(change.after).toEqual([siteA]);
    }

    // A THIRD date before the war still shows the old overlap -- maps
    // through time, not just "now".
    const midTick = 5;
    expect(claimantsAt(world, regionMap, 3, 2, midTick)).toEqual([siteA, siteB]);
    expect(claimantsAt(world, regionMap, 3, 2, postWarTick)).toEqual([siteA]);

    // A settlement founded later does not exist on earlier maps.
    world.clock.advanceTicks(10);
    const lateSite = createSite(world, regionMap, 12, 12, 5, 50);
    expect(sitesAt(world, world.clock.tick)).toContain(lateSite);
    expect(sitesAt(world, postWarTick)).not.toContain(lateSite);
  });

  it("maps through time survive centuries of deep time and save/reload", () => {
    const { world, regionMap } = buildWorld();
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) regionMap.setElevation(x, z, 0);
    const siteA = createSite(world, regionMap, 2, 2, 10, 100);
    const siteB = createSite(world, regionMap, 3, 2, 10, 100);
    establishPolity(world, siteA);
    establishPolity(world, siteB);
    const claimAEvent = claimTerritory(world, regionMap, siteA, 1);
    claimTerritory(world, regionMap, siteB, 1);
    const earlyTick = world.clock.tick;
    world.clock.advanceTicks(10);
    const warId = declareWar(world, siteA, siteB, "territory", claimAEvent as unknown as EventId);
    world.clock.advanceTicks(10);
    endWar(world, warId, siteA);
    const lateTick = world.clock.tick;

    const earlyMap = politicalMapAt(world, regionMap, earlyTick);
    const lateMap = politicalMapAt(world, regionMap, lateTick);

    // A century of deep time does not disturb the reconstruction.
    const siteC = createSite(world, regionMap, 8, 8, 30, 500);
    advanceWorldTicks(world, 100 * 48_000, () => "forest", { forest: 0.8, wetland: 0.7, grassland: 0.5, desert: 0.1, tundra: 0.1, mountain: 0.1 });
    expect(politicalMapAt(world, regionMap, earlyTick)).toEqual(earlyMap);
    expect(politicalMapAt(world, regionMap, lateTick)).toEqual(lateMap);
    expect(siteC).toBeDefined();

    // Save/reload: the same historical maps, bit for bit.
    const materials = new MaterialRegistry();
    registerStandardMaterials(materials);
    const restored = restoreWorld(snapshotWorld(world), { componentTypes: ALL_COMPONENT_TYPES, materials });
    const restoredRegion = new RegionMap(16, 16);
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) restoredRegion.setElevation(x, z, 0);
    expect(politicalMapAt(restored, restoredRegion, earlyTick)).toEqual(earlyMap);
    expect(politicalMapAt(restored, restoredRegion, lateTick)).toEqual(lateMap);
    expect(mapChangesBetween(restored, restoredRegion, earlyTick, lateTick)).toEqual(mapChangesBetween(world, regionMap, earlyTick, lateTick));
  });
});
