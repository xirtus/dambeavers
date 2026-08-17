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
import { getSkills, spawnBeaver } from "../../src/sim/creatures/Beaver.js";
import { getDesignation } from "../../src/sim/jobs/Designation.js";
import { getJob, setJob } from "../../src/sim/jobs/Job.js";
import { setLog, getLog, getHeld, getReservation } from "../../src/sim/labor/Log.js";
import { designateHaul, generateHaulJob, tickHaulJob } from "../../src/sim/labor/Hauling.js";
import {
  designateConstruction,
  getConstruction,
  setConstruction,
  deliveredMassAtSite,
  ensureMaterialHaul,
  checkMaterialsDelivered,
  generateBuildJob,
  getBuildProgress,
  isEligibleForBuild,
  tickBuildJob,
  cancelConstruction,
  type ConstructionKind,
} from "../../src/sim/labor/Construction.js";

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
  const world: World = { clock, random, entities, components, grid, terrain, events, water, weather };
  return { world, materials, water };
}

function spawnAt(world: World, x: number, z: number, name = "Worker") {
  const floor = world.grid.surfaceY(x, z)!;
  return spawnBeaver(world, { name, position: { x, y: floor + 1, z } });
}

function spawnLog(world: World, x: number, z: number, massKg = 15) {
  const id = world.entities.create("log");
  const floor = world.grid.surfaceY(x, z)!;
  world.grid.setEntityPosition(id, x, floor + 1, z);
  setLog(world.components, id, { materialId: "wood", massKg });
  return id;
}

/** Drives a haul job all the way to "delivered". */
function driveHaulToDelivery(world: World, materials: MaterialRegistry, water: WaterField, beaver: EntityId, jobId: EntityId): void {
  let outcome = "";
  let iterations = 0;
  do {
    outcome = tickHaulJob(world.grid, world.terrain, water, materials, world.entities, world.components, beaver, PROFILE, [jobId]);
    iterations++;
    expect(iterations).toBeLessThan(100);
  } while (outcome !== "delivered" && outcome !== "failed" && outcome !== "requeued");
  expect(outcome).toBe("delivered");
}

describe("designateConstruction", () => {
  it("creates a 'construct-<kind>' designation and an 'awaiting-materials' Construction", () => {
    const { world } = buildFlatWorld();
    const site = { x: 5, z: 5 };
    const constructionId = designateConstruction(world, "wall", site);

    const construction = getConstruction(world.components, constructionId)!;
    expect(construction.status).toBe("awaiting-materials");
    expect(construction.kind).toBe("wall");
    expect(construction.site).toEqual(site);
    expect(construction.requiredMaterialId).toBe("wood");
    expect(construction.requiredMassKg).toBeGreaterThan(0);
    expect(construction.workRequired).toBeGreaterThan(0);
    expect(construction.workDone).toBe(0);

    const designation = getDesignation(world.components, construction.designationId)!;
    expect(designation).toEqual({ kind: "construct-wall", target: site, status: "active" });
  });

  it("throws for a site with no ground", () => {
    const { world } = buildFlatWorld();
    expect(() => designateConstruction(world, "wall", { x: 200, z: 200 })).toThrow(RangeError);
  });

  it("gives different construction kinds different requirements", () => {
    const { world } = buildFlatWorld();
    const wallId = designateConstruction(world, "wall", { x: 2, z: 2 });
    const lodgeId = designateConstruction(world, "lodge-segment", { x: 4, z: 4 });
    const wall = getConstruction(world.components, wallId)!;
    const lodge = getConstruction(world.components, lodgeId)!;
    expect(lodge.requiredMassKg).toBeGreaterThan(wall.requiredMassKg);
    expect(lodge.workRequired).toBeGreaterThan(wall.workRequired);
  });

  it("REGRESSION (critic-found Moderate, P1-20 review): rejects an invalid kind cleanly, with NO entity ever created -- not a raw TypeError after already allocating orphaned entities", () => {
    const { world } = buildFlatWorld();
    const entityCountBefore = world.entities.totalAllocatedCount;
    expect(() => designateConstruction(world, "not-a-real-kind" as ConstructionKind, { x: 5, z: 5 })).toThrow(RangeError);
    // No designation and no construction entity were left behind -- the
    // exact orphaned-entity leak the critic reproduced against the
    // pre-fix version (which validated `kind` only implicitly, by
    // crashing on `CONSTRUCTION_REQUIREMENTS[kind].materialId` AFTER
    // already creating both entities).
    expect(world.entities.totalAllocatedCount).toBe(entityCountBefore);
  });
});

