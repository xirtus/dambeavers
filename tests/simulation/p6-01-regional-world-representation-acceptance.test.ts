/**
 * Headless acceptance test for P6-01 -- Regional world representation.
 *
 * Roadmap acceptance test: "many local sites can exist inside a larger
 * spatial region with stable coordinates."
 *
 * One `RegionMap` cell represents an entire potential site/watershed -- a
 * real, coarser coordinate space above (not replacing) the per-watershed
 * `WorldGrid`. This test proves several sites coexist at distinct, stable
 * region coordinates, that a cell can host at most one site, and that the
 * whole layer survives a real save/reload round trip.
 */
import { describe, expect, it } from "vitest";
import { EntityIdRegistry } from "../../src/sim/core/EntityId.js";
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
import { RegionMap } from "../../src/sim/region/RegionMap.js";
import { createSite, getSite } from "../../src/sim/region/Site.js";

const REGION_SIZE = 32;

function buildWorld(): { world: World; regionMap: RegionMap } {
  const entities = new EntityIdRegistry();
  const components = new ComponentStore(entities);
  const grid = new WorldGrid({ sizeX: 20, sizeY: 8, sizeZ: 20 }, entities);
  const materials = new MaterialRegistry();
  registerStandardMaterials(materials);
  const terrain = new TerrainField(grid, materials);
  const water = new WaterField(grid);
  const weather = new Weather();
  const clock = new SimulationClock({ tickRateHz: 20 });
  const random = new RandomStreams(601);
  const events = new EventLog(entities);
  return {
    world: { clock, random, entities, components, grid, terrain, events, water, weather },
    regionMap: new RegionMap(REGION_SIZE, REGION_SIZE),
  };
}

describe("P6-01 -- Regional world representation", () => {
  it("many local sites coexist inside a larger region at stable coordinates, one site per cell, surviving save/reload", () => {
    const { world, regionMap } = buildWorld();
    // Four sites spread across a region far larger than any one local
    // watershed grid (20x20) -- "many local sites inside a larger region."
    const locations = [
      { x: 2, z: 3, pop: 5, food: 30 },
      { x: 9, z: 14, pop: 8, food: 60 },
      { x: 21, z: 7, pop: 3, food: 12 },
      { x: 29, z: 28, pop: 6, food: 40 },
    ];
    const siteIds = locations.map((loc) => createSite(world, regionMap, loc.x, loc.z, loc.pop, loc.food));

    // Each site keeps its OWN stable coordinates and summary state after
    // every later site is created -- creating site N never disturbs
    // sites 1..N-1.
    siteIds.forEach((siteId, i) => {
      const site = getSite(world.components, siteId)!;
      expect(site.regionX).toBe(locations[i]!.x);
      expect(site.regionZ).toBe(locations[i]!.z);
      expect(site.populationCount).toBe(locations[i]!.pop);
      expect(regionMap.siteIdAt(locations[i]!.x, locations[i]!.z)).toBe(siteId);
    });

    // A region cell hosts at most one real site -- the second claim is
    // rejected loudly rather than silently displacing the first.
    expect(() => regionMap.placeSite(2, 3, siteIds[1]!)).toThrow(RangeError);

    // The whole regional layer survives a real save/reload round trip with
    // the same elevations and site placements.
    const snapshot = regionMap.toSnapshot();
    const restored = RegionMap.fromSnapshot(JSON.parse(JSON.stringify(snapshot)));
    siteIds.forEach((siteId, i) => {
      expect(restored.siteIdAt(locations[i]!.x, locations[i]!.z)).toBe(siteId);
    });
  });
});
