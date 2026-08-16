import { describe, expect, it } from "vitest";
import { EntityIdRegistry } from "../../src/sim/core/EntityId.js";
import { ComponentStore } from "../../src/sim/core/ComponentStore.js";
import { SimulationClock } from "../../src/sim/core/SimulationClock.js";
import { RandomStreams } from "../../src/sim/core/Random.js";
import { WorldGrid } from "../../src/sim/world/WorldGrid.js";
import { TerrainField } from "../../src/sim/world/TerrainField.js";
import { EventLog } from "../../src/sim/history/EventLog.js";
import { MaterialRegistry } from "../../src/sim/materials/Material.js";
import { registerStandardMaterials } from "../../src/sim/materials/standardMaterials.js";
import type { World } from "../../src/sim/persistence/WorldSnapshot.js";
import { setDesignation, getDesignation, createDesignation } from "../../src/sim/jobs/Designation.js";

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
  return { clock, random, entities, components, grid, terrain, events };
}

describe("Designation component", () => {
  it("round-trips a valid designation", () => {
    const world = buildWorld();
    const id = world.entities.create("designation");
    setDesignation(world.components, id, { kind: "go-to", target: { x: 3, z: 4 }, status: "active" });
    expect(getDesignation(world.components, id)).toEqual({ kind: "go-to", target: { x: 3, z: 4 }, status: "active" });
  });

  it("rejects an empty kind", () => {
    const world = buildWorld();
    const id = world.entities.create("designation");
    expect(() => setDesignation(world.components, id, { kind: "", target: { x: 0, z: 0 }, status: "active" })).toThrow(
      RangeError,
    );
  });

  it("rejects non-integer target coordinates", () => {
    const world = buildWorld();
    const id = world.entities.create("designation");
    expect(() =>
      setDesignation(world.components, id, { kind: "go-to", target: { x: 1.5, z: 0 }, status: "active" }),
    ).toThrow(RangeError);
  });

  it("rejects an invalid status", () => {
    const world = buildWorld();
    const id = world.entities.create("designation");
    expect(() =>
      setDesignation(world.components, id, { kind: "go-to", target: { x: 0, z: 0 }, status: "bogus" as never }),
    ).toThrow(RangeError);
  });
});

describe("createDesignation", () => {
  it("creates a live designation entity with the given kind/target, starting active", () => {
    const world = buildWorld();
    const id = createDesignation(world, "go-to", { x: 5, z: 6 });
    expect(world.entities.kindOf(id)).toBe("designation");
    expect(world.entities.isLive(id)).toBe(true);
    expect(getDesignation(world.components, id)).toEqual({ kind: "go-to", target: { x: 5, z: 6 }, status: "active" });
  });

  it("outlives an unrelated entity's destruction -- a designation is never implicitly deleted", () => {
    const world = buildWorld();
    const id = createDesignation(world, "go-to", { x: 1, z: 1 });
    const decoy = world.entities.create("beaver");
    world.entities.destroy(decoy);
    expect(world.entities.isLive(id)).toBe(true);
    expect(getDesignation(world.components, id)!.status).toBe("active");
  });
});
