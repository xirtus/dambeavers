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
import { restoreWorld, snapshotWorld } from "../../src/sim/persistence/WorldSnapshot.js";
import { ALL_COMPONENT_TYPES } from "../../src/sim/persistence/AllComponentTypes.js";
import { spawnBeaver, getInventory } from "../../src/sim/creatures/Beaver.js";
import { getHeld, pickUp, drop } from "../../src/sim/labor/Log.js";
import {
  createTool,
  getRequiredTool,
  getTool,
  hasHeldToolKindForLabor,
  hasRequiredToolForJob,
  heldToolIdsForLabor,
  RequiredToolComponent,
  setRequiredTool,
  setTool,
  ToolComponent,
} from "../../src/sim/labor/Equipment.js";

function buildFlatWorld(sizeX = 8, sizeY = 8, sizeZ = 8, floor = 2): { world: World; materials: MaterialRegistry } {
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
  return { world: { clock, random, entities, components, grid, terrain, events, water, weather }, materials };
}

function spawnAt(world: World, x: number, z: number): EntityId {
  const floor = world.grid.surfaceY(x, z)!;
  return spawnBeaver(world, { name: "Worker", position: { x, y: floor + 1, z } });
}

describe("Equipment / tools", () => {
  it("creates a physical tool entity with a real map position and tool metadata", () => {
    const { world } = buildFlatWorld();
    const floor = world.grid.surfaceY(1, 1)!;

    const tool = createTool(world, { toolKind: "stone-axe", laborKinds: ["woodcutting"] }, { x: 1, y: floor + 1, z: 1 });

    expect(world.entities.kindOf(tool)).toBe("tool");
    expect(world.grid.positionOf(tool)).toEqual({ x: 1, y: floor + 1, z: 1 });
    expect(getTool(world.components, tool)).toEqual({ toolKind: "stone-axe", laborKinds: ["woodcutting"] });
  });

  it("normalizes tool labor kinds and rejects malformed persisted tool data at the read boundary", () => {
    const { world } = buildFlatWorld();
    const tool = world.entities.create("tool");

    setTool(world.components, tool, { toolKind: "stone-axe", laborKinds: ["woodcutting", "hauling", "woodcutting"] });
    expect(getTool(world.components, tool)).toEqual({ toolKind: "stone-axe", laborKinds: ["hauling", "woodcutting"] });

    world.components.set(tool, ToolComponent, { toolKind: "stone-axe", laborKinds: "woodcutting" } as never);
    expect(() => getTool(world.components, tool)).toThrow(RangeError);
  });

  it("discovers only tools the beaver physically holds in its own Inventory", () => {
    const { world } = buildFlatWorld();
    const beaver = spawnAt(world, 0, 0);
    const floor = world.grid.surfaceY(0, 0)!;
    const axe = createTool(world, { toolKind: "stone-axe", laborKinds: ["woodcutting"] }, { x: 0, y: floor + 1, z: 0 });
    const shovel = createTool(world, { toolKind: "mud-spade", laborKinds: ["construction"] }, { x: 0, y: floor + 1, z: 0 });

    expect(heldToolIdsForLabor(world.components, beaver, "woodcutting")).toEqual([]);

    pickUp(world.components, world.grid, axe, beaver);
    pickUp(world.components, world.grid, shovel, beaver);

    expect(getInventory(world.components, beaver)!.itemIds).toEqual([axe, shovel]);
    expect(heldToolIdsForLabor(world.components, beaver, "woodcutting")).toEqual([axe]);
    expect(hasHeldToolKindForLabor(world.components, beaver, "woodcutting", "stone-axe")).toBe(true);
    expect(hasHeldToolKindForLabor(world.components, beaver, "woodcutting", "mud-spade")).toBe(false);

    drop(world.components, world.grid, axe, { x: 1, z: 1 });
    expect(getHeld(world.components, axe)).toBeUndefined();
    expect(heldToolIdsForLabor(world.components, beaver, "woodcutting")).toEqual([]);
  });

  it("required-tool jobs are satisfied only by a matching held physical tool", () => {
    const { world } = buildFlatWorld();
    const beaver = spawnAt(world, 0, 0);
    const job = world.entities.create("job");
    const floor = world.grid.surfaceY(0, 0)!;
    const axe = createTool(world, { toolKind: "stone-axe", laborKinds: ["woodcutting"] }, { x: 0, y: floor + 1, z: 0 });

    expect(hasRequiredToolForJob(world.components, beaver, job, "woodcutting")).toBe(true);
    setRequiredTool(world.components, job, { toolKind: "stone-axe" });
    expect(getRequiredTool(world.components, job)).toEqual({ toolKind: "stone-axe" });
    expect(hasRequiredToolForJob(world.components, beaver, job, "woodcutting")).toBe(false);

    pickUp(world.components, world.grid, axe, beaver);
    expect(hasRequiredToolForJob(world.components, beaver, job, "woodcutting")).toBe(true);
  });

  it("round-trips physical tools, held state, inventory membership, and required-tool jobs through full-world persistence", () => {
    const { world, materials } = buildFlatWorld();
    const beaver = spawnAt(world, 0, 0);
    const floor = world.grid.surfaceY(0, 0)!;
    const axe = createTool(world, { toolKind: "stone-axe", laborKinds: ["woodcutting"] }, { x: 0, y: floor + 1, z: 0 });
    const job = world.entities.create("job");
    setRequiredTool(world.components, job, { toolKind: "stone-axe" });
    pickUp(world.components, world.grid, axe, beaver);

    const restoredMaterials = new MaterialRegistry();
    registerStandardMaterials(restoredMaterials);
    const restored = restoreWorld(JSON.parse(JSON.stringify(snapshotWorld(world))), { componentTypes: ALL_COMPONENT_TYPES, materials: restoredMaterials });

    expect(getTool(restored.components, axe)).toEqual({ toolKind: "stone-axe", laborKinds: ["woodcutting"] });
    expect(getHeld(restored.components, axe)).toEqual({ by: beaver });
    expect(getInventory(restored.components, beaver)!.itemIds).toEqual([axe]);
    expect(getRequiredTool(restored.components, job)).toEqual({ toolKind: "stone-axe" });
    expect(hasRequiredToolForJob(restored.components, beaver, job, "woodcutting")).toBe(true);
    void materials;
  });

  it("REGRESSION (P2-04): non-string tool/labor names fail before RegExp coercion", () => {
    const { world } = buildFlatWorld();
    const tool = world.entities.create("tool");
    const job = world.entities.create("job");

    world.components.set(tool, ToolComponent, { toolKind: true, laborKinds: ["woodcutting"] } as never);
    expect(() => getTool(world.components, tool)).toThrow(RangeError);

    world.components.set(tool, ToolComponent, { toolKind: "stone-axe", laborKinds: [true] } as never);
    expect(() => getTool(world.components, tool)).toThrow(RangeError);

    world.components.set(job, RequiredToolComponent, { toolKind: true } as never);
    expect(() => getRequiredTool(world.components, job)).toThrow(RangeError);
  });
});
