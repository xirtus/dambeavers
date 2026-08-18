/**
 * Headless acceptance test for P8-02 -- Timeline browser.
 *
 * Roadmap acceptance test: "player can browse chronological events from
 * world scale down to one individual."
 */
import { describe, expect, it } from "vitest";
import { EntityIdRegistry, type EntityId } from "../../src/sim/core/EntityId.js";
import { ComponentStore } from "../../src/sim/core/ComponentStore.js";
import { SimulationClock } from "../../src/sim/core/SimulationClock.js";
import { RandomStreams } from "../../src/sim/core/Random.js";
import { WorldGrid } from "../../src/sim/world/WorldGrid.js";
import { TerrainField } from "../../src/sim/world/TerrainField.js";
import { EventLog, type RecordedEvent } from "../../src/sim/history/EventLog.js";
import { MaterialRegistry } from "../../src/sim/materials/Material.js";
import { registerStandardMaterials } from "../../src/sim/materials/standardMaterials.js";
import { WaterField } from "../../src/sim/hydrology/WaterField.js";
import { Weather } from "../../src/sim/weather/Weather.js";
import type { World } from "../../src/sim/persistence/WorldSnapshot.js";
import { snapshotWorld, restoreWorld } from "../../src/sim/persistence/WorldSnapshot.js";
import { ALL_COMPONENT_TYPES } from "../../src/sim/persistence/AllComponentTypes.js";
import { spawnBeaver } from "../../src/sim/creatures/Beaver.js";
import { die } from "../../src/sim/creatures/Mortality.js";
import { worldTimeline, entityTimeline, timelineWindow } from "../../src/sim/chronicle/Timeline.js";

function buildWorld(): World {
  const entities = new EntityIdRegistry();
  const components = new ComponentStore(entities);
  const grid = new WorldGrid({ sizeX: 20, sizeY: 10, sizeZ: 20 }, entities);
  const materials = new MaterialRegistry();
  registerStandardMaterials(materials);
  const terrain = new TerrainField(grid, materials);
  for (let x = 0; x < 20; x++) for (let z = 0; z < 20; z++) for (let y = 0; y <= 2; y++) terrain.setMaterial(x, y, z, "soil");
  const water = new WaterField(grid);
  const weather = new Weather();
  const clock = new SimulationClock({ tickRateHz: 20 });
  const random = new RandomStreams(802);
  const events = new EventLog(entities);
  return { clock, random, entities, components, grid, terrain, events, water, weather };
}

function isChronological(events: RecordedEvent[]): boolean {
  for (let i = 1; i < events.length; i++) {
    const a = events[i - 1]!;
    const b = events[i]!;
    if (a.tick > b.tick || (a.tick === b.tick && a.id >= b.id)) return false;
  }
  return true;
}

describe("P8-02 -- Timeline browser", () => {
  it("browses chronological events from world scale down to one individual", () => {
    const world = buildWorld();
    const alder = spawnBeaver(world, { name: "Alder", position: { x: 4, y: 3, z: 4 } });
    const birch = spawnBeaver(world, { name: "Birch", position: { x: 4, y: 3, z: 5 } });
    const unrelated = world.entities.create("log");

    // Interleaved history at advancing ticks.
    world.clock.advanceTicks(1);
    world.events.record({ tick: world.clock.tick, eventType: "social-interaction", subjectIds: [alder], objectIds: [birch], location: { x: 4, y: 3, z: 4 } });
    world.clock.advanceTicks(2);
    world.events.record({ tick: world.clock.tick, eventType: "log-hauled", subjectIds: [birch], objectIds: [unrelated], location: { x: 6, y: 3, z: 6 } });
    world.clock.advanceTicks(2);
    world.events.record({ tick: world.clock.tick, eventType: "starvation-death", subjectIds: [alder], location: { x: 4, y: 3, z: 4 } });
    die(world, alder, "starvation");

    // World scale: everything, chronological.
    const timeline = worldTimeline(world);
    expect(timeline.length).toBe(world.events.count);
    expect(isChronological(timeline)).toBe(true);

    // Down to one individual.
    const alderTimeline = entityTimeline(world, alder);
    expect(alderTimeline.length).toBeGreaterThan(0);
    expect(alderTimeline.every((event) => event.subjectIds.includes(alder) || event.objectIds.includes(alder))).toBe(true);
    expect(isChronological(alderTimeline)).toBe(true);
    expect(entityTimeline(world, alder)).toEqual(timelineWindow(world, { entityId: alder }));

    // Windowing: tick range + type filter narrow the world timeline.
    const windowed = timelineWindow(world, { sinceTick: 2, untilTick: 5, eventTypes: ["social-interaction", "log-hauled"] });
    expect(windowed.every((event) => event.tick >= 2 && event.tick <= 5)).toBe(true);
    expect(windowed.every((event) => event.eventType === "social-interaction" || event.eventType === "log-hauled")).toBe(true);
    expect(isChronological(windowed)).toBe(true);

    // Pagination: pages are disjoint and cover the whole window exactly.
    const all = timelineWindow(world);
    const pageSize = 1;
    const pages: RecordedEvent[] = [];
    for (let offset = 0; offset < all.length; offset += pageSize) {
      pages.push(...timelineWindow(world, { offset, limit: pageSize }));
    }
    expect(pages).toEqual(all);
    expect(new Set(pages.map((e) => e.id)).size).toBe(all.length); // no duplicates

    expect(() => timelineWindow(world, { sinceTick: 5, untilTick: 2 })).toThrow(RangeError);
    expect(() => timelineWindow(world, { offset: -1 })).toThrow(RangeError);
  });

  it("timeline browsing survives save/reload identically", () => {
    const world = buildWorld();
    const alder = spawnBeaver(world, { name: "Alder", position: { x: 4, y: 3, z: 4 } });
    world.clock.advanceTicks(3);
    world.events.record({ tick: world.clock.tick, eventType: "social-interaction", subjectIds: [alder], location: { x: 4, y: 3, z: 4 } });
    const before = timelineWindow(world, { entityId: alder });

    const materials = new MaterialRegistry();
    registerStandardMaterials(materials);
    const restored = restoreWorld(snapshotWorld(world), { componentTypes: ALL_COMPONENT_TYPES, materials });
    expect(timelineWindow(restored, { entityId: alder })).toEqual(before);
    expect(worldTimeline(restored)).toEqual(worldTimeline(world));
  });
});
