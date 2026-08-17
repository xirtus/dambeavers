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
import { PlantSpeciesRegistry } from "../../src/sim/ecology/PlantSpecies.js";
import { registerStandardPlantSpecies } from "../../src/sim/ecology/standardPlantSpecies.js";
import { RecipeRegistry, registerStandardRecipes } from "../../src/sim/economy/Recipe.js";
import type { World } from "../../src/sim/persistence/WorldSnapshot.js";
import type { NavigationProfile } from "../../src/sim/navigation/Pathfinding.js";
import { spawnBeaver } from "../../src/sim/creatures/Beaver.js";
import { setNeeds, BASELINE_NEEDS } from "../../src/sim/creatures/Needs.js";
import { setLog, pickUp, getHeld } from "../../src/sim/labor/Log.js";
import { designateHaul, generateHaulJob, getHaulProgress } from "../../src/sim/labor/Hauling.js";
import { currentJobOf } from "../../src/sim/jobs/JobBoard.js";
import { getJob } from "../../src/sim/jobs/Job.js";
import { tickColony, type ColonyLoopDeps } from "../../src/sim/runtime/ColonyLoop.js";

const PROFILE: NavigationProfile = { canSwim: true, maxWadingDepth: 0.5 };

function buildWorld(): { world: World; deps: ColonyLoopDeps } {
  const entities = new EntityIdRegistry();
  const components = new ComponentStore(entities);
  const grid = new WorldGrid({ sizeX: 12, sizeY: 8, sizeZ: 12 }, entities);
  const materials = new MaterialRegistry();
  registerStandardMaterials(materials);
  const terrain = new TerrainField(grid, materials);
  for (let x = 0; x < 12; x++) for (let z = 0; z < 12; z++) for (let y = 0; y <= 2; y++) terrain.setMaterial(x, y, z, "soil");
  const water = new WaterField(grid);
  const weather = new Weather();
  const plantSpecies = new PlantSpeciesRegistry();
  registerStandardPlantSpecies(plantSpecies);
  const recipes = new RecipeRegistry();
  registerStandardRecipes(recipes);
  const clock = new SimulationClock({ tickRateHz: 20 });
  const random = new RandomStreams(1);
  const events = new EventLog(entities);
  const world: World = { clock, random, entities, components, grid, terrain, events, water, weather };
  const deps: ColonyLoopDeps = { grid, terrain, water, materials, plantSpecies, recipes, entities, components, profile: PROFILE };
  return { world, deps };
}

function spawnAt(world: World, x: number, z: number, name = "Beaver"): EntityId {
  const floor = world.grid.surfaceY(x, z)!;
  const id = spawnBeaver(world, { name, position: { x, y: floor + 1, z } });
  setNeeds(world.components, id, { ...BASELINE_NEEDS });
  return id;
}

