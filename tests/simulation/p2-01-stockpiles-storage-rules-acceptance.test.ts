/**
 * Headless acceptance test for P2-01 -- Stockpiles and storage rules.
 *
 * Roadmap acceptance:
 *   "material categories can be allowed/forbidden and hauling jobs arise
 *   automatically from storage policy."
 *
 * The stockpile does not teleport items and does not assign a worker. It
 * creates ordinary P1-09 `haul-item` jobs from policy; a normal beaver
 * then selects, reserves, carries, and drops the physical log.
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
import { getJob } from "../../src/sim/jobs/Job.js";
import { getDesignation } from "../../src/sim/jobs/Designation.js";
import { setLog, getHeld, getReservation } from "../../src/sim/labor/Log.js";
import { tickHaulJob } from "../../src/sim/labor/Hauling.js";
import {
  createStockpile,
  generateStockpileHaulJobs,
  getStockpile,
  getStockpileDebugState,
  setStockpilePolicy,
  storedItemIds,
  type StockpilePolicy,
} from "../../src/sim/logistics/Stockpile.js";

const PROFILE: NavigationProfile = { canSwim: true, maxWadingDepth: 0.5 };
const ORGANIC_ONLY: StockpilePolicy = {
  allowedMaterialCategories: ["organic"],
  allowedMaterialIds: [],
  forbiddenMaterialCategories: [],
  forbiddenMaterialIds: [],
};

function buildWorld(): { world: World; materials: MaterialRegistry; water: WaterField } {
  const entities = new EntityIdRegistry();
  const components = new ComponentStore(entities);
  const grid = new WorldGrid({ sizeX: 16, sizeY: 8, sizeZ: 16 }, entities);
  const materials = new MaterialRegistry();
  registerStandardMaterials(materials);
  const terrain = new TerrainField(grid, materials);
  for (let x = 0; x < grid.dims.sizeX; x++) {
    for (let z = 0; z < grid.dims.sizeZ; z++) {
      for (let y = 0; y <= 2; y++) terrain.setMaterial(x, y, z, "soil");
    }
  }
  const water = new WaterField(grid);
  const weather = new Weather();
  const clock = new SimulationClock({ tickRateHz: 20 });
  const random = new RandomStreams(202);
  const events = new EventLog(entities);
  return { world: { clock, random, entities, components, grid, terrain, events, water, weather }, materials, water };
}

function spawnAt(world: World, x: number, z: number, name: string): EntityId {
  const floor = world.grid.surfaceY(x, z)!;
  return spawnBeaver(world, { name, position: { x, y: floor + 1, z } });
}

function spawnLogAt(world: World, x: number, z: number, massKg = 12): EntityId {
  const logId = world.entities.create("log");
  const floor = world.grid.surfaceY(x, z)!;
  world.grid.setEntityPosition(logId, x, floor + 1, z);
  setLog(world.components, logId, { materialId: "wood", massKg });
  return logId;
}

function driveHaulToDelivery(world: World, materials: MaterialRegistry, water: WaterField, worker: EntityId, jobId: EntityId): void {
  let outcome = "";
  for (let tick = 0; tick < 80; tick++) {
    outcome = tickHaulJob(world.grid, world.terrain, water, materials, world.entities, world.components, worker, PROFILE, [jobId]);
    if (outcome === "delivered") return;
    expect(outcome).not.toBe("failed");
    expect(outcome).not.toBe("requeued");
  }
  throw new Error(`haul did not deliver; last outcome ${outcome}`);
}

describe("P2-01 acceptance: storage policy creates ordinary haul work", () => {
  it("allows/forbids material categories and stores a physical log through the normal hauling pipeline", () => {
    const { world, materials, water } = buildWorld();
    const worker = spawnAt(world, 1, 1, "Storekeeper");
    const firstLog = spawnLogAt(world, 3, 1);
    const stockpileId = createStockpile(
      world,
      [
        { x: 11, z: 11 },
        { x: 12, z: 11 },
      ],
      ORGANIC_ONLY,
    );

    const [jobId] = generateStockpileHaulJobs(world, materials, stockpileId);
    expect(jobId).toBeDefined();
    expect(getJob(world.components, jobId!)!.status).toBe("unclaimed");
    expect(getDesignation(world.components, getJob(world.components, jobId!)!.designationId)!.kind).toBe("haul-item");
    expect(getReservation(world.components, firstLog)).toBeUndefined();
    expect(world.grid.positionOf(firstLog)).toMatchObject({ x: 3, z: 1 });

    // Save/reload while storage policy and the automatically-created haul
    // job are both active, then continue from the restored authoritative
    // state rather than rebuilding anything by hand.
    const restoreMaterials = new MaterialRegistry();
    registerStandardMaterials(restoreMaterials);
    const restoredWorld = restoreWorld(JSON.parse(JSON.stringify(snapshotWorld(world))), {
      componentTypes: ALL_COMPONENT_TYPES,
      materials: restoreMaterials,
    });
    expect(getStockpile(restoredWorld.components, stockpileId)).toEqual(getStockpile(world.components, stockpileId));
    expect(getStockpileDebugState(restoredWorld, restoreMaterials, stockpileId).pendingHaulItemIds).toEqual([firstLog]);

    driveHaulToDelivery(restoredWorld, restoreMaterials, restoredWorld.water, worker, jobId!);
    expect(getHeld(restoredWorld.components, firstLog)).toBeUndefined();
    expect(storedItemIds(restoredWorld, restoreMaterials, stockpileId)).toEqual([firstLog]);
    const storedPosition = restoredWorld.grid.positionOf(firstLog)!;
    expect([{ x: 11, z: 11 }, { x: 12, z: 11 }]).toContainEqual({ x: storedPosition.x, z: storedPosition.z });

    const secondLog = spawnLogAt(restoredWorld, 4, 1);
    setStockpilePolicy(restoredWorld.components, stockpileId, {
      allowedMaterialCategories: ["organic"],
      allowedMaterialIds: [],
      forbiddenMaterialCategories: ["organic"],
      forbiddenMaterialIds: [],
    });

    expect(generateStockpileHaulJobs(restoredWorld, restoreMaterials, stockpileId)).toEqual([]);
    expect(restoredWorld.grid.positionOf(secondLog)).toMatchObject({ x: 4, z: 1 });
    expect(getReservation(restoredWorld.components, secondLog)).toBeUndefined();
  });
});
