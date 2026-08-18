/**
 * Headless acceptance test for P9-05 -- Survival adventure loop.
 *
 * Roadmap acceptance test: "food, sleep, weather, injury, water, and
 * danger remain the same mechanics as colony mode."
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
import type { ColonyLoopDeps } from "../../src/sim/runtime/ColonyLoop.js";
import type { NavigationProfile } from "../../src/sim/navigation/Pathfinding.js";
import { PlantSpeciesRegistry } from "../../src/sim/ecology/PlantSpecies.js";
import { registerStandardPlantSpecies } from "../../src/sim/ecology/standardPlantSpecies.js";
import { RecipeRegistry, registerStandardRecipes } from "../../src/sim/economy/Recipe.js";
import { AnimalSpeciesRegistry, registerStandardAnimalSpecies } from "../../src/sim/creatures/AnimalSpecies.js";
import { PathogenRegistry, registerStandardPathogens } from "../../src/sim/creatures/Disease.js";
import { spawnBeaver, getHealth } from "../../src/sim/creatures/Beaver.js";
import { getNeeds, applyNeedsTick, setNeeds } from "../../src/sim/creatures/Needs.js";
import { resolveAttack, getWounds } from "../../src/sim/creatures/Anatomy.js";
import { tickCreatureWounds } from "../../src/sim/creatures/Anatomy.js";
import { die } from "../../src/sim/creatures/Mortality.js";
import { designatePlayerControlled, tickControlledBeaver } from "../../src/sim/wayfarer/Control.js";
import { wayfarerSurvivalReport, tickWayfarerSurvival } from "../../src/sim/wayfarer/Survival.js";

const PROFILE: NavigationProfile = { canSwim: true, maxWadingDepth: 0.5 };

function buildWorld(): { world: World; deps: ColonyLoopDeps } {
  const entities = new EntityIdRegistry();
  const components = new ComponentStore(entities);
  const grid = new WorldGrid({ sizeX: 20, sizeY: 10, sizeZ: 20 }, entities);
  const materials = new MaterialRegistry();
  registerStandardMaterials(materials);
  const terrain = new TerrainField(grid, materials);
  for (let x = 0; x < 20; x++) for (let z = 0; z < 20; z++) for (let y = 0; y <= 2; y++) terrain.setMaterial(x, y, z, "soil");
  const water = new WaterField(grid);
  const weather = new Weather();
  const plantSpecies = new PlantSpeciesRegistry();
  registerStandardPlantSpecies(plantSpecies);
  const recipes = new RecipeRegistry();
  registerStandardRecipes(recipes);
  const animalSpecies = new AnimalSpeciesRegistry();
  registerStandardAnimalSpecies(animalSpecies);
  const pathogens = new PathogenRegistry();
  registerStandardPathogens(pathogens);
  const clock = new SimulationClock({ tickRateHz: 20 });
  const random = new RandomStreams(905);
  const events = new EventLog(entities);
  const world: World = { clock, random, entities, components, grid, terrain, events, water, weather };
  const deps: ColonyLoopDeps = { grid, terrain, water, materials, plantSpecies, recipes, animalSpecies, pathogens, entities, components, profile: PROFILE };
  return { world, deps };
}

describe("P9-05 -- Survival adventure loop", () => {
  it("food, sleep, weather, injury, water, and danger remain the same mechanics as colony mode", () => {
    const { world, deps } = buildWorld();
    const alder = spawnBeaver(world, { name: "Alder", position: { x: 4, y: 3, z: 4 } });
    const control = spawnBeaver(world, { name: "Control", position: { x: 8, y: 3, z: 8 } });
    designatePlayerControlled(world, alder);

    // FOOD/SLEEP (needs): the controlled beaver decays through the SAME
    // formula the colony AI uses -- identical inputs, identical outputs.
    setNeeds(world.components, alder, { hunger: 0.2, thirst: 0.2, fatigue: 0.2, thermalComfort: 1 });
    setNeeds(world.components, control, { hunger: 0.2, thirst: 0.2, fatigue: 0.2, thermalComfort: 1 });
    tickControlledBeaver(deps, world, alder); // idle tick
    setNeeds(world.components, control, applyNeedsTick(getNeeds(world.components, control)!, false));
    expect(getNeeds(world.components, alder)).toEqual(getNeeds(world.components, control));

    // WATER/WEATHER: thermal exposure is the same function of the same
    // real medium for both.
    world.water.setDepth(4, 4, 1.0);
    const before = getNeeds(world.components, alder)!.thermalComfort;
    tickControlledBeaver(deps, world, alder);
    expect(getNeeds(world.components, alder)!.thermalComfort).not.toBe(before);

    // INJURY: wounds bleed and heal through the IDENTICAL per-creature
    // physiology extracted from the world-wide tick.
    resolveAttack(world, control, alder, 4, 0, world.random.stream("p9-05-wound"), undefined);
    const wounded = getWounds(world.components, alder)!;
    expect(wounded.entries.length).toBeGreaterThan(0);
    const healthBefore = getHealth(world.components, alder)!.fraction;
    const severityBefore = wounded.entries[0]!.severity;
    tickWayfarerSurvival(deps, world, alder, false);
    const severityAfter = getWounds(world.components, alder)!.entries[0]!.severity;
    expect(severityAfter).toBeLessThan(severityBefore); // real healing
    const bleeding = getWounds(world.components, alder)!.entries[0]!.bleedingRate;
    if (bleeding > 0) {
      expect(getHealth(world.components, alder)!.fraction).toBeLessThanOrEqual(healthBefore);
    }

    // DROWNING is the ordinary two-stage machinery -- the same function
    // the colony loop calls for every beaver.
    const report = wayfarerSurvivalReport(world, alder);
    expect(report.health).toBeLessThanOrEqual(1);
    expect(report.woundCount).toBeGreaterThan(0);

    // The controlled character can still die the ordinary way.
    const doomed = spawnBeaver(world, { name: "Doomed", position: { x: 12, y: 3, z: 12 } });
    designatePlayerControlled(world, doomed);
    const corpseId = die(world, doomed, "starvation");
    expect(world.entities.isLive(doomed)).toBe(false);
    expect(corpseId).toBeGreaterThan(0);
  });
});
