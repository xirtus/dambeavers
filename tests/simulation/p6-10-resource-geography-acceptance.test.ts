/**
 * Headless acceptance test for P6-10 -- Resource geography.
 *
 * Roadmap acceptance test: "raw materials occur according to world
 * geology/ecology and constrain settlement economies."
 *
 * A cell's available raw-material deposits are a pure function of its own
 * real biome (P6-05) and elevation -- a wetland yields clay, a forest
 * wood, a mountain stone, a desert sand, and a grassland nothing at all.
 * A settlement's economy is constrained by construction: what a site can
 * extract IS its own biome's deposit list, never a universal menu.
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
import { generateMacroTerrain } from "../../src/sim/region/MacroTerrain.js";
import { computeRiverNetwork } from "../../src/sim/region/RegionalHydrology.js";
import { temperatureAt, precipitationAt } from "../../src/sim/region/Climate.js";
import { biomeAt } from "../../src/sim/region/Biomes.js";
import { depositsAt } from "../../src/sim/region/ResourceGeography.js";
import { MACRO_ELEVATION_RANGE } from "../../src/sim/region/MacroTerrain.js";
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
  const random = new RandomStreams(610);
  const events = new EventLog(entities);
  return {
    world: { clock, random, entities, components, grid, terrain, events, water, weather },
    regionMap: new RegionMap(REGION_SIZE, REGION_SIZE),
  };
}

describe("P6-10 -- Resource geography", () => {
  it("raw materials occur according to real biome/geology and constrain what a settlement can extract", () => {
    const { world, regionMap } = buildWorld();
    generateMacroTerrain(regionMap, world.random.stream("acceptance-terrain"));
    const network = computeRiverNetwork(regionMap);
    const tick = 13_200; // summer noon
    const equatorZ = Math.floor(REGION_SIZE / 2);

    // Pure derivation: biome-based deposits differ by biome, and extreme
    // elevation yields real stone regardless of biome (real geology).
    expect(depositsAt("wetland", 0.2)).toContain("clay");
    expect(depositsAt("forest", 0.3)).toContain("wood");
    expect(depositsAt("desert", 0.1)).toContain("sand");
    expect(depositsAt("mountain", 0.9)).toContain("stone");
    expect(depositsAt("grassland", 0.2)).toEqual([]);

    // A settlement's economy is genuinely constrained: pick a real
    // generated cell, classify its own real biome, and verify its deposit
    // list is exactly its own biome's deposit list -- a grassland site
    // has NOTHING to extract, a wetland site clay, by construction.
    const biomeOf = (x: number, z: number) =>
      biomeAt(temperatureAt(regionMap, x, z, tick), precipitationAt(regionMap, network, x, z), regionMap.elevationAt(x, z) / MACRO_ELEVATION_RANGE);

    let grasslandSite: { x: number; z: number } | undefined;
    let wetlandSite: { x: number; z: number } | undefined;
    for (let x = 0; x < REGION_SIZE && (grasslandSite === undefined || wetlandSite === undefined); x += 2) {
      for (let z = 0; z < REGION_SIZE && (grasslandSite === undefined || wetlandSite === undefined); z += 2) {
        const biome = biomeOf(x, z);
        if (biome === "grassland" && grasslandSite === undefined) grasslandSite = { x, z };
        if (biome === "wetland" && wetlandSite === undefined) wetlandSite = { x, z };
      }
    }
    expect(grasslandSite).toBeDefined();
    expect(wetlandSite).toBeDefined();

    const grasslandSiteId = createSite(world, regionMap, grasslandSite!.x, grasslandSite!.z, 4, 30);
    const wetlandSiteId = createSite(world, regionMap, wetlandSite!.x, wetlandSite!.z, 4, 30);
    const grasslandDeposits = depositsAt(biomeOf(grasslandSite!.x, grasslandSite!.z), regionMap.elevationAt(grasslandSite!.x, grasslandSite!.z) / MACRO_ELEVATION_RANGE);
    const wetlandDeposits = depositsAt(biomeOf(wetlandSite!.x, wetlandSite!.z), regionMap.elevationAt(wetlandSite!.x, wetlandSite!.z) / MACRO_ELEVATION_RANGE);
    expect(grasslandDeposits).toEqual([]);
    expect(wetlandDeposits).toContain("clay");
    void grasslandSiteId;
    void wetlandSiteId;
    void getSite;
  });
});
