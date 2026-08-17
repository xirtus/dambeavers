/**
 * Headless acceptance test for P1-05 — Beaver creature model.
 *
 * Roadmap acceptance test (DAMN_BEAVERS_MASTER_ROADMAP.md, P1-05):
 *   "seven persistent individuals can move independently and retain
 *   distinct IDs/state."
 *
 * "Move" here uses real P1-04 navigation (`advanceTowards`,
 * `BeaverLocomotion.ts`) over real terrain -- each beaver is driven
 * toward its own distinct destination one simulated tick at a time, the
 * same primitive a future job/AI system (P1-07) would eventually call,
 * not a scripted position swap. "Persistent" and "distinct IDs/state" are
 * checked both immediately after spawn AND after the movement scenario
 * completes AND after a real save/reload round trip, so nothing here
 * could pass by aliasing shared state or losing identity mid-scenario.
 */
import { describe, expect, it } from "vitest";
import { EntityIdRegistry, type EntityId } from "../../src/sim/core/EntityId.js";
import { ComponentStore, type ComponentType } from "../../src/sim/core/ComponentStore.js";
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
import {
  IdentityComponent,
  CreatureBodyComponent,
  LocomotionComponent,
  SwimmerComponent,
  InventoryComponent,
  SkillsComponent,
  HealthComponent,
  getIdentity,
  getHealth,
  setHealth,
  getInventory,
  setInventory,
  setSwimmer,
  spawnBeaver,
  spawnSevenStartingBeavers,
  DEFAULT_BEAVER_MAX_WADING_DEPTH,
} from "../../src/sim/creatures/Beaver.js";
import { NeedsComponent } from "../../src/sim/creatures/Needs.js";
import { NeedFocusComponent } from "../../src/sim/creatures/BeaverNeeds.js";
import { BreathComponent } from "../../src/sim/creatures/Respiration.js";
import { TraitsComponent } from "../../src/sim/creatures/Traits.js";
import { advanceTowards } from "../../src/sim/creatures/BeaverLocomotion.js";

const SIZE_X = 9;
const SIZE_Y = 8;
const SIZE_Z = 9;
const STREAM_Z = 4; // a stream band crossing the map, matching M0's "seven beavers arrive beside a stream"
// Genuinely deeper than any beaver's default wading depth: crossing this
// band requires actually using `canSwim`, not just wading. A shallower
// depth would let a broken/disabled `canSwim` wiring cross identically and
// pass this whole suite undetected.
const STREAM_DEPTH = DEFAULT_BEAVER_MAX_WADING_DEPTH + 0.3;
const SPAWN = { x: 4, z: 1 }; // beside the stream, on the near bank

function buildWatershedWorld(): { world: World; materials: MaterialRegistry; water: WaterField } {
  const entities = new EntityIdRegistry();
  const components = new ComponentStore(entities);
  const grid = new WorldGrid({ sizeX: SIZE_X, sizeY: SIZE_Y, sizeZ: SIZE_Z }, entities);
  const materials = new MaterialRegistry();
  registerStandardMaterials(materials);
  const terrain = new TerrainField(grid, materials);
  for (let x = 0; x < SIZE_X; x++) {
    for (let z = 0; z < SIZE_Z; z++) {
      const floor = z === STREAM_Z ? 1 : 2; // a dip for the stream bed
      for (let y = 0; y <= floor; y++) terrain.setMaterial(x, y, z, "soil");
    }
  }
  const water = new WaterField(grid);
  const weather = new Weather();
  for (let x = 0; x < SIZE_X; x++) water.setDepth(x, STREAM_Z, STREAM_DEPTH); // deep enough that crossing genuinely requires swimming, not just wading

  const clock = new SimulationClock({ tickRateHz: 20 });
  const random = new RandomStreams("m0-pond-test");
  const events = new EventLog(entities);
  const world: World = { clock, random, entities, components, grid, terrain, events, water, weather };
  return { world, materials, water };
}

