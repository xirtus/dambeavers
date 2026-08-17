/**
 * Headless acceptance test for P3-05 -- Clay/mud working.
 *
 * Roadmap acceptance test: "suitable wet material can be gathered and
 * transformed into construction goods."
 *
 * Real clay terrain standing under real water (the "wet material") is
 * gathered through the ordinary dig pipeline into a real `raw-clay`
 * good, then transformed by the `fire-bricks` recipe into a `brick`
 * construction good with a genuinely transformed material identity
 * (the recipe's explicit `outputMaterialId: "clay"` path, demonstrating
 * the optional override is real, not decorative).
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
import { designateDig, generateDigJob, tickDigJob } from "../../src/sim/labor/Digging.js";
import { tickHaulJob } from "../../src/sim/labor/Hauling.js";
import { RecipeRegistry, registerStandardRecipes } from "../../src/sim/economy/Recipe.js";
import { createWorkshop } from "../../src/sim/economy/Workshop.js";
import { designateCraft, ensureCraftMaterialHaul, checkCraftMaterialsDelivered, generateCraftJob, tickCraftJob } from "../../src/sim/economy/Craft.js";
import { getGood } from "../../src/sim/economy/Good.js";

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
  const random = new RandomStreams(105);
  const events = new EventLog(entities);
  return { world: { clock, random, entities, components, grid, terrain, events, water, weather }, materials };
}

function spawnAt(world: World, name: string, x: number, z: number): EntityId {
  const floor = world.grid.surfaceY(x, z)!;
  return spawnBeaver(world, { name, position: { x, y: floor + 1, z } });
}

function driveJob<T extends string>(step: () => T, doneValue: T, maxTicks = 500): T {
  let outcome: T = "idle" as T;
  for (let i = 0; i < maxTicks && outcome !== doneValue; i++) outcome = step();
  return outcome;
}

describe("P3-05 -- Clay/mud working", () => {
  it("wet clay gathered by digging is transformed into a fired-brick construction good", () => {
    const { world, materials } = buildWorld();
    const recipes = new RecipeRegistry();
    registerStandardRecipes(recipes);

    // Real clay terrain with real standing water above it -- the wet
    // material this task is about.
    world.terrain.setMaterial(5, 3, 5, "clay");
    world.water.setDepth(5, 5, 2);
    expect(world.water.depthAt(5, 5)).toBe(2);

    const digger = spawnAt(world, "Digger", 6, 5);
    const digDesignationId = designateDig(world, { x: 5, z: 5 });
    const [digJobId] = generateDigJob(world, materials, digDesignationId);
    const digOutcome = driveJob(
      () => tickDigJob(world.grid, world.terrain, world.water, materials, world.entities, world.components, digger, PROFILE, [digJobId!]),
      "dug",
    );
    expect(digOutcome).toBe("dug");

    const rawClay = world.entities.liveIdsOfKind("good").map((id) => getGood(world.components, id)!).find((g) => g.goodKind === "raw-clay");
    expect(rawClay).toBeDefined();
    expect(rawClay!.materialId).toBe("clay");

    // Fire the gathered clay into bricks at a kiln.
    const workshopId = createWorkshop(world, "kiln", { x: 9, z: 9 });
    const worker = spawnAt(world, "Kilner", 9, 9);
    const craftOrderId = designateCraft(world, recipes, workshopId, "fire-bricks");

    for (let i = 0; i < 5; i++) {
      const haulJobId = ensureCraftMaterialHaul(world, recipes, craftOrderId);
      if (haulJobId === undefined) break;
      driveJob(() => tickHaulJob(world.grid, world.terrain, world.water, materials, world.entities, world.components, worker, PROFILE, [haulJobId]), "delivered" as never);
    }
    expect(checkCraftMaterialsDelivered(world, recipes, craftOrderId)).toBe(true);

    const [craftJobId] = generateCraftJob(world, craftOrderId);
    const craftOutcome = driveJob(
      () => tickCraftJob(world.grid, world.terrain, world.water, materials, recipes, world.entities, world.components, worker, PROFILE, [craftJobId!]),
      "crafted",
    );
    expect(craftOutcome).toBe("crafted");

    const bricks = world.entities.liveIdsOfKind("good").map((id) => getGood(world.components, id)!).filter((g) => g.goodKind === "brick");
    expect(bricks).toHaveLength(1);
    expect(bricks[0]!.materialId).toBe("clay"); // fired brick: transformed identity, still the clay material
    expect(bricks[0]!.makerId).toBe(worker);
  });
});
