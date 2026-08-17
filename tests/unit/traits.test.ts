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
import { snapshotWorld, restoreWorld } from "../../src/sim/persistence/WorldSnapshot.js";
import { ALL_COMPONENT_TYPES } from "../../src/sim/persistence/AllComponentTypes.js";
import { spawnBeaver, spawnSevenStartingBeavers } from "../../src/sim/creatures/Beaver.js";
import {
  TraitsComponent,
  assertValidTraits,
  assignTraits,
  getTraits,
  getWorldTraits,
  setTraits,
  setWorldTraits,
} from "../../src/sim/creatures/Traits.js";

function buildWorld(seed: number | string = 7): World {
  const entities = new EntityIdRegistry();
  const components = new ComponentStore(entities);
  const grid = new WorldGrid({ sizeX: 10, sizeY: 8, sizeZ: 10 }, entities);
  const materials = new MaterialRegistry();
  registerStandardMaterials(materials);
  const terrain = new TerrainField(grid, materials);
  for (let x = 0; x < 10; x++) {
    for (let z = 0; z < 10; z++) terrain.setMaterial(x, 2, z, "soil");
  }
  const water = new WaterField(grid);
  const weather = new Weather();
  const clock = new SimulationClock({ tickRateHz: 20 });
  const random = new RandomStreams(seed);
  const events = new EventLog(entities);
  return { clock, random, entities, components, grid, terrain, events, water, weather };
}

function spawnAt(world: World, name: string, x: number, z: number): EntityId {
  const floor = world.grid.surfaceY(x, z)!;
  return spawnBeaver(world, { name, position: { x, y: floor + 1, z } });
}

describe("Traits", () => {
  it("validates persistent trait state", () => {
    expect(() => assertValidTraits({ sociability: 0, resilience: 1, assignedTick: 0 })).not.toThrow();
    expect(() => assertValidTraits({ sociability: -0.01, resilience: 0.5, assignedTick: 0 })).toThrow(RangeError);
    expect(() => assertValidTraits({ sociability: 1.01, resilience: 0.5, assignedTick: 0 })).toThrow(RangeError);
    expect(() => assertValidTraits({ sociability: 0.5, resilience: -0.01, assignedTick: 0 })).toThrow(RangeError);
    expect(() => assertValidTraits({ sociability: 0.5, resilience: 1.01, assignedTick: 0 })).toThrow(RangeError);
    expect(() => assertValidTraits({ sociability: 0.5, resilience: 0.5, assignedTick: -1 })).toThrow(RangeError);
    expect(() => assertValidTraits({ sociability: 0.5, resilience: 0.5, assignedTick: 1.5 })).toThrow(RangeError);
  });

  it("round-trips through the validated component read/write path", () => {
    const world = buildWorld();
    const beaver = spawnAt(world, "Alder", 3, 3);
    setTraits(world.components, beaver, { sociability: 0.3, resilience: 0.8, assignedTick: 0 });
    expect(getTraits(world.components, beaver)).toEqual({ sociability: 0.3, resilience: 0.8, assignedTick: 0 });
  });

  it("world-aware writes/reads reject a beaver id that is not a live beaver", () => {
    const world = buildWorld();
    const beaver = spawnAt(world, "Alder", 3, 3);
    world.entities.destroy(beaver);
    const nonBeaver = world.entities.create("log");
    expect(() => setWorldTraits(world, beaver, { sociability: 0.5, resilience: 0.5, assignedTick: 0 })).toThrow(RangeError);
    expect(() => setWorldTraits(world, nonBeaver, { sociability: 0.5, resilience: 0.5, assignedTick: 0 })).toThrow(RangeError);
    expect(() => getWorldTraits(world, nonBeaver)).toThrow(RangeError);
  });

  it("world-aware paths reject traits assigned from the future", () => {
    const world = buildWorld();
    const beaver = spawnAt(world, "Alder", 3, 3);
    expect(() => setWorldTraits(world, beaver, { sociability: 0.5, resilience: 0.5, assignedTick: world.clock.tick + 1 })).toThrow(
      RangeError,
    );
  });

  it("catches corrupted restored future traits on read", () => {
    const world = buildWorld();
    const beaver = spawnAt(world, "Alder", 3, 3);
    world.components.set(beaver, TraitsComponent, { sociability: 0.5, resilience: 0.5, assignedTick: world.clock.tick + 5 });
    expect(() => getWorldTraits(world, beaver)).toThrow(RangeError);
  });

  it("assignTraits rolls in-range values, stamps the current tick, and persists them", () => {
    const world = buildWorld();
    world.clock.advanceTicks(3);
    const beaver = spawnAt(world, "Alder", 3, 3);
    const stream = world.random.stream("beaver-traits");
    const traits = assignTraits(world, beaver, stream);

    expect(traits.sociability).toBeGreaterThanOrEqual(0);
    expect(traits.sociability).toBeLessThan(1);
    expect(traits.resilience).toBeGreaterThanOrEqual(0);
    expect(traits.resilience).toBeLessThan(1);
    expect(traits.assignedTick).toBe(3);
    expect(getWorldTraits(world, beaver)).toEqual(traits);
  });

  it("assignTraits is deterministic for a given world seed and diverges for a different one", () => {
    const worldA1 = buildWorld("colony-seed");
    const worldA2 = buildWorld("colony-seed");
    const worldB = buildWorld("a-different-seed");

    const beaverA1 = spawnAt(worldA1, "Alder", 3, 3);
    const beaverA2 = spawnAt(worldA2, "Alder", 3, 3);
    const beaverB = spawnAt(worldB, "Alder", 3, 3);

    const traitsA1 = assignTraits(worldA1, beaverA1, worldA1.random.stream("beaver-traits"));
    const traitsA2 = assignTraits(worldA2, beaverA2, worldA2.random.stream("beaver-traits"));
    const traitsB = assignTraits(worldB, beaverB, worldB.random.stream("beaver-traits"));

    expect(traitsA2).toEqual(traitsA1);
    expect(traitsB).not.toEqual(traitsA1);
  });

  it("assigns the seven starting beavers distinct, deterministic traits via a dedicated substream", () => {
    const worldA = buildWorld("roster-seed");
    const worldB = buildWorld("roster-seed");
    const rosterA = spawnSevenStartingBeavers(worldA, { x: 4, y: 3, z: 4 });
    const rosterB = spawnSevenStartingBeavers(worldB, { x: 4, y: 3, z: 4 });

    const traitsA = rosterA.map((id) => getWorldTraits(worldA, id));
    const traitsB = rosterB.map((id) => getWorldTraits(worldB, id));
    expect(traitsB).toEqual(traitsA);

    // Not every beaver ends up with the same personality -- a real,
    // varied roster, not seven copies of one rolled value.
    const serialized = new Set(traitsA.map((t) => JSON.stringify(t)));
    expect(serialized.size).toBeGreaterThan(1);
  });

  it("persists through a real full-world save/reload round trip", () => {
    const world = buildWorld();
    const beaver = spawnAt(world, "Alder", 3, 3);
    setWorldTraits(world, beaver, { sociability: 0.42, resilience: 0.17, assignedTick: 0 });

    const restoredMaterials = new MaterialRegistry();
    registerStandardMaterials(restoredMaterials);
    const restored = restoreWorld(JSON.parse(JSON.stringify(snapshotWorld(world))), {
      componentTypes: ALL_COMPONENT_TYPES,
      materials: restoredMaterials,
    });

    expect(getWorldTraits(restored, beaver)).toEqual({ sociability: 0.42, resilience: 0.17, assignedTick: 0 });
  });
});
