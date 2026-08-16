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
import type { World } from "../../src/sim/persistence/WorldSnapshot.js";
import type { NavigationProfile } from "../../src/sim/navigation/Pathfinding.js";
import { spawnBeaver } from "../../src/sim/creatures/Beaver.js";
import { createDesignation, getDesignation } from "../../src/sim/jobs/Designation.js";
import { generateJobs, getJob, setJob } from "../../src/sim/jobs/Job.js";
import {
  isJobAvailable,
  releaseStaleReservation,
  isEligible,
  selectJob,
  reserveJob,
  currentJobOf,
  tickJobForBeaver,
} from "../../src/sim/jobs/JobBoard.js";

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
  const clock = new SimulationClock({ tickRateHz: 20 });
  const random = new RandomStreams(1);
  const events = new EventLog(entities);
  const world: World = { clock, random, entities, components, grid, terrain, events };
  return { world, materials, water };
}

function spawnAt(world: World, x: number, z: number, name = "Worker") {
  const floor = world.grid.surfaceY(x, z)!;
  return spawnBeaver(world, { name, position: { x, y: floor + 1, z } });
}

/** Raises a solid, un-scalable wall across every z at column `x` -- blocks every beaver regardless of swim capability (unlike water, which a default beaver can swim across), and unlike a single-z block, leaves no side detour on a map exactly `sizeZ` wide. */
function wallOffColumn(world: World, x: number, sizeZ: number): void {
  for (let z = 0; z < sizeZ; z++) {
    for (let y = 3; y < world.grid.dims.sizeY; y++) world.terrain.setMaterial(x, y, z, "stone");
  }
}

describe("isJobAvailable / releaseStaleReservation", () => {
  it("an unclaimed job is available", () => {
    const { world } = buildFlatWorld();
    const designationId = createDesignation(world, "go-to", { x: 3, z: 3 });
    const [jobId] = generateJobs(world, designationId);
    expect(isJobAvailable(world.entities, world.components, jobId!)).toBe(true);
  });

  it("a job reserved by a live worker is NOT available", () => {
    const { world } = buildFlatWorld();
    const beaver = spawnAt(world, 0, 0);
    const designationId = createDesignation(world, "go-to", { x: 3, z: 3 });
    const [jobId] = generateJobs(world, designationId);
    reserveJob(world.components, world.entities, jobId!, beaver);
    expect(isJobAvailable(world.entities, world.components, jobId!)).toBe(false);
  });

  it("a job reserved by a now-dead worker becomes available again -- without ever touching the Designation", () => {
    const { world } = buildFlatWorld();
    const beaver = spawnAt(world, 0, 0);
    const designationId = createDesignation(world, "go-to", { x: 3, z: 3 });
    const [jobId] = generateJobs(world, designationId);
    reserveJob(world.components, world.entities, jobId!, beaver);

    world.entities.destroy(beaver);

    expect(isJobAvailable(world.entities, world.components, jobId!)).toBe(true);
    expect(getJob(world.components, jobId!)!.reservedBy).toBe(beaver); // still stale, unmutated by the read-only check
  });

  it("releaseStaleReservation rewrites a dead-worker reservation back to unclaimed, and is a no-op otherwise", () => {
    const { world } = buildFlatWorld();
    const beaver = spawnAt(world, 0, 0);
    const designationId = createDesignation(world, "go-to", { x: 3, z: 3 });
    const [jobId] = generateJobs(world, designationId);
    reserveJob(world.components, world.entities, jobId!, beaver);
    world.entities.destroy(beaver);

    expect(releaseStaleReservation(world.entities, world.components, jobId!)).toBe(true);
    expect(getJob(world.components, jobId!)).toEqual({ designationId, target: { x: 3, z: 3 }, status: "unclaimed" });
    expect(releaseStaleReservation(world.entities, world.components, jobId!)).toBe(false); // already unclaimed -- no-op
  });

  it("a completed or failed job is never available", () => {
    const { world } = buildFlatWorld();
    const designationId = createDesignation(world, "go-to", { x: 3, z: 3 });
    const [jobId] = generateJobs(world, designationId);
    setJob(world.components, jobId!, { designationId, target: { x: 3, z: 3 }, status: "completed" });
    expect(isJobAvailable(world.entities, world.components, jobId!)).toBe(false);
  });
});

