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
import { getDesignation } from "../../src/sim/jobs/Designation.js";
import { getJob } from "../../src/sim/jobs/Job.js";
import {
  BURIAL_WORK_REQUIRED,
  assertValidBurialProgress,
  assertValidGrave,
  designateBurial,
  generateBurialJob,
  getBurialProgress,
  getGrave,
  isEligibleForBurial,
  tickBurialJob,
} from "../../src/sim/labor/Burial.js";

const PROFILE: NavigationProfile = { canSwim: true, maxWadingDepth: 0.5 };

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
  const world: World = { clock, random, entities, components, grid, terrain, events, water, weather };
  return { world, materials, water };
}

function spawnAt(world: World, name: string, x: number, z: number): EntityId {
  const floor = world.grid.surfaceY(x, z)!;
  return spawnBeaver(world, { name, position: { x, y: floor + 1, z } });
}

/**
 * A bare, standalone `"corpse"` entity, deliberately NOT created via
 * `Mortality.ts`'s `die()` -- these tests exercise `Burial.ts` in
 * isolation (the same "construct the physical fixture directly" pattern
 * `Hauling.ts`'s own unit tests use for logs), and proves `Burial.ts`
 * genuinely needs nothing from `Mortality.ts` (no `CorpseComponent`
 * attached here at all). `die()`'s own automatic burial-job generation is
 * covered separately by `mortality.test.ts`/the P2-15 acceptance test.
 */
function createCorpseAt(world: World, x: number, z: number): EntityId {
  const corpseId = world.entities.create("corpse");
  const floor = world.grid.surfaceY(x, z)!;
  world.grid.setEntityPosition(corpseId, x, floor + 1, z);
  return corpseId;
}

function driveBurialToCompletion(
  world: World,
  materials: MaterialRegistry,
  water: WaterField,
  beaverId: EntityId,
  candidateJobIds: readonly EntityId[],
  maxTicks = 50,
) {
  let outcome: string = "idle";
  for (let i = 0; i < maxTicks; i++) {
    outcome = tickBurialJob(world.grid, world.terrain, water, materials, world.entities, world.components, beaverId, PROFILE, candidateJobIds);
    if (outcome === "buried" || outcome === "failed") return outcome;
  }
  return outcome;
}

