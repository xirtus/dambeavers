/**
 * Headless acceptance test for P3-17 -- Quality.
 *
 * Roadmap acceptance test: "worker skill, material, and process affect
 * item quality through common rules."
 *
 * `qualityOf` combines three factors -- the worker's real skill level,
 * the output material's real hardness, and the recipe's own
 * `workRequired` process definition -- through ONE shared formula
 * (geometric mean). Raising any single input while holding the other two
 * fixed raises quality; no per-recipe quality table exists.
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
import { setSkills } from "../../src/sim/creatures/Beaver.js";
import { setLog } from "../../src/sim/labor/Log.js";
import { RecipeRegistry, registerStandardRecipes, type RecipeDefinition } from "../../src/sim/economy/Recipe.js";
import { createWorkshop } from "../../src/sim/economy/Workshop.js";
import { designateCraft, checkCraftMaterialsDelivered, generateCraftJob, tickCraftJob, qualityOf } from "../../src/sim/economy/Craft.js";
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
  const random = new RandomStreams(117);
  const events = new EventLog(entities);
  return { world: { clock, random, entities, components, grid, terrain, events, water, weather }, materials };
}

function spawnAt(world: World, name: string, x: number, z: number): EntityId {
  const floor = world.grid.surfaceY(x, z)!;
  return spawnBeaver(world, { name, position: { x, y: floor + 1, z } });
}

function testRecipe(id: string, inputMaterialId: string, outputGoodKind: string, workRequired: number): RecipeDefinition {
  return {
    id,
    displayName: `Test ${id}`,
    workshopKind: "carpenter",
    inputMaterialId,
    inputMassKg: 5,
    outputGoodKind,
    outputMassKg: 4,
    workRequired,
    skillName: "woodworking",
  };
}

describe("P3-17 -- Quality", () => {
  it("worker skill, material, and process each affect quality through one common rule", () => {
    const { world, materials } = buildWorld();
    const recipes = new RecipeRegistry();
    registerStandardRecipes(recipes);

    // Three test recipes isolating each input: same process/skill, only
    // the material differs (wood hardness 2 vs stone hardness 5); same
    // material/skill, only the process length differs (20 vs 40 work).
    const woodRecipe = testRecipe("test-quality-wood", "wood", "quality-wood", 20);
    const stoneRecipe = testRecipe("test-quality-stone", "stone", "quality-stone", 20);
    const slowRecipe = testRecipe("test-quality-wood-slow", "wood", "quality-wood-slow", 40);
    recipes.define(woodRecipe);
    recipes.define(stoneRecipe);
    recipes.define(slowRecipe);

    const worker = spawnAt(world, "Craftsbeaver", 4, 4);
    const master = spawnAt(world, "Master", 6, 4);
    setSkills(world.components, worker, { levels: { woodworking: 10 } });
    setSkills(world.components, master, { levels: { woodworking: 20 } });

    const workerWood = qualityOf(materials, world.components, worker, woodRecipe);
    const workerStone = qualityOf(materials, world.components, worker, stoneRecipe);
    const workerSlow = qualityOf(materials, world.components, worker, slowRecipe);
    const masterWood = qualityOf(materials, world.components, master, woodRecipe);

    // Material affects quality (same worker, same process): stone > wood.
    expect(workerStone).toBeGreaterThan(workerWood);
    // Skill affects quality (same material, same process): master > worker.
    expect(masterWood).toBeGreaterThan(workerWood);
    // Process affects quality (same material, same worker): slower/careful > fast.
    expect(workerSlow).toBeGreaterThan(workerWood);
    // All values stay in the real [0,1] range.
    for (const q of [workerWood, workerStone, workerSlow, masterWood]) {
      expect(q).toBeGreaterThan(0);
      expect(q).toBeLessThanOrEqual(1);
    }

    // The same formula drives real crafted goods end-to-end.
    const workshopId = createWorkshop(world, "carpenter", { x: 4, z: 4 });
    const logId = world.entities.create("log");
    world.grid.setEntityPosition(logId, 4, 3, 4);
    setLog(world.components, logId, { materialId: "wood", massKg: 10 });
    const craftOrderId = designateCraft(world, recipes, workshopId, woodRecipe.id);
    expect(checkCraftMaterialsDelivered(world, recipes, craftOrderId)).toBe(true);
    const [jobId] = generateCraftJob(world, craftOrderId);
    let outcome: string = "idle";
    for (let i = 0; i < 200 && outcome !== "crafted"; i++) {
      outcome = tickCraftJob(world.grid, world.terrain, world.water, materials, recipes, world.entities, world.components, worker, PROFILE, [jobId!]);
    }
    expect(outcome).toBe("crafted");
    const crafted = world.entities.liveIdsOfKind("good").map((id) => getGood(world.components, id)!).find((g) => g.goodKind === "quality-wood");
    expect(crafted).toBeDefined();
    // The crafted good's quality is the live formula's own value:
    // `assembleCraftOrder` computes quality BEFORE the completing tick's
    // `practiceSkill` lands, so the recomputed post-completion value
    // differs only by that one tick's practice -- assert to 3 decimals.
    expect(crafted!.quality).toBeCloseTo(qualityOf(materials, world.components, worker, woodRecipe), 3);
  });
});
