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
import { spawnBeaver, getInventory } from "../../src/sim/creatures/Beaver.js";
import { setLog, getLog, setHeld, getHeld, setReservation, getReservation, clearReservation, pickUp, drop } from "../../src/sim/labor/Log.js";

function buildFlatWorld(sizeX = 8, sizeY = 8, sizeZ = 8, floor = 2): World {
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
  const clock = new SimulationClock({ tickRateHz: 20 });
  const random = new RandomStreams(1);
  const events = new EventLog(entities);
  const water = new WaterField(grid);
  const weather = new Weather();
  return { clock, random, entities, components, grid, terrain, events, water, weather };
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

describe("Log component", () => {
  it("round-trips a valid log", () => {
    const entities = new EntityIdRegistry();
    const components = new ComponentStore(entities);
    const id = entities.create("log");
    setLog(components, id, { materialId: "wood", massKg: 12.5 });
    expect(getLog(components, id)).toEqual({ materialId: "wood", massKg: 12.5 });
  });

  it("rejects an empty materialId", () => {
    const entities = new EntityIdRegistry();
    const components = new ComponentStore(entities);
    const id = entities.create("log");
    expect(() => setLog(components, id, { materialId: "", massKg: 5 })).toThrow(RangeError);
  });

  it("rejects a non-positive or non-finite mass", () => {
    const entities = new EntityIdRegistry();
    const components = new ComponentStore(entities);
    const id = entities.create("log");
    expect(() => setLog(components, id, { materialId: "wood", massKg: 0 })).toThrow(RangeError);
    expect(() => setLog(components, id, { materialId: "wood", massKg: -1 })).toThrow(RangeError);
    expect(() => setLog(components, id, { materialId: "wood", massKg: Infinity })).toThrow(RangeError);
    expect(() => setLog(components, id, { materialId: "wood", massKg: NaN })).toThrow(RangeError);
  });

  it("returns undefined for an entity with no Log", () => {
    const entities = new EntityIdRegistry();
    const components = new ComponentStore(entities);
    const id = entities.create("log");
    expect(getLog(components, id)).toBeUndefined();
  });
});

describe("Held component", () => {
  it("round-trips", () => {
    const entities = new EntityIdRegistry();
    const components = new ComponentStore(entities);
    const item = entities.create("log");
    const beaver = entities.create("beaver");
    setHeld(components, item, { by: beaver });
    expect(getHeld(components, item)).toEqual({ by: beaver });
  });

  it("rejects a non-positive by", () => {
    const entities = new EntityIdRegistry();
    const components = new ComponentStore(entities);
    const item = entities.create("log");
    expect(() => setHeld(components, item, { by: 0 as never })).toThrow(RangeError);
  });
});

describe("Reservation component", () => {
  it("round-trips and clears", () => {
    const entities = new EntityIdRegistry();
    const components = new ComponentStore(entities);
    const item = entities.create("log");
    const beaver = entities.create("beaver");
    setReservation(components, item, { by: beaver });
    expect(getReservation(components, item)).toEqual({ by: beaver });
    clearReservation(components, item);
    expect(getReservation(components, item)).toBeUndefined();
  });
});

describe("pickUp / drop", () => {
  it("moves an item from the ground into the beaver's Inventory, clearing its WorldGrid position", () => {
    const world = buildFlatWorld();
    const beaver = spawnAt(world, 0, 0);
    const item = spawnLog(world, 0, 0);

    pickUp(world.components, world.grid, item, beaver);

    expect(getInventory(world.components, beaver)!.itemIds).toEqual([item]);
    expect(getHeld(world.components, item)).toEqual({ by: beaver });
    expect(world.grid.positionOf(item)).toBeUndefined();
  });

  it("throws when picking up an already-held item", () => {
    const world = buildFlatWorld();
    const beaver = spawnAt(world, 0, 0);
    const item = spawnLog(world, 0, 0);
    pickUp(world.components, world.grid, item, beaver);
    expect(() => pickUp(world.components, world.grid, item, beaver)).toThrow(RangeError);
  });

  it("throws when the holder has no Inventory component", () => {
    const world = buildFlatWorld();
    const notABeaver = world.entities.create("tree");
    const item = spawnLog(world, 0, 0);
    expect(() => pickUp(world.components, world.grid, item, notABeaver)).toThrow(RangeError);
  });

  it("drop removes the item from Inventory, clears Held, and gives it back a real WorldGrid position", () => {
    const world = buildFlatWorld();
    const beaver = spawnAt(world, 0, 0);
    const item = spawnLog(world, 0, 0);
    pickUp(world.components, world.grid, item, beaver);

    drop(world.components, world.grid, item, { x: 3, z: 4 });

    expect(getInventory(world.components, beaver)!.itemIds).toEqual([]);
    expect(getHeld(world.components, item)).toBeUndefined();
    expect(world.grid.positionOf(item)).toEqual({ x: 3, y: world.grid.surfaceY(3, 4)! + 1, z: 4 });
  });

  it("throws when dropping an item that isn't held", () => {
    const world = buildFlatWorld();
    const item = spawnLog(world, 0, 0);
    expect(() => drop(world.components, world.grid, item, { x: 1, z: 1 })).toThrow(RangeError);
  });

  it("throws when dropping at a column with no ground", () => {
    const world = buildFlatWorld();
    const beaver = spawnAt(world, 0, 0);
    const item = spawnLog(world, 0, 0);
    pickUp(world.components, world.grid, item, beaver);
    // A fresh grid over the same entity registry has no terrain anywhere -- surfaceY is undefined everywhere.
    const bareGrid = new WorldGrid({ sizeX: 8, sizeY: 8, sizeZ: 8 }, world.entities);
    expect(() => drop(world.components, bareGrid, item, { x: 5, z: 5 })).toThrow(RangeError);
  });

  it("mutating one beaver's held item never affects another's Inventory -- true per-entity isolation", () => {
    const world = buildFlatWorld();
    const a = spawnAt(world, 0, 0, "A");
    const b = spawnAt(world, 1, 0, "B");
    const item = spawnLog(world, 0, 0);
    pickUp(world.components, world.grid, item, a);
    expect(getInventory(world.components, b)!.itemIds).toEqual([]);
  });
});
