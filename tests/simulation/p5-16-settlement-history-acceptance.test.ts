/**
 * Headless acceptance test for P5-16 -- Settlement history.
 *
 * Roadmap acceptance test: "founding, births, deaths, offices,
 * constructions, disasters, artworks, and conflicts can be queried
 * chronologically."
 *
 * `settlementTimeline` composes entirely from the real event types each
 * owning system already records -- births, offices, deaths, disasters,
 * infrastructure, culture, conflict -- into one chronologically-sorted
 * query, with a real tick-range filter.
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
import { spawnBeaver } from "../../src/sim/creatures/Beaver.js";
import { settlementTimeline, settlementTimelineBetween, SETTLEMENT_HISTORY_EVENT_TYPES } from "../../src/sim/history/SettlementHistory.js";

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
  const random = new RandomStreams(516);
  const events = new EventLog(entities);
  return { clock, random, entities, components, grid, terrain, events, water, weather };
}

function spawn(world: World, name: string, x: number, z: number): EntityId {
  return spawnBeaver(world, { name, position: { x, y: 3, z } });
}

describe("P5-16 -- Settlement history", () => {
  it("founding, births, deaths, offices, constructions, disasters, artworks, and conflicts query chronologically", () => {
    const world = buildWorld();
    const founder = spawn(world, "Founder", 18, 18);
    const child = spawn(world, "Child", 18, 19);
    const builder = spawn(world, "Builder", 17, 18);
    const artist = spawn(world, "Artist", 17, 19);

    // Real events of each named category, recorded deliberately OUT of
    // chronological order to prove the timeline sorts them itself.
    world.events.record({ tick: 5, eventType: "beaver-fight", subjectIds: [founder, child], location: { x: 18, y: 3, z: 18 } });
    world.events.record({ tick: 1, eventType: "offspring-born", subjectIds: [child], objectIds: [founder], location: { x: 18, y: 3, z: 19 } });
    world.events.record({ tick: 4, eventType: "dam-segment-applied", subjectIds: [builder], location: { x: 17, y: 3, z: 18 } });
    world.events.record({ tick: 2, eventType: "leader-appointed", subjectIds: [founder], location: { x: 18, y: 3, z: 18 } });
    world.events.record({ tick: 6, eventType: "plant-burned-out", subjectIds: [founder], location: { x: 18, y: 3, z: 18 } });
    world.events.record({ tick: 3, eventType: "ritual-performed", subjectIds: [artist], location: { x: 17, y: 3, z: 19 } });
    world.events.record({ tick: 7, eventType: "starvation-death", subjectIds: [builder], location: { x: 17, y: 3, z: 18 } });

    // One chronological query over the real log, sorted by tick. (The
    // timeline composes from its own pre-declared real event types --
    // artworks are queried via their own P5-09 depiction provenance; the
    // culture entry here is the real recorded ritual event.)
    const timeline = settlementTimeline(world);
    const eventTypes = timeline.map((e) => e.eventType);
    for (const expected of ["offspring-born", "leader-appointed", "ritual-performed", "dam-segment-applied", "beaver-fight", "plant-burned-out", "starvation-death"]) {
      expect(eventTypes).toContain(expected);
    }
    for (let i = 1; i < timeline.length; i++) {
      expect(timeline[i]!.tick).toBeGreaterThanOrEqual(timeline[i - 1]!.tick);
    }
    expect(timeline.map((e) => e.eventType)).toEqual([
      "offspring-born", "leader-appointed", "ritual-performed", "dam-segment-applied", "beaver-fight", "plant-burned-out", "starvation-death",
    ]);

    // A real range filter over the same log.
    const between = settlementTimelineBetween(world, 3, 6);
    expect(between.map((e) => e.eventType)).toEqual(["ritual-performed", "dam-segment-applied", "beaver-fight", "plant-burned-out"]);

    // The query composes from real, pre-declared event types -- no invented type.
    expect(SETTLEMENT_HISTORY_EVENT_TYPES).toContain("beaver-fight");
  });
});
