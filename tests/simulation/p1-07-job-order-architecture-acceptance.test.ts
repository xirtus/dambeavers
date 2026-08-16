/**
 * Headless acceptance test for P1-07 — Job/order architecture.
 *
 * Roadmap acceptance test (DAMN_BEAVERS_MASTER_ROADMAP.md, P1-07):
 *   "deleting the currently assigned worker does not delete the
 *   underlying player order; another eligible beaver can take it."
 *
 * Exercises the full pipeline AGENTS.md Law 1.5 / ARCHITECTURE_CONTRACT
 * §10 describe: player designation (`createDesignation`) -> available
 * work / job instance (`generateJobs`) -> eligibility -> job selection
 * (`selectJob`) -> reservation (`reserveJob`) -> navigation/execution
 * (`advanceTowards`, P1-05, via `tickJobForBeaver`) -> completion. The
 * "go-to" designation kind is deliberately the most minimal generic
 * labor this task can demonstrate the pipeline with -- P1-08/P1-09/P1-10
 * (tree cutting, hauling, construction) each add their own designation
 * kind later, not here (AGENTS.md Law 10); nothing about the pipeline
 * stages themselves is specific to "go-to."
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
import type { World } from "../../src/sim/persistence/WorldSnapshot.js";
import type { NavigationProfile } from "../../src/sim/navigation/Pathfinding.js";
import { spawnBeaver } from "../../src/sim/creatures/Beaver.js";
import { createDesignation, getDesignation } from "../../src/sim/jobs/Designation.js";
import { generateJobs, getJob } from "../../src/sim/jobs/Job.js";
import { tickJobForBeaver } from "../../src/sim/jobs/JobBoard.js";

const SIZE_X = 20;
const SIZE_Y = 8;
const SIZE_Z = 8;
const TARGET = { x: 16, z: 4 };
const PROFILE: NavigationProfile = { canSwim: true, maxWadingDepth: 0.4 };

function buildWorld(): { world: World; materials: MaterialRegistry; water: WaterField } {
  const entities = new EntityIdRegistry();
  const components = new ComponentStore(entities);
  const grid = new WorldGrid({ sizeX: SIZE_X, sizeY: SIZE_Y, sizeZ: SIZE_Z }, entities);
  const materials = new MaterialRegistry();
  registerStandardMaterials(materials);
  const terrain = new TerrainField(grid, materials);
  for (let x = 0; x < SIZE_X; x++) {
    for (let z = 0; z < SIZE_Z; z++) {
      for (let y = 0; y <= 2; y++) terrain.setMaterial(x, y, z, "soil");
    }
  }
  const water = new WaterField(grid);
  const clock = new SimulationClock({ tickRateHz: 20 });
  const random = new RandomStreams("p1-07-jobs");
  const events = new EventLog(entities);
  const world: World = { clock, random, entities, components, grid, terrain, events };
  return { world, materials, water };
}

function spawnAt(world: World, x: number, z: number, name: string) {
  const floor = world.grid.surfaceY(x, z)!;
  return spawnBeaver(world, { name, position: { x, y: floor + 1, z } });
}

describe("P1-07 acceptance: deleting the assigned worker does not delete the order; another eligible beaver takes it", () => {
  it("a player designation survives its assigned worker's death, and a second beaver completes the SAME job", () => {
    const { world, materials, water } = buildWorld();
    const first = spawnAt(world, 0, 0, "Gnaw");
    const second = spawnAt(world, 0, 7, "Chisel");

    // Player designates work: "go to this location."
    const designationId = createDesignation(world, "go-to", TARGET);
    const jobIds = generateJobs(world, designationId);
    expect(jobIds).toHaveLength(1);
    const jobId = jobIds[0]!;

    // Run ticks until SOMEONE is assigned -- not scripted to be `first`,
    // just whichever beaver the real eligibility/selection pipeline picks
    // first (both are candidates every tick).
    let assignedWorker: EntityId | undefined;
    for (let tick = 0; tick < 5 && assignedWorker === undefined; tick++) {
      world.clock.resume();
      world.clock.advanceTicks(1);
      for (const beaver of [first, second]) {
        tickJobForBeaver(world.grid, world.terrain, water, materials, world.entities, world.components, beaver, PROFILE, [jobId]);
      }
      const reservedBy = getJob(world.components, jobId)!.reservedBy;
      if (reservedBy !== undefined) assignedWorker = reservedBy;
    }
    expect(assignedWorker).toBeDefined();
    const survivor = assignedWorker === first ? second : first;

    // Let the assigned worker make some real, partial progress first --
    // this isn't deleted the instant it's claimed.
    for (let tick = 0; tick < 3; tick++) {
      tickJobForBeaver(world.grid, world.terrain, water, materials, world.entities, world.components, assignedWorker!, PROFILE, [jobId]);
    }
    expect(getJob(world.components, jobId)!.status).toBe("in-progress");

    // Delete the currently assigned worker.
    world.entities.destroy(assignedWorker!);

    // The underlying player order is NOT deleted.
    expect(world.entities.isLive(designationId)).toBe(true);
    expect(getDesignation(world.components, designationId)!.status).toBe("active");
    expect(world.entities.isLive(jobId)).toBe(true);

    // The other eligible beaver can take it over -- the SAME job entity,
    // not a freshly re-generated one (the designation was never touched,
    // so there was nothing to regenerate from).
    let iterations = 0;
    let outcome: string;
    do {
      outcome = tickJobForBeaver(world.grid, world.terrain, water, materials, world.entities, world.components, survivor, PROFILE, [
        jobId,
      ]);
      iterations++;
      expect(iterations).toBeLessThan(60);
    } while (outcome === "assigned" || outcome === "progressed");

    expect(outcome).toBe("arrived");
    expect(getJob(world.components, jobId)!.reservedBy).toBe(survivor);
    expect(getJob(world.components, jobId)!.status).toBe("completed");
    expect(getDesignation(world.components, designationId)!.status).toBe("completed");

    const finalPosition = world.grid.positionOf(survivor)!;
    expect({ x: finalPosition.x, z: finalPosition.z }).toEqual(TARGET);
  });

  it("distinct simultaneous designations are each independently claimed and completed by distinct beavers", () => {
    const { world, materials, water } = buildWorld();
    const a = spawnAt(world, 0, 0, "A");
    const b = spawnAt(world, 0, 7, "B");

    const jobA = generateJobs(world, createDesignation(world, "go-to", { x: 5, z: 0 }))[0]!;
    const jobB = generateJobs(world, createDesignation(world, "go-to", { x: 5, z: 7 }))[0]!;

    for (let tick = 0; tick < 20; tick++) {
      for (const beaver of [a, b]) {
        const outcome = tickJobForBeaver(world.grid, world.terrain, water, materials, world.entities, world.components, beaver, PROFILE, [
          jobA,
          jobB,
        ]);
        void outcome;
      }
    }

    expect(getJob(world.components, jobA)!.status).toBe("completed");
    expect(getJob(world.components, jobB)!.status).toBe("completed");
    // Each beaver took the job nearer to its own start, not a coin flip.
    expect(getJob(world.components, jobA)!.reservedBy).toBe(a);
    expect(getJob(world.components, jobB)!.reservedBy).toBe(b);
  });
});