describe("isEligible", () => {
  it("a live beaver is eligible for an available job", () => {
    const { world } = buildFlatWorld();
    const beaver = spawnAt(world, 0, 0);
    const designationId = createDesignation(world, "go-to", { x: 3, z: 3 });
    const [jobId] = generateJobs(world, designationId);
    expect(isEligible(world.entities, world.components, beaver, jobId!)).toBe(true);
  });

  it("a non-beaver entity is never eligible", () => {
    const { world } = buildFlatWorld();
    const tree = world.entities.create("tree");
    const designationId = createDesignation(world, "go-to", { x: 3, z: 3 });
    const [jobId] = generateJobs(world, designationId);
    expect(isEligible(world.entities, world.components, tree, jobId!)).toBe(false);
  });

  it("a dead beaver is never eligible", () => {
    const { world } = buildFlatWorld();
    const beaver = spawnAt(world, 0, 0);
    world.entities.destroy(beaver);
    const designationId = createDesignation(world, "go-to", { x: 3, z: 3 });
    const [jobId] = generateJobs(world, designationId);
    expect(isEligible(world.entities, world.components, beaver, jobId!)).toBe(false);
  });

  it("a beaver is not eligible for an already-reserved (live worker) job", () => {
    const { world } = buildFlatWorld();
    const holder = spawnAt(world, 0, 0);
    const other = spawnAt(world, 1, 0);
    const designationId = createDesignation(world, "go-to", { x: 3, z: 3 });
    const [jobId] = generateJobs(world, designationId);
    reserveJob(world.components, world.entities, jobId!, holder);
    expect(isEligible(world.entities, world.components, other, jobId!)).toBe(false);
  });
});

describe("selectJob", () => {
  it("picks the nearest available job to the beaver's current position", () => {
    const { world, materials, water } = buildFlatWorld();
    const beaver = spawnAt(world, 5, 5);
    const near = generateJobs(world, createDesignation(world, "go-to", { x: 6, z: 5 }))[0]!;
    const far = generateJobs(world, createDesignation(world, "go-to", { x: 11, z: 11 }))[0]!;
    expect(selectJob(world.entities, world.components, world.grid, world.terrain, water, materials, PROFILE, beaver, [far, near])).toBe(
      near,
    );
  });

  it("excludes unavailable jobs from consideration", () => {
    const { world, materials, water } = buildFlatWorld();
    const beaver = spawnAt(world, 5, 5);
    const holder = spawnAt(world, 6, 5);
    const near = generateJobs(world, createDesignation(world, "go-to", { x: 6, z: 5 }))[0]!;
    const far = generateJobs(world, createDesignation(world, "go-to", { x: 9, z: 5 }))[0]!;
    reserveJob(world.components, world.entities, near, holder); // taken
    expect(selectJob(world.entities, world.components, world.grid, world.terrain, water, materials, PROFILE, beaver, [near, far])).toBe(
      far,
    );
  });

  it("returns undefined when no candidates are available", () => {
    const { world, materials, water } = buildFlatWorld();
    const beaver = spawnAt(world, 5, 5);
    expect(selectJob(world.entities, world.components, world.grid, world.terrain, water, materials, PROFILE, beaver, [])).toBeUndefined();
  });

  it("breaks exact-distance ties by lowest job EntityId, deterministically", () => {
    const { world, materials, water } = buildFlatWorld();
    const beaver = spawnAt(world, 5, 5);
    const a = generateJobs(world, createDesignation(world, "go-to", { x: 6, z: 5 }))[0]!;
    const b = generateJobs(world, createDesignation(world, "go-to", { x: 4, z: 5 }))[0]!; // same distance from (5,5)
    const winner = a < b ? a : b;
    expect(selectJob(world.entities, world.components, world.grid, world.terrain, water, materials, PROFILE, beaver, [a, b])).toBe(
      winner,
    );
    expect(selectJob(world.entities, world.components, world.grid, world.terrain, water, materials, PROFILE, beaver, [b, a])).toBe(
      winner,
    ); // order-independent
  });

  it("REGRESSION: excludes an unreachable-but-nearer job in favor of a reachable-but-farther one, rather than picking the unreachable one", () => {
    const { world, materials, water } = buildFlatWorld(10, 8, 10, 2);
    wallOffColumn(world, 3, 10); // beaver's whole side is x < 3
    const beaver = spawnAt(world, 0, 0);
    const unreachableNear = generateJobs(world, createDesignation(world, "go-to", { x: 3, z: 0 }))[0]!; // beyond the wall
    const reachableFar = generateJobs(world, createDesignation(world, "go-to", { x: 2, z: 9 }))[0]!; // farther by raw distance, but reachable

    const chosen = selectJob(world.entities, world.components, world.grid, world.terrain, water, materials, PROFILE, beaver, [
      unreachableNear,
      reachableFar,
    ]);

    expect(chosen).toBe(reachableFar);
  });
});

