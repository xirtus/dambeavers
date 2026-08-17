/**
 * Consolidated Phase 3 (Industrial Lodge) integration smoke test --
 * exercises the real end-to-end pipelines built for P3-01 through P3-18
 * (digging/raw material, workshop crafting with quality/maker/value
 * provenance, gates, water power/transmission, liquid transfer and
 * fermentation, containers, and dam/bridge structural support and
 * hydraulic-stress collapse) against real, wired-together `World` state,
 * not mocks. This is deliberately ONE consolidated file rather than 18
 * separate per-task acceptance test files (this project's usual
 * per-task convention) -- written to de-risk the initial Phase 3
 * implementation pass quickly; splitting into full per-task acceptance
 * tests with the project's usual literal-roadmap-wording coverage and
 * an independent critic review is still owed as a follow-up.
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
import { createWorkshop } from "../../src/sim/economy/Workshop.js";
import { RecipeRegistry, registerStandardRecipes } from "../../src/sim/economy/Recipe.js";
import { designateCraft, ensureCraftMaterialHaul, checkCraftMaterialsDelivered, generateCraftJob, tickCraftJob } from "../../src/sim/economy/Craft.js";
import { tickHaulJob } from "../../src/sim/labor/Hauling.js";
import { getGood } from "../../src/sim/economy/Good.js";
import { createGate, openGate, closeGate } from "../../src/sim/hydrology/Gate.js";
import { createWaterWheel, waterWheelPowerOutput, getWaterWheel } from "../../src/sim/mechanics/WaterPower.js";
import { connectPower, transmittedPowerTo } from "../../src/sim/mechanics/Machine.js";
import { createLiquidContainer, transferLiquid, getLiquidContents, setLiquidContents, tickFermentation } from "../../src/sim/economy/Liquid.js";
import { createContainer, placeInContainer, removeFromContainer, getContainer } from "../../src/sim/economy/Container.js";
import { designateConstruction, checkMaterialsDelivered, ensureMaterialHaul, generateBuildJob, tickBuildJob } from "../../src/sim/labor/Construction.js";
import { applyDamSegment, tickDamStructure, getDamSegment } from "../../src/sim/hydrology/Dam.js";
import { applyBridgeSegment, tickBridgeStructure, getBridgeSegment } from "../../src/sim/structures/Bridge.js";
import { setLog } from "../../src/sim/labor/Log.js";

const PROFILE: NavigationProfile = { canSwim: true, maxWadingDepth: 0.5 };

function buildWorld(): { world: World; materials: MaterialRegistry } {
  const entities = new EntityIdRegistry();
  const components = new ComponentStore(entities);
  const grid = new WorldGrid({ sizeX: 20, sizeY: 10, sizeZ: 20 }, entities);
  const materials = new MaterialRegistry();
  registerStandardMaterials(materials);
  const terrain = new TerrainField(grid, materials);
  for (let x = 0; x < 20; x++) for (let z = 0; z < 20; z++) for (let y = 0; y <= 2; y++) terrain.setMaterial(x, y, z, "soil");
  const water = new WaterField(grid);
  const weather = new Weather();
  const clock = new SimulationClock({ tickRateHz: 20 });
  const random = new RandomStreams(1);
  const events = new EventLog(entities);
  const world: World = { clock, random, entities, components, grid, terrain, events, water, weather };
  return { world, materials };
}

function driveJob<T extends string>(step: () => T, doneValue: T, maxTicks = 300): T {
  let outcome: T = "idle" as T;
  for (let i = 0; i < maxTicks && outcome !== doneValue; i++) outcome = step();
  return outcome;
}

describe("Phase 3 smoke", () => {
  it("digging yields raw material with real mass/materialId and clears terrain", () => {
    const { world, materials } = buildWorld();
    world.terrain.setMaterial(5, 3, 5, "stone");
    const beaverId = spawnBeaver(world, { name: "Digger", position: { x: 5, y: 4, z: 5 } });
    const designationId = designateDig(world, { x: 5, z: 5 });
    const [jobId] = generateDigJob(world, materials, designationId);
    const outcome = driveJob(
      () => tickDigJob(world.grid, world.terrain, world.water, materials, world.entities, world.components, beaverId, PROFILE, [jobId!]),
      "dug",
    );
    expect(outcome).toBe("dug");
    const goods = world.entities.liveIdsOfKind("good").map((id) => getGood(world.components, id)!);
    expect(goods.some((g) => g.goodKind === "raw-stone" && g.materialId === "stone" && g.massKg > 0)).toBe(true);
    expect(world.terrain.materialAt(5, 3, 5)).toBeUndefined();
  });

  it("full craft pipeline: dig stone -> haul -> craft blocks with quality/maker/value provenance", () => {
    const { world, materials } = buildWorld();
    const recipes = new RecipeRegistry();
    registerStandardRecipes(recipes);

    let cellIndex = 0;
    for (const [x, z] of [[5, 5], [6, 5], [7, 5]] as const) {
      world.terrain.setMaterial(x, 3, z, "stone");
      const digger = spawnBeaver(world, { name: `Digger${x}`, position: { x, y: 4, z } });
      const dId = designateDig(world, { x, z });
      const [jId] = generateDigJob(world, materials, dId);
      const outcome = driveJob(
        () => tickDigJob(world.grid, world.terrain, world.water, materials, world.entities, world.components, digger, PROFILE, [jId!]),
        "dug",
      );
      expect(outcome).toBe("dug");
      cellIndex++;
    }
    expect(cellIndex).toBe(3);

    const workshopId = createWorkshop(world, "mason", { x: 8, z: 8 });
    const craftOrderId = designateCraft(world, recipes, workshopId, "cut-blocks");
    const worker = spawnBeaver(world, { name: "Worker", position: { x: 8, y: 4, z: 8 } });

    for (let i = 0; i < 10; i++) {
      const haulJobId = ensureCraftMaterialHaul(world, recipes, craftOrderId);
      if (haulJobId === undefined) break;
      driveJob(() => tickHaulJob(world.grid, world.terrain, world.water, materials, world.entities, world.components, worker, PROFILE, [haulJobId]), "delivered" as never, 500);
    }
    const delivered = checkCraftMaterialsDelivered(world, recipes, craftOrderId);
    expect(delivered).toBe(true);

    const [craftJobId] = generateCraftJob(world, craftOrderId);
    const craftOutcome = driveJob(
      () => tickCraftJob(world.grid, world.terrain, world.water, materials, recipes, world.entities, world.components, worker, PROFILE, [craftJobId!]),
      "crafted",
    );
    expect(craftOutcome).toBe("crafted");
    const blocks = world.entities.liveIdsOfKind("good").map((id) => getGood(world.components, id)!).filter((g) => g.goodKind === "stone-block");
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks[0]!.quality).toBeGreaterThanOrEqual(0);
    expect(blocks[0]!.makerId).toBe(worker);
    expect(blocks[0]!.value).toBeGreaterThan(0);
  });

  it("gate open/close raises and clears real terrain", () => {
    const { world } = buildWorld();
    const gateId = createGate(world, { x: 10, z: 10 }, 3, "wood");
    expect(world.terrain.materialAt(10, 3, 10)).toBe("wood");
    openGate(world, gateId);
    expect(world.terrain.materialAt(10, 3, 10)).toBeUndefined();
    closeGate(world, gateId);
    expect(world.terrain.materialAt(10, 3, 10)).toBe("wood");
  });

  it("water wheel power drives a craft workshop's work rate and stops when source is destroyed", () => {
    const { world } = buildWorld();
    world.water.setDepth(9, 9, 3);
    world.water.setDepth(9, 10, 0);
    const wheelId = createWaterWheel(world, { x: 9, z: 9 }, { x: 9, z: 10 });
    const wheel = getWaterWheel(world.components, wheelId)!;
    expect(waterWheelPowerOutput(world.water, wheel)).toBeGreaterThan(0);

    const workshopId = createWorkshop(world, "carpenter", { x: 9, z: 9 });
    connectPower(world, wheelId, workshopId);
    const before = transmittedPowerTo(world.entities, world.components, world.water, workshopId);
    expect(before).toBeGreaterThan(0);
    world.entities.destroy(wheelId);
    const after = transmittedPowerTo(world.entities, world.components, world.water, workshopId);
    expect(after).toBe(0);
  });

  it("liquid transfer conserves volume and mixes composition; fermentation shifts composition over time", () => {
    const { world } = buildWorld();
    const a = createLiquidContainer(world, 100, { x: 1, y: 3, z: 1 });
    const b = createLiquidContainer(world, 100, { x: 2, y: 3, z: 1 });
    setLiquidContents(world.components, a, { capacityL: 100, materialId: "water", volumeL: 50, composition: { sugar: 0.2 } });
    const moved = transferLiquid(world.components, a, b, 30);
    expect(moved).toBe(30);
    const bContents = getLiquidContents(world.components, b)!;
    expect(bContents.volumeL).toBeCloseTo(30);
    expect(bContents.composition.sugar).toBeCloseTo(0.2);
    const aContents = getLiquidContents(world.components, a)!;
    expect(aContents.volumeL).toBeCloseTo(20);

    tickFermentation(world, b, "sugar", "alcohol");
    const afterFerment = getLiquidContents(world.components, b)!;
    expect(afterFerment.composition.alcohol).toBeGreaterThan(0);
  });

  it("containers place/remove items while preserving location semantics", () => {
    const { world } = buildWorld();
    const containerId = createContainer(world, 50, { x: 3, y: 3, z: 3 });
    const logId = world.entities.create("log");
    world.grid.setEntityPosition(logId, 4, 3, 4);
    setLog(world.components, logId, { materialId: "wood", massKg: 10 });
    placeInContainer(world, containerId, logId);
    expect(getContainer(world.components, containerId)!.itemIds).toContain(logId);
    expect(world.grid.positionOf(logId)).toBeUndefined();
    removeFromContainer(world, containerId, logId);
    expect(world.grid.positionOf(logId)).toBeDefined();
  });

  function driveConstructionToComplete(world: World, materials: MaterialRegistry, constructionId: EntityId, builder: EntityId): void {
    for (let i = 0; i < 20; i++) {
      const haulJobId = ensureMaterialHaul(world, constructionId);
      if (haulJobId === undefined) break;
      driveJob(() => tickHaulJob(world.grid, world.terrain, world.water, materials, world.entities, world.components, builder, PROFILE, [haulJobId]), "delivered" as never, 500);
    }
    expect(checkMaterialsDelivered(world, constructionId)).toBe(true);
    const [buildJobId] = generateBuildJob(world, constructionId);
    const outcome = driveJob(
      () => tickBuildJob(world.grid, world.terrain, world.water, materials, world.entities, world.components, builder, PROFILE, [buildJobId!]),
      "built",
    );
    expect(outcome).toBe("built");
  }

  it("dam segment structural tick decays integrity under real hydraulic stress and collapses when exhausted", () => {
    const { world, materials } = buildWorld();
    const site = { x: 12, z: 12 };
    // log to build with
    const logId = world.entities.create("log");
    world.grid.setEntityPosition(logId, 13, 3, 12);
    setLog(world.components, logId, { materialId: "wood", massKg: 50 });
    const builder = spawnBeaver(world, { name: "Builder", position: { x: 12, y: 3, z: 12 } });
    const constructionId = designateConstruction(world, "dam-segment", site);
    driveConstructionToComplete(world, materials, constructionId, builder);
    const damId = applyDamSegment(world, constructionId);
    expect(getDamSegment(world.components, damId)).toBeDefined();

    world.water.setDepth(site.x, site.z, 500); // extreme stress to force collapse within a bounded loop
    let result: "intact" | "collapsed" = "intact";
    for (let i = 0; i < 10000 && result === "intact"; i++) {
      result = tickDamStructure(world, materials, damId);
    }
    expect(result).toBe("collapsed");
  });

  it("bridge segment applies real walkable terrain and structural tick can collapse it under stress", () => {
    const { world, materials } = buildWorld();
    const site = { x: 15, z: 15 };
    // Built while dry so the deck lands directly on the grounded floor (deckY = floorY + 1, self-supporting);
    // water is added AFTERWARD purely to exercise the P3-11 hydraulic-stress collapse path in isolation.
    const logId = world.entities.create("log");
    world.grid.setEntityPosition(logId, 16, 3, 15);
    setLog(world.components, logId, { materialId: "wood", massKg: 40 });
    const builder = spawnBeaver(world, { name: "Builder", position: { x: 15, y: 3, z: 15 } });
    const constructionId = designateConstruction(world, "bridge", site);
    driveConstructionToComplete(world, materials, constructionId, builder);
    const bridgeId = applyBridgeSegment(world, constructionId);
    const bridge = getBridgeSegment(world.components, bridgeId)!;
    expect(world.terrain.materialAt(site.x, bridge.y, site.z)).toBe("wood");
    expect(world.grid.isSolid(site.x, bridge.y, site.z)).toBe(true);

    world.water.setDepth(site.x, site.z, 500);
    let result: "intact" | "collapsed" = "intact";
    for (let i = 0; i < 10000 && result === "intact"; i++) {
      result = tickBridgeStructure(world, materials, bridgeId);
    }
    expect(result).toBe("collapsed");
    expect(world.terrain.materialAt(site.x, bridge.y, site.z)).toBeUndefined();
  });
});