describe("Burial", () => {
  it("validates persistent burial progress and grave state", () => {
    expect(() =>
      assertValidBurialProgress({ corpseId: 1 as EntityId, causeOfDeath: "trauma", deceasedBeaverId: 2 as EntityId, workDone: 0, workRequired: 20 }),
    ).not.toThrow();
    expect(() =>
      assertValidBurialProgress({ corpseId: 0 as EntityId, causeOfDeath: "trauma", deceasedBeaverId: 2 as EntityId, workDone: 0, workRequired: 20 }),
    ).toThrow(RangeError);
    expect(() =>
      assertValidBurialProgress({
        corpseId: 1 as EntityId,
        causeOfDeath: "invented" as unknown as "trauma",
        deceasedBeaverId: 2 as EntityId,
        workDone: 0,
        workRequired: 20,
      }),
    ).toThrow(RangeError);
    expect(() =>
      assertValidBurialProgress({ corpseId: 1 as EntityId, causeOfDeath: "trauma", deceasedBeaverId: 2 as EntityId, workDone: -1, workRequired: 20 }),
    ).toThrow(RangeError);
    expect(() => assertValidGrave({ deceasedBeaverId: 1 as EntityId, causeOfDeath: "drowning" })).not.toThrow();
    expect(() => assertValidGrave({ deceasedBeaverId: 0 as EntityId, causeOfDeath: "drowning" })).toThrow(RangeError);
  });

  it("designateBurial rejects a non-corpse or unpositioned entity", () => {
    const { world } = buildFlatWorld();
    const beaverId = spawnAt(world, "Alder", 3, 3);
    expect(() => designateBurial(world, beaverId)).toThrow(RangeError);

    const corpseId = createCorpseAt(world, 4, 4);
    expect(() => designateBurial(world, corpseId)).not.toThrow();
  });

  it("generateBurialJob expands a valid designation into one job with real progress state", () => {
    const { world } = buildFlatWorld();
    const corpseId = createCorpseAt(world, 4, 4);
    const designationId = designateBurial(world, corpseId);
    const [jobId] = generateBurialJob(world, designationId, "trauma", 999 as EntityId);

    const progress = getBurialProgress(world.components, jobId!)!;
    expect(progress).toEqual({ corpseId, causeOfDeath: "trauma", deceasedBeaverId: 999, workDone: 0, workRequired: BURIAL_WORK_REQUIRED });
    expect(getJob(world.components, jobId!)).toMatchObject({ designationId, status: "unclaimed" });
  });

  it("a gravedigger travels to the corpse, digs, and creates a real grave in its place", () => {
    const { world, materials, water } = buildFlatWorld();
    const corpseId = createCorpseAt(world, 8, 8);
    const corpsePosition = world.grid.positionOf(corpseId)!;
    const gravedigger = spawnAt(world, "Digger", 2, 2);
    const designationId = designateBurial(world, corpseId);
    const [jobId] = generateBurialJob(world, designationId, "trauma", 12345 as EntityId);

    expect(isEligibleForBurial(world.entities, world.components, gravedigger, jobId!)).toBe(true);

    const outcome = driveBurialToCompletion(world, materials, water, gravedigger, [jobId!]);
    expect(outcome).toBe("buried");

    expect(world.entities.isLive(corpseId)).toBe(false);
    expect(getJob(world.components, jobId!)!.status).toBe("completed");
    expect(getDesignation(world.components, designationId)!.status).toBe("completed");

    const graves = world.entities.liveIdsOfKind("grave");
    expect(graves).toHaveLength(1);
    expect(getGrave(world.components, graves[0]!)).toEqual({ deceasedBeaverId: 12345, causeOfDeath: "trauma" });
    expect(world.grid.positionOf(graves[0]!)).toEqual(corpsePosition);
  });

  it("fails if the corpse vanishes mid-job", () => {
    const { world, materials, water } = buildFlatWorld();
    const corpseId = createCorpseAt(world, 8, 8);
    const gravedigger = spawnAt(world, "Digger", 2, 2);
    const designationId = designateBurial(world, corpseId);
    const [jobId] = generateBurialJob(world, designationId, "trauma", 1 as EntityId);

    // Vanish the corpse mid-job (defensive path -- nothing in this codebase
    // currently destroys a corpse except this file's own completion branch).
    world.entities.destroy(corpseId);
    const outcome = tickBurialJob(world.grid, world.terrain, water, materials, world.entities, world.components, gravedigger, PROFILE, [jobId!]);
    expect(outcome).toBe("failed");
    expect(getJob(world.components, jobId!)!.status).toBe("failed");
  });

  it("persists burial progress and a completed grave through a real full-world save/reload round trip", () => {
    const { world, materials, water } = buildFlatWorld();
    const corpseId = createCorpseAt(world, 8, 8);
    const gravedigger = spawnAt(world, "Digger", 2, 2);
    const designationId = designateBurial(world, corpseId);
    const [jobId] = generateBurialJob(world, designationId, "trauma", 777 as EntityId);
    driveBurialToCompletion(world, materials, water, gravedigger, [jobId!]);
    const graveId = world.entities.liveIdsOfKind("grave")[0]!;
    const beforeGrave = getGrave(world.components, graveId);

    const restoredMaterials = new MaterialRegistry();
    registerStandardMaterials(restoredMaterials);
    const restored = restoreWorld(JSON.parse(JSON.stringify(snapshotWorld(world))), {
      componentTypes: ALL_COMPONENT_TYPES,
      materials: restoredMaterials,
    });

    expect(getGrave(restored.components, graveId)).toEqual(beforeGrave);
    expect(restored.entities.isLive(graveId)).toBe(true);
  });

  it("persists a LIVE, still-unburied corpse and a MID-PROGRESS, in-progress burial job through a real save/reload round trip", () => {
    const { world, materials, water } = buildFlatWorld();
    const corpseId = createCorpseAt(world, 8, 8);
    const gravedigger = spawnAt(world, "Digger", 7, 8); // adjacent -- arrives and starts digging in one tick
    const designationId = designateBurial(world, corpseId);
    const [jobId] = generateBurialJob(world, designationId, "drowning", 555 as EntityId);

    // Exactly one tick: travel there, then a single tick of real digging --
    // deliberately short of BURIAL_WORK_REQUIRED, so the corpse is still
    // live and the job still genuinely mid-flight at snapshot time.
    tickBurialJob(world.grid, world.terrain, water, materials, world.entities, world.components, gravedigger, PROFILE, [jobId!]);
    tickBurialJob(world.grid, world.terrain, water, materials, world.entities, world.components, gravedigger, PROFILE, [jobId!]);
    const beforeProgress = getBurialProgress(world.components, jobId!)!;
    expect(beforeProgress.workDone).toBeGreaterThan(0);
    expect(beforeProgress.workDone).toBeLessThan(BURIAL_WORK_REQUIRED);
    expect(world.entities.isLive(corpseId)).toBe(true);
    const beforeJob = getJob(world.components, jobId!)!;
    expect(beforeJob.status).toBe("in-progress");

    const restoredMaterials = new MaterialRegistry();
    registerStandardMaterials(restoredMaterials);
    const restored = restoreWorld(JSON.parse(JSON.stringify(snapshotWorld(world))), {
      componentTypes: ALL_COMPONENT_TYPES,
      materials: restoredMaterials,
    });

    expect(restored.entities.isLive(corpseId)).toBe(true);
    expect(getBurialProgress(restored.components, jobId!)).toEqual(beforeProgress);
    expect(getJob(restored.components, jobId!)).toEqual(beforeJob);

    // The restored world can still drive the SAME in-progress job through
    // to completion -- reload didn't leave it in a stuck/orphaned state.
    const outcome = driveBurialToCompletion(restored, materials, water, gravedigger, [jobId!]);
    expect(outcome).toBe("buried");
    expect(restored.entities.isLive(corpseId)).toBe(false);
  });
});
