/**
 * Headless acceptance test for P3-04 -- Stoneworking.
 *
 * Roadmap acceptance test: "excavated stone can become
 * construction/component items."
 *
 * Real stone terrain is excavated through the ordinary dig job pipeline
 * (a real `raw-stone` good appears with mass derived from the material's
 * real density), then that excavated stone is hauled and consumed by the
 * `cut-blocks` recipe into a real `stone-block` construction item.
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
  const random = new RandomStreams(104);
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

describe("P3-04 -- Stoneworking", () => {
  it("excavated stone becomes a real construction item through the ordinary dig and craft pipelines", () => {
    const { world, materials } = buildWorld();
    const recipes = new RecipeRegistry();
    registerStandardRecipes(recipes);

    // Real stone terrain to excavate.
    world.terrain.setMaterial(5, 3, 5, "stone");
    const digger = spawnAt(world, "Digger", 5, 5);
    const digDesignationId = designateDig(world, { x: 5, z: 5 });
    const [digJobId] = generateDigJob(world, materials, digDesignationId);
    const digOutcome = driveJob(
      () => tickDigJob(world.grid, world.terrain, world.water, materials, world.entities, world.components, digger, PROFILE, [digJobId!]),
      "dug",
    );
    expect(digOutcome).toBe("dug");
    expect(world.terrain.materialAt(5, 3, 5)).toBeUndefined(); // really excavated

    const rawStone = world.entities.liveIdsOfKind("good").map((id) => getGood(world.components, id)!).find((g) => g.goodKind === "raw-stone");
    expect(rawStone).toBeDefined();
    expect(rawStone!.materialId).toBe("stone");
    expect(rawStone!.massKg).toBeGreaterThan(0);

    // Haul the excavated stone to the mason and cut it into blocks.
    const workshopId = createWorkshop(world, "mason", { x: 8, z: 8 });
    const worker = spawnAt(world, "Mason", 8, 8);
    const craftOrderId = designateCraft(world, recipes, workshopId, "cut-blocks");

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

    const blocks = world.entities.liveIdsOfKind("good").map((id) => getGood(world.components, id)!).filter((g) => g.goodKind === "stone-block");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.materialId).toBe("stone");
    expect(blocks[0]!.makerId).toBe(worker);
  });
});
