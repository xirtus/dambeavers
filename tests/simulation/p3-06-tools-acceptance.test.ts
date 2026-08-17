/**
 * Headless acceptance test for P3-06 -- Tools.
 *
 * Roadmap acceptance test: "tool material/quality changes work
 * efficiency or capability."
 *
 * Four beavers run the SAME craft job for one tick, differing only in
 * the held tool: bare-handed (neutral 1x), a wood axe of quality 0, a
 * wood axe of quality 1, and a stone axe. The work each performs in that
 * single tick is strictly ordered by tool material hardness and crafted
 * quality -- one formula over real `MaterialProperties`, never a
 * per-material-name table.
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
import { setLog, pickUp } from "../../src/sim/labor/Log.js";
import { createTool } from "../../src/sim/labor/Equipment.js";
import { RecipeRegistry, registerStandardRecipes } from "../../src/sim/economy/Recipe.js";
import { createWorkshop } from "../../src/sim/economy/Workshop.js";
import { designateCraft, checkCraftMaterialsDelivered, generateCraftJob, tickCraftJob, getCraftOrder } from "../../src/sim/economy/Craft.js";

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
  const random = new RandomStreams(106);
  const events = new EventLog(entities);
  return { world: { clock, random, entities, components, grid, terrain, events, water, weather }, materials };
}

function spawnAt(world: World, name: string, x: number, z: number): EntityId {
  const floor = world.grid.surfaceY(x, z)!;
  return spawnBeaver(world, { name, position: { x, y: floor + 1, z } });
}

/** A workshop + awaiting-labor craft order for `saw-planks` with input wood already at the site, plus a worker standing at the site. */
function readyOrder(world: World, recipes: RecipeRegistry, x: number, z: number, workerName: string): { worker: EntityId; jobId: EntityId; craftOrderId: EntityId } {
  const workshopId = createWorkshop(world, "carpenter", { x, z });
  const worker = spawnAt(world, workerName, x, z);
  const logId = world.entities.create("log");
  world.grid.setEntityPosition(logId, x, 3, z);
  setLog(world.components, logId, { materialId: "wood", massKg: 20 });
  const craftOrderId = designateCraft(world, recipes, workshopId, "saw-planks");
  if (!checkCraftMaterialsDelivered(world, recipes, craftOrderId)) throw new Error("materials not delivered");
  const [jobId] = generateCraftJob(world, craftOrderId);
  return { worker, jobId: jobId!, craftOrderId };
}

function workAfterOneTick(world: World, materials: MaterialRegistry, recipes: RecipeRegistry, worker: EntityId, jobId: EntityId, craftOrderId: EntityId): number {
  const outcome = tickCraftJob(world.grid, world.terrain, world.water, materials, recipes, world.entities, world.components, worker, PROFILE, [jobId]);
  expect(outcome).toBe("working");
  return getCraftOrder(world.components, craftOrderId)!.workDone;
}

describe("P3-06 -- Tools", () => {
  it("tool material hardness and crafted quality change work efficiency through one formula", () => {
    const { world, materials } = buildWorld();
    const recipes = new RecipeRegistry();
    registerStandardRecipes(recipes);

    const bare = readyOrder(world, recipes, 4, 4, "Bare");
    const woodLow = readyOrder(world, recipes, 7, 4, "WoodLow");
    const woodHigh = readyOrder(world, recipes, 10, 4, "WoodHigh");
    const stone = readyOrder(world, recipes, 13, 4, "Stone");

    // Hold tools: wood axe (hardness 2) quality 0 vs quality 1, stone axe (hardness 5).
    const woodLowTool = createTool(world, { toolKind: "axe", laborKinds: ["woodworking"], materialId: "wood", quality: 0 }, { x: 7, y: 3, z: 5 });
    pickUp(world.components, world.grid, woodLowTool, woodLow.worker);
    const woodHighTool = createTool(world, { toolKind: "axe", laborKinds: ["woodworking"], materialId: "wood", quality: 1 }, { x: 10, y: 3, z: 5 });
    pickUp(world.components, world.grid, woodHighTool, woodHigh.worker);
    const stoneTool = createTool(world, { toolKind: "axe", laborKinds: ["woodworking"], materialId: "stone" }, { x: 13, y: 3, z: 5 });
    pickUp(world.components, world.grid, stoneTool, stone.worker);

    const bareWork = workAfterOneTick(world, materials, recipes, bare.worker, bare.jobId, bare.craftOrderId);
    const woodLowWork = workAfterOneTick(world, materials, recipes, woodLow.worker, woodLow.jobId, woodLow.craftOrderId);
    const woodHighWork = workAfterOneTick(world, materials, recipes, woodHigh.worker, woodHigh.jobId, woodHigh.craftOrderId);
    const stoneWork = workAfterOneTick(world, materials, recipes, stone.worker, stone.jobId, stone.craftOrderId);

    // One formula over real hardness/quality: bare (1x) < wood q0 < wood q1 < stone.
    expect(bareWork).toBe(1);
    expect(woodLowWork).toBeGreaterThan(bareWork);
    expect(woodHighWork).toBeGreaterThan(woodLowWork);
    expect(stoneWork).toBeGreaterThan(woodHighWork);
  });
});
