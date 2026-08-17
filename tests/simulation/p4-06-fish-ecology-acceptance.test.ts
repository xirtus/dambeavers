/**
 * Headless acceptance test for P4-06 -- Fish ecology.
 *
 * Roadmap acceptance test: "fish distribution responds to connected
 * water, depth, temperature, and habitat."
 *
 * Trout survive only in suitable habitat (real depth + real seasonal
 * temperature through one formula), strand and die when their column
 * dries, and spread only into immediately-adjacent suitable columns --
 * connected water, one hop per tick, never teleporting into a
 * disconnected pond.
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
import { AnimalSpeciesRegistry, registerStandardAnimalSpecies } from "../../src/sim/creatures/AnimalSpecies.js";
import { spawnAnimal, getAnimal } from "../../src/sim/creatures/Animal.js";
import { fishHabitatSuitability, tickFishDistribution } from "../../src/sim/ecology/FishEcology.js";
import { seasonalAmbientTemperature } from "../../src/sim/weather/Seasons.js";

function buildWorld(): { world: World; animalSpecies: AnimalSpeciesRegistry } {
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
  const random = new RandomStreams(406);
  const events = new EventLog(entities);
  const animalSpecies = new AnimalSpeciesRegistry();
  registerStandardAnimalSpecies(animalSpecies);
  return { world: { clock, random, entities, components, grid, terrain, events, water, weather }, animalSpecies };
}

function fishAt(world: World, x: number, z: number): boolean {
  return world.entities.liveIdsOfKind("animal").some((id) => {
    const position = world.grid.positionOf(id);
    return position !== undefined && position.x === x && position.z === z && getAnimal(world.components, id)?.speciesId === "trout";
  });
}

describe("P4-06 -- Fish ecology", () => {
  it("fish distribution responds to connected water, depth, temperature, and habitat", () => {
    const { world, animalSpecies } = buildWorld();

    // Depth and habitat: suitability requires real depth, and colder
    // seasons genuinely reduce it through the shared temperature formula.
    world.water.setDepth(4, 4, 2);
    expect(fishHabitatSuitability(world, animalSpecies, "trout", 4, 4)).toBeGreaterThan(0);
    world.water.setDepth(4, 4, 0);
    expect(fishHabitatSuitability(world, animalSpecies, "trout", 4, 4)).toBe(0);

    const noonTick = 1200; // phase 0.5: warmest
    expect(seasonalAmbientTemperature(noonTick)).toBeGreaterThan(seasonalAmbientTemperature(0));
    world.water.setDepth(4, 4, 2);
    const coldSuitability = fishHabitatSuitability(world, animalSpecies, "trout", 4, 4); // midnight, phase 0
    world.clock.advanceTicks(noonTick);
    const warmSuitability = fishHabitatSuitability(world, animalSpecies, "trout", 4, 4); // solar noon
    expect(warmSuitability).toBeGreaterThan(coldSuitability);

    // Connected water: a fish spreads only into an immediately-adjacent
    // suitable column -- never into a far-away disconnected pond.
    const random = world.random.stream("fish");
    world.water.setDepth(4, 4, 2);
    world.water.setDepth(5, 4, 2);
    world.water.setDepth(10, 10, 2);
    spawnAnimal(world, animalSpecies, "trout", { x: 4, y: 4, z: 4 });
    let spread = false;
    for (let i = 0; i < 5000 && !spread; i++) {
      tickFishDistribution(world, animalSpecies, random, "trout");
      spread = fishAt(world, 5, 4);
    }
    expect(spread).toBe(true);
    expect(fishAt(world, 10, 10)).toBe(false); // disconnected water stays uncolonized

    // Stranding: drying the original column kills the fish left in it.
    const strandedId = spawnAnimal(world, animalSpecies, "trout", { x: 6, y: 4, z: 6 });
    world.water.setDepth(6, 6, 2);
    world.water.setDepth(6, 6, 0);
    tickFishDistribution(world, animalSpecies, random, "trout");
    expect(world.entities.isLive(strandedId)).toBe(false);
  });
});
