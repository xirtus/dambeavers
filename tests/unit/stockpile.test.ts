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
import { setLog, getReservation } from "../../src/sim/labor/Log.js";
import { setFood } from "../../src/sim/labor/Food.js";
import { createRefuse } from "../../src/sim/logistics/Refuse.js";
import { getHaulProgress } from "../../src/sim/labor/Hauling.js";
import { getDesignation } from "../../src/sim/jobs/Designation.js";
import { getJob } from "../../src/sim/jobs/Job.js";
import {
  createStockpile,
  generateStockpileHaulJobs,
  getStockpile,
  getStockpileDebugState,
  setStockpile,
  setStockpilePolicy,
  stockpileAcceptsMaterial,
  storedItemIds,
  StockpileComponent,
  type StockpilePolicy,
} from "../../src/sim/logistics/Stockpile.js";

const EMPTY_POLICY: StockpilePolicy = {
  allowedMaterialCategories: [],
  allowedMaterialIds: [],
  forbiddenMaterialCategories: [],
  forbiddenMaterialIds: [],
};

function buildFlatWorld(sizeX = 12, sizeY = 8, sizeZ = 12, floor = 2): { world: World; materials: MaterialRegistry; water: WaterField } {
  const entities = new EntityIdRegistry();
  const components = new ComponentStore(entities);
  const grid = new WorldGrid({ sizeX, sizeY, sizeZ }, entities);
  const materials = new MaterialRegistry();
  registerStandardMaterials(materials);
  const terrain = new TerrainField(grid, materials);
  for (let x = 0; x < sizeX; x++) {
    for (let z = 0; z < sizeZ; z++) {
      for (let y = 0; y <= floor; y++) terrain.setMaterial(x, y, z, "soil");
    }
  }
  const water = new WaterField(grid);
  const weather = new Weather();
  const clock = new SimulationClock({ tickRateHz: 20 });
  const random = new RandomStreams(1);
  const events = new EventLog(entities);
  return { world: { clock, random, entities, components, grid, terrain, events, water, weather }, materials, water };
}

function spawnMaterialItem(world: World, x: number, z: number, materialId = "wood", massKg = 10): EntityId {
  const id = world.entities.create("log");
  const floor = world.grid.surfaceY(x, z)!;
  world.grid.setEntityPosition(id, x, floor + 1, z);
  setLog(world.components, id, { materialId, massKg });
  return id;
}

function spawnFoodItem(world: World, x: number, z: number, materialId = "plant-matter", massKg = 1): EntityId {
  const id = world.entities.create("food");
  const floor = world.grid.surfaceY(x, z)!;
  world.grid.setEntityPosition(id, x, floor + 1, z);
  setFood(world.components, id, { nutritionValue: 0.4, materialId, massKg });
  return id;
}

function spawnRefuseItem(world: World, x: number, z: number, materialId = "plant-matter", massKg = 0.1): EntityId {
  const floor = world.grid.surfaceY(x, z)!;
  return createRefuse(world.entities, world.components, world.grid, { x, y: floor + 1, z }, {
    materialId,
    massKg,
    origin: "food-consumption",
  });
}

