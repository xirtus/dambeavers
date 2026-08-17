/**
 * Headless acceptance test for P3-01 -- Workshop framework.
 *
 * Roadmap acceptance test: "new workshop definitions can consume inputs
 * and produce outputs without custom job architecture."
 *
 * The test defines a BRAND-NEW workshop kind (`grain-mill`) plus a recipe
 * that names it -- both pure data -- and then drives the SAME generic
 * craft pipeline every other recipe uses (designate -> haul real input
 * mass -> deliver -> craft job -> output good), with zero code added
 * anywhere for this workshop kind.
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
import type { NavigationProfile } from "../../src/sim/navigation/Pathfinding.js";
import { spawnBeaver } from "../../src/sim/creatures/Beaver.js";
import { setLog } from "../../src/sim/labor/Log.js";
import { tickHaulJob } from "../../src/sim/labor/Hauling.js";
import { RecipeRegistry } from "../../src/sim/economy/Recipe.js";
import { createWorkshop } from "../../src/sim/economy/Workshop.js";
import { designateCraft, ensureCraftMaterialHaul, checkCraftMaterialsDelivered, generateCraftJob, tickCraftJob } from "../../src/sim/economy/Craft.js";
import { getGood } from "../../src/sim/economy/Good.js";
import { getJob } from "../../src/sim/jobs/Job.js";

const PROFILE: NavigationProfile = { canSwim: true, maxWadingDepth: 0.5 };

function buildWorld(): { world: World; materials: MaterialRegistry } {
  const entities = new EntityIdRegistry();
  const components = new ComponentStore(entities);
  const grid = new WorldGrid({ sizeX: 20, sizeY: 12, sizeZ: 20 }, entities);
  const materials = new MaterialRegistry();
  registerStandardMaterials(materials);
  const terrain = new TerrainField(grid, materials);
  for (let x = 0; x < 20; x++) for (let z = 0; z < 20; z++) for (let y = 0; y <= 2; y++) terrain.setMaterial(x, y, z, "soil");
  const water = new WaterField(grid);
  const weather = new Weather();
  const clock = new SimulationClock({ tickRateHz: 20 });
  const random = new RandomStreams(101);
  const events = new EventLog(entities);
  return { world: { clock, random, entities, components, grid, terrain, events, water, weather }, materials };
}

function spawnAt(world: World, name: string, x: number, z: number): EntityId {
  const floor = world.grid.surfaceY(x, z)!;
  return spawnBeaver(world, { name, position: { x, y: floor + 1, z } });
}

function placeLog(world: World, x: number, z: number, massKg: number): EntityId {
  const id = world.entities.create("log");
  const floor = world.grid.surfaceY(x, z)!;
  world.grid.setEntityPosition(id, x, floor + 1, z);
  setLog(world.components, id, { materialId: "wood", massKg });
  return id;
}

function driveJob<T extends string>(step: () => T, doneValue: T, maxTicks = 500): T {
  let outcome: T = "idle" as T;
  for (let i = 0; i < maxTicks && outcome !== doneValue; i++) outcome = step();
  return outcome;
}

describe("P3-01 -- Workshop framework", () => {
  it("a brand-new workshop definition consumes inputs and produces outputs through the existing generic job architecture", () => {
    const { world, materials } = buildWorld();
    const recipes = new RecipeRegistry();
    // A workshop kind and recipe neither `Workshop.ts` nor `Craft.ts` has
    // ever heard of -- pure data, no new job architecture anywhere.
    const workshopId = createWorkshop(world, "grain-mill", { x: 8, z: 8 });
    recipes.define({
      id: "mill-flour",
      displayName: "Mill flour",
      workshopKind: "grain-mill",
      inputMaterialId: "wood",
      inputMassKg: 20,
      outputGoodKind: "flour",
      outputMassKg: 15,
      workRequired: 10,
      skillName: "milling",
    });

    const logId = placeLog(world, 6, 8, 25);
    const worker = spawnAt(world, "Miller", 8, 8);
    const craftOrderId = designateCraft(world, recipes, workshopId, "mill-flour");

    const haulJobId = ensureCraftMaterialHaul(world, recipes, craftOrderId);
    expect(haulJobId).toBeDefined();
    const haulOutcome = driveJob(
      () => tickHaulJob(world.grid, world.terrain, world.water, materials, world.entities, world.components, worker, PROFILE, [haulJobId!]),
      "delivered" as never,
    );
    expect(haulOutcome).toBe("delivered");
    expect(world.entities.isLive(logId)).toBe(true);

    expect(checkCraftMaterialsDelivered(world, recipes, craftOrderId)).toBe(true);
    const [jobId] = generateCraftJob(world, craftOrderId);
    // The job is an ordinary generic job entity -- no "mill" job kind.
    expect(world.entities.kindOf(jobId!)).toBe("job");
    expect(getJob(world.components, jobId!)!.designationId).toBeDefined();

    const craftOutcome = driveJob(
      () => tickCraftJob(world.grid, world.terrain, world.water, materials, recipes, world.entities, world.components, worker, PROFILE, [jobId!]),
      "crafted",
    );
    expect(craftOutcome).toBe("crafted");
    expect(world.entities.isLive(logId)).toBe(false); // input mass really consumed

    const outputs = world.entities.liveIdsOfKind("good").map((id) => getGood(world.components, id)!);
    const flour = outputs.find((g) => g.goodKind === "flour");
    expect(flour).toBeDefined();
    expect(flour!.materialId).toBe("wood");
    expect(flour!.massKg).toBe(15);
    expect(flour!.makerId).toBe(worker);
  });
});
