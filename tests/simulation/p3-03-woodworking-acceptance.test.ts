/**
 * Headless acceptance test for P3-03 -- Woodworking.
 *
 * Roadmap acceptance test: "logs can become planks/components with
 * material identity preserved."
 *
 * A real physical log entity is consumed by the `saw-planks` recipe and a
 * real `plank` good appears whose material id is IDENTICAL to the log's
 * (`outputMaterialId` defaults to the recipe's input material -- identity
 * preserved through the process, by construction rather than a special
 * case).
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
  const random = new RandomStreams(103);
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

describe("P3-03 -- Woodworking", () => {
  it("a real log becomes a plank whose material identity is preserved", () => {
    const { world, materials } = buildWorld();
    const recipes = new RecipeRegistry();
    registerStandardRecipes(recipes);

    const workshopId = createWorkshop(world, "carpenter", { x: 8, z: 8 });
    const worker = spawnAt(world, "Carpenter", 8, 8);
    const logId = world.entities.create("log");
    world.grid.setEntityPosition(logId, 8, 3, 8);
    setLog(world.components, logId, { materialId: "wood", massKg: 20 });

    const craftOrderId = designateCraft(world, recipes, workshopId, "saw-planks");
    expect(checkCraftMaterialsDelivered(world, recipes, craftOrderId)).toBe(true);
    const [jobId] = generateCraftJob(world, craftOrderId);
    const outcome = driveJob(
      () => tickCraftJob(world.grid, world.terrain, world.water, materials, recipes, world.entities, world.components, worker, PROFILE, [jobId!]),
      "crafted",
    );
    expect(outcome).toBe("crafted");
    expect(world.entities.isLive(logId)).toBe(false); // the log itself was consumed

    const planks = world.entities.liveIdsOfKind("good").map((id) => getGood(world.components, id)!).filter((g) => g.goodKind === "plank");
    expect(planks).toHaveLength(1);
    // Material identity preserved: wood in, wood out -- the same material
    // id, not a renamed/remapped one.
    expect(planks[0]!.materialId).toBe("wood");
    expect(planks[0]!.massKg).toBe(18);
    expect(planks[0]!.makerId).toBe(worker);
  });
});
