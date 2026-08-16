import { describe, expect, it } from "vitest";
import { EntityIdRegistry } from "../../src/sim/core/EntityId.js";
import { ComponentStore, defineComponent, type ComponentType } from "../../src/sim/core/ComponentStore.js";
import { SimulationClock } from "../../src/sim/core/SimulationClock.js";
import { RandomStreams } from "../../src/sim/core/Random.js";
import { WorldGrid } from "../../src/sim/world/WorldGrid.js";
import { TerrainField } from "../../src/sim/world/TerrainField.js";
import { EventLog } from "../../src/sim/history/EventLog.js";
import { MaterialRegistry } from "../../src/sim/materials/Material.js";
import { registerStandardMaterials } from "../../src/sim/materials/standardMaterials.js";
import { snapshotWorld, restoreWorld, type World, type WorldRestoreContext } from "../../src/sim/persistence/WorldSnapshot.js";

const Label = defineComponent<string>("label");

function buildWorld(): World {
  const entities = new EntityIdRegistry();
  const components = new ComponentStore(entities);
  const grid = new WorldGrid({ sizeX: 4, sizeY: 4, sizeZ: 4 }, entities);
  const materials = new MaterialRegistry();
  registerStandardMaterials(materials);
  const terrain = new TerrainField(grid, materials);
  const clock = new SimulationClock({ tickRateHz: 20 });
  const random = new RandomStreams(42);
  const events = new EventLog(entities);
  return { clock, random, entities, components, grid, terrain, events };
}

function makeContext(): WorldRestoreContext {
  const materials = new MaterialRegistry();
  registerStandardMaterials(materials);
  return {
    componentTypes: new Map<string, ComponentType<unknown>>([["label", Label]]),
    materials,
  };
}

describe("WorldSnapshot compose/restore", () => {
  it("round-trips every section of a populated world", () => {
    const world = buildWorld();
    const beaver = world.entities.create("beaver");
    world.components.set(beaver, Label, "Bucktooth");
    world.grid.setEntityPosition(beaver, 1, 1, 1);
    world.terrain.setMaterial(0, 0, 0, "stone");
    world.random.stream("test").nextUint32();
    world.clock.resume();
    world.clock.advance(0.06); // 1 tick @20Hz + 10ms leftover
    const spawned = world.events.record({ tick: 0, eventType: "spawned", subjectIds: [beaver], location: { x: 1, y: 1, z: 1 } });

    const snapshot = snapshotWorld(world);
    const restored = restoreWorld(snapshot, makeContext());

    expect(restored.entities.isLive(beaver)).toBe(true);
    expect(restored.components.get(beaver, Label)).toBe("Bucktooth");
    expect(restored.grid.positionOf(beaver)).toEqual({ x: 1, y: 1, z: 1 });
    expect(restored.terrain.materialAt(0, 0, 0)).toBe("stone");
    expect(restored.clock.tick).toBe(world.clock.tick);
    expect(restored.random.stream("test").getDebugState()).toEqual(world.random.stream("test").getDebugState());
    expect(restored.events.get(spawned).subjectIds).toEqual([beaver]);
  });

  it("survives a real JSON.stringify/JSON.parse round trip end to end", () => {
    const world = buildWorld();
    const beaver = world.entities.create("beaver");
    world.components.set(beaver, Label, "Bucktooth");
    world.terrain.setMaterial(0, 0, 0, "soil");

    const json = JSON.stringify(snapshotWorld(world));
    const restored = restoreWorld(JSON.parse(json), makeContext());

    expect(restored.components.get(beaver, Label)).toBe("Bucktooth");
    expect(restored.terrain.materialAt(0, 0, 0)).toBe("soil");
  });

  it("rejects an unsupported top-level save version", () => {
    const world = buildWorld();
    const snapshot = snapshotWorld(world);
    expect(() => restoreWorld({ ...snapshot, version: 999 }, makeContext())).toThrow(RangeError);
  });

  it("propagates a nested section's own validation error (e.g. unknown component type)", () => {
    const world = buildWorld();
    const beaver = world.entities.create("beaver");
    world.components.set(beaver, Label, "Bucktooth");
    const snapshot = snapshotWorld(world);

    expect(() => restoreWorld(snapshot, { componentTypes: new Map(), materials: makeContext().materials })).toThrow(
      RangeError,
    );
  });
});