describe("currentJobOf", () => {
  it("finds the job a beaver holds, ignoring jobs held by other beavers or already concluded", () => {
    const { world } = buildFlatWorld();
    const mine = spawnAt(world, 0, 0);
    const theirs = spawnAt(world, 1, 0);
    const myJob = generateJobs(world, createDesignation(world, "go-to", { x: 3, z: 3 }))[0]!;
    const theirJob = generateJobs(world, createDesignation(world, "go-to", { x: 4, z: 4 }))[0]!;
    const doneJob = generateJobs(world, createDesignation(world, "go-to", { x: 5, z: 5 }))[0]!;
    reserveJob(world.components, world.entities, myJob, mine);
    reserveJob(world.components, world.entities, theirJob, theirs);
    const doneJobData = getJob(world.components, doneJob)!;
    setJob(world.components, doneJob, { ...doneJobData, status: "completed", reservedBy: mine });

    expect(currentJobOf(world.entities, world.components, mine)).toBe(myJob);
  });

  it("returns undefined when the beaver holds nothing", () => {
    const { world } = buildFlatWorld();
    const beaver = spawnAt(world, 0, 0);
    expect(currentJobOf(world.entities, world.components, beaver)).toBeUndefined();
  });
});

describe("reserveJob", () => {
  it("throws when the job is not actually available", () => {
    const { world } = buildFlatWorld();
    const a = spawnAt(world, 0, 0);
    const b = spawnAt(world, 1, 0);
    const [jobId] = generateJobs(world, createDesignation(world, "go-to", { x: 3, z: 3 }));
    reserveJob(world.components, world.entities, jobId!, a);
    expect(() => reserveJob(world.components, world.entities, jobId!, b)).toThrow(RangeError);
  });
});