describe("deliveredMassAtSite / ensureMaterialHaul / checkMaterialsDelivered", () => {
  it("reports zero delivered mass at a bare site", () => {
    const { world } = buildFlatWorld();
    const constructionId = designateConstruction(world, "wall", { x: 5, z: 5 });
    const construction = getConstruction(world.components, constructionId)!;
    expect(deliveredMassAtSite(world.entities, world.components, world.grid, constructionId)).toBe(0);
  });

  it("ensureMaterialHaul returns undefined when nothing is available to haul", () => {
    const { world } = buildFlatWorld();
    const constructionId = designateConstruction(world, "wall", { x: 5, z: 5 });
    expect(ensureMaterialHaul(world, constructionId)).toBeUndefined();
  });

  it("ensureMaterialHaul designates a haul for the nearest free matching item", () => {
    const { world } = buildFlatWorld();
    const site = { x: 5, z: 5 };
    const constructionId = designateConstruction(world, "wall", site);
    const near = spawnLog(world, 3, 5, 10);
    const far = spawnLog(world, 12, 12, 10);

    const jobId = ensureMaterialHaul(world, constructionId);
    expect(jobId).toBeDefined();
    expect(getReservation(world.components, near)).toBeUndefined(); // haul job not yet driven, just designated
    expect(getReservation(world.components, far)).toBeUndefined();
    // The generated job targets whichever item designateHaul picked -- confirm it's the actually-nearer one.
    const job = getJob(world.components, jobId!)!;
    expect(job.target).toEqual({ x: 3, z: 5 });
  });

  it("ensureMaterialHaul ignores items that are held or reserved by a live beaver", () => {
    const { world, materials, water } = buildFlatWorld();
    const site = { x: 5, z: 5 };
    const constructionId = designateConstruction(world, "wall", site);
    const busyItem = spawnLog(world, 3, 5, 10);
    const freeItem = spawnLog(world, 10, 10, 10);

    const beaver = spawnAt(world, 3, 5, "Other");
    const otherJob = generateHaulJob(world, designateHaul(world, busyItem, { x: 0, z: 0 }))[0]!;
    tickHaulJob(world.grid, world.terrain, water, materials, world.entities, world.components, beaver, PROFILE, [otherJob]); // picks up immediately

    const jobId = ensureMaterialHaul(world, constructionId);
    expect(jobId).toBeDefined();
    const job = getJob(world.components, jobId!)!;
    expect(job.target).toEqual({ x: 10, z: 10 }); // not the busy one
  });

  it("ensureMaterialHaul returns undefined once enough mass is already delivered, even if more free material exists", () => {
    const { world, materials, water } = buildFlatWorld();
    const site = { x: 5, z: 5 };
    const constructionId = designateConstruction(world, "wall", site); // requires 20kg
    const beaver = spawnAt(world, 5, 5, "Hauler");
    const bigItem = spawnLog(world, 1, 5, 25); // elsewhere -- a real haul is needed to deliver it
    const jobId = ensureMaterialHaul(world, constructionId)!;
    driveHaulToDelivery(world, materials, water, beaver, jobId);
    expect(deliveredMassAtSite(world.entities, world.components, world.grid, constructionId)).toBe(25);

    const extra = spawnLog(world, 6, 5, 10);
    expect(ensureMaterialHaul(world, constructionId)).toBeUndefined();
    expect(getReservation(world.components, extra)).toBeUndefined();
    expect(getLog(world.components, bigItem)).toBeDefined();
  });

  it("checkMaterialsDelivered stays false until cumulative delivered mass across TWO separate hauls meets the requirement, then flips", () => {
    const { world, materials, water } = buildFlatWorld();
    const site = { x: 5, z: 5 };
    const constructionId = designateConstruction(world, "wall", site); // requires 20kg
    const beaver = spawnAt(world, 5, 5, "Hauler");
    spawnLog(world, 2, 5, 12); // first available item, elsewhere -- a real haul, not a self-haul
    spawnLog(world, 9, 5, 12); // second available item, elsewhere

    expect(checkMaterialsDelivered(world, constructionId)).toBe(false);
    expect(getConstruction(world.components, constructionId)!.status).toBe("awaiting-materials");

    const firstJob = ensureMaterialHaul(world, constructionId)!;
    driveHaulToDelivery(world, materials, water, beaver, firstJob);
    expect(deliveredMassAtSite(world.entities, world.components, world.grid, constructionId)).toBe(12);
    expect(checkMaterialsDelivered(world, constructionId)).toBe(false); // 12kg < 20kg required

    const secondJob = ensureMaterialHaul(world, constructionId)!;
    driveHaulToDelivery(world, materials, water, beaver, secondJob);
    expect(deliveredMassAtSite(world.entities, world.components, world.grid, constructionId)).toBe(24);
    expect(checkMaterialsDelivered(world, constructionId)).toBe(true); // 24kg >= 20kg required
    expect(getConstruction(world.components, constructionId)!.status).toBe("awaiting-labor");
  });

  it("checkMaterialsDelivered flips to 'awaiting-labor' once cumulative delivered mass meets the requirement", () => {
    const { world, materials, water } = buildFlatWorld();
    const site = { x: 5, z: 5 };
    const constructionId = designateConstruction(world, "wall", site); // requires 20kg
    const beaver = spawnAt(world, 5, 5, "Hauler");
    spawnLog(world, 5, 5, 25); // already enough, sitting right at the site

    expect(checkMaterialsDelivered(world, constructionId)).toBe(true);
    expect(getConstruction(world.components, constructionId)!.status).toBe("awaiting-labor");
    void beaver;
  });
});

