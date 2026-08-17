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
import { getPlant, type Plant } from "../../src/sim/ecology/Plant.js";
import { PlantSpeciesRegistry, type PlantSpeciesProperties } from "../../src/sim/ecology/PlantSpecies.js";
import { registerStandardPlantSpecies } from "../../src/sim/ecology/standardPlantSpecies.js";
import {
  currentWetness,
  floodTolerance,
  applyVegetationHealthTick,
  applyPlantGrowthTick,
  plantSapling,
  isFishHabitat,
  spawnFish,
  WETNESS_REFERENCE_DEPTH,
  VEGETATION_HEALTH_DRIFT_RATE,
  FISH_HABITAT_MIN_DEPTH,
} from "../../src/sim/ecology/EcologyResponse.js";

function buildFlatWorld(sizeX = 10, sizeY = 8, sizeZ = 10, floor = 2): { world: World; materials: MaterialRegistry; water: WaterField } {
  const entities = new EntityIdRegistry();
  const components = new ComponentStore(entities);
  const grid = new WorldGrid({ sizeX, sizeY, sizeZ }, entities);
  const materials = new MaterialRegistry();
  registerStandardMaterials(materials);
  const terrain = new TerrainField(grid, materials);
  for (let x = 0; x < sizeX; x++) {
    for (let z = 0; z < sizeZ; z++) {
      for (let y = 0; y <= floor; y++) terrain.setMaterial(x, y, z, "soil");
    }
  }
  const water = new WaterField(grid);
  const weather = new Weather();
  const clock = new SimulationClock({ tickRateHz: 20 });
  const random = new RandomStreams(1);
  const events = new EventLog(entities);
  const world: World = { clock, random, entities, components, grid, terrain, events, water, weather };
  return { world, materials, water };
}

const DRY_SPECIES: PlantSpeciesProperties = { woodMaterialId: "wood", matureTrunkVolumeM3: 0.3, matureAgeTicks: 20_000, moisturePreference: 0.2 };
const WETLAND_SPECIES: PlantSpeciesProperties = { woodMaterialId: "wood", matureTrunkVolumeM3: 0.6, matureAgeTicks: 12_000, moisturePreference: 0.85 };

describe("currentWetness", () => {
  it("is 0 for a dry column", () => {
    const world = buildFlatWorld();
    expect(currentWetness(world.water, 3, 3)).toBe(0);
  });

  it("scales linearly with depth up to WETNESS_REFERENCE_DEPTH, then clamps at 1", () => {
    const world = buildFlatWorld();
    world.water.setDepth(3, 3, WETNESS_REFERENCE_DEPTH / 2);
    expect(currentWetness(world.water, 3, 3)).toBeCloseTo(0.5, 10);
    world.water.setDepth(3, 3, WETNESS_REFERENCE_DEPTH * 5);
    expect(currentWetness(world.water, 3, 3)).toBe(1);
  });
});

describe("floodTolerance", () => {
  it("is literally the species' own moisturePreference", () => {
    expect(floodTolerance(DRY_SPECIES)).toBe(DRY_SPECIES.moisturePreference);
    expect(floodTolerance(WETLAND_SPECIES)).toBe(WETLAND_SPECIES.moisturePreference);
  });
});

