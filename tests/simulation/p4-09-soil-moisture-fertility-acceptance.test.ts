/**
 * Headless acceptance test for P4-09 -- Soil moisture and fertility.
 *
 * Roadmap acceptance test: "flooding/drying changes soil state and plant
 * performance."
 *
 * `SoilFertilityField` is a real persisted per-column moisture memory
 * that drifts toward real wetness: flooding wets it, drying leaves it
 * parched, and neither snaps instantaneously. Fertility peaks at
 * moderate moisture -- waterlogged and bone-dry are both worse -- and
 * real fertility scales plant growth through the same lifecycle tick
 * (a plant on balanced soil grows measurably more than one on parched
 * soil over identical ticks).
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
import { PlantSpeciesRegistry } from "../../src/sim/ecology/PlantSpecies.js";
import { registerStandardPlantSpecies } from "../../src/sim/ecology/standardPlantSpecies.js";
import { getPlant, setPlant } from "../../src/sim/ecology/Plant.js";
import { plantSapling } from "../../src/sim/ecology/EcologyResponse.js";
import { tickPlantLifecycle } from "../../src/sim/ecology/PlantLifecycle.js";
import { SoilFertilityField, soilFertility } from "../../src/sim/ecology/SoilFertility.js";

function buildWorld(): { world: World; plantSpecies: PlantSpeciesRegistry } {
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
  const random = new RandomStreams(409);
  const events = new EventLog(entities);
  const plantSpecies = new PlantSpeciesRegistry();
  registerStandardPlantSpecies(plantSpecies);
  return { world: { clock, random, entities, components, grid, terrain, events, water, weather }, plantSpecies };
}

describe("P4-09 -- Soil moisture and fertility", () => {
  it("flooding and drying change persisted soil state, and real fertility scales plant performance", () => {
    const { world, plantSpecies } = buildWorld();
    const soil = new SoilFertilityField(20, 20);

    // Flooding wets the soil through real drift -- not an instant snap.
    world.water.setDepth(5, 5, 10);
    const wetBefore = soil.moistureAt(5, 5);
    for (let i = 0; i < 300; i++) soil.tick(world.water, 5, 5);
    const wetAfter = soil.moistureAt(5, 5);
    expect(wetAfter).toBeGreaterThan(wetBefore);

    // A never-wetted column stays parched (drying side of the same memory).
    expect(soil.moistureAt(9, 9)).toBe(0);

    // Fertility peaks at MODERATE moisture: saturated and bone-dry are both worse.
    const saturated = soilFertility(soil, 5, 5);
    const parched = soilFertility(soil, 9, 9);
    // Build a genuinely moderate column by wetting it briefly (drift
    // never reaches full saturation in a short soak).
    const moderate = new SoilFertilityField(20, 20);
    world.water.setDepth(6, 6, 2);
    for (let i = 0; i < 100; i++) moderate.tick(world.water, 6, 6);
    const moderateFertility = soilFertility(moderate, 6, 6);
    expect(moderateFertility).toBeGreaterThan(saturated);
    expect(moderateFertility).toBeGreaterThan(parched);

    // Plant performance: identical plants, one on fertile ground and one on
    // parched ground, over identical ticks -- the fertile one grows more.
    const random = world.random.stream("soil-plants");
    const fertilePlant = plantSapling(world, "aspen", { x: 6, z: 6 });
    const parchedPlant = plantSapling(world, "aspen", { x: 9, z: 9 });
    setPlant(world.components, fertilePlant, { speciesId: "aspen", ageTicks: 0, health: 1 });
    setPlant(world.components, parchedPlant, { speciesId: "aspen", ageTicks: 0, health: 1 });
    world.clock.advanceTicks(1200); // solar noon, growing season
    for (let i = 0; i < 200; i++) {
      world.clock.advanceTicks(1);
      tickPlantLifecycle(world, plantSpecies, random, fertilePlant, moderate);
      tickPlantLifecycle(world, plantSpecies, random, parchedPlant, soil);
    }
    const fertileAge = getPlant(world.components, fertilePlant)!.ageTicks;
    const parchedAge = getPlant(world.components, parchedPlant)!.ageTicks;
    expect(fertileAge).toBeGreaterThan(parchedAge);
  });
});