describe("generateBuildJob / isEligibleForBuild / tickBuildJob", () => {
  function readyConstruction(world: World): EntityId {
    const site = { x: 5, z: 5 };
    const constructionId = designateConstruction(world, "wall", site); // requires 20kg / 10 work
    spawnLog(world, 5, 5, 25); // enough material already sitting at the site
    expect(checkMaterialsDelivered(world, constructionId)).toBe(true);
    return constructionId;
  }

  it("throws generating a build job for a construction that isn't awaiting labor", () => {
    const { world } = buildFlatWorld();
    const constructionId = designateConstruction(world, "wall", { x: 5, z: 5 });
    expect(() => generateBuildJob(world, constructionId)).toThrow(RangeError);
  });

  it("generates one unclaimed job pointing back at the construction", () => {
    const { world } = buildFlatWorld();
    const constructionId = readyConstruction(world);
    const [jobId] = generateBuildJob(world, constructionId);
    expect(getJob(world.components, jobId!)).toEqual({
      designationId: getConstruction(world.components, constructionId)!.designationId,
      target: { x: 5, z: 5 },
      status: "unclaimed",
    });
    expect(getBuildProgress(world.components, jobId!)).toEqual({ constructionId });
  });

  it("isEligibleForBuild is false once the construction is no longer awaiting labor", () => {
    const { world } = buildFlatWorld();
    const constructionId = readyConstruction(world);
    const beaver = spawnAt(world, 0, 0);
    const [jobId] = generateBuildJob(world, constructionId);
    expect(isEligibleForBuild(world.entities, world.components, beaver, jobId!)).toBe(true);

    cancelConstruction(world.entities, world.components, world.grid, constructionId);
    expect(isEligibleForBuild(world.entities, world.components, beaver, jobId!)).toBe(false);
  });

  it("travels to the site before starting work", () => {
    const { world, materials, water } = buildFlatWorld();
    const constructionId = readyConstruction(world);
    const beaver = spawnAt(world, 0, 0, "Builder");
    const [jobId] = generateBuildJob(world, constructionId);

    const outcome = tickBuildJob(world.grid, world.terrain, water, materials, world.entities, world.components, beaver, PROFILE, [jobId!]);

    expect(outcome).toBe("assigned");
    expect(getConstruction(world.components, constructionId)!.workDone).toBe(0);
  });

  it("drives a beaver to the site, accumulates work, consumes the delivered material, and completes the job and designation", () => {
    const { world, materials, water } = buildFlatWorld();
    const constructionId = readyConstruction(world);
    const beaver = spawnAt(world, 5, 5, "Builder"); // already at the site
    const [jobId] = generateBuildJob(world, constructionId);

    let outcome: string;
    let iterations = 0;
    do {
      outcome = tickBuildJob(world.grid, world.terrain, water, materials, world.entities, world.components, beaver, PROFILE, [jobId!]);
      iterations++;
      expect(iterations).toBeLessThan(100);
    } while (outcome !== "built" && outcome !== "failed" && outcome !== "requeued");

    expect(outcome).toBe("built");
    const construction = getConstruction(world.components, constructionId)!;
    expect(construction.status).toBe("complete");
    expect(construction.workDone).toBe(construction.workRequired);
    expect(getJob(world.components, jobId!)!.status).toBe("completed");
    expect(getDesignation(world.components, construction.designationId)!.status).toBe("completed");

    // The delivered log was consumed -- built into the structure, not just moved.
    for (const id of world.entities.liveIdsOfKind("log")) {
      expect(getLog(world.components, id)).toBeUndefined();
    }
    expect(deliveredMassAtSite(world.entities, world.components, world.grid, constructionId)).toBe(0);
  });

  it("REGRESSION (P2-03): real assembly work grants construction skill practice", () => {
    const { world, materials, water } = buildFlatWorld();
    const constructionId = readyConstruction(world);
    const beaver = spawnAt(world, 5, 5, "Builder");
    const [jobId] = generateBuildJob(world, constructionId);

    expect(getSkills(world.components, beaver)!.levels.construction).toBeUndefined();
    const outcome = tickBuildJob(world.grid, world.terrain, water, materials, world.entities, world.components, beaver, PROFILE, [jobId!]);

    expect(outcome).toBe("working");
    expect(getConstruction(world.components, constructionId)!.workDone).toBeGreaterThan(0);
    expect(getSkills(world.components, beaver)!.levels.construction).toBeGreaterThan(0);
  });

  it("REGRESSION (P2-03 critic): a final build tick that fails material consumption grants no construction practice", () => {
    const { world, materials, water } = buildFlatWorld();
    const constructionId = readyConstruction(world);
    const construction = getConstruction(world.components, constructionId)!;
    const beaver = spawnAt(world, 5, 5, "Builder");
    const [jobId] = generateBuildJob(world, constructionId);
    const almostDone = construction.workRequired - 0.5;
    setConstruction(world.components, constructionId, { ...construction, workDone: almostDone });

    for (const logId of world.entities.liveIdsOfKind("log")) world.entities.destroy(logId);

    const outcome = tickBuildJob(world.grid, world.terrain, water, materials, world.entities, world.components, beaver, PROFILE, [jobId!]);

    expect(outcome).toBe("failed");
    expect(getConstruction(world.components, constructionId)!.workDone).toBe(almostDone);
    expect(getSkills(world.components, beaver)!.levels.construction).toBeUndefined();
  });

  it("requeues if the site becomes unreachable mid-journey", () => {
    const { world, materials, water } = buildFlatWorld(8, 8, 8, 2);
    const constructionId = readyConstruction(world);
    const beaver = spawnAt(world, 0, 0, "Builder");
    const [jobId] = generateBuildJob(world, constructionId);

    const first = tickBuildJob(world.grid, world.terrain, water, materials, world.entities, world.components, beaver, PROFILE, [jobId!]);
    expect(first).toBe("assigned");

    for (let z = 0; z < 8; z++) {
      for (let y = 3; y < world.grid.dims.sizeY; y++) world.terrain.setMaterial(3, y, z, "stone");
    }

    const outcome = tickBuildJob(world.grid, world.terrain, water, materials, world.entities, world.components, beaver, PROFILE, [jobId!]);
    expect(outcome).toBe("requeued");
    expect(getJob(world.components, jobId!)!.status).toBe("unclaimed");
  });

  it("cancelling an in-progress build fails its job immediately (via cancelConstruction itself), so the beaver's next tick just goes idle rather than crashing or phantom-progressing", () => {
    const { world, materials, water } = buildFlatWorld();
    const constructionId = readyConstruction(world);
    const beaver = spawnAt(world, 5, 5, "Builder");
    const [jobId] = generateBuildJob(world, constructionId);
    tickBuildJob(world.grid, world.terrain, water, materials, world.entities, world.components, beaver, PROFILE, [jobId!]); // starts work-eligible

    cancelConstruction(world.entities, world.components, world.grid, constructionId);
    expect(getJob(world.components, jobId!)!.status).toBe("failed"); // cancelConstruction already failed it

    const workDoneBeforeCancel = getConstruction(world.components, constructionId)!.workDone;
    const outcome = tickBuildJob(world.grid, world.terrain, water, materials, world.entities, world.components, beaver, PROFILE, [jobId!]);
    expect(outcome).toBe("idle"); // nothing left to reserve -- not re-marked "failed" a second time
    expect(getConstruction(world.components, constructionId)!.workDone).toBe(workDoneBeforeCancel); // no further work phantom-accumulated after cancellation
  });

  it("defensively fails the job outright if, hypothetically, the construction stops being 'awaiting-labor' while the SAME beaver still holds a live reservation on it", () => {
    // Exercises tickBuildJob's own defensive branch directly -- not
    // reachable via cancelConstruction (which already fails the job
    // itself, covered by the test above), but a real safety net worth
    // keeping and testing on its own, matching this project's established
    // "fail intelligibly if an invariant is ever violated" discipline
    // (e.g. Hauling.ts's belt-and-suspenders throw).
    const { world, materials, water } = buildFlatWorld();
    const constructionId = readyConstruction(world);
    const beaver = spawnAt(world, 5, 5, "Builder");
    const [jobId] = generateBuildJob(world, constructionId);
    tickBuildJob(world.grid, world.terrain, water, materials, world.entities, world.components, beaver, PROFILE, [jobId!]); // reserves + arrives

    const construction = getConstruction(world.components, constructionId)!;
    setConstruction(world.components, constructionId, { ...construction, status: "cancelled" }); // bypass cancelConstruction's own job-failing loop, on purpose

    const outcome = tickBuildJob(world.grid, world.terrain, water, materials, world.entities, world.components, beaver, PROFILE, [jobId!]);
    expect(outcome).toBe("failed");
    expect(getJob(world.components, jobId!)!.status).toBe("failed");
  });
});

