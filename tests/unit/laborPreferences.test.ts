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
import { createDesignation } from "../../src/sim/jobs/Designation.js";
import { setJob } from "../../src/sim/jobs/Job.js";
import { isEligible, selectJob } from "../../src/sim/jobs/JobBoard.js";
import {
  getLaborPreferences,
  isLaborAllowedForJob,
  laborKindForDesignationKind,
  laborPriorityForJob,
  LaborPreferencesComponent,
  setAllowedLabors,
  setLaborPreferences,
  setLaborPriority,
} from "../../src/sim/jobs/LaborPreferences.js";

const PROFILE: NavigationProfile = { canSwim: true, maxWadingDepth: 0.5 };

function buildFlatWorld(sizeX = 14, sizeY = 8, sizeZ = 14, floor = 2): { world: World; materials: MaterialRegistry; water: WaterField } {
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

function spawnAt(world: World, x: number, z: number): EntityId {
  const floor = world.grid.surfaceY(x, z)!;
  return spawnBeaver(world, { name: "Worker", position: { x, y: floor + 1, z } });
}

function createJobOfDesignationKind(world: World, designationKind: string, target: { x: number; z: number }): EntityId {
  const designationId = createDesignation(world, designationKind, target);
  const jobId = world.entities.create("job");
  setJob(world.components, jobId, { designationId, target, status: "unclaimed" });
  return jobId;
}

describe("LaborPreferences", () => {
  it("normalizes allowed labor kinds and priorities for deterministic persistence", () => {
    const { world } = buildFlatWorld();
    const beaver = spawnAt(world, 0, 0);

    setLaborPreferences(world.components, beaver, {
      allowUnlisted: false,
      allowedLaborKinds: ["hauling", "woodcutting", "hauling"],
      priorityByLaborKind: { woodcutting: 3, hauling: 5 },
    });

    expect(getLaborPreferences(world.components, beaver)).toEqual({
      allowUnlisted: false,
      allowedLaborKinds: ["hauling", "woodcutting"],
      priorityByLaborKind: { hauling: 5, woodcutting: 3 },
    });
  });

  it("maps existing designation kinds onto broad labor kinds", () => {
    expect(laborKindForDesignationKind("go-to")).toBe("general");
    expect(laborKindForDesignationKind("cut-tree")).toBe("woodcutting");
    expect(laborKindForDesignationKind("haul-item")).toBe("hauling");
    expect(laborKindForDesignationKind("construct-dam-segment")).toBe("construction");
    expect(laborKindForDesignationKind("future-labor")).toBe("future-labor");
  });

  it("changes eligibility through allowed labors, without naming a specific job", () => {
    const { world } = buildFlatWorld();
    const beaver = spawnAt(world, 0, 0);
    const woodcuttingJob = createJobOfDesignationKind(world, "cut-tree", { x: 3, z: 0 });
    const haulingJob = createJobOfDesignationKind(world, "haul-item", { x: 4, z: 0 });

    setAllowedLabors(world.components, beaver, ["woodcutting"]);
    expect(isLaborAllowedForJob(world.components, beaver, woodcuttingJob)).toBe(true);
    expect(isEligible(world.entities, world.components, beaver, woodcuttingJob)).toBe(true);
    expect(isEligible(world.entities, world.components, beaver, haulingJob)).toBe(false);

    setAllowedLabors(world.components, beaver, ["hauling"]);
    expect(isEligible(world.entities, world.components, beaver, woodcuttingJob)).toBe(false);
    expect(isEligible(world.entities, world.components, beaver, haulingJob)).toBe(true);
  });

  it("selectJob prefers higher-priority labor before distance, then keeps deterministic tie-breaks", () => {
    const { world, materials, water } = buildFlatWorld();
    const beaver = spawnAt(world, 0, 0);
    const nearWoodcutting = createJobOfDesignationKind(world, "cut-tree", { x: 1, z: 0 });
    const farHauling = createJobOfDesignationKind(world, "haul-item", { x: 8, z: 0 });
    setLaborPriority(world.components, beaver, "woodcutting", 1);
    setLaborPriority(world.components, beaver, "hauling", 5);

    expect(selectJob(world.entities, world.components, world.grid, world.terrain, water, materials, PROFILE, beaver, [nearWoodcutting, farHauling])).toBe(
      farHauling,
    );

    setLaborPriority(world.components, beaver, "woodcutting", 5);
    const chosen = selectJob(world.entities, world.components, world.grid, world.terrain, water, materials, PROFILE, beaver, [
      nearWoodcutting,
      farHauling,
    ]);
    expect(chosen).toBe(nearWoodcutting);
  });

  it("round-trips through the full world component registry", () => {
    const { world } = buildFlatWorld();
    const beaver = spawnAt(world, 0, 0);
    setAllowedLabors(world.components, beaver, ["hauling"]);
    setLaborPriority(world.components, beaver, "hauling", 4);

    const restoreMaterials = new MaterialRegistry();
    registerStandardMaterials(restoreMaterials);
    const restored = restoreWorld(JSON.parse(JSON.stringify(snapshotWorld(world))), { componentTypes: ALL_COMPONENT_TYPES, materials: restoreMaterials });

    expect(getLaborPreferences(restored.components, beaver)).toEqual({
      allowUnlisted: false,
      allowedLaborKinds: ["hauling"],
      priorityByLaborKind: { hauling: 4 },
    });
    expect(laborPriorityForJob(restored.components, beaver, createJobOfDesignationKind(restored, "haul-item", { x: 1, z: 0 }))).toBe(4);
  });

  it("REGRESSION (P2-02): malformed persisted arrays fail loudly at the read boundary", () => {
    const { world } = buildFlatWorld();
    const beaver = spawnAt(world, 0, 0);
    world.components.set(beaver, LaborPreferencesComponent, {
      allowUnlisted: false,
      allowedLaborKinds: "not-an-array",
      priorityByLaborKind: {},
    } as never);

    expect(() => getLaborPreferences(world.components, beaver)).toThrow(RangeError);
  });

  it("REGRESSION (P2-02 critic): malformed persisted labor-kind values cannot pass through RegExp coercion", () => {
    const { world } = buildFlatWorld();
    const beaver = spawnAt(world, 0, 0);

    for (const malformedKind of [true, false, null, undefined]) {
      world.components.set(beaver, LaborPreferencesComponent, {
        allowUnlisted: false,
        allowedLaborKinds: [malformedKind],
        priorityByLaborKind: {},
      } as never);

      expect(() => getLaborPreferences(world.components, beaver)).toThrow(RangeError);
    }
  });
});
