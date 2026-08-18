/**
 * Headless acceptance test for P9-01 -- Direct creature control.
 *
 * Roadmap acceptance test: "player control replaces decision selection
 * for one creature while preserving the ordinary movement/body systems."
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
import { snapshotWorld, restoreWorld } from "../../src/sim/persistence/WorldSnapshot.js";
import { ALL_COMPONENT_TYPES } from "../../src/sim/persistence/AllComponentTypes.js";
import type { ColonyLoopDeps } from "../../src/sim/runtime/ColonyLoop.js";
import { tickColony } from "../../src/sim/runtime/ColonyLoop.js";
import type { NavigationProfile } from "../../src/sim/navigation/Pathfinding.js";
import { PlantSpeciesRegistry } from "../../src/sim/ecology/PlantSpecies.js";
import { registerStandardPlantSpecies } from "../../src/sim/ecology/standardPlantSpecies.js";
import { RecipeRegistry, registerStandardRecipes } from "../../src/sim/economy/Recipe.js";
import { AnimalSpeciesRegistry, registerStandardAnimalSpecies } from "../../src/sim/creatures/AnimalSpecies.js";
import { PathogenRegistry, registerStandardPathogens } from "../../src/sim/creatures/Disease.js";
import { spawnBeaver } from "../../src/sim/creatures/Beaver.js";
import { getNeeds, applyNeedsTick } from "../../src/sim/creatures/Needs.js";
import { setLog } from "../../src/sim/labor/Log.js";
import { designateHaul } from "../../src/sim/labor/Hauling.js";
import { getPlayerControl, isPlayerControlled, designatePlayerControlled, releaseControl, submitWayfarerCommand, tickControlledBeaver } from "../../src/sim/wayfarer/Control.js";

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
  const random = new RandomStreams(901);
  const events = new EventLog(entities);
  const world: World = { clock, random, entities, components, grid, terrain, events, water, weather };
  const deps: ColonyLoopDeps = { grid, terrain, water, materials, plantSpecies, recipes, animalSpecies, pathogens, entities, components, profile: PROFILE };
  return { world, deps };
}

function spawnAt(world: World, name: string, x: number, z: number): EntityId {
  const floor = world.grid.surfaceY(x, z)!;
  return spawnBeaver(world, { name, position: { x, y: floor + 1, z } });
}

describe("P9-01 -- Direct creature control", () => {
  it("player control replaces decision selection while preserving the ordinary movement/body systems", () => {
    const { world, deps } = buildWorld();
    const alder = spawnAt(world, "Alder", 3, 3);
    const birch = spawnAt(world, "Birch", 6, 3);

    // Real work exists for decision-makers.
    const log = world.entities.create("log");
    world.grid.setEntityPosition(log, 8, 3, 8);
    setLog(world.components, log, { materialId: "wood", massKg: 5 });
    designateHaul(world, log, { x: 12, z: 12 });

    // The player takes control of Alder.
    designatePlayerControlled(world, alder);
    expect(isPlayerControlled(world.components, alder)).toBe(true);

    // One colony tick: Birch (ordinary AI) may act on the world; Alder's
    // decisions are the player's -- no job is ever claimed by Alder.
    world.clock.advanceTicks(1);
    tickColony(deps, world);
    for (const jobId of world.entities.liveIdsOfKind("job")) {
      const job = world.components.get(jobId, ALL_COMPONENT_TYPES.get("job")!) as { reservedBy?: EntityId } | undefined;
      expect(job?.reservedBy).not.toBe(alder);
    }

    // Body systems preserved: Alder's needs advanced through the SAME
    // formula the ordinary AI uses (wasActive=false while idle).
    const needsBefore = getNeeds(world.components, alder)!;
    world.clock.advanceTicks(1);
    tickColony(deps, world);
    const needsAfter = getNeeds(world.components, alder)!;
    expect(needsAfter).toEqual(applyNeedsTick(needsBefore, false));

    // A player move command travels through ORDINARY movement: one
    // speed-budget step per tick, no teleport.
    const startPosition = world.grid.positionOf(alder)!;
    submitWayfarerCommand(world, alder, { kind: "move", goal: { x: 15, z: 15 } });
    const firstTick = tickControlledBeaver(deps, world, alder);
    expect(firstTick.status).toBe("in-progress");
    const movedPosition = world.grid.positionOf(alder)!;
    const distance = Math.max(Math.abs(movedPosition.x - startPosition.x), Math.abs(movedPosition.z - startPosition.z));
    expect(distance).toBeGreaterThan(0);
    expect(distance).toBeLessThan(6); // one ordinary budget, not the whole route

    // Keep ticking until arrival -- the goal is reached by ordinary steps.
    let guard = 0;
    while (getPlayerControl(world.components, alder)?.pending !== undefined && guard < 100) {
      world.clock.advanceTicks(1);
      tickColony(deps, world);
      guard++;
    }
    const finalPosition = world.grid.positionOf(alder)!;
    expect(finalPosition).toMatchObject({ x: 15, z: 15 });
    expect(getPlayerControl(world.components, alder)?.pending).toBeUndefined();

    // Walk the beaver away from the enclosure site first (ordinary steps).
    submitWayfarerCommand(world, alder, { kind: "move", goal: { x: 5, z: 5 } });
    let outGuard = 0;
    while (getPlayerControl(world.components, alder)?.pending !== undefined && outGuard < 60) {
      tickControlledBeaver(deps, world, alder);
      outGuard++;
    }
    expect(world.grid.positionOf(alder)).toMatchObject({ x: 5, z: 5 });

    // An unreachable goal fails honestly through the ordinary navigator:
    // a real full-height walled enclosure around the goal blocks every
    // route (solid stone from floor to ceiling on all 8 neighbors).
    for (let x = 14; x <= 16; x++) {
      for (let z = 14; z <= 16; z++) {
        if (x === 15 && z === 15) continue;
        for (let y = 3; y <= 9; y++) world.terrain.setMaterial(x, y, z, "stone");
      }
    }
    submitWayfarerCommand(world, alder, { kind: "move", goal: { x: 15, z: 15 } });
    const blocked = tickControlledBeaver(deps, world, alder);
    expect(blocked.status).toBe("blocked");

    // Releasing control returns the beaver to ordinary AI decisions.
    releaseControl(world, alder);
    expect(isPlayerControlled(world.components, alder)).toBe(false);
  });

  it("player control survives save/reload, including a pending move", () => {
    const { world, deps } = buildWorld();
    const alder = spawnAt(world, "Alder", 3, 3);
    designatePlayerControlled(world, alder);
    submitWayfarerCommand(world, alder, { kind: "move", goal: { x: 10, z: 10 } });
    world.clock.advanceTicks(1);
    tickColony(deps, world);

    const materials = new MaterialRegistry();
    registerStandardMaterials(materials);
    const restored = restoreWorld(snapshotWorld(world), { componentTypes: ALL_COMPONENT_TYPES, materials });
    expect(isPlayerControlled(restored.components, alder)).toBe(true);
    expect(getPlayerControl(restored.components, alder)?.pending).toEqual({ kind: "move", goal: { x: 10, z: 10 } });
  });
});
