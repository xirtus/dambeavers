import { describe, expect, it } from "vitest";
import { EntityIdRegistry } from "../../src/sim/core/EntityId.js";
import { ComponentStore, defineComponent } from "../../src/sim/core/ComponentStore.js";
import { WorldGrid } from "../../src/sim/world/WorldGrid.js";
import { TerrainField } from "../../src/sim/world/TerrainField.js";
import { EventLog } from "../../src/sim/history/EventLog.js";
import { SimulationClock } from "../../src/sim/core/SimulationClock.js";
import { RandomStreams } from "../../src/sim/core/Random.js";
import { MaterialRegistry } from "../../src/sim/materials/Material.js";
import { registerStandardMaterials } from "../../src/sim/materials/standardMaterials.js";
import { inspectEntity, inspectCell, inspectWorld } from "../../src/sim/debug/DebugInspector.js";
import type { World } from "../../src/sim/persistence/WorldSnapshot.js";

const Label = defineComponent<string>("label");

function buildWorld(): World {
  const entities = new EntityIdRegistry();
  const components = new ComponentStore(entities);
  const grid = new WorldGrid({ sizeX: 4, sizeY: 4, sizeZ: 4 }, entities);
  const materials = new MaterialRegistry();
  registerStandardMaterials(materials);
  const terrain = new TerrainField(grid, materials);
  const events = new EventLog(entities);
  const clock = new SimulationClock();
  const random = new RandomStreams(1);
  return { clock, random, entities, components, grid, terrain, events };
}

describe("inspectEntity", () => {
  it("reports kind, liveness, position, components, and events for a live entity", () => {
    const world = buildWorld();
    const beaver = world.entities.create("beaver");
    world.grid.setEntityPosition(beaver, 1, 2, 3);
    world.components.set(beaver, Label, "Bucktooth");
    const spawned = world.events.record({ tick: 0, eventType: "spawned", subjectIds: [beaver], location: { x: 1, y: 2, z: 3 } });

    const inspection = inspectEntity(world, beaver);

    expect(inspection.id).toBe(beaver);
    expect(inspection.kind).toBe("beaver");
    expect(inspection.live).toBe(true);
    expect(inspection.position).toEqual({ x: 1, y: 2, z: 3 });
    expect(inspection.components).toEqual([{ type: "label", value: "Bucktooth" }]);
    expect(inspection.events.map((e) => e.id)).toEqual([spawned]);
  });

  it("reports position as undefined for an entity never placed in the grid", () => {
    const world = buildWorld();
    const item = world.entities.create("log");
    expect(inspectEntity(world, item).position).toBeUndefined();
  });

  it("reports an empty components list for an entity with none", () => {
    const world = buildWorld();
    const tree = world.entities.create("tree");
    expect(inspectEntity(world, tree).components).toEqual([]);
  });

  it("reports an empty events list for an entity involved in no event", () => {
    const world = buildWorld();
    const tree = world.entities.create("tree");
    expect(inspectEntity(world, tree).events).toEqual([]);
  });

  it("still reports raw state for a destroyed entity -- live: false, not an error", () => {
    const world = buildWorld();
    const beaver = world.entities.create("beaver");
    world.entities.destroy(beaver);
    const inspection = inspectEntity(world, beaver);
    expect(inspection.live).toBe(false);
    expect(inspection.kind).toBe("beaver");
  });

  it("throws for an id never allocated in this world", () => {
    const world = buildWorld();
    expect(() => inspectEntity(world, 999 as unknown as ReturnType<typeof world.entities.create>)).toThrow(
      RangeError,
    );
  });

  it("multiple attached components all appear, sorted by type name", () => {
    const world = buildWorld();
    const Health = defineComponent<number>("health");
    const beaver = world.entities.create("beaver");
    world.components.set(beaver, Health, 100);
    world.components.set(beaver, Label, "Bucktooth");

    expect(inspectEntity(world, beaver).components.map((c) => c.type)).toEqual(["health", "label"]);
  });

  it("sorts by type name even when attached in reverse-alphabetical order (actually exercises the sort, not incidental Map order)", () => {
    const world = buildWorld();
    const Zebra = defineComponent<number>("zebra");
    const Alpha = defineComponent<number>("alpha");
    const beaver = world.entities.create("beaver");
    world.components.set(beaver, Zebra, 1); // attached first
    world.components.set(beaver, Alpha, 2); // attached second

    expect(inspectEntity(world, beaver).components.map((c) => c.type)).toEqual(["alpha", "zebra"]);
  });

  it("does not return a live alias into ComponentStore -- mutating the inspection cannot corrupt authoritative state", () => {
    const world = buildWorld();
    const Inventory = defineComponent<number[]>("inventory");
    const beaver = world.entities.create("beaver");
    world.components.set(beaver, Inventory, [1, 2, 3]);

    const inspection = inspectEntity(world, beaver);
    (inspection.components[0]!.value as number[]).push(999);

    expect(world.components.get(beaver, Inventory)).toEqual([1, 2, 3]); // untouched by the mutation above
  });

  it("does not return a live alias into EventLog -- mutating an inspected event cannot rewrite recorded history", () => {
    const world = buildWorld();
    const beaver = world.entities.create("beaver");
    const eventId = world.events.record({ tick: 0, eventType: "spawned", subjectIds: [beaver], location: { x: 0, y: 0, z: 0 } });

    const inspection = inspectEntity(world, beaver);
    const mutableSubjectIds = inspection.events[0]!.subjectIds as unknown as number[];
    mutableSubjectIds.push(999);

    expect(world.events.get(eventId).subjectIds).toEqual([beaver]); // untouched by the mutation above
  });
});

describe("inspectCell", () => {
  it("reports solidity, material, and occupants for a cell", () => {
    const world = buildWorld();
    world.terrain.setMaterial(1, 1, 1, "stone");
    const beaver = world.entities.create("beaver");
    world.grid.setEntityPosition(beaver, 1, 1, 1);

    const cell = inspectCell(world, 1, 1, 1);
    expect(cell).toEqual({
      cell: { x: 1, y: 1, z: 1 },
      solid: true,
      material: "stone",
      entityIds: [beaver],
    });
  });

  it("reports an empty, non-solid cell honestly", () => {
    const world = buildWorld();
    const cell = inspectCell(world, 0, 0, 0);
    expect(cell.solid).toBe(false);
    expect(cell.material).toBeUndefined();
    expect(cell.entityIds).toEqual([]);
  });
});

describe("inspectWorld", () => {
  it("aggregates every subsystem's own debug state", () => {
    const world = buildWorld();
    world.entities.create("beaver");
    world.terrain.setMaterial(0, 0, 0, "soil");
    world.events.record({ tick: 0, eventType: "x", location: { x: 0, y: 0, z: 0 } });

    const summary = inspectWorld(world);
    expect(summary.entities).toEqual(world.entities.getDebugState());
    expect(summary.components).toEqual(world.components.getDebugState());
    expect(summary.grid).toEqual(world.grid.getDebugState());
    expect(summary.terrain).toEqual(world.terrain.getDebugState());
    expect(summary.events).toEqual(world.events.getDebugState());
    expect(summary.clock).toEqual(world.clock.getDebugState());
    expect(summary.random).toEqual(world.random.getDebugState());
  });
});
