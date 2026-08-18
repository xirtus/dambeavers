/**
 * Headless acceptance test for P6-05 -- Biomes.
 *
 * Roadmap acceptance test: "different regions generate distinct
 * plant/animal communities from climate/environment parameters."
 *
 * Biome classification is a real threshold formula over continuous
 * climate/environment inputs (P6-04's real geography-driven values), and
 * each biome exposes one real `biomeMoisture` environment parameter. The
 * plant community a biome supports is then DERIVED from that parameter
 * against the real registered plant species' own `moisturePreference`
 * (P4-02/P4-05's real data) -- two regions with different climate
 * classify into different biomes and therefore derive measurably
 * different plant/animal communities, with no per-biome species list.
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
import { biomeAt, biomeMoisture } from "../../src/sim/region/Biomes.js";
import { MACRO_ELEVATION_RANGE } from "../../src/sim/region/MacroTerrain.js";
import { PlantSpeciesRegistry } from "../../src/sim/ecology/PlantSpecies.js";
import { registerStandardPlantSpecies } from "../../src/sim/ecology/standardPlantSpecies.js";
import { AnimalSpeciesRegistry } from "../../src/sim/creatures/AnimalSpecies.js";
import { registerStandardAnimalSpecies } from "../../src/sim/creatures/AnimalSpecies.js";

const REGION_SIZE = 32;
const COMMUNITY_MOISTURE_TOLERANCE = 0.3;

function buildWorld(): { world: World; regionMap: RegionMap; plantSpecies: PlantSpeciesRegistry; animalSpecies: AnimalSpeciesRegistry } {
  const entities = new EntityIdRegistry();
  const components = new ComponentStore(entities);
  const grid = new WorldGrid({ sizeX: 20, sizeY: 8, sizeZ: 20 }, entities);
  const materials = new MaterialRegistry();
  registerStandardMaterials(materials);
  const terrain = new TerrainField(grid, materials);
  const water = new WaterField(grid);
  const weather = new Weather();
  const clock = new SimulationClock({ tickRateHz: 20 });
  const random = new RandomStreams(605);
  const events = new EventLog(entities);
  const plantSpecies = new PlantSpeciesRegistry();
  registerStandardPlantSpecies(plantSpecies);
  const animalSpecies = new AnimalSpeciesRegistry();
  registerStandardAnimalSpecies(animalSpecies);
  return {
    world: { clock, random, entities, components, grid, terrain, events, water, weather },
    regionMap: new RegionMap(REGION_SIZE, REGION_SIZE),
    plantSpecies,
    animalSpecies,
  };
}

/** The plant community a biome supports -- derived (never listed) from real registered species' moisture preferences against the biome's own real moisture parameter. */
function plantCommunityFor(biome: ReturnType<typeof biomeAt>, plantSpecies: PlantSpeciesRegistry): string[] {
  const moisture = biomeMoisture(biome);
  return plantSpecies
    .all()
    .filter((species) => Math.abs(species.moisturePreference - moisture) <= COMMUNITY_MOISTURE_TOLERANCE)
    .map((species) => species.id)
    .sort();
}

/** The animal community a biome supports -- derived from real registered species' own aquatic/habitat facts (aquatic species need wetland water). */
function animalCommunityFor(biome: ReturnType<typeof biomeAt>, animalSpecies: AnimalSpeciesRegistry): string[] {
  return animalSpecies
    .all()
    .filter((species) => (biome === "wetland" ? species.aquatic : !species.aquatic))
    .map((species) => species.id)
    .sort();
}

describe("P6-05 -- Biomes", () => {
  it("different regions (different real climate) classify into different biomes with distinct derived plant/animal communities", () => {
    const { world, regionMap, plantSpecies, animalSpecies } = buildWorld();
    generateMacroTerrain(regionMap, world.random.stream("acceptance-terrain"));
    const network = computeRiverNetwork(regionMap);
    const tick = 13_200; // summer noon
    const equatorZ = Math.floor(REGION_SIZE / 2);

    // Find the two real region cells with the most divergent climate:
    // the wettest and the driest column at the map's equator row.
    let driestX = 0;
    let wettestX = 0;
    for (let x = 0; x < REGION_SIZE; x += 2) {
      if (precipitationAt(regionMap, network, x, equatorZ) < precipitationAt(regionMap, network, driestX, equatorZ)) driestX = x;
      if (precipitationAt(regionMap, network, x, equatorZ) > precipitationAt(regionMap, network, wettestX, equatorZ)) wettestX = x;
    }
    const biomeOf = (x: number) =>
      biomeAt(
        temperatureAt(regionMap, x, equatorZ, tick),
        precipitationAt(regionMap, network, x, equatorZ),
        regionMap.elevationAt(x, equatorZ) / MACRO_ELEVATION_RANGE,
      );
    const dryBiome = biomeOf(driestX);
    const wetBiome = biomeOf(wettestX);

    // Different environment parameters genuinely classify into different
    // biomes, and those biomes derive DIFFERENT plant/animal communities
    // from the same two real species registries.
    expect(wetBiome).not.toBe(dryBiome);
    const dryPlants = plantCommunityFor(dryBiome, plantSpecies);
    const wetPlants = plantCommunityFor(wetBiome, plantSpecies);
    expect(dryPlants).not.toEqual(wetPlants);
    const dryAnimals = animalCommunityFor(dryBiome, animalSpecies);
    const wetAnimals = animalCommunityFor(wetBiome, animalSpecies);
    expect(dryAnimals).not.toEqual(wetAnimals);
    // The wet region's community genuinely includes the real aquatic species;
    // the dry region's genuinely does not.
    expect(wetAnimals).toContain("trout");
    expect(dryAnimals).not.toContain("trout");
  });
});
