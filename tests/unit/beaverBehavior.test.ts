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
import { spawnBeaver, getSwimmer } from "../../src/sim/creatures/Beaver.js";
import { getNeeds, setNeeds, NEED_URGENT_THRESHOLD } from "../../src/sim/creatures/Needs.js";
import { setNeedFocus } from "../../src/sim/creatures/BeaverNeeds.js";
import { tickBeaverBehavior } from "../../src/sim/creatures/BeaverBehavior.js";
import { createDesignation } from "../../src/sim/jobs/Designation.js";
import { generateJobs, getJob } from "../../src/sim/jobs/Job.js";
import { reserveJob, currentJobOf } from "../../src/sim/jobs/JobBoard.js";

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

function giveJob(world: World, beaver: EntityId): EntityId {
  const designationId = createDesignation(world, "go-to", { x: 3, z: 3 });
  const [jobId] = generateJobs(world, designationId);
  reserveJob(world.components, world.entities, jobId!, beaver);
  return jobId!;
}

const NOT_URGENT = { hunger: 0, thirst: 0, fatigue: 0, thermalComfort: 1 };
const URGENT_FATIGUE = { hunger: 0, thirst: 0, fatigue: NEED_URGENT_THRESHOLD + 0.1, thermalComfort: 1 };

describe("tickBeaverBehavior", () => {
  it("with no job held and no urgent need, drives tickBeaverNeeds directly ('needs' outcome)", () => {
    const { world, materials, water } = buildFlatWorld();
    const id = spawnAt(world, 1, 1);
    setNeeds(world.components, id, NOT_URGENT);
    setNeedFocus(world.components, id, { current: "none" });
    const profile = getSwimmer(world.components, id)!;

    const outcome = tickBeaverBehavior(world.grid, world.terrain, water, materials, world.entities, world.components, id, profile);

    expect(outcome.kind).toBe("needs");
  });

  it("with a job held and no urgent fatigue, returns 'working' and leaves the job reservation untouched -- the caller drives the job's own tick function", () => {
    const { world, materials, water } = buildFlatWorld();
    const id = spawnAt(world, 1, 1);
    setNeeds(world.components, id, NOT_URGENT);
    setNeedFocus(world.components, id, { current: "none" });
    const profile = getSwimmer(world.components, id)!;
    const jobId = giveJob(world, id);

    const outcome = tickBeaverBehavior(world.grid, world.terrain, water, materials, world.entities, world.components, id, profile);

    expect(outcome.kind).toBe("working");
    expect(currentJobOf(world.entities, world.components, id)).toBe(jobId); // still held
    expect(getJob(world.components, jobId)!.status).toBe("reserved");
  });

  it("job work counts as real activity -- fatigue accumulates for a working beaver even though tickBeaverNeeds is never called for it", () => {
    const { world, materials, water } = buildFlatWorld();
    const id = spawnAt(world, 1, 1);
    setNeeds(world.components, id, NOT_URGENT);
    setNeedFocus(world.components, id, { current: "none" });
    const profile = getSwimmer(world.components, id)!;
    giveJob(world, id);

    tickBeaverBehavior(world.grid, world.terrain, water, materials, world.entities, world.components, id, profile);

    expect(getNeeds(world.components, id)!.fatigue).toBeGreaterThan(0);
  });

  it("REGRESSION: urgent fatigue interrupts a held job -- suspends it (requeued, reservation dropped) and drives needs/rest instead", () => {
    const { world, materials, water } = buildFlatWorld();
    const id = spawnAt(world, 1, 1);
    setNeeds(world.components, id, URGENT_FATIGUE);
    setNeedFocus(world.components, id, { current: "none" });
    const profile = getSwimmer(world.components, id)!;
    const jobId = giveJob(world, id);

    const outcome = tickBeaverBehavior(world.grid, world.terrain, water, materials, world.entities, world.components, id, profile);

    expect(outcome.kind).toBe("job-interrupted");
    if (outcome.kind === "job-interrupted") expect(outcome.needsResult.intent.kind).toBe("rest");
    expect(getJob(world.components, jobId)).toEqual({ designationId: getJob(world.components, jobId)!.designationId, target: { x: 3, z: 3 }, status: "unclaimed" });
    expect(currentJobOf(world.entities, world.components, id)).toBeUndefined(); // no longer held
  });

  it("a suspended job is immediately available for another worker", () => {
    const { world, materials, water } = buildFlatWorld();
    const exhausted = spawnAt(world, 1, 1, "Exhausted");
    const other = spawnAt(world, 5, 5, "Fresh");
    setNeeds(world.components, exhausted, URGENT_FATIGUE);
    setNeedFocus(world.components, exhausted, { current: "none" });
    const profile = getSwimmer(world.components, exhausted)!;
    const jobId = giveJob(world, exhausted);

    tickBeaverBehavior(world.grid, world.terrain, water, materials, world.entities, world.components, exhausted, profile);

    reserveJob(world.components, world.entities, jobId, other);
    expect(getJob(world.components, jobId)!.reservedBy).toBe(other);
  });

  it("with no job held, urgent fatigue just drives tickBeaverNeeds ('needs' outcome, not 'job-interrupted' -- nothing to interrupt)", () => {
    const { world, materials, water } = buildFlatWorld();
    const id = spawnAt(world, 1, 1);
    setNeeds(world.components, id, URGENT_FATIGUE);
    setNeedFocus(world.components, id, { current: "none" });
    const profile = getSwimmer(world.components, id)!;

    const outcome = tickBeaverBehavior(world.grid, world.terrain, water, materials, world.entities, world.components, id, profile);

    expect(outcome.kind).toBe("needs");
  });

  it("throws for an entity with no Needs component", () => {
    const { world, materials, water } = buildFlatWorld();
    const bogus = world.entities.create("beaver");
    const profile = { canSwim: true, maxWadingDepth: 0.5 };
    expect(() => tickBeaverBehavior(world.grid, world.terrain, water, materials, world.entities, world.components, bogus, profile)).toThrow(RangeError);
  });
});
