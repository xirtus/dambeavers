/**
 * Headless acceptance test for P8-08 -- Causal history view.
 *
 * Roadmap acceptance test: "major disasters/conflicts can display
 * upstream causal chains where recorded."
 */
import { describe, expect, it } from "vitest";
import { EntityIdRegistry, type EntityId } from "../../src/sim/core/EntityId.js";
import { ComponentStore } from "../../src/sim/core/ComponentStore.js";
import { SimulationClock } from "../../src/sim/core/SimulationClock.js";
import { RandomStreams } from "../../src/sim/core/Random.js";
import { WorldGrid } from "../../src/sim/world/WorldGrid.js";
import { TerrainField } from "../../src/sim/world/TerrainField.js";
import { EventLog, type EventId } from "../../src/sim/history/EventLog.js";
import { MaterialRegistry } from "../../src/sim/materials/Material.js";
import { registerStandardMaterials } from "../../src/sim/materials/standardMaterials.js";
import { WaterField } from "../../src/sim/hydrology/WaterField.js";
import { Weather } from "../../src/sim/weather/Weather.js";
import type { World } from "../../src/sim/persistence/WorldSnapshot.js";
import { snapshotWorld, restoreWorld } from "../../src/sim/persistence/WorldSnapshot.js";
import { ALL_COMPONENT_TYPES } from "../../src/sim/persistence/AllComponentTypes.js";
import { RegionMap } from "../../src/sim/region/RegionMap.js";
import { createSite } from "../../src/sim/region/Site.js";
import { applyDisasterToSite } from "../../src/sim/region/WorldDisasters.js";
import { establishPolity } from "../../src/sim/politics/PoliticalEntity.js";
import { claimTerritory } from "../../src/sim/politics/Territory.js";
import { declareWar, endWar } from "../../src/sim/politics/War.js";
import { nameEntity } from "../../src/sim/creatures/Naming.js";
import { causalHistoryOf, majorRecordedEvents, majorCausalHistories } from "../../src/sim/chronicle/CausalHistory.js";

function buildWorld(): { world: World; regionMap: RegionMap } {
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
  const random = new RandomStreams(808);
  const events = new EventLog(entities);
  return {
    world: { clock, random, entities, components, grid, terrain, events, water, weather },
    regionMap: new RegionMap(16, 16),
  };
}

describe("P8-08 -- Causal history view", () => {
  it("major disasters and conflicts display upstream causal chains where recorded", () => {
    const { world, regionMap } = buildWorld();
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) regionMap.setElevation(x, z, 0);

    // A conflict with a REAL recorded chain:
    //   territory-claimed -> war-declared -> war-ended
    const siteA = createSite(world, regionMap, 2, 2, 10, 100);
    const siteB = createSite(world, regionMap, 3, 2, 10, 100);
    establishPolity(world, siteA);
    establishPolity(world, siteB);
    nameEntity(world, siteA, "site", world.random.stream("p8-08"));
    nameEntity(world, siteB, "site", world.random.stream("p8-08b"));
    claimTerritory(world, regionMap, siteA, 1);
    // The war's recorded cause is the real claim EVENT (claimTerritory
    // returns the claim entity; the event is what history records).
    const claimEvent = world.events.eventsOfType("territory-claimed").find((e) => e.subjectIds.includes(siteA))!.id;
    world.clock.advanceTicks(10);
    const warId = declareWar(world, siteA, siteB, "territory", claimEvent);
    world.clock.advanceTicks(10);
    const warEndedEvent = endWar(world, warId, siteA);

    const warHistoryView = causalHistoryOf(world, warEndedEvent);
    // Origin-first upstream chain: claim -> war-declared -> war-ended.
    expect(warHistoryView.recordedDepth).toBe(2);
    expect(warHistoryView.upstream.length).toBe(3);
    expect(warHistoryView.upstream[0]!.event.eventType).toBe("territory-claimed");
    expect(warHistoryView.upstream[1]!.event.eventType).toBe("war-declared");
    expect(warHistoryView.upstream[2]!.event.eventType).toBe("war-ended");
    expect(warHistoryView.outcomeEvent.id).toBe(warEndedEvent);

    // Every step's description is assembled from its own real record.
    for (const step of warHistoryView.upstream) {
      expect(step.description).toContain(step.event.eventType.replace(/-/g, " "));
      expect(step.description).toContain(String(step.event.tick));
      for (const participant of step.participants) {
        expect(world.entities.isKnown(participant.id)).toBe(true);
      }
    }

    // A major disaster with NO recorded cause: the view is honest about
    // the absence ("where recorded") instead of fabricating a chain.
    const disasterSite = createSite(world, regionMap, 10, 10, 10, 100);
    world.clock.advanceTicks(10);
    applyDisasterToSite(world, disasterSite, { kind: "flood", regionX: 10, regionZ: 10, severity: 0.6 });
    const floodEvent = world.events.eventsOfType("world-flood").find((e) => e.subjectIds.includes(disasterSite))!;
    const floodView = causalHistoryOf(world, floodEvent.id);
    expect(floodView.recordedDepth).toBe(0);
    expect(floodView.upstream.length).toBe(1);
    expect(floodView.upstream[0]!.event.id).toBe(floodEvent.id);

    // The major-event inventory includes both.
    const majors = majorRecordedEvents(world);
    expect(majors.some((e) => e.eventType === "war-declared")).toBe(true);
    expect(majors.some((e) => e.eventType === "world-flood")).toBe(true);
    const majorViews = majorCausalHistories(world);
    expect(majorViews.length).toBe(majors.length);
    for (const view of majorViews) {
      expect(world.events.has(view.outcomeEvent.id)).toBe(true);
    }
  });

  it("causal history views survive save/reload", () => {
    const { world, regionMap } = buildWorld();
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) regionMap.setElevation(x, z, 0);
    const siteA = createSite(world, regionMap, 2, 2, 10, 100);
    const siteB = createSite(world, regionMap, 3, 2, 10, 100);
    establishPolity(world, siteA);
    establishPolity(world, siteB);
    claimTerritory(world, regionMap, siteA, 1);
    // The war's recorded cause is the real claim EVENT (claimTerritory
    // returns the claim entity; the event is what history records).
    const claimEvent = world.events.eventsOfType("territory-claimed").find((e) => e.subjectIds.includes(siteA))!.id;
    world.clock.advanceTicks(10);
    const warId = declareWar(world, siteA, siteB, "territory", claimEvent);
    world.clock.advanceTicks(10);
    const warEndedEvent = endWar(world, warId, siteA);

    const before = causalHistoryOf(world, warEndedEvent);
    const materials = new MaterialRegistry();
    registerStandardMaterials(materials);
    const restored = restoreWorld(snapshotWorld(world), { componentTypes: ALL_COMPONENT_TYPES, materials });
    expect(causalHistoryOf(restored, warEndedEvent)).toEqual(before);
  });
});