describe("stockpile material policy", () => {
  it("allows every material by default, then lets category forbids reject the same material", () => {
    const { materials } = buildFlatWorld();
    const wood = materials.get("wood");

    expect(stockpileAcceptsMaterial(EMPTY_POLICY, wood)).toBe(true);
    expect(
      stockpileAcceptsMaterial(
        { ...EMPTY_POLICY, forbiddenMaterialCategories: ["organic"] },
        wood,
      ),
    ).toBe(false);
  });

  it("uses positive allow lists when present, with explicit forbids winning over allows", () => {
    const { materials } = buildFlatWorld();
    const wood = materials.get("wood");
    const stone = materials.get("stone");

    expect(stockpileAcceptsMaterial({ ...EMPTY_POLICY, allowedMaterialCategories: ["organic"] }, wood)).toBe(true);
    expect(stockpileAcceptsMaterial({ ...EMPTY_POLICY, allowedMaterialCategories: ["organic"] }, stone)).toBe(false);
    expect(
      stockpileAcceptsMaterial(
        { ...EMPTY_POLICY, allowedMaterialCategories: ["organic"], forbiddenMaterialIds: ["wood"] },
        wood,
      ),
    ).toBe(false);
    expect(stockpileAcceptsMaterial({ ...EMPTY_POLICY, allowedMaterialIds: ["stone"] }, stone)).toBe(true);
  });

  it("normalizes cells and material rules for deterministic persistence", () => {
    const { world } = buildFlatWorld();
    const stockpileId = world.entities.create("stockpile");

    setStockpile(world.components, stockpileId, {
      cells: [
        { x: 5, z: 5 },
        { x: 3, z: 4 },
        { x: 5, z: 5 },
      ],
      status: "active",
      policy: {
        allowedMaterialCategories: ["organic", "organic"],
        allowedMaterialIds: ["wood", "bark", "wood"],
        forbiddenMaterialCategories: [],
        forbiddenMaterialIds: [],
      },
    });

    expect(getStockpile(world.components, stockpileId)).toEqual({
      cells: [
        { x: 3, z: 4 },
        { x: 5, z: 5 },
      ],
      status: "active",
      policy: {
        allowedMaterialCategories: ["organic"],
        allowedMaterialIds: ["bark", "wood"],
        forbiddenMaterialCategories: [],
        forbiddenMaterialIds: [],
      },
    });
  });

  it("REGRESSION (P2-01 critic/minor): malformed array fields fail loudly with RangeError at the read boundary", () => {
    const { world } = buildFlatWorld();
    const stockpileId = world.entities.create("stockpile");
    world.components.set(stockpileId, StockpileComponent, {
      cells: "not-an-array",
      status: "active",
      policy: EMPTY_POLICY,
    } as never);

    expect(() => getStockpile(world.components, stockpileId)).toThrow(RangeError);
  });
});

