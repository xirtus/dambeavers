/**
 * Headless acceptance test for P2-02 -- Work priorities and labor
 * preferences.
 *
 * Roadmap acceptance:
 *   "changing a beaver's allowed labor changes job selection without
 *   assigning a specific job directly."
 *
 * This test uses the authoritative job-board selection primitive over
 * real persistent `Designation`/`Job` entities. There is no colony-wide
 * scheduler yet, so the test does not fake one; it proves the shared
 * selection layer all existing labor drivers call now respects worker
 * policy.
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
import { createDesignation } from "../../src/sim/jobs/Designation.js";
import { setJob, getJob } from "../../src/sim/jobs/Job.js";
import { currentJobOf, selectJob } from "../../src/sim/jobs/JobBoard.js";
import { setAllowedLabors, setLaborPriority } from "../../src/sim/jobs/LaborPreferences.js";

const PROFILE: NavigationProfile = { canSwim: true, maxWadingDepth: 0.5 };

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
  const random = new RandomStreams(303);
  const events = new EventLog(entities);
  return { world: { clock, random, entities, components, grid, terrain, events, water, weather }, materials, water };
}

function spawnAt(world: World, x: number, z: number): EntityId {
  const floor = world.grid.surfaceY(x, z)!;
  return spawnBeaver(world, { name: "Dispatcher", position: { x, y: floor + 1, z } });
}

function createLaborJob(world: World, designationKind: string, target: { x: number; z: number }): EntityId {
  const designationId = createDesignation(world, designationKind, target);
  const jobId = world.entities.create("job");
  setJob(world.components, jobId, { designationId, target, status: "unclaimed" });
  return jobId;
}

function choose(world: World, materials: MaterialRegistry, water: WaterField, beaver: EntityId, jobs: readonly EntityId[]): EntityId | undefined {
  return selectJob(world.entities, world.components, world.grid, world.terrain, water, materials, PROFILE, beaver, jobs);
}

describe("P2-02 acceptance: allowed labor changes job selection without direct assignment", () => {
  it("changes selected job by changing broad labor policy, while jobs remain unassigned until the normal pipeline reserves them", () => {
    const { world, materials, water } = buildWorld();
    const beaver = spawnAt(world, 0, 0);
    const woodcuttingJob = createLaborJob(world, "cut-tree", { x: 1, z: 0 });
    const haulingJob = createLaborJob(world, "haul-item", { x: 8, z: 0 });

    setAllowedLabors(world.components, beaver, ["woodcutting"]);
    expect(choose(world, materials, water, beaver, [haulingJob, woodcuttingJob])).toBe(woodcuttingJob);
    expect(currentJobOf(world.entities, world.components, beaver)).toBeUndefined();
    expect(getJob(world.components, woodcuttingJob)!.status).toBe("unclaimed");

    const restoreMaterials = new MaterialRegistry();
    registerStandardMaterials(restoreMaterials);
    const restored = restoreWorld(JSON.parse(JSON.stringify(snapshotWorld(world))), { componentTypes: ALL_COMPONENT_TYPES, materials: restoreMaterials });
    expect(choose(restored, restoreMaterials, restored.water, beaver, [haulingJob, woodcuttingJob])).toBe(woodcuttingJob);

    setAllowedLabors(restored.components, beaver, ["hauling"]);
    expect(choose(restored, restoreMaterials, restored.water, beaver, [woodcuttingJob, haulingJob])).toBe(haulingJob);
    expect(currentJobOf(restored.entities, restored.components, beaver)).toBeUndefined();
    expect(getJob(restored.components, haulingJob)!.status).toBe("unclaimed");

    setAllowedLabors(restored.components, beaver, ["woodcutting", "hauling"]);
    setLaborPriority(restored.components, beaver, "woodcutting", 1);
    setLaborPriority(restored.components, beaver, "hauling", 5);
    expect(choose(restored, restoreMaterials, restored.water, beaver, [woodcuttingJob, haulingJob])).toBe(haulingJob);
  });
});
