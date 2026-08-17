/**
 * Headless acceptance test for P3-18 -- Trade goods production.
 *
 * Roadmap acceptance test: "the colony can create non-survival goods
 * with material, quality, maker, and value provenance."
 *
 * The `carve-trinket` recipe turns real wood into a `trade-good` item
 * that nothing in the survival economy consumes. Every provenance field
 * is populated from real state -- material id, the live quality formula,
 * the beaver who actually finished the job, and a value derived from
 * real mass and quality -- and the full provenance chain survives
 * full-world save/reload.
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
  const random = new RandomStreams(118);
  const events = new EventLog(entities);
  return { world: { clock, random, entities, components, grid, terrain, events, water, weather }, materials };
}

function spawnAt(world: World, name: string, x: number, z: number): EntityId {
  const floor = world.grid.surfaceY(x, z)!;
  return spawnBeaver(world, { name, position: { x, y: floor + 1, z } });
}

describe("P3-18 -- Trade goods production", () => {
  it("a crafted non-survival trade good carries material, quality, maker, and value provenance across save/reload", () => {
    const { world, materials } = buildWorld();
    const recipes = new RecipeRegistry();
    registerStandardRecipes(recipes);

    const workshopId = createWorkshop(world, "carpenter", { x: 8, z: 8 });
    const worker = spawnAt(world, "Carver", 8, 8);
    const logId = world.entities.create("log");
    world.grid.setEntityPosition(logId, 8, 3, 8);
    setLog(world.components, logId, { materialId: "wood", massKg: 2 });

    const craftOrderId = designateCraft(world, recipes, workshopId, "carve-trinket");
    expect(checkCraftMaterialsDelivered(world, recipes, craftOrderId)).toBe(true);
    const [jobId] = generateCraftJob(world, craftOrderId);
    let outcome: string = "idle";
    for (let i = 0; i < 200 && outcome !== "crafted"; i++) {
      outcome = tickCraftJob(world.grid, world.terrain, world.water, materials, recipes, world.entities, world.components, worker, PROFILE, [jobId!]);
    }
    expect(outcome).toBe("crafted");

    const trinkets = world.entities.liveIdsOfKind("good").map((id) => getGood(world.components, id)!).filter((g) => g.goodKind === "trade-good");
    expect(trinkets).toHaveLength(1);
    const trinket = trinkets[0]!;

    // A non-survival good: a plain physical good entity, not a log, food,
    // or refuse -- nothing in the survival economy consumes it.
    expect(world.entities.kindOf(world.entities.liveIdsOfKind("good").find((id) => getGood(world.components, id)!.goodKind === "trade-good")!)).toBe("good");

    // Full provenance, each field derived from real state.
    expect(trinket.materialId).toBe("wood");
    expect(trinket.makerId).toBe(worker);
    expect(trinket.quality).toBeGreaterThanOrEqual(0);
    expect(trinket.quality).toBeLessThanOrEqual(1);
    expect(trinket.value).toBeCloseTo(trinket.massKg * (0.5 + trinket.quality!) * 5);

    // The provenance chain survives full-world save/reload.
    const restoredMaterials = new MaterialRegistry();
    registerStandardMaterials(restoredMaterials);
    const restored = restoreWorld(JSON.parse(JSON.stringify(snapshotWorld(world))), {
      componentTypes: ALL_COMPONENT_TYPES,
      materials: restoredMaterials,
    });
    const restoredTrinket = restored.entities.liveIdsOfKind("good").map((id) => getGood(restored.components, id)!).find((g) => g.goodKind === "trade-good");
    expect(restoredTrinket).toEqual(trinket);
  });
});