describe("applyVegetationHealthTick", () => {
  it("REGRESSION (P1-17 acceptance): persistently flooded dry vegetation declines", () => {
    const world = buildFlatWorld();
    world.water.setDepth(3, 3, WETNESS_REFERENCE_DEPTH * 2); // fully wet
    let plant: Plant = { speciesId: "dry-species", ageTicks: 1000, health: 1 };
    for (let i = 0; i < 200; i++) plant = applyVegetationHealthTick(plant, DRY_SPECIES, world.water, 3, 3);
    expect(plant.health).toBeLessThan(1);
  });

  it("REGRESSION (P1-17 acceptance): suitable wetland vegetation gains viability", () => {
    const world = buildFlatWorld();
    world.water.setDepth(3, 3, WETNESS_REFERENCE_DEPTH * 2); // fully wet
    let plant: Plant = { speciesId: "wetland-species", ageTicks: 1000, health: 0.3 }; // starts unhealthy
    for (let i = 0; i < 200; i++) plant = applyVegetationHealthTick(plant, WETLAND_SPECIES, world.water, 3, 3);
    expect(plant.health).toBeGreaterThan(0.3);
  });

  it("the SAME flooded conditions produce OPPOSITE health trends for a dry vs. wetland species, from identical starting health", () => {
    const world = buildFlatWorld();
    world.water.setDepth(3, 3, WETNESS_REFERENCE_DEPTH * 2);
    let dryPlant: Plant = { speciesId: "d", ageTicks: 0, health: 0.6 };
    let wetlandPlant: Plant = { speciesId: "w", ageTicks: 0, health: 0.6 };
    for (let i = 0; i < 100; i++) {
      dryPlant = applyVegetationHealthTick(dryPlant, DRY_SPECIES, world.water, 3, 3);
      wetlandPlant = applyVegetationHealthTick(wetlandPlant, WETLAND_SPECIES, world.water, 3, 3);
    }
    expect(dryPlant.health).toBeLessThan(0.6);
    expect(wetlandPlant.health).toBeGreaterThan(0.6);
  });

  it("a species already exactly matched to a dry site holds steady health -- no drift when perfectly suited", () => {
    const world = buildFlatWorld(); // bone dry everywhere
    const perfectlyDrySpecies: PlantSpeciesProperties = { ...DRY_SPECIES, moisturePreference: 0 };
    let plant: Plant = { speciesId: "d", ageTicks: 0, health: 1 };
    for (let i = 0; i < 50; i++) plant = applyVegetationHealthTick(plant, perfectlyDrySpecies, world.water, 3, 3);
    expect(plant.health).toBe(1); // already at fitness 1, no gap to close
  });

  it("matches the exact documented formula: delta = (siteFitness - health) * VEGETATION_HEALTH_DRIFT_RATE", () => {
    const world = buildFlatWorld();
    world.water.setDepth(3, 3, WETNESS_REFERENCE_DEPTH); // wetness = 1
    const plant: Plant = { speciesId: "d", ageTicks: 0, health: 1 };
    const result = applyVegetationHealthTick(plant, DRY_SPECIES, world.water, 3, 3);
    const siteFitness = 1 - Math.abs(1 - DRY_SPECIES.moisturePreference);
    const expectedDelta = (siteFitness - 1) * VEGETATION_HEALTH_DRIFT_RATE;
    expect(result.health).toBeCloseTo(1 + expectedDelta, 12);
  });

  it("clamps health to [0, 1]", () => {
    const world = buildFlatWorld();
    world.water.setDepth(3, 3, WETNESS_REFERENCE_DEPTH * 2);
    let plant: Plant = { speciesId: "d", ageTicks: 0, health: 1 };
    for (let i = 0; i < 2000; i++) plant = applyVegetationHealthTick(plant, DRY_SPECIES, world.water, 3, 3);
    expect(plant.health).toBeGreaterThanOrEqual(0);
    expect(plant.health).toBeLessThanOrEqual(1);
  });

  describe("REGRESSION (critic-found CRITICAL, P1-17): a healthy species must hold steady, never decay, in its own real ideal habitat", () => {
    // The critic's own repro: with the ORIGINAL near-extreme data (aspen
    // 0.2, willow 0.85), a species starting at the game's actual default
    // spawn health of 1 would perpetually decay even standing in its own
    // best-possible real conditions, since siteFitness could never reach
    // 1 for either species under any real wetness value. This is only a
    // real regression guard if it exercises the ACTUAL shipped species
    // data (`registerStandardPlantSpecies`), not the local 0.2/0.85
    // fixtures above -- those still validate the formula's shape at
    // intermediate values but would not have caught this bug.
    function buildRegistry(): PlantSpeciesRegistry {
      const registry = new PlantSpeciesRegistry();
      registerStandardPlantSpecies(registry);
      return registry;
    }

    it("a healthy aspen (health=1) on ordinary, permanently-dry ground holds steady at exactly 1, never declining", () => {
      const world = buildFlatWorld(); // bone dry everywhere -- never touches setDepth
      const aspen = buildRegistry().get("aspen");
      let plant: Plant = { speciesId: "aspen", ageTicks: 0, health: 1 };
      for (let i = 0; i < 2000; i++) plant = applyVegetationHealthTick(plant, aspen, world.water, 3, 3);
      expect(plant.health).toBe(1);
    });

    it("a healthy willow (health=1) in a full, sustained flood holds steady at exactly 1, never declining", () => {
      const world = buildFlatWorld();
      world.water.setDepth(3, 3, WETNESS_REFERENCE_DEPTH * 2); // sustained full flood
      const willow = buildRegistry().get("willow");
      let plant: Plant = { speciesId: "willow", ageTicks: 0, health: 1 };
      for (let i = 0; i < 2000; i++) plant = applyVegetationHealthTick(plant, willow, world.water, 3, 3);
      expect(plant.health).toBe(1);
    });
  });
});

