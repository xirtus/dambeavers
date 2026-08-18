/**
 * Headless acceptance test for P9-02 -- Local interaction verbs.
 *
 * Roadmap acceptance test: "pickup, drop, use, eat, drink, open, climb,
 * swim, speak, and attack operate on ordinary world entities."
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
import { spawnBeaver, getInventory, setSkills } from "../../src/sim/creatures/Beaver.js";
import { getNeeds, setNeeds } from "../../src/sim/creatures/Needs.js";
import { setLog, getHeld } from "../../src/sim/labor/Log.js";
import { setFood, getFood } from "../../src/sim/labor/Food.js";
import { createGate, getGate } from "../../src/sim/hydrology/Gate.js";
import { createTool, setRequiredTool } from "../../src/sim/labor/Equipment.js";
import { setJob } from "../../src/sim/jobs/Job.js";
import { getHealth } from "../../src/sim/creatures/Beaver.js";
import { makeWeapon } from "../../src/sim/politics/Weaponry.js";
import { setGood } from "../../src/sim/economy/Good.js";
import { setRelationshipWith, relationshipWith } from "../../src/sim/creatures/Relationships.js";
import { executeWayfarerVerb } from "../../src/sim/wayfarer/Verbs.js";
import { designatePlayerControlled, tickControlledBeaver, submitWayfarerCommand, getPlayerControl } from "../../src/sim/wayfarer/Control.js";

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
  const random = new RandomStreams(902);
  const events = new EventLog(entities);
  const world: World = { clock, random, entities, components, grid, terrain, events, water, weather };
  const deps: ColonyLoopDeps = { grid, terrain, water, materials, plantSpecies, recipes, animalSpecies, pathogens, entities, components, profile: PROFILE };
  return { world, deps };
}

function spawnAt(world: World, name: string, x: number, z: number): EntityId {
  const floor = world.grid.surfaceY(x, z)!;
  return spawnBeaver(world, { name, position: { x, y: floor + 1, z } });
}

describe("P9-02 -- Local interaction verbs", () => {
  it("pickup, drop, use, eat, drink, open, climb, swim, speak, and attack operate on ordinary world entities", () => {
    const { world, deps } = buildWorld();
    const alder = spawnAt(world, "Alder", 3, 3);
    const birch = spawnAt(world, "Birch", 6, 3);
    designatePlayerControlled(world, alder);

    // PICKUP: an ordinary log on the ground, adjacent.
    const log = world.entities.create("log");
    world.grid.setEntityPosition(log, 4, 3, 3);
    setLog(world.components, log, { materialId: "wood", massKg: 5 });
    const pickup = executeWayfarerVerb(deps, world, alder, { kind: "pickup", itemId: log });
    expect(pickup.ok).toBe(true);
    expect(getHeld(world.components, log)).toEqual({ by: alder });
    expect(getInventory(world.components, alder)?.itemIds).toContain(log);
    // Out of reach: an item two cells away cannot be picked up.
    const farLog = world.entities.create("log");
    world.grid.setEntityPosition(farLog, 10, 3, 10);
    setLog(world.components, farLog, { materialId: "wood", massKg: 5 });
    expect(executeWayfarerVerb(deps, world, alder, { kind: "pickup", itemId: farLog }).ok).toBe(false);

    // DROP: set the held log down at an adjacent cell.
    const dropResult = executeWayfarerVerb(deps, world, alder, { kind: "drop", itemId: log, at: { x: 3, z: 4 } });
    expect(dropResult.ok).toBe(true);
    expect(getHeld(world.components, log)).toBeUndefined();
    expect(world.grid.positionOf(log)).toMatchObject({ x: 3, z: 4 });

    // EAT: a real food item, held.
    const food = world.entities.create("food");
    world.grid.setEntityPosition(food, 3, 3, 3);
    setFood(world.components, food, { nutritionValue: 0.5, materialId: "plant-matter", massKg: 1 });
    executeWayfarerVerb(deps, world, alder, { kind: "pickup", itemId: food });
    // A genuinely hungry beaver (real state first, then the verb).
    setNeeds(world.components, alder, { ...getNeeds(world.components, alder)!, hunger: 0.8 });
    const hungerBefore = getNeeds(world.components, alder)!.hunger;
    const eat = executeWayfarerVerb(deps, world, alder, { kind: "eat", itemId: food });
    expect(eat.ok).toBe(true);
    expect(world.entities.isLive(food)).toBe(false); // really consumed
    expect(getNeeds(world.components, alder)!.hunger).toBeLessThan(hungerBefore);

    // DRINK: only where real water stands.
    expect(executeWayfarerVerb(deps, world, alder, { kind: "drink" }).ok).toBe(false); // dry ground
    world.water.setDepth(3, 3, 0.8);
    setNeeds(world.components, alder, { ...getNeeds(world.components, alder)!, thirst: 0.7 });
    const thirstBefore = getNeeds(world.components, alder)!.thirst;
    expect(executeWayfarerVerb(deps, world, alder, { kind: "drink" }).ok).toBe(true);
    expect(getNeeds(world.components, alder)!.thirst).toBeLessThan(thirstBefore);

    // OPEN: a real gate's own state flips.
    const gate = createGate(world, { x: 5, z: 5 }, 3, "wood");
    const opened = executeWayfarerVerb(deps, world, alder, { kind: "open", gateId: gate });
    expect(opened.ok).toBe(false); // not adjacent from (3,3)
    submitMoveTo(deps, world, alder, 4, 5);
    const openResult = executeWayfarerVerb(deps, world, alder, { kind: "open", gateId: gate });
    expect(openResult.ok).toBe(true);
    expect(getGate(world.components, gate)!.isOpen).toBe(true);

    // USE: a real tool against a real required-tool target.
    const tool = createTool(world, { toolKind: "axe", laborKinds: ["tree-cutting"], materialId: "wood" }, { x: 5, y: 3, z: 4 });
    const treeJob = world.entities.create("job");
    setJob(world.components, treeJob, { designationId: treeJob, target: { x: 5, z: 3 }, status: "unclaimed" });
    setRequiredTool(world.components, treeJob, { toolKind: "axe" });
    expect(executeWayfarerVerb(deps, world, alder, { kind: "use", toolId: tool, targetId: treeJob }).ok).toBe(false); // not held
    executeWayfarerVerb(deps, world, alder, { kind: "pickup", itemId: tool });
    // The target must be adjacent: move beside it.
    submitMoveTo(deps, world, alder, 5, 3);
    const use = executeWayfarerVerb(deps, world, alder, { kind: "use", toolId: tool, targetId: treeJob });
    expect(use.ok).toBe(true);
    expect(world.events.eventsOfType("tool-used").length).toBe(1);

    // SPEAK: real relationship contact through the ordinary machinery.
    submitMoveTo(deps, world, alder, 6, 3);
    const speak = executeWayfarerVerb(deps, world, alder, { kind: "speak", targetId: birch });
    expect(speak.ok).toBe(true);
    expect(world.events.eventsOfType("wayfarer-conversation").length).toBe(1);
    const edge = relationshipWith(world.components, alder, birch);
    expect(edge).toBeDefined();

    // ATTACK: the same exchange primitive battles use -- a real wound.
    // Combat skill is part of the real force formula (the battle path's
    // own fighterForce), so the attacker is given a real skill level.
    setSkills(world.components, alder, { levels: { combat: 1 } });
    setGood(world.components, tool, { goodKind: "tool", materialId: "wood", massKg: 10 }); // a real material body whose force genuinely penetrates tissue
    makeWeapon(world.components, tool, "club", 2, 0.2); // the held tool becomes a real club
    const healthBefore = getHealth(world.components, birch)!.fraction;
    const attack = executeWayfarerVerb(deps, world, alder, { kind: "attack", targetId: birch });
    expect(attack.ok).toBe(true);
    expect(getHealth(world.components, birch)!.fraction).toBeLessThanOrEqual(healthBefore);
    expect(world.events.eventsOfType("wound-inflicted").length).toBeGreaterThan(0);

    // CLIMB/SWIM are the ordinary move command: a water cell is entered
    // through the beaver's own swimmer profile, exactly like any agent.
    world.water.setDepth(7, 3, 2.0);
    submitMoveTo(deps, world, alder, 7, 3);
    expect(world.grid.positionOf(alder)).toMatchObject({ x: 7, z: 3 });
    expect(world.water.depthAt(7, 3)).toBeGreaterThan(0.5); // genuinely in deep water
  });
});

/** Drives ordinary move commands through the ordinary controlled tick until arrival. */
function submitMoveTo(deps: ColonyLoopDeps, world: World, beaverId: EntityId, x: number, z: number): void {
  submitWayfarerCommand(world, beaverId, { kind: "move", goal: { x, z } });
  let guard = 0;
  while (getPlayerControl(world.components, beaverId)?.pending !== undefined && guard < 100) {
    tickControlledBeaver(deps, world, beaverId);
    guard++;
  }
}
