import { describe, expect, it } from "vitest";
import { EntityIdRegistry } from "../../src/sim/core/EntityId.js";
import { ComponentStore } from "../../src/sim/core/ComponentStore.js";
import { SimulationClock } from "../../src/sim/core/SimulationClock.js";
import { RandomStreams } from "../../src/sim/core/Random.js";
import { WorldGrid } from "../../src/sim/world/WorldGrid.js";
import { TerrainField } from "../../src/sim/world/TerrainField.js";
import { EventLog } from "../../src/sim/history/EventLog.js";
import { WaterField } from "../../src/sim/hydrology/WaterField.js";
import { Weather } from "../../src/sim/weather/Weather.js";
import { MaterialRegistry } from "../../src/sim/materials/Material.js";
import { registerStandardMaterials } from "../../src/sim/materials/standardMaterials.js";
import type { World } from "../../src/sim/persistence/WorldSnapshot.js";
import { createDesignation } from "../../src/sim/jobs/Designation.js";
import { setJob, getJob, generateJobs } from "../../src/sim/jobs/Job.js";

function buildWorld(): World {
  const entities = new EntityIdRegistry();
  const components = new ComponentStore(entities);
  const grid = new WorldGrid({ sizeX: 8, sizeY: 8, sizeZ: 8 }, entities);
  const materials = new MaterialRegistry();
  registerStandardMaterials(materials);
  const terrain = new TerrainField(grid, materials);
  const clock = new SimulationClock({ tickRateHz: 20 });
  const random = new RandomStreams(1);
  const events = new EventLog(entities);
  const water = new WaterField(grid);
  const weather = new Weather();
  return { clock, random, entities, components, grid, terrain, events, water, weather };
}

describe("Job component", () => {
  it("round-trips a valid unclaimed job (reservedBy omitted)", () => {
    const world = buildWorld();
    const designationId = createDesignation(world, "go-to", { x: 1, z: 1 });
    const id = world.entities.create("job");
    setJob(world.components, id, { designationId, target: { x: 1, z: 1 }, status: "unclaimed" });
    expect(getJob(world.components, id)).toEqual({ designationId, target: { x: 1, z: 1 }, status: "unclaimed" });
    expect(getJob(world.components, id)!.reservedBy).toBeUndefined();
  });

  it("round-trips a reserved job with reservedBy set", () => {
    const world = buildWorld();
    const designationId = createDesignation(world, "go-to", { x: 1, z: 1 });
    const beaver = world.entities.create("beaver");
    const id = world.entities.create("job");
    setJob(world.components, id, { designationId, target: { x: 1, z: 1 }, status: "reserved", reservedBy: beaver });
    expect(getJob(world.components, id)).toEqual({ designationId, target: { x: 1, z: 1 }, status: "reserved", reservedBy: beaver });
  });

  it("rejects a non-positive designationId", () => {
    const world = buildWorld();
    const id = world.entities.create("job");
    expect(() => setJob(world.components, id, { designationId: 0 as never, target: { x: 0, z: 0 }, status: "unclaimed" })).toThrow(
      RangeError,
    );
  });

  it("rejects non-integer target coordinates", () => {
    const world = buildWorld();
    const designationId = createDesignation(world, "go-to", { x: 1, z: 1 });
    const id = world.entities.create("job");
    expect(() => setJob(world.components, id, { designationId, target: { x: 0.5, z: 0 }, status: "unclaimed" })).toThrow(
      RangeError,
    );
  });

  it("rejects an invalid status", () => {
    const world = buildWorld();
    const designationId = createDesignation(world, "go-to", { x: 1, z: 1 });
    const id = world.entities.create("job");
    expect(() =>
      setJob(world.components, id, { designationId, target: { x: 0, z: 0 }, status: "bogus" as never }),
    ).toThrow(RangeError);
  });

  it("rejects a non-positive reservedBy when present", () => {
    const world = buildWorld();
    const designationId = createDesignation(world, "go-to", { x: 1, z: 1 });
    const id = world.entities.create("job");
    expect(() =>
      setJob(world.components, id, { designationId, target: { x: 0, z: 0 }, status: "reserved", reservedBy: 0 as never }),
    ).toThrow(RangeError);
  });
});

describe("generateJobs", () => {
  it("expands a 'go-to' designation into exactly one unclaimed job targeting the same location", () => {
    const world = buildWorld();
    const designationId = createDesignation(world, "go-to", { x: 7, z: 2 });

    const jobIds = generateJobs(world, designationId);

    expect(jobIds).toHaveLength(1);
    expect(world.entities.kindOf(jobIds[0]!)).toBe("job");
    expect(getJob(world.components, jobIds[0]!)).toEqual({
      designationId,
      target: { x: 7, z: 2 },
      status: "unclaimed",
    });
  });

  it("throws for a designationId with no Designation component", () => {
    const world = buildWorld();
    const notADesignation = world.entities.create("beaver");
    expect(() => generateJobs(world, notADesignation)).toThrow(RangeError);
  });
});