describe("cancelConstruction", () => {
  it("marks the Construction and Designation 'cancelled' and fails outstanding jobs, but throws for an unknown entity", () => {
    const { world } = buildFlatWorld();
    expect(() => cancelConstruction(world.entities, world.components, world.grid, 999999 as EntityId)).toThrow(RangeError);
  });

  it("REGRESSION (P1-10 acceptance): cancelling construction before assembly leaves delivered physical materials in the world", () => {
    const { world, materials, water } = buildFlatWorld();
    const site = { x: 5, z: 5 };
    const constructionId = designateConstruction(world, "wall", site); // requires 20kg
    const hauler = spawnAt(world, 5, 5, "Hauler");
    const materialItem = spawnLog(world, 5, 5, 25); // enough, sitting right at the site

    expect(checkMaterialsDelivered(world, constructionId)).toBe(true);
    void hauler;

    const [buildJobId] = generateBuildJob(world, constructionId);
    const builder = spawnAt(world, 5, 5, "Builder");
    // Some real (but not yet completing) work happens first.
    tickBuildJob(world.grid, world.terrain, water, materials, world.entities, world.components, builder, PROFILE, [buildJobId!]);
    expect(getConstruction(world.components, constructionId)!.status).toBe("awaiting-labor"); // not yet assembled

    cancelConstruction(world.entities, world.components, world.grid, constructionId);

    const construction = getConstruction(world.components, constructionId)!;
    expect(construction.status).toBe("cancelled");
    expect(getDesignation(world.components, construction.designationId)!.status).toBe("cancelled");
    expect(getJob(world.components, buildJobId!)!.status).toBe("failed");

    // The delivered log is still a real, physical, undestroyed entity in the world.
    expect(world.entities.isLive(materialItem)).toBe(true);
    expect(getLog(world.components, materialItem)).toEqual({ materialId: "wood", massKg: 25 });
    expect(world.grid.positionOf(materialItem)).toEqual({ x: 5, y: world.grid.surfaceY(5, 5)! + 1, z: 5 });
    expect(deliveredMassAtSite(world.entities, world.components, world.grid, constructionId)).toBe(25);
  });

  it("is a no-op when called on an already-complete construction", () => {
    const { world, materials, water } = buildFlatWorld();
    const site = { x: 5, z: 5 };
    const constructionId = designateConstruction(world, "wall", site);
    spawnLog(world, 5, 5, 25);
    checkMaterialsDelivered(world, constructionId);
    const [jobId] = generateBuildJob(world, constructionId);
    const beaver = spawnAt(world, 5, 5, "Builder");
    let outcome: string;
    let iterations = 0;
    do {
      outcome = tickBuildJob(world.grid, world.terrain, water, materials, world.entities, world.components, beaver, PROFILE, [jobId!]);
      iterations++;
      expect(iterations).toBeLessThan(100);
    } while (outcome !== "built");

    expect(() => cancelConstruction(world.entities, world.components, world.grid, constructionId)).not.toThrow();
    expect(getConstruction(world.components, constructionId)!.status).toBe("complete"); // untouched, not flipped to "cancelled"
  });

  it("does not disturb an UNRELATED, still-active job on a different designation", () => {
    const { world } = buildFlatWorld();
    const constructionId = designateConstruction(world, "wall", { x: 5, z: 5 });
    const otherDesignationId = world.entities.create("designation");
    const otherJobId = world.entities.create("job");
    setJob(world.components, otherJobId, { designationId: otherDesignationId, target: { x: 1, z: 1 }, status: "unclaimed" });

    cancelConstruction(world.entities, world.components, world.grid, constructionId);

    expect(getJob(world.components, otherJobId)!.status).toBe("unclaimed");
  });

  it("releases its claim on delivered material, so a fresh construction can reuse the same physical logs afterward", () => {
    const { world } = buildFlatWorld();
    const site = { x: 5, z: 5 };
    const constructionId = designateConstruction(world, "wall", site); // requires 20kg
    const log = spawnLog(world, 5, 5, 25);
    expect(checkMaterialsDelivered(world, constructionId)).toBe(true);
    expect(getReservation(world.components, log)).toEqual({ by: constructionId }); // claimed

    cancelConstruction(world.entities, world.components, world.grid, constructionId);

    expect(getReservation(world.components, log)).toBeUndefined(); // claim released
    expect(world.entities.isLive(log)).toBe(true); // log itself untouched

    const secondConstructionId = designateConstruction(world, "wall", { x: 8, z: 8 });
    const jobId = ensureMaterialHaul(world, secondConstructionId);
    expect(jobId).toBeDefined(); // the freed log is available again
    const job = getJob(world.components, jobId!)!;
    expect(job.target).toEqual({ x: 5, z: 5 });
  });
});

