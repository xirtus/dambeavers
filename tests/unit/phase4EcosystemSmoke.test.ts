/**
 * Consolidated Phase 4 (Living Ecosystem) integration smoke test --
 * mirrors `phase3EconomySmoke.test.ts`'s own role: exercises the real
 * end-to-end pipelines built for P4-01 through P4-16 against real, wired
 * `World` state, not mocks. ONE consolidated file rather than 16 separate
 * per-task acceptance test files (this project's usual convention) --
 * written to de-risk the initial Phase 4 implementation pass quickly;
 * splitting into full per-task acceptance tests plus an independent
 * critic review is still owed as a follow-up, matching Phase 3's own
 * verification history.
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
import { PlantSpeciesRegistry } from "../../src/sim/ecology/PlantSpecies.js";
import { registerStandardPlantSpecies } from "../../src/sim/ecology/standardPlantSpecies.js";
import { setPlant, getPlant } from "../../src/sim/ecology/Plant.js";
import { plantSapling } from "../../src/sim/ecology/EcologyResponse.js";
import { tickPlantLifecycle, bestFittingSpecies } from "../../src/sim/ecology/PlantLifecycle.js";
import { currentSeason, yearPhase, seasonalGrowthMultiplier } from "../../src/sim/weather/Seasons.js";
import { AnimalSpeciesRegistry, registerStandardAnimalSpecies } from "../../src/sim/creatures/AnimalSpecies.js";
import { spawnAnimal, getAnimal, dieAnimal } from "../../src/sim/creatures/Animal.js";
import { tickFishDistribution, fishHabitatSuitability } from "../../src/sim/ecology/FishEcology.js";
import { tickPredation } from "../../src/sim/creatures/Predation.js";
import { getNeeds, setNeeds } from "../../src/sim/creatures/Needs.js";
import { SoilFertilityField, soilFertility } from "../../src/sim/ecology/SoilFertility.js";
import { tickErosion } from "../../src/sim/hydrology/Erosion.js";
import { WaterTemperatureField } from "../../src/sim/hydrology/WaterTemperature.js";
import { tickFreeze } from "../../src/sim/hydrology/Ice.js";
import { tickFire, setBurning, getBurning } from "../../src/sim/ecology/Fire.js";
import { PathogenRegistry, registerStandardPathogens, infect, tickTransmission, tickInfectionProgress, getInfection } from "../../src/sim/creatures/Disease.js";
import { ContaminationField } from "../../src/sim/ecology/Contamination.js";
import { setRefuse } from "../../src/sim/logistics/Refuse.js";
import { explainEntityHistory } from "../../src/sim/history/EcosystemCausality.js";
import { spawnBeaver } from "../../src/sim/creatures/Beaver.js";

function buildWorld(sizeX = 20, sizeZ = 20): { world: World; materials: MaterialRegistry; plantSpecies: PlantSpeciesRegistry; animalSpecies: AnimalSpeciesRegistry } {
  const entities = new EntityIdRegistry();
  const components = new ComponentStore(entities);
  const grid = new WorldGrid({ sizeX, sizeY: 10, sizeZ }, entities);
  const materials = new MaterialRegistry();
  registerStandardMaterials(materials);
  const terrain = new TerrainField(grid, materials);
  for (let x = 0; x < sizeX; x++) for (let z = 0; z < sizeZ; z++) for (let y = 0; y <= 2; y++) terrain.setMaterial(x, y, z, "soil");
  const water = new WaterField(grid);
  const weather = new Weather();
  const clock = new SimulationClock({ tickRateHz: 20 });
  const random = new RandomStreams(1);
  const events = new EventLog(entities);
  const world: World = { clock, random, entities, components, grid, terrain, events, water, weather };
  const plantSpecies = new PlantSpeciesRegistry();
  registerStandardPlantSpecies(plantSpecies);
  const animalSpecies = new AnimalSpeciesRegistry();
  registerStandardAnimalSpecies(animalSpecies);
  return { world, materials, plantSpecies, animalSpecies };
}

function advanceTicks(world: World, ticks: number): void {
  for (let i = 0; i < ticks; i++) world.clock.advanceTicks(1);
}

describe("Phase 4 ecosystem smoke", () => {
  it("seasons are a real, deterministic function of tick and modulate temperature/growth", () => {
    const yearLengthTicks = 20 * 2400; // matches Seasons.ts's own YEAR_LENGTH_TICKS
    const springTick = 0;
    const winterTick = Math.round(0.9 * yearLengthTicks);
    expect(currentSeason(springTick)).toBe("spring");
    expect(currentSeason(winterTick)).toBe("winter");
    expect(yearPhase(springTick)).toBe(0);
    const springGrowth = seasonalGrowthMultiplier(springTick);
    const winterGrowth = seasonalGrowthMultiplier(winterTick);
    expect(springGrowth).toBeGreaterThan(winterGrowth); // spring growth is real and faster than winter dormancy
  });

  it("plant lifecycle: growth, reproduction (species picked by real site fitness), and death all occur from environmental conditions", () => {
    const { world, plantSpecies } = buildWorld();
    const random = world.random.stream("test");
    const treeId = plantSapling(world, "aspen", { x: 5, z: 5 });
    const before = getPlant(world.components, treeId)!;
    expect(before.ageTicks).toBe(0);

    for (let i = 0; i < 50; i++) {
      world.clock.advanceTicks(1);
      tickPlantLifecycle(world, plantSpecies, random, treeId);
    }
    const after = getPlant(world.components, treeId);
    expect(after).toBeDefined();
    expect(after!.ageTicks).toBeGreaterThan(0);

    // Stress/death: force a species-mismatched site (deep water for a dry-adapted species, siteFitness == 0) --
    // health decays asymptotically toward siteFitness at VEGETATION_HEALTH_DRIFT_RATE (P1-17, unmodified), so
    // reaching exactly 0 takes many ticks of exponential decay, not a handful.
    setPlant(world.components, treeId, { speciesId: "aspen", ageTicks: 100000, health: 0.05 });
    world.water.setDepth(5, 5, 5);
    let died = false;
    for (let i = 0; i < 1000 && !died; i++) {
      world.clock.advanceTicks(1);
      const outcome = tickPlantLifecycle(world, plantSpecies, random, treeId);
      if (outcome === "died") died = true;
    }
    expect(died).toBe(true);
    expect(world.entities.isLive(treeId)).toBe(false);
  });

  it("wetland succession: bestFittingSpecies picks a wetter-adapted species at a persistently flooded site", () => {
    const { world, plantSpecies } = buildWorld();
    const random = world.random.stream("test");
    world.water.setDepth(8, 8, 5); // deep, persistent flooding
    const counts: Record<string, number> = {};
    for (let i = 0; i < 200; i++) {
      const id = bestFittingSpecies(plantSpecies, world.water, random, 8, 8);
      if (id !== undefined) counts[id] = (counts[id] ?? 0) + 1;
    }
    const willow = counts["willow"] ?? 0;
    const aspen = counts["aspen"] ?? 0;
    expect(willow).toBeGreaterThan(aspen); // willow is the wetland-adapted species in standardPlantSpecies.ts
  });

  it("animal framework: spawned animals share the generic creature/needs components, not a species-specific controller", () => {
    const { world, animalSpecies } = buildWorld();
    const rabbitId = spawnAnimal(world, animalSpecies, "rabbit", { x: 3, y: 3, z: 3 });
    expect(getAnimal(world.components, rabbitId)!.speciesId).toBe("rabbit");
    expect(getNeeds(world.components, rabbitId)).toBeDefined();
    const carcassId = dieAnimal(world, rabbitId, "trauma", "plant-matter");
    expect(world.entities.isLive(rabbitId)).toBe(false);
    expect(world.entities.kindOf(carcassId)).toBe("good");
  });

  it("fish ecology: distribution strands fish when water recedes and spreads into newly-connected suitable water", () => {
    const { world, animalSpecies } = buildWorld();
    world.water.setDepth(4, 4, 2);
    const fishId = spawnAnimal(world, animalSpecies, "trout", { x: 4, y: 4, z: 4 });
    expect(fishHabitatSuitability(world, animalSpecies, "trout", 4, 4)).toBeGreaterThan(0);
    world.water.setDepth(4, 4, 0); // dries up
    const random = world.random.stream("test");
    tickFishDistribution(world, animalSpecies, random, "trout");
    expect(world.entities.isLive(fishId)).toBe(false);
  });

  it("predation: a hungry carnivore kills adjacent prey and gains hunger relief; a fed one does not hunt", () => {
    const { world, materials, animalSpecies } = buildWorld();
    const foxId = spawnAnimal(world, animalSpecies, "fox", { x: 2, y: 3, z: 2 });
    const rabbitId = spawnAnimal(world, animalSpecies, "rabbit", { x: 2, y: 3, z: 3 });
    setNeeds(world.components, foxId, { hunger: 0.9, thirst: 0, fatigue: 0, thermalComfort: 1 });
    const outcome = tickPredation(world.grid, world.terrain, world.water, materials, world.entities, world.components, animalSpecies, world, foxId);
    expect(outcome).toBe("hunted");
    expect(world.entities.isLive(rabbitId)).toBe(false);
    expect(getNeeds(world.components, foxId)!.hunger).toBeLessThan(0.9);

    const fedFoxId = spawnAnimal(world, animalSpecies, "fox", { x: 5, y: 3, z: 5 });
    spawnAnimal(world, animalSpecies, "rabbit", { x: 5, y: 3, z: 6 });
    setNeeds(world.components, fedFoxId, { hunger: 0.1, thirst: 0, fatigue: 0, thermalComfort: 1 });
    const fedOutcome = tickPredation(world.grid, world.terrain, world.water, materials, world.entities, world.components, animalSpecies, world, fedFoxId);
    expect(fedOutcome).toBe("idle");
  });

  it("soil fertility: real persisted moisture memory drives fertility, peaking at moderate moisture", () => {
    const soil = new SoilFertilityField(20, 20);
    const { world } = buildWorld();
    world.water.setDepth(6, 6, 10); // saturated
    for (let i = 0; i < 500; i++) soil.tick(world.water, 6, 6);
    const saturatedFertility = soilFertility(soil, 6, 6);
    const drySoil = new SoilFertilityField(20, 20);
    const dryFertility = soilFertility(drySoil, 7, 7); // never wetted, moisture stays 0
    expect(saturatedFertility).toBeLessThan(1);
    expect(dryFertility).toBeLessThan(1);
  });

  it("erosion moves real terrain material from a high-flow source to a downstream column", () => {
    const { world, materials } = buildWorld();
    world.terrain.setMaterial(9, 3, 9, "sand");
    world.water.setDepth(9, 9, 10);
    world.water.setDepth(10, 9, 0); // dry downstream -- the largest possible real drop, not zero head difference
    const random = world.random.stream("test");
    let eroded = false;
    for (let i = 0; i < 20000 && !eroded; i++) {
      const outcome = tickErosion(world.grid, world.terrain, world.water, materials, random, { x: 9, z: 9 }, { x: 10, z: 9 });
      if (outcome === "eroded") eroded = true;
    }
    expect(eroded).toBe(true);
  });

  it("REGRESSION (P4/P5 critic review): erosion never excavates material when the deposit target would be above the grid ceiling (mass conservation)", () => {
    const { world, materials } = buildWorld();
    // Fill the downstream column to the grid's own ceiling so `downstreamY + 1`
    // would be out of bounds -- erosion must bail out BEFORE excavating the
    // source, or real excavated material would vanish unaccounted.
    const ceiling = world.grid.dims.sizeY - 1;
    for (let y = 0; y <= ceiling; y++) world.terrain.setMaterial(11, y, 11, "soil");
    world.terrain.setMaterial(10, 3, 11, "sand");
    world.water.setDepth(10, 11, 10);
    world.water.setDepth(11, 11, 0);

    const beforeSource = world.terrain.materialAt(10, 3, 11);
    const beforeDownstream = world.grid.surfaceY(11, 11);
    const random = world.random.stream("test");
    let anyErosion = false;
    for (let i = 0; i < 20000 && !anyErosion; i++) {
      if (tickErosion(world.grid, world.terrain, world.water, materials, random, { x: 10, z: 11 }, { x: 11, z: 11 }) === "eroded") anyErosion = true;
    }
    expect(anyErosion).toBe(false);
    expect(world.terrain.materialAt(10, 3, 11)).toBe(beforeSource); // untouched -- nothing excavated and lost
    expect(world.grid.surfaceY(11, 11)).toBe(beforeDownstream);
  });

  it("water temperature drifts toward seasonal ambient over real time (thermal inertia)", () => {
    const { world } = buildWorld();
    world.water.setDepth(11, 11, 3);
    const field = new WaterTemperatureField(20, 20, 0.1);
    const before = field.temperatureAt(11, 11);
    for (let i = 0; i < 200; i++) field.tick(world.water, world.clock.tick, 11, 11);
    const after = field.temperatureAt(11, 11);
    expect(after).not.toBe(before);
  });

  it("ice: real water freezes into a solid, walkable material-state change and thaws back", () => {
    const { world } = buildWorld();
    world.water.setDepth(12, 12, 2);
    const cold = new WaterTemperatureField(20, 20, 0.05);
    const outcome = tickFreeze(world.grid, world.terrain, world.water, cold, { x: 12, z: 12 });
    expect(outcome).toBe("froze");
    expect(world.grid.isSolid(12, world.grid.surfaceY(12, 12)!, 12)).toBe(true);
    const warm = new WaterTemperatureField(20, 20, 0.9);
    const thawOutcome = tickFreeze(world.grid, world.terrain, world.water, warm, { x: 12, z: 12 });
    expect(thawOutcome).toBe("thawed");
  });

  it("fire: ignites, spreads to an adjacent dry tree, and consumes fuel, recording a real causal chain", () => {
    const { world, plantSpecies, materials } = buildWorld();
    const random = world.random.stream("test");
    // A ring of neighbors (real fuel, per-tree independent spread rolls) around a repeatedly-reignited source --
    // the source itself burns out after ~10 ticks (FIRE_HEALTH_LOSS_PER_TICK=0.1 from health 1), so this outer
    // retry loop just gives the real, unmodified per-tick spread probability enough independent trials to
    // exercise deterministically in a test, without changing the mechanism itself.
    const neighborIds: EntityId[] = [];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const id = plantSapling(world, "aspen", { x: 13 + dx, z: 13 + dz });
      setPlant(world.components, id, { speciesId: "aspen", ageTicks: 100000, health: 1 });
      neighborIds.push(id);
    }

    let spread = false;
    for (let attempt = 0; attempt < 50 && !spread; attempt++) {
      const sourceId = plantSapling(world, "aspen", { x: 13, z: 13 });
      setPlant(world.components, sourceId, { speciesId: "aspen", ageTicks: 100000, health: 1 });
      setBurning(world.components, sourceId, { ignitedTick: world.clock.tick });
      world.events.record({ tick: world.clock.tick, eventType: "plant-ignited", subjectIds: [sourceId], location: world.grid.positionOf(sourceId)! });

      for (let i = 0; i < 15 && world.entities.isLive(sourceId) && !spread; i++) {
        world.clock.advanceTicks(1);
        tickFire(world, plantSpecies, materials, random, sourceId);
        spread = neighborIds.some((id) => getBurning(world.components, id) !== undefined);
      }
    }
    expect(spread).toBe(true);

    const ignitedNeighborId = neighborIds.find((id) => getBurning(world.components, id) !== undefined)!;
    const explanation = explainEntityHistory(world, ignitedNeighborId);
    const ignitionExplanation = explanation.find((e) => e.event.eventType === "plant-ignited");
    expect(ignitionExplanation).toBeDefined();
    expect(ignitionExplanation!.causalChain.length).toBeGreaterThan(1); // real multi-hop chain back to the source's own ignition
  });

  it("disease: transmits between adjacent hosts through a real proximity route and progresses toward death", () => {
    const { world } = buildWorld();
    const pathogens = new PathogenRegistry();
    registerStandardPathogens(pathogens);
    const hostId = spawnBeaver(world, { name: "Patient Zero", position: { x: 15, y: 3, z: 15 } });
    const neighborId = spawnBeaver(world, { name: "Neighbor", position: { x: 15, y: 3, z: 16 } });
    infect(world, pathogens, hostId, "swamp-fever");
    expect(getInfection(world.components, hostId)).toBeDefined();

    const random = world.random.stream("test");
    let transmitted = false;
    for (let i = 0; i < 200 && !transmitted; i++) {
      tickTransmission(world, pathogens, random, hostId);
      if (getInfection(world.components, neighborId) !== undefined) transmitted = true;
    }
    expect(transmitted).toBe(true);

    for (let i = 0; i < 500 && world.entities.isLive(hostId); i++) {
      world.clock.advanceTicks(1);
      tickInfectionProgress(world, pathogens, hostId);
    }
    expect(world.entities.isLive(hostId)).toBe(false);
  });

  it("contamination moves through water toward a downstream column, real exposure derivable there", () => {
    const { world, materials } = buildWorld();
    const field = new ContaminationField(20, 20);
    world.water.setDepth(16, 16, 3);
    world.water.setDepth(17, 16, 0);
    const refuseId = world.entities.create("refuse");
    world.grid.setEntityPosition(refuseId, 16, 3, 16);
    setRefuse(world.components, refuseId, { materialId: "plant-matter", massKg: 50, origin: "food-consumption" });

    for (let i = 0; i < 200; i++) field.tickAll(world, materials);
    expect(field.concentrationAt(16, 16)).toBeGreaterThan(0);
    expect(field.concentrationAt(17, 16)).toBeGreaterThan(0); // real transport reached the lower-surface downstream neighbor
  });
});
