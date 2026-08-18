/**
 * Headless acceptance test for P7-05 -- Migration.
 *
 * Roadmap acceptance test: "individuals/households can move because of
 * opportunity, danger, kinship, or displacement."
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
import { RegionMap } from "../../src/sim/region/RegionMap.js";
import { createSite, getSite } from "../../src/sim/region/Site.js";
import { spawnBeaver } from "../../src/sim/creatures/Beaver.js";
import { ensureSharedHousehold } from "../../src/sim/creatures/Household.js";
import { setRelationshipWith } from "../../src/sim/creatures/Relationships.js";
import { establishPolity, bindPolityHousehold } from "../../src/sim/politics/PoliticalEntity.js";
import {
  planMigrations, tickMigrationGroups, migrationPushScore, migrationPullScore, getMigrationGroup,
} from "../../src/sim/politics/Migration.js";

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
  const random = new RandomStreams(705);
  const events = new EventLog(entities);
  return {
    world: { clock, random, entities, components, grid, terrain, events, water, weather },
    regionMap: new RegionMap(16, 16),
  };
}

describe("P7-05 -- Migration", () => {
  it("households move because of opportunity, danger, kinship, or displacement", () => {
    const { world, regionMap } = buildWorld();
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) regionMap.setElevation(x, z, 0);

    const dangerSite = createSite(world, regionMap, 2, 2, 8, 10);    // short on food
    const kinSite = createSite(world, regionMap, 10, 2, 4, 200);     // surplus + kin
    const richSite = createSite(world, regionMap, 10, 10, 4, 200);   // surplus, no kin
    const poorSite = createSite(world, regionMap, 2, 10, 4, 10);     // neither
    establishPolity(world, dangerSite);
    establishPolity(world, kinSite);
    establishPolity(world, richSite);
    establishPolity(world, poorSite);

    // Real households with real cross-site kinship.
    const a = spawnBeaver(world, { name: "A", position: { x: 4, y: 3, z: 4 } });
    const b = spawnBeaver(world, { name: "B", position: { x: 4, y: 3, z: 5 } });
    const dangerHousehold = ensureSharedHousehold(world, a, b);
    const c = spawnBeaver(world, { name: "C", position: { x: 12, y: 3, z: 4 } });
    const d = spawnBeaver(world, { name: "D", position: { x: 12, y: 3, z: 5 } });
    const kinHousehold = ensureSharedHousehold(world, c, d);
    bindPolityHousehold(world, dangerSite, dangerHousehold);
    bindPolityHousehold(world, kinSite, kinHousehold);
    setRelationshipWith(world.components, a, { withId: c, kin: "sibling", familiarity: 0.9, affinity: 0.8 });
    setRelationshipWith(world.components, c, { withId: a, kin: "sibling", familiarity: 0.9, affinity: 0.8 });

    // Danger: a real raid arrival at the site pushes people away.
    world.events.record({
      tick: world.clock.tick,
      eventType: "raid-arrived",
      subjectIds: [world.entities.create("raid")],
      objectIds: [dangerSite],
      location: { x: 0, y: 0, z: 0 },
    });
    expect(migrationPushScore(world, dangerSite)).toBeGreaterThanOrEqual(1.3);
    expect(migrationPushScore(world, richSite)).toBeLessThan(1);

    // Opportunity and kinship both pull -- kinship measurably more.
    expect(migrationPullScore(world, dangerSite, richSite)).toBeGreaterThan(0);
    expect(migrationPullScore(world, dangerSite, kinSite)).toBeGreaterThan(migrationPullScore(world, dangerSite, richSite));

    // The move itself: population departs, travels the real route, arrives.
    const originInitial = getSite(world.components, dangerSite)!.populationCount;
    const destInitial = getSite(world.components, kinSite)!.populationCount;
    const groups = planMigrations(world, regionMap, [dangerSite, kinSite, richSite, poorSite]);
    expect(groups.length).toBe(1);
    const group = getMigrationGroup(world.components, groups[0]!)!;
    expect(group.originSiteId).toBe(dangerSite);
    expect(group.destinationSiteId).toBe(kinSite); // kinship + opportunity beats opportunity alone
    expect(group.reason).toBe("danger");
    expect(group.route.length).toBeGreaterThanOrEqual(2);

    const routeTicks = group.route.length - 1;
    for (let tick = 0; tick < routeTicks; tick++) tickMigrationGroups(world, regionMap);
    // Departure deducted the travellers; arrival added exactly them.
    expect(getSite(world.components, dangerSite)!.populationCount).toBe(originInitial - group.populationCount);
    expect(getSite(world.components, kinSite)!.populationCount).toBe(destInitial + group.populationCount);
    const arrivals = world.events.eventsOfType("migration-arrived");
    expect(arrivals.length).toBe(1);
    expect(arrivals[0]!.causeEventId).toBe(group.departedEventId);

    // Displacement: a real territorial cession pushes its own migration.
    const displacedSite = createSite(world, regionMap, 6, 6, 8, 200);
    establishPolity(world, displacedSite);
    world.events.record({
      tick: world.clock.tick,
      eventType: "territory-ceded",
      subjectIds: [displacedSite],
      objectIds: [kinSite],
      location: { x: 0, y: 0, z: 0 },
    });
    const displacedGroups = planMigrations(world, regionMap, [displacedSite, kinSite, richSite, poorSite]);
    expect(displacedGroups.length).toBe(1);
    expect(getMigrationGroup(world.components, displacedGroups[0]!)!.reason).toBe("displacement");
  });
});