const BEAVER_COMPONENT_TYPES = new Map<string, ComponentType<unknown>>([
  ["identity", IdentityComponent],
  ["creature-body", CreatureBodyComponent],
  ["locomotion", LocomotionComponent],
  ["swimmer", SwimmerComponent],
  ["inventory", InventoryComponent],
  ["skills", SkillsComponent],
  ["health", HealthComponent],
  ["breath", BreathComponent],
  ["needs", NeedsComponent],
  ["need-focus", NeedFocusComponent],
  ["traits", TraitsComponent],
]);

describe("P1-05 acceptance: seven persistent beavers move independently and retain distinct IDs/state", () => {
  it("spawns seven beavers with distinct ids and names beside the stream", () => {
    const { world } = buildWatershedWorld();
    const floor = world.grid.surfaceY(SPAWN.x, SPAWN.z)!;
    const beavers = spawnSevenStartingBeavers(world, { x: SPAWN.x, y: floor + 1, z: SPAWN.z });

    expect(beavers).toHaveLength(7);
    expect(new Set(beavers).size).toBe(7);
    const names = beavers.map((id) => getIdentity(world.components, id)!.name);
    expect(new Set(names).size).toBe(7);

    // All seven sharing one starting cell is intentional (one arrival
    // point, matching the roadmap's own narrative), not an accident of a
    // missing collision system -- `WorldGrid` explicitly supports multiple
    // entities occupying the same cell (P0-05).
    for (const id of beavers) {
      expect(world.grid.entitiesAt(SPAWN.x, floor + 1, SPAWN.z)).toContain(id);
    }
  });

  it("a real spawnBeaver's default swim capability is what lets it cross the stream -- the identical crossing is unreachable once canSwim is disabled", () => {
    // Uses spawnBeaver's own default Swimmer wiring, not a hand-built test
    // double: this is the guard against a regression that silently broke
    // DEFAULT_BEAVER_CAN_SWIM (or its wiring into spawnBeaver) without any
    // test noticing, since the stream is now genuinely deeper than
    // DEFAULT_BEAVER_MAX_WADING_DEPTH.
    const { world, materials, water } = buildWatershedWorld();
    const floor = world.grid.surfaceY(SPAWN.x, SPAWN.z)!;
    const swimmer = spawnBeaver(world, { name: "Swimmer", position: { x: SPAWN.x, y: floor + 1, z: SPAWN.z } });
    const acrossTheStream = { x: SPAWN.x, z: SIZE_Z - 2 };

    let result;
    let iterations = 0;
    do {
      result = advanceTowards(world.grid, world.terrain, water, materials, world.components, swimmer, acrossTheStream);
      iterations++;
      expect(iterations).toBeLessThan(50);
    } while (result.outcome === "moved");
    expect(result.outcome).toBe("arrived");

    // Same beaver, same start, same goal, same world state -- only
    // capability changed.
    world.grid.setEntityPosition(swimmer, SPAWN.x, floor + 1, SPAWN.z);
    setSwimmer(world.components, swimmer, { canSwim: false, maxWadingDepth: DEFAULT_BEAVER_MAX_WADING_DEPTH });
    const blocked = advanceTowards(world.grid, world.terrain, water, materials, world.components, swimmer, acrossTheStream);
    expect(blocked.outcome).toBe("unreachable");
  });

  it("drives all seven toward distinct destinations across the stream, one tick at a time, and each arrives at its OWN goal -- never a neighbor's", () => {
    const { world, materials, water } = buildWatershedWorld();
    const floor = world.grid.surfaceY(SPAWN.x, SPAWN.z)!;
    const beavers = spawnSevenStartingBeavers(world, { x: SPAWN.x, y: floor + 1, z: SPAWN.z });

    // Seven distinct goals on the far bank, spread across the map width --
    // reaching them requires actually crossing the stream (real navigation
    // over real hydrology, not a scripted teleport), and no two beavers
    // share a destination, so arriving at the WRONG column is detectable.
    const goals = beavers.map((_, i) => ({ x: 1 + i, z: SIZE_Z - 2 }));
    expect(new Set(goals.map((g) => `${g.x},${g.z}`)).size).toBe(7);

    const arrived = new Set<EntityId>();
    const MAX_TICKS = 200;
    for (let tick = 0; tick < MAX_TICKS && arrived.size < beavers.length; tick++) {
      world.clock.resume();
      world.clock.advanceTicks(1);
      for (let i = 0; i < beavers.length; i++) {
        const id = beavers[i]!;
        if (arrived.has(id)) continue;
        const goal = goals[i]!;
        const result = advanceTowards(world.grid, world.terrain, water, materials, world.components, id, goal);
        if (result.outcome === "arrived" || result.outcome === "already-there") arrived.add(id);
        expect(result.outcome).not.toBe("unreachable"); // every beaver can swim by default -- the stream must never block them
      }
    }

    expect(arrived.size).toBe(beavers.length); // every beaver actually reached its goal within the tick budget

    for (let i = 0; i < beavers.length; i++) {
      const id = beavers[i]!;
      const goal = goals[i]!;
      const position = world.grid.positionOf(id);
      expect(position).toBeDefined();
      expect({ x: position!.x, z: position!.z }).toEqual(goal); // landed on ITS OWN goal, not swapped with a neighbor
    }

    // Distinct identity/state survived an entire multi-tick movement
    // scenario, not just the moment of spawn.
    const finalNames = beavers.map((id) => getIdentity(world.components, id)!.name);
    expect(new Set(finalNames).size).toBe(7);
  });

  it("mutating one beaver's state after movement never leaks into another's -- persistent per-entity state, not shared references", () => {
    const { world, materials, water } = buildWatershedWorld();
    const floor = world.grid.surfaceY(SPAWN.x, SPAWN.z)!;
    const beavers = spawnSevenStartingBeavers(world, { x: SPAWN.x, y: floor + 1, z: SPAWN.z });
    const [first, second] = beavers as [EntityId, EntityId];

    advanceTowards(world.grid, world.terrain, water, materials, world.components, first, { x: SPAWN.x, z: SIZE_Z - 2 });

    const log = world.entities.create("log");
    setInventory(world.components, first, { itemIds: [log] });
    setHealth(world.components, first, { fraction: 0.3 });

    expect(getInventory(world.components, second)).toEqual({ itemIds: [] });
    expect(getHealth(world.components, second)).toEqual({ fraction: 1 });
    expect(world.grid.positionOf(second)).toEqual({ x: SPAWN.x, y: floor + 1, z: SPAWN.z }); // never moved
  });

  it("distinct IDs/state survive a real save/reload round trip mid-scenario", () => {
    const { world, materials, water } = buildWatershedWorld();
    const floor = world.grid.surfaceY(SPAWN.x, SPAWN.z)!;
    const beavers = spawnSevenStartingBeavers(world, { x: SPAWN.x, y: floor + 1, z: SPAWN.z });
    const [first] = beavers as [EntityId];
    advanceTowards(world.grid, world.terrain, water, materials, world.components, first, { x: SPAWN.x, z: SIZE_Z - 2 });

    const snapshot = JSON.parse(JSON.stringify(world.components.toSnapshot()));
    const restored = ComponentStore.fromSnapshot(snapshot, world.entities, BEAVER_COMPONENT_TYPES);

    const restoredNames = beavers.map((id) => getIdentity(restored, id)!.name);
    expect(new Set(restoredNames).size).toBe(7); // still seven distinct identities after reload
    for (const id of beavers) {
      expect(world.entities.isLive(id)).toBe(true); // ids remain live/known -- EntityIdRegistry itself isn't touched by this reload, but the same guarantee (P0-02) is what makes reattaching component data by id meaningful at all
    }
    expect(getIdentity(restored, first)).toEqual(getIdentity(world.components, first));
  });
});