describe("generateStockpileHaulJobs", () => {
  it("creates ordinary haul jobs for accepted free items outside the stockpile", () => {
    const { world, materials } = buildFlatWorld();
    const item = spawnMaterialItem(world, 1, 1, "wood");
    const stockpileId = createStockpile(world, [{ x: 8, z: 8 }], { ...EMPTY_POLICY, allowedMaterialCategories: ["organic"] });

    const [jobId] = generateStockpileHaulJobs(world, materials, stockpileId);

    expect(jobId).toBeDefined();
    expect(getReservation(world.components, item)).toBeUndefined(); // generation is policy, not worker/item reservation
    expect(world.grid.positionOf(item)).toMatchObject({ x: 1, z: 1 });
    const job = getJob(world.components, jobId!)!;
    const progress = getHaulProgress(world.components, jobId!)!;
    const designation = getDesignation(world.components, job.designationId)!;
    expect(designation.kind).toBe("haul-item");
    expect(designation.target).toEqual({ x: 8, z: 8 });
    expect(designation.targetEntity).toBe(item);
    expect(progress).toEqual({ itemId: item, destination: { x: 8, z: 8 }, phase: "to-item" });
  });

  it("P2-07: creates ordinary haul jobs for accepted physical food items", () => {
    const { world, materials } = buildFlatWorld();
    const item = spawnFoodItem(world, 1, 1, "plant-matter");
    const stockpileId = createStockpile(world, [{ x: 8, z: 8 }], { ...EMPTY_POLICY, allowedMaterialCategories: ["organic"] });

    const [jobId] = generateStockpileHaulJobs(world, materials, stockpileId);

    expect(jobId).toBeDefined();
    expect(getReservation(world.components, item)).toBeUndefined();
    const progress = getHaulProgress(world.components, jobId!)!;
    const designation = getDesignation(world.components, getJob(world.components, jobId!)!.designationId)!;
    expect(designation.targetEntity).toBe(item);
    expect(progress).toEqual({ itemId: item, destination: { x: 8, z: 8 }, phase: "to-item" });
  });

  it("P2-09: creates ordinary haul jobs for accepted physical refuse items requiring disposal", () => {
    const { world, materials } = buildFlatWorld();
    const item = spawnRefuseItem(world, 1, 1, "plant-matter");
    const stockpileId = createStockpile(world, [{ x: 8, z: 8 }], { ...EMPTY_POLICY, allowedMaterialCategories: ["organic"] });

    const [jobId] = generateStockpileHaulJobs(world, materials, stockpileId);

    expect(jobId).toBeDefined();
    expect(getReservation(world.components, item)).toBeUndefined();
    const progress = getHaulProgress(world.components, jobId!)!;
    const designation = getDesignation(world.components, getJob(world.components, jobId!)!.designationId)!;
    expect(designation.targetEntity).toBe(item);
    expect(progress).toEqual({ itemId: item, destination: { x: 8, z: 8 }, phase: "to-item" });
  });

  it("does not create duplicate active haul jobs for the same item", () => {
    const { world, materials } = buildFlatWorld();
    spawnMaterialItem(world, 1, 1, "wood");
    const stockpileId = createStockpile(world, [{ x: 8, z: 8 }], { ...EMPTY_POLICY, allowedMaterialCategories: ["organic"] });

    expect(generateStockpileHaulJobs(world, materials, stockpileId)).toHaveLength(1);
    expect(generateStockpileHaulJobs(world, materials, stockpileId)).toHaveLength(0);
  });

  it("leaves already stored accepted items alone", () => {
    const { world, materials } = buildFlatWorld();
    const stockpileId = createStockpile(world, [{ x: 8, z: 8 }], { ...EMPTY_POLICY, allowedMaterialCategories: ["organic"] });
    const item = spawnMaterialItem(world, 8, 8, "wood");

    expect(storedItemIds(world, materials, stockpileId)).toEqual([item]);
    expect(generateStockpileHaulJobs(world, materials, stockpileId)).toEqual([]);
  });

  it("P2-07/P2-09: reports stored food and refuse items alongside stored logs", () => {
    const { world, materials } = buildFlatWorld();
    const stockpileId = createStockpile(world, [{ x: 8, z: 8 }], { ...EMPTY_POLICY, allowedMaterialCategories: ["organic"] });
    const food = spawnFoodItem(world, 8, 8, "plant-matter");
    const log = spawnMaterialItem(world, 8, 8, "wood");
    const refuse = spawnRefuseItem(world, 8, 8, "plant-matter");

    expect(storedItemIds(world, materials, stockpileId)).toEqual([food, log, refuse].sort((a, b) => a - b));
    expect(generateStockpileHaulJobs(world, materials, stockpileId)).toEqual([]);
  });

  it("policy changes immediately change which new jobs arise", () => {
    const { world, materials } = buildFlatWorld();
    spawnMaterialItem(world, 1, 1, "wood");
    const stockpileId = createStockpile(world, [{ x: 8, z: 8 }], { ...EMPTY_POLICY, forbiddenMaterialCategories: ["organic"] });

    expect(generateStockpileHaulJobs(world, materials, stockpileId)).toEqual([]);

    setStockpilePolicy(world.components, stockpileId, { ...EMPTY_POLICY, allowedMaterialCategories: ["organic"] });
    expect(generateStockpileHaulJobs(world, materials, stockpileId)).toHaveLength(1);
  });

  it("round-trips through the full component registry", () => {
    const { world, materials } = buildFlatWorld();
    const stockpileId = createStockpile(world, [{ x: 8, z: 8 }], { ...EMPTY_POLICY, allowedMaterialCategories: ["organic"] });
    spawnMaterialItem(world, 1, 1, "wood");
    generateStockpileHaulJobs(world, materials, stockpileId);

    const restoreMaterials = new MaterialRegistry();
    registerStandardMaterials(restoreMaterials);
    const restored = restoreWorld(JSON.parse(JSON.stringify(snapshotWorld(world))), { componentTypes: ALL_COMPONENT_TYPES, materials: restoreMaterials });

    expect(getStockpile(restored.components, stockpileId)).toEqual(getStockpile(world.components, stockpileId));
    expect(getStockpileDebugState(restored, restoreMaterials, stockpileId).pendingHaulItemIds).toEqual([world.entities.liveIdsOfKind("log")[0]]);
  });
});