describe("tickColony", () => {
  it("runs a tick over an empty colony with no beavers without throwing", () => {
    const { world, deps } = buildWorld();
    expect(() => tickColony(deps, world)).not.toThrow();
  });

  it("a jobless, well-rested beaver picks up and starts an eligible haul job", () => {
    const { world, deps } = buildWorld();
    const worker = spawnAt(world, 3, 3);
    const item = world.entities.create("log");
    world.grid.setEntityPosition(item, 4, 3, 3);
    setLog(world.components, item, { materialId: "wood", massKg: 10 });
    const designationId = designateHaul(world, item, { x: 8, z: 3 });
    const [jobId] = generateHaulJob(world, designationId);

    tickColony(deps, world);

    expect(currentJobOf(world.entities, world.components, worker)).toBe(jobId);
    expect(getHaulProgress(world.components, jobId!)).toBeDefined();
  });

  it("an urgently fatigued jobless beaver does NOT get assigned a new job -- the fatigue/assignment livelock fix", () => {
    const { world, deps } = buildWorld();
    const worker = spawnAt(world, 3, 3);
    setNeeds(world.components, worker, { ...BASELINE_NEEDS, fatigue: 0.9 });
    const item = world.entities.create("log");
    world.grid.setEntityPosition(item, 4, 3, 3);
    setLog(world.components, item, { materialId: "wood", massKg: 10 });
    const designationId = designateHaul(world, item, { x: 8, z: 3 });
    generateHaulJob(world, designationId);

    tickColony(deps, world);

    // A real eligible haul job existed the whole time; an urgently
    // fatigued beaver must not have claimed it -- it should be attending
    // to rest instead (P1-14's own priority rule, applied to fresh
    // assignment as well as already-held jobs).
    expect(currentJobOf(world.entities, world.components, worker)).toBeUndefined();
  });

  it("a beaver already holding a haul job gets it driven one further tick by the correct type-specific driver", () => {
    const { world, deps } = buildWorld();
    const worker = spawnAt(world, 3, 3);
    const item = world.entities.create("log");
    world.grid.setEntityPosition(item, 6, 3, 3); // far enough that it doesn't arrive in one tick
    setLog(world.components, item, { materialId: "wood", massKg: 10 });
    const designationId = designateHaul(world, item, { x: 8, z: 3 });
    const [jobId] = generateHaulJob(world, designationId);

    tickColony(deps, world); // assigns + first step
    const positionAfterFirst = world.grid.positionOf(worker)!;

    tickColony(deps, world); // should progress the SAME job further, not reassign or stall

    expect(currentJobOf(world.entities, world.components, worker)).toBe(jobId);
    expect(getJob(world.components, jobId!)!.status).not.toBe("unclaimed");
    // Real, continued progress: the beaver kept moving toward the item
    // (still same held job -- no reassignment/stall between ticks).
    const positionAfterSecond = world.grid.positionOf(worker)!;
    expect(positionAfterSecond).not.toEqual(positionAfterFirst);
  });

  it("the generic go-to fallback never mis-selects a specialized job it doesn't understand, even standing exactly on its target", () => {
    // The item is already HELD by another live beaver -- `isEligibleForHaul`
    // (haul-specific) correctly excludes this job for `worker`, but the
    // GENERIC `isEligible` `tickJobForBeaver` itself uses has no concept of
    // "held" at all, so it would treat this job as ordinarily available.
    // The regression this test guards: if the final generic
    // `tickJobForBeaver` fallback were ever given the unfiltered job list
    // instead of only jobs with no specialized progress component, it
    // would happily "arrive and complete" this haul job the instant
    // `worker` stands on its own target column -- silently skipping the
    // real pickup/carry/deliver mechanics `HaulProgress` exists to
    // enforce, and corrupting the OTHER beaver's own in-progress haul.
    const { world, deps } = buildWorld();
    const item = world.entities.create("log");
    const itemFloor = world.grid.surfaceY(6, 6)!;
    world.grid.setEntityPosition(item, 6, itemFloor + 1, 6);
    const holder = spawnAt(world, 2, 2);
    // `generateHaulJob` sets the job's own `target` to the ITEM's position
    // at generation time -- `worker` starts standing exactly there, so an
    // unfiltered generic fallback would see it as "already arrived."
    const worker = spawnAt(world, 6, 6);
    setLog(world.components, item, { materialId: "wood", massKg: 10 });
    const designationId = designateHaul(world, item, { x: 8, z: 3 }); // designated while still on the ground
    const [jobId] = generateHaulJob(world, designationId);
    pickUp(world.components, world.grid, item, holder); // then independently picked up -- item genuinely Held by another live beaver

    for (let i = 0; i < 5; i++) tickColony(deps, world);

    expect(currentJobOf(world.entities, world.components, worker)).toBeUndefined();
    expect(getHeld(world.components, item)).toEqual({ by: holder }); // still genuinely carried, not silently "delivered"
    expect(getJob(world.components, jobId!)!.status).not.toBe("completed");
  });
});