describe("tickJobForBeaver", () => {
  it("returns 'idle' and does nothing when there are no candidate jobs", () => {
    const { world, materials, water } = buildFlatWorld();
    const beaver = spawnAt(world, 0, 0);
    const before = world.grid.positionOf(beaver);
    const outcome = tickJobForBeaver(world.grid, world.terrain, water, materials, world.entities, world.components, beaver, PROFILE, []);
    expect(outcome).toBe("idle");
    expect(world.grid.positionOf(beaver)).toEqual(before);
  });

  it("assigns a fresh job and takes a real step toward it", () => {
    const { world, materials, water } = buildFlatWorld();
    const beaver = spawnAt(world, 0, 0);
    const [jobId] = generateJobs(world, createDesignation(world, "go-to", { x: 6, z: 0 }));
    const before = world.grid.positionOf(beaver);

    const outcome = tickJobForBeaver(world.grid, world.terrain, water, materials, world.entities, world.components, beaver, PROFILE, [
      jobId!,
    ]);

    expect(outcome).toBe("assigned");
    expect(world.grid.positionOf(beaver)).not.toEqual(before);
    expect(getJob(world.components, jobId!)!.status).toBe("in-progress");
    expect(getJob(world.components, jobId!)!.reservedBy).toBe(beaver);
  });

  it("continues an already-held job across multiple ticks until arrival, then completes the job AND its designation", () => {
    const { world, materials, water } = buildFlatWorld();
    const beaver = spawnAt(world, 0, 0);
    const designationId = createDesignation(world, "go-to", { x: 3, z: 0 });
    const [jobId] = generateJobs(world, designationId);

    let outcome;
    let iterations = 0;
    do {
      outcome = tickJobForBeaver(world.grid, world.terrain, water, materials, world.entities, world.components, beaver, PROFILE, [
        jobId!,
      ]);
      iterations++;
      expect(iterations).toBeLessThan(20);
    } while (outcome === "assigned" || outcome === "progressed");

    expect(outcome).toBe("arrived");
    expect(getJob(world.components, jobId!)!.status).toBe("completed");
    expect(getDesignationStatus(world, designationId)).toBe("completed");
  });

  it("REGRESSION (literal acceptance scenario): deleting the assigned worker does not delete the designation, and another eligible beaver takes over the SAME job", () => {
    const { world, materials, water } = buildFlatWorld();
    const first = spawnAt(world, 0, 0, "First");
    const second = spawnAt(world, 0, 1, "Second");
    const designationId = createDesignation(world, "go-to", { x: 8, z: 0 });
    const [jobId] = generateJobs(world, designationId);

    // First beaver claims and starts working the job.
    const firstOutcome = tickJobForBeaver(world.grid, world.terrain, water, materials, world.entities, world.components, first, PROFILE, [
      jobId!,
    ]);
    expect(firstOutcome).toBe("assigned");
    expect(getJob(world.components, jobId!)!.reservedBy).toBe(first);

    // The assigned worker is deleted.
    world.entities.destroy(first);

    // The order survives.
    expect(world.entities.isLive(designationId)).toBe(true);
    expect(getDesignationStatus(world, designationId)).toBe("active");

    // The second beaver picks up the SAME job entity -- not a new one.
    const secondOutcome = tickJobForBeaver(
      world.grid,
      world.terrain,
      water,
      materials,
      world.entities,
      world.components,
      second,
      PROFILE,
      [jobId!],
    );
    expect(secondOutcome).toBe("assigned");
    expect(getJob(world.components, jobId!)!.reservedBy).toBe(second);

    // It can actually finish the job.
    let outcome = secondOutcome;
    let iterations = 0;
    while (outcome === "assigned" || outcome === "progressed") {
      outcome = tickJobForBeaver(world.grid, world.terrain, water, materials, world.entities, world.components, second, PROFILE, [
        jobId!,
      ]);
      iterations++;
      expect(iterations).toBeLessThan(20);
    }
    expect(outcome).toBe("arrived");
    expect(getDesignationStatus(world, designationId)).toBe("completed");
  });

  it("a designation with multiple jobs only completes once EVERY job referencing it is completed", () => {
    const { world, materials, water } = buildFlatWorld();
    const a = spawnAt(world, 0, 0, "A");
    const b = spawnAt(world, 9, 0, "B");
    const designationId = createDesignation(world, "go-to", { x: 4, z: 0 }); // target unused by this synthetic multi-job scenario
    const jobOne = generateJobs(world, designationId)[0]!; // reuse generateJobs' own single job as "job one"
    // A second job manually attached to the SAME designation, simulating what a future multi-unit labor type's generateJobs would produce.
    const jobTwo = world.entities.create("job");
    setJob(world.components, jobTwo, { designationId, target: { x: 9, z: 3 }, status: "unclaimed" });

    let outcomeA: string;
    let iterations = 0;
    do {
      outcomeA = tickJobForBeaver(world.grid, world.terrain, water, materials, world.entities, world.components, a, PROFILE, [jobOne]);
      iterations++;
      expect(iterations).toBeLessThan(20);
    } while (outcomeA === "assigned" || outcomeA === "progressed");
    expect(outcomeA).toBe("arrived");
    expect(getJob(world.components, jobOne)!.status).toBe("completed");
    // jobTwo is still open -- the designation must NOT read completed yet.
    expect(getDesignationStatus(world, designationId)).toBe("active");

    let outcomeB: string;
    iterations = 0;
    do {
      outcomeB = tickJobForBeaver(world.grid, world.terrain, water, materials, world.entities, world.components, b, PROFILE, [jobTwo]);
      iterations++;
      expect(iterations).toBeLessThan(20);
    } while (outcomeB === "assigned" || outcomeB === "progressed");
    expect(outcomeB).toBe("arrived");
    // NOW every job referencing the designation is done.
    expect(getDesignationStatus(world, designationId)).toBe("completed");
  });

  it("requeues (back to unclaimed) rather than permanently failing when an already-in-progress job's route becomes blocked mid-journey", () => {
    const { world, materials, water } = buildFlatWorld(8, 8, 3, 2);
    const beaver = spawnAt(world, 0, 0);
    const [jobId] = generateJobs(world, createDesignation(world, "go-to", { x: 6, z: 0 }));

    // Reachable at reservation time -- selectJob's reachability check
    // passes, and the beaver genuinely starts moving.
    const first = tickJobForBeaver(world.grid, world.terrain, water, materials, world.entities, world.components, beaver, PROFILE, [
      jobId!,
    ]);
    expect(first).toBe("assigned");
    expect(getJob(world.components, jobId!)!.status).toBe("in-progress");

    // The route is blocked AFTER reservation, while the job is already
    // held (not freshly selected) -- this is the scenario
    // `tickJobForBeaver`'s own "unreachable" branch exists for.
    wallOffColumn(world, 3, 3);

    const second = tickJobForBeaver(world.grid, world.terrain, water, materials, world.entities, world.components, beaver, PROFILE, [
      jobId!,
    ]);

    expect(second).toBe("requeued");
    expect(getJob(world.components, jobId!)).toEqual({
      designationId: getJob(world.components, jobId!)!.designationId,
      target: { x: 6, z: 0 },
      status: "unclaimed",
    });
  });

  it("two beavers never both claim the same job in the same round of ticks", () => {
    const { world, materials, water } = buildFlatWorld();
    const a = spawnAt(world, 0, 0, "A");
    const b = spawnAt(world, 1, 0, "B");
    const [jobId] = generateJobs(world, createDesignation(world, "go-to", { x: 9, z: 9 }));

    const outcomeA = tickJobForBeaver(world.grid, world.terrain, water, materials, world.entities, world.components, a, PROFILE, [
      jobId!,
    ]);
    const outcomeB = tickJobForBeaver(world.grid, world.terrain, water, materials, world.entities, world.components, b, PROFILE, [
      jobId!,
    ]);

    expect(outcomeA).toBe("assigned");
    expect(outcomeB).toBe("idle"); // job was already taken by A by the time B looked
    expect(getJob(world.components, jobId!)!.reservedBy).toBe(a);
  });

  it("REGRESSION: with an unreachable job and a reachable job both candidates, a beaver completes the reachable one instead of looping forever on the unreachable one", () => {
    const { world, materials, water } = buildFlatWorld(10, 8, 10, 2);
    wallOffColumn(world, 3, 10);
    const beaver = spawnAt(world, 0, 0);
    const unreachable = generateJobs(world, createDesignation(world, "go-to", { x: 3, z: 0 }))[0]!; // beyond the wall, nearer by raw distance
    const reachable = generateJobs(world, createDesignation(world, "go-to", { x: 2, z: 5 }))[0]!; // reachable, farther

    let outcome: string;
    let iterations = 0;
    do {
      outcome = tickJobForBeaver(world.grid, world.terrain, water, materials, world.entities, world.components, beaver, PROFILE, [
        unreachable,
        reachable,
      ]);
      iterations++;
      expect(iterations).toBeLessThan(30); // would never terminate under the pre-fix behavior
    } while (outcome === "assigned" || outcome === "progressed" || outcome === "idle");

    expect(outcome).toBe("arrived");
    expect(getJob(world.components, reachable)!.status).toBe("completed");
    expect(getJob(world.components, unreachable)!.status).toBe("unclaimed"); // never touched -- excluded outright, not reserved-then-failed
  });
});

function getDesignationStatus(world: World, designationId: EntityId): string {
  return getDesignation(world.components, designationId)!.status;
}