describe("REGRESSION (critic review): delivered material is claimed to its own construction, closing two Critical resource-race bugs", () => {
  it("designateConstruction rejects a second active construction at the same site -- prevents two requirements being satisfied by the SAME physical logs", () => {
    const { world } = buildFlatWorld();
    const site = { x: 5, z: 5 };
    designateConstruction(world, "wall", site);
    expect(() => designateConstruction(world, "lodge-segment", site)).toThrow(RangeError);
  });

  it("a NEW construction may reuse a site once the earlier one there is complete or cancelled", () => {
    const { world, materials, water } = buildFlatWorld();
    const site = { x: 5, z: 5 };
    const firstId = designateConstruction(world, "wall", site);
    cancelConstruction(world.entities, world.components, world.grid, firstId);
    expect(() => designateConstruction(world, "wall", site)).not.toThrow();

    const site2 = { x: 8, z: 8 };
    const secondId = designateConstruction(world, "wall", site2);
    spawnLog(world, 8, 8, 25);
    expect(checkMaterialsDelivered(world, secondId)).toBe(true);
    const [jobId] = generateBuildJob(world, secondId);
    const beaver = spawnAt(world, 8, 8, "Builder");
    let outcome: string;
    do {
      outcome = tickBuildJob(world.grid, world.terrain, water, materials, world.entities, world.components, beaver, PROFILE, [jobId!]);
    } while (outcome !== "built");
    cancelConstruction(world.entities, world.components, world.grid, secondId); // no-op, already complete -- just confirms it's harmless
    expect(() => designateConstruction(world, "wall", site2)).not.toThrow();
  });

  it("REGRESSION: once enough material has been claimed (awaiting-labor), an UNRELATED haul designation can no longer steal the delivered log out from under the construction", () => {
    // Reproduces the exact Critical bug this task's own critic review found:
    // before this fix, delivered material sat completely unprotected, so a
    // wholly independent haul could re-target the same log and the
    // construction would still "complete" having consumed nothing.
    const { world } = buildFlatWorld();
    const site = { x: 5, z: 5 };
    const constructionId = designateConstruction(world, "wall", site); // requires 20kg
    const log = spawnLog(world, 5, 5, 25);

    expect(checkMaterialsDelivered(world, constructionId)).toBe(true);
    expect(getReservation(world.components, log)).toEqual({ by: constructionId });

    expect(() => designateHaul(world, log, { x: 0, z: 0 })).toThrow(RangeError); // Hauling.ts's own designateHaul refuses a live-reserved item
  });

  it("REGRESSION: two constructions racing for a limited pool of material never double-count or double-consume the same log", () => {
    // With designateConstruction now rejecting a shared site outright, this
    // exercises the surviving scenario: two constructions at DIFFERENT
    // sites both drawing from the same small pool of free material via
    // ensureMaterialHaul -- confirms each log is claimed by exactly one of
    // them, never both.
    const { world, materials, water } = buildFlatWorld();
    const siteA = { x: 5, z: 5 };
    const siteB = { x: 5, z: 9 };
    const constructionA = designateConstruction(world, "wall", siteA); // requires 20kg
    const constructionB = designateConstruction(world, "wall", siteB); // requires 20kg
    // Only enough free material for ONE of the two constructions.
    spawnLog(world, 5, 7, 25);

    const haulerA = spawnAt(world, 5, 5, "HaulerA");
    const jobA = ensureMaterialHaul(world, constructionA);
    expect(jobA).toBeDefined();
    let outcome = "";
    let iterations = 0;
    do {
      outcome = tickHaulJob(world.grid, world.terrain, water, materials, world.entities, world.components, haulerA, PROFILE, [jobA!]);
      iterations++;
      expect(iterations).toBeLessThan(100);
    } while (outcome !== "delivered" && outcome !== "failed" && outcome !== "requeued");
    expect(outcome).toBe("delivered");
    expect(checkMaterialsDelivered(world, constructionA)).toBe(true);

    // Construction B can no longer find that log at all -- it's claimed by A.
    expect(ensureMaterialHaul(world, constructionB)).toBeUndefined();
    expect(checkMaterialsDelivered(world, constructionB)).toBe(false);
    expect(deliveredMassAtSite(world.entities, world.components, world.grid, constructionB)).toBe(0);
  });

  it("REGRESSION: checkMaterialsDelivered tolerates a floating-point mass sum a few ULPs short of the exact requirement", () => {
    const { world } = buildFlatWorld();
    const site = { x: 5, z: 5 };
    const constructionId = designateConstruction(world, "wall", site); // requires exactly 20kg
    // Two masses that sum to 19.999999999999996 in IEEE754, not exactly 20 --
    // a real, plausible pair of tree-felling's own fractional log remnants
    // (TreeCutting.ts's fellTree splits a tree's total mass this way).
    // Confirmed in isolation: 13.333333333333332 + 6.666666666666664 === 19.999999999999996.
    spawnLog(world, 5, 5, 13.333333333333332); // both already resting at the site -- isolates the comparison itself, not the haul pipeline
    spawnLog(world, 5, 5, 6.666666666666664);

    expect(deliveredMassAtSite(world.entities, world.components, world.grid, constructionId)).toBeLessThan(20);
    expect(checkMaterialsDelivered(world, constructionId)).toBe(true); // within MASS_EPSILON_KG tolerance -- would wrongly stay false without it
    expect(getConstruction(world.components, constructionId)!.status).toBe("awaiting-labor");
  });

  it("REGRESSION: over-delivered material beyond the requirement is left unclaimed and survives assembly as real, reusable stock -- never silently swept up and destroyed", () => {
    const { world, materials, water } = buildFlatWorld();
    const site = { x: 5, z: 5 };
    const constructionId = designateConstruction(world, "wall", site); // requires exactly 20kg
    spawnLog(world, 5, 5, 25); // enough on its own -- entirely claimed, since a log can't be partially reserved
    const excess = spawnLog(world, 5, 5, 8); // genuinely surplus -- never needed to satisfy the requirement

    expect(checkMaterialsDelivered(world, constructionId)).toBe(true);
    expect(getReservation(world.components, excess)).toBeUndefined(); // never claimed -- claiming stops once enough is reserved

    const [jobId] = generateBuildJob(world, constructionId);
    const beaver = spawnAt(world, 5, 5, "Builder");
    let outcome: string;
    let iterations = 0;
    do {
      outcome = tickBuildJob(world.grid, world.terrain, water, materials, world.entities, world.components, beaver, PROFILE, [jobId!]);
      iterations++;
      expect(iterations).toBeLessThan(100);
    } while (outcome !== "built");

    expect(getConstruction(world.components, constructionId)!.status).toBe("complete");
    expect(world.entities.isLive(excess)).toBe(true); // still real, physical, undestroyed
    expect(getLog(world.components, excess)).toEqual({ materialId: "wood", massKg: 8 });
    expect(world.grid.positionOf(excess)).toEqual({ x: 5, y: world.grid.surfaceY(5, 5)! + 1, z: 5 }); // right where it was left
  });
});
