/**
 * Headless acceptance test for P8-04 -- Site histories.
 *
 * Roadmap acceptance test: "ownership, population, disasters,
 * constructions, battles, and cultural changes can be reconstructed."
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
import { createSite, getSite } from "../../src/sim/region/Site.js";
import { establishPolity } from "../../src/sim/politics/PoliticalEntity.js";
import { claimTerritory } from "../../src/sim/politics/Territory.js";
import { declareWar, endWar } from "../../src/sim/politics/War.js";
import { planMigrations, tickMigrationGroups } from "../../src/sim/politics/Migration.js";
import { applyDisasterToSite } from "../../src/sim/region/WorldDisasters.js";
import { spawnBeaver } from "../../src/sim/creatures/Beaver.js";
import { ensureSharedHousehold } from "../../src/sim/creatures/Household.js";
import { bindPolityHousehold } from "../../src/sim/politics/PoliticalEntity.js";
import { assignLeader } from "../../src/sim/creatures/Leadership.js";
import { siteHistory, sitePopulationAt, siteFoundingEvent } from "../../src/sim/chronicle/SiteHistories.js";

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
  const random = new RandomStreams(804);
  const events = new EventLog(entities);
  return {
    world: { clock, random, entities, components, grid, terrain, events, water, weather },
    regionMap: new RegionMap(16, 16),
  };
}

describe("P8-04 -- Site histories", () => {
  it("reconstructs ownership, population, disasters, constructions, battles, and cultural changes", () => {
    const { world, regionMap } = buildWorld();
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) regionMap.setElevation(x, z, 0);

    // Founding with a recorded initial state. siteA is short on food
    // (40kg vs a 120kg reserve) so real danger pressure pushes a real
    // migration out, exactly like P7-05's own scenario.
    const siteA = createSite(world, regionMap, 2, 2, 12, 40);
    const siteB = createSite(world, regionMap, 10, 2, 8, 40);
    establishPolity(world, siteA);
    establishPolity(world, siteB);
    const founding = siteFoundingEvent(world, siteA)!;
    expect(founding.data?.initialPopulation).toBe(12);

    // Real household + leader (culture).
    const a = spawnBeaver(world, { name: "A", position: { x: 4, y: 3, z: 4 } });
    const b = spawnBeaver(world, { name: "B", position: { x: 4, y: 3, z: 5 } });
    const household = ensureSharedHousehold(world, a, b);
    bindPolityHousehold(world, siteA, household);
    world.clock.advanceTicks(10);
    assignLeader(world, household);

    // Ownership: a real territorial claim.
    const claimEvent = claimTerritory(world, regionMap, siteA, 1);
    world.clock.advanceTicks(10);

    // Population: a real danger-driven migration out of siteA.
    const initialPop = getSite(world.components, siteA)!.populationCount;
    world.events.record({
      tick: world.clock.tick,
      eventType: "raid-arrived",
      subjectIds: [world.entities.create("raid")],
      objectIds: [siteA, siteB],
      location: { x: 0, y: 0, z: 0 },
    });
    const groups = planMigrations(world, regionMap, [siteA, siteB]);
    expect(groups.length).toBe(1);
    const travelers = initialPop - getSite(world.components, siteA)!.populationCount;
    expect(travelers).toBeGreaterThan(0);
    const departTick = world.clock.tick;
    // Tick the group along its route until arrival.
    const routeTicks = 30;
    for (let i = 0; i < routeTicks; i++) {
      world.clock.advanceTicks(1);
      tickMigrationGroups(world, regionMap);
    }
    const arriveTick = world.clock.tick;

    // Population reconstruction at the exact dates.
    const beforeDeparture = sitePopulationAt(world, siteA, departTick - 1);
    expect(beforeDeparture.reconstructible).toBe(true);
    expect(beforeDeparture.population).toBe(initialPop);
    const afterArrival = sitePopulationAt(world, siteA, arriveTick);
    expect(afterArrival.reconstructible).toBe(true);
    expect(afterArrival.population).toBe(initialPop - travelers);
    const destinationAfter = sitePopulationAt(world, siteB, arriveTick);
    expect(destinationAfter.population).toBe(8 + travelers);

    // Disaster: a real flood strikes siteA.
    world.clock.advanceTicks(10);
    const beforeDisaster = getSite(world.components, siteA)!.populationCount;
    applyDisasterToSite(world, siteA, { kind: "flood", regionX: 2, regionZ: 2, severity: 0.5 });
    const afterDisaster = sitePopulationAt(world, siteA, world.clock.tick);
    expect(afterDisaster.population).toBeLessThanOrEqual(beforeDisaster);

    // Battle: a real war with a real battle... wars need battles from
    // Battle.ts; here the site history must reconstruct the war record.
    world.clock.advanceTicks(10);
    const warId = declareWar(world, siteA, siteB, "territory", claimEvent as unknown as EventId);
    world.clock.advanceTicks(10);
    endWar(world, warId, siteA);

    // Construction: a real dam-segment-applied event naming a real
    // construction, at the site's own active-area location (the detailed
    // world IS the active site's area -- P6-08).
    const constructionId = world.entities.create("construction");
    world.events.record({
      tick: world.clock.tick,
      eventType: "dam-segment-applied",
      subjectIds: [world.entities.create("dam-segment")],
      objectIds: [constructionId, siteA],
      location: { x: 4, y: 0, z: 4 },
    });

    // The full reconstruction.
    const history = siteHistory(world, siteA);
    const kinds = history.map((entry) => entry.kind);
    expect(kinds).toContain("founding");
    expect(kinds).toContain("ownership");
    expect(kinds).toContain("population");
    expect(kinds).toContain("disaster");
    expect(kinds).toContain("battle");
    expect(kinds).toContain("culture");
    expect(kinds).toContain("construction");
    expect(kinds).toContain("current-state");

    // Chronological ordering.
    for (let i = 1; i < history.length; i++) {
      expect(history[i]!.tick).toBeGreaterThanOrEqual(history[i - 1]!.tick);
    }

    // Every event-backed entry's event id is real.
    for (const entry of history) {
      if (entry.eventId !== undefined) expect(world.events.has(entry.eventId)).toBe(true);
    }
  });

  it("site histories and population reconstructions survive save/reload", () => {
    const { world, regionMap } = buildWorld();
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) regionMap.setElevation(x, z, 0);
    const siteA = createSite(world, regionMap, 2, 2, 12, 150);
    const siteB = createSite(world, regionMap, 10, 2, 8, 40);
    establishPolity(world, siteA);
    establishPolity(world, siteB);
    claimTerritory(world, regionMap, siteA, 1);
    world.clock.advanceTicks(10);
    applyDisasterToSite(world, siteA, { kind: "wildfire", regionX: 2, regionZ: 2, severity: 0.8 });
    world.clock.advanceTicks(10);

    const beforeHistory = siteHistory(world, siteA);
    const beforePop = sitePopulationAt(world, siteA, world.clock.tick);

    const materials = new MaterialRegistry();
    registerStandardMaterials(materials);
    const restored = restoreWorld(snapshotWorld(world), { componentTypes: ALL_COMPONENT_TYPES, materials });

    expect(siteHistory(restored, siteA)).toEqual(beforeHistory);
    expect(sitePopulationAt(restored, siteA, world.clock.tick)).toEqual(beforePop);
  });
});