describe("applyPlantGrowthTick", () => {
  it("advances ageTicks by exactly one tick", () => {
    const plant: Plant = { speciesId: "aspen", ageTicks: 500, health: 1 };
    expect(applyPlantGrowthTick(plant)).toEqual({ speciesId: "aspen", ageTicks: 501, health: 1 });
  });

  it("leaves health untouched", () => {
    const plant: Plant = { speciesId: "aspen", ageTicks: 0, health: 0.42 };
    expect(applyPlantGrowthTick(plant).health).toBe(0.42);
  });
});

describe("plantSapling", () => {
  it("creates a real, brand-new tree entity at age 0 and full health", () => {
    const { world } = buildFlatWorld();
    const id = plantSapling(world, "aspen", { x: 3, z: 3 });

    expect(world.entities.isLive(id)).toBe(true);
    expect(world.entities.kindOf(id)).toBe("tree");
    expect(getPlant(world.components, id)).toEqual({ speciesId: "aspen", ageTicks: 0, health: 1 });
    expect(world.grid.positionOf(id)).toEqual({ x: 3, y: world.grid.surfaceY(3, 3)! + 1, z: 3 });
  });

  it("throws for a site with no ground", () => {
    const { world } = buildFlatWorld();
    expect(() => plantSapling(world, "aspen", { x: 999, z: 999 })).toThrow(RangeError);
  });
});

describe("isFishHabitat / spawnFish", () => {
  it("a dry column is never fish habitat", () => {
    const { water } = buildFlatWorld();
    expect(isFishHabitat(water, 3, 3)).toBe(false);
  });

  it("a shallow column below FISH_HABITAT_MIN_DEPTH is not fish habitat", () => {
    const { water } = buildFlatWorld();
    water.setDepth(3, 3, FISH_HABITAT_MIN_DEPTH - 0.1);
    expect(isFishHabitat(water, 3, 3)).toBe(false);
  });

  it("a column at or beyond FISH_HABITAT_MIN_DEPTH is fish habitat", () => {
    const { water } = buildFlatWorld();
    water.setDepth(3, 3, FISH_HABITAT_MIN_DEPTH);
    expect(isFishHabitat(water, 3, 3)).toBe(true);
  });

  it("spawnFish places a real, physical fish entity at a suitable column", () => {
    const { world, water } = buildFlatWorld();
    water.setDepth(3, 3, FISH_HABITAT_MIN_DEPTH + 1);
    const id = spawnFish(world, water, { x: 3, z: 3 });

    expect(world.entities.isLive(id)).toBe(true);
    expect(world.entities.kindOf(id)).toBe("fish");
    expect(world.grid.positionOf(id)).toEqual({ x: 3, y: world.grid.surfaceY(3, 3)! + 1, z: 3 });
  });

  it("throws for a column that isn't real fish habitat", () => {
    const { world, water } = buildFlatWorld();
    expect(() => spawnFish(world, water, { x: 3, z: 3 })).toThrow(RangeError); // bone dry
    water.setDepth(3, 3, 0.1); // wet, but too shallow
    expect(() => spawnFish(world, water, { x: 3, z: 3 })).toThrow(RangeError);
  });
});
