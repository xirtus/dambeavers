/**
 * Headless acceptance test for P3-02 -- Recipes/process definitions.
 *
 * Roadmap acceptance test: "a data-defined recipe can be added without
 * changing workshop execution code."
 *
 * The test registers a recipe AFTER the standard set, at runtime, and
 * executes it through the exact same `Craft.ts` driver as every standard
 * recipe -- the only extension surface is `RecipeRegistry.define`, a pure
 * data change with zero edits to any execution code.
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
import { RecipeRegistry, registerStandardRecipes } from "../../src/sim/economy/Recipe.js";
import { createWorkshop } from "../../src/sim/economy/Workshop.js";
import { designateCraft, checkCraftMaterialsDelivered, generateCraftJob, tickCraftJob } from "../../src/sim/economy/Craft.js";
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
  const random = new RandomStreams(102);
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

describe("P3-02 -- Recipes/process definitions", () => {
  it("a recipe added at runtime executes through the unchanged workshop driver", () => {
    const { world, materials } = buildWorld();
    const recipes = new RecipeRegistry();
    registerStandardRecipes(recipes);

    // A data-defined recipe added AFTER the standard set -- no execution
    // code knows or branches on it.
    recipes.define({
      id: "rip-beams",
      displayName: "Rip beams",
      workshopKind: "carpenter",
      inputMaterialId: "wood",
      inputMassKg: 15,
      outputGoodKind: "beam",
      outputMassKg: 12,
      workRequired: 14,
      skillName: "woodworking",
    });
    expect(recipes.forWorkshopKind("carpenter").map((r) => r.id)).toContain("rip-beams");

    const workshopId = createWorkshop(world, "carpenter", { x: 8, z: 8 });
    const worker = spawnAt(world, "Joiner", 8, 8);

    // Input mass pre-placed at the site (hauling itself is P1-09/P3-01's
    // already-proven ground); the point here is the recipe drives the
    // SAME execution code.
    const logId = world.entities.create("log");
    world.grid.setEntityPosition(logId, 8, 3, 8);
    setLog(world.components, logId, { materialId: "wood", massKg: 20 });

    const craftOrderId = designateCraft(world, recipes, workshopId, "rip-beams");
    expect(checkCraftMaterialsDelivered(world, recipes, craftOrderId)).toBe(true);
    const [jobId] = generateCraftJob(world, craftOrderId);
    const outcome = driveJob(
      () => tickCraftJob(world.grid, world.terrain, world.water, materials, recipes, world.entities, world.components, worker, PROFILE, [jobId!]),
      "crafted",
    );
    expect(outcome).toBe("crafted");

    const beams = world.entities.liveIdsOfKind("good").map((id) => getGood(world.components, id)!).filter((g) => g.goodKind === "beam");
    expect(beams).toHaveLength(1);
    expect(beams[0]!.materialId).toBe("wood");
    expect(beams[0]!.massKg).toBe(12);
    expect(beams[0]!.makerId).toBe(worker);
    expect(world.entities.isLive(logId)).toBe(false);
  });
});
