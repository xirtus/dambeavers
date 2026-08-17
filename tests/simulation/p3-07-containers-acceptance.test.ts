/**
 * Headless acceptance test for P3-07 -- Containers.
 *
 * Roadmap acceptance test: "items/liquids can be stored inside physical
 * containers while retaining ownership and location chain."
 *
 * A real physical container entity holds an item by the SAME generic
 * `Held` relation a beaver's inventory uses (ownership chain preserved:
 * `Held.by === containerId`), and the item's location is derived from
 * the container's own grid position while contained (never duplicated).
 * A liquid container stores a real physical liquid quantity the same
 * way, as state of the container entity itself.
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
import { Weather } from "../../src/sim/weather/Weather.js";
import type { World } from "../../src/sim/persistence/WorldSnapshot.js";
import { setLog, getHeld } from "../../src/sim/labor/Log.js";
import { createContainer, placeInContainer, removeFromContainer, getContainer } from "../../src/sim/economy/Container.js";
import { createLiquidContainer, setLiquidContents, getLiquidContents } from "../../src/sim/economy/Liquid.js";

function buildWorld(): { world: World } {
  const entities = new EntityIdRegistry();
  const components = new ComponentStore(entities);
  const grid = new WorldGrid({ sizeX: 20, sizeY: 12, sizeZ: 20 }, entities);
  const materials = new MaterialRegistry();
  registerStandardMaterials(materials);
  const terrain = new TerrainField(grid, materials);
  for (let x = 0; x < 20; x++) for (let z = 0; z < 20; z++) for (let y = 0; y <= 2; y++) terrain.setMaterial(x, y, z, "soil");
  const water = new WaterField(grid);
  const weather = new Weather();
  const clock = new SimulationClock({ tickRateHz: 20 });
  const random = new RandomStreams(107);
  const events = new EventLog(entities);
  return { world: { clock, random, entities, components, grid, terrain, events, water, weather } };
}

describe("P3-07 -- Containers", () => {
  it("items stored in a physical container keep their ownership and location chain", () => {
    const { world } = buildWorld();
    const containerId = createContainer(world, 50, { x: 3, y: 3, z: 3 });
    const containerPosition = world.grid.positionOf(containerId)!;
    expect(containerPosition).toEqual({ x: 3, y: 3, z: 3 });

    const logId = world.entities.create("log");
    world.grid.setEntityPosition(logId, 4, 3, 4);
    setLog(world.components, logId, { materialId: "wood", massKg: 10 });

    placeInContainer(world, containerId, logId);

    // Ownership chain: the item is held BY the container through the same
    // generic Held relation a beaver's inventory uses.
    expect(getHeld(world.components, logId)).toEqual({ by: containerId });
    expect(getContainer(world.components, containerId)!.itemIds).toEqual([logId]);
    // Location chain: while contained, the item has no position of its
    // own -- its location IS the container's.
    expect(world.grid.positionOf(logId)).toBeUndefined();

    removeFromContainer(world, containerId, logId);
    expect(getHeld(world.components, logId)).toBeUndefined();
    expect(world.grid.positionOf(logId)).toEqual(containerPosition);
    expect(getContainer(world.components, containerId)!.itemIds).toEqual([]);
  });

  it("liquids are stored inside a physical liquid container as its own real state", () => {
    const { world } = buildWorld();
    const barrelId = createLiquidContainer(world, 100, { x: 5, y: 3, z: 5 });
    expect(world.grid.positionOf(barrelId)).toEqual({ x: 5, y: 3, z: 5 });

    setLiquidContents(world.components, barrelId, { capacityL: 100, materialId: "water", volumeL: 40, composition: { sugar: 0.1 } });
    const stored = getLiquidContents(world.components, barrelId)!;
    expect(stored.volumeL).toBe(40);
    expect(stored.materialId).toBe("water");
    expect(stored.composition.sugar).toBeCloseTo(0.1);
  });
});
