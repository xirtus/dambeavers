/**
 * Headless acceptance test for P6-04 -- Climate model.
 *
 * Roadmap acceptance test: "geography produces spatial variation in
 * temperature/precipitation influencing biomes."
 *
 * Climate is one shared formula over real geography (elevation, latitude)
 * layered on the EXISTING seasonal cycle (P4-01), never a per-region
 * scripted value. This test proves the spatial variation is real and
 * measurable at a single tick, and that it genuinely changes the biome
 * classification (P6-05) downstream.
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
import { MACRO_ELEVATION_RANGE } from "../../src/sim/region/MacroTerrain.js";

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
  const random = new RandomStreams(604);
  const events = new EventLog(entities);
  return {
    world: { clock, random, entities, components, grid, terrain, events, water, weather },
    regionMap: new RegionMap(REGION_SIZE, REGION_SIZE),
  };
}

describe("P6-04 -- Climate model", () => {
  it("geography produces real spatial variation in temperature and precipitation that changes biome classification", () => {
    const { world, regionMap } = buildWorld();
    generateMacroTerrain(regionMap, world.random.stream("acceptance-terrain"));
    const network = computeRiverNetwork(regionMap);
    const tick = 13_200; // summer noon: the seasonal baseline is warmest here, so spatial variation (not just "everywhere cold") decides classification

    // Latitude: at the same tick, the map's own equator row is warmer than
    // a pole row -- a real north-south temperature gradient.
    const equatorZ = Math.floor(REGION_SIZE / 2);
    const equatorTemp = temperatureAt(regionMap, 16, equatorZ, tick);
    const poleTemp = temperatureAt(regionMap, 16, 0, tick);
    expect(equatorTemp).toBeGreaterThan(poleTemp);

    // Elevation: at the same latitude, the highest cell is colder than a
    // low one (lapse-rate cooling).
    let lowest: { x: number; z: number; elevation: number } | undefined;
    let highest: { x: number; z: number; elevation: number } | undefined;
    for (let x = 0; x < REGION_SIZE; x++) {
      const elevation = regionMap.elevationAt(x, equatorZ);
      if (lowest === undefined || elevation < lowest.elevation) lowest = { x, z: equatorZ, elevation };
      if (highest === undefined || elevation > highest.elevation) highest = { x, z: equatorZ, elevation };
    }
    expect(temperatureAt(regionMap, highest!.x, equatorZ, tick)).toBeLessThan(temperatureAt(regionMap, lowest!.x, equatorZ, tick));

    // Precipitation: real spatial variation across the map at one tick
    // (multiple distinct values, not one flat field).
    const precipitationValues = new Set<number>();
    for (let x = 0; x < REGION_SIZE; x += 4) {
      precipitationValues.add(Math.round(precipitationAt(regionMap, network, x, equatorZ) * 100) / 100);
    }
    expect(precipitationValues.size).toBeGreaterThan(1);

    // "Influencing biomes": pick the driest and wettest sampled columns
    // and show their real climate genuinely classifies into DIFFERENT
    // biomes through P6-05's own threshold classification.
    let driestX = 0;
    let wettestX = 0;
    for (let x = 0; x < REGION_SIZE; x += 4) {
      if (precipitationAt(regionMap, network, x, equatorZ) < precipitationAt(regionMap, network, driestX, equatorZ)) driestX = x;
      if (precipitationAt(regionMap, network, x, equatorZ) > precipitationAt(regionMap, network, wettestX, equatorZ)) wettestX = x;
    }
    const driestBiome = biomeAt(
      temperatureAt(regionMap, driestX, equatorZ, tick),
      precipitationAt(regionMap, network, driestX, equatorZ),
      regionMap.elevationAt(driestX, equatorZ) / MACRO_ELEVATION_RANGE,
    );
    const wettestBiome = biomeAt(
      temperatureAt(regionMap, wettestX, equatorZ, tick),
      precipitationAt(regionMap, network, wettestX, equatorZ),
      regionMap.elevationAt(wettestX, equatorZ) / MACRO_ELEVATION_RANGE,
    );
    expect(wettestBiome).not.toBe(driestBiome);
  });
});
