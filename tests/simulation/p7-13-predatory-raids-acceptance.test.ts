/**
 * Headless acceptance test for P7-13 -- Predatory raids.
 *
 * Roadmap acceptance test: "hostile creatures/groups can enter a site
 * for resources or prey using ordinary travel/navigation."
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
import { createOrganization, joinOrganization } from "../../src/sim/politics/Organization.js";
import { formMilitaryUnit } from "../../src/sim/politics/Military.js";
import {
  planSettlementRaid, planPredatorRaid, tickRaids, lootTarget, getRaid, targetDefenders,
} from "../../src/sim/politics/Raids.js";
import { assignMission } from "../../src/sim/politics/Military.js";

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
  const random = new RandomStreams(713);
  const events = new EventLog(entities);
  return {
    world: { clock, random, entities, components, grid, terrain, events, water, weather },
    regionMap: new RegionMap(16, 16),
  };
}

describe("P7-13 -- Predatory raids", () => {
  it("hostile groups enter a site for resources using ordinary travel", () => {
    const { world, regionMap } = buildWorld();
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) regionMap.setElevation(x, z, 0);

    const originSite = createSite(world, regionMap, 1, 1, 5, 50);
    const targetSite = createSite(world, regionMap, 12, 12, 5, 200);

    // A real raiding party: an ordinary organization of ordinary beavers.
    const unitId = createOrganization(world, ["raider"], world.random.stream("unit-name"));
    formMilitaryUnit(world, unitId);
    const raider = spawnBeaver(world, { name: "Raider", position: { x: 3, y: 3, z: 3 } });
    joinOrganization(world, unitId, raider, "raider");

    // The raid travels the ORDINARY network: its route is the real
    // shortest-cost path between the two real site cells.
    const raidId = planSettlementRaid(world, regionMap, unitId, originSite, targetSite, "resources");
    expect(raidId).toBeDefined();
    const raid = getRaid(world.components, raidId!)!;
    expect(raid.route[0]).toEqual({ regionX: 1, regionZ: 1 });
    expect(raid.route[raid.route.length - 1]).toEqual({ regionX: 12, regionZ: 12 });
    expect(raid.raiderIds).toEqual([raider]);
    expect(world.events.eventsOfType("raid-departed").length).toBe(1);

    // One real network step per tick; nothing happens at the target
    // until the route genuinely completes.
    const foodBefore = getSite(world.components, targetSite)!.storedFoodKg;
    const routeTicks = raid.route.length - 1;
    for (let tick = 0; tick < routeTicks - 1; tick++) tickRaids(world, regionMap, world.random.stream(`raid-tick-${tick}`));
    expect(getSite(world.components, targetSite)!.storedFoodKg).toBe(foodBefore);
    expect(getRaid(world.components, raidId!)!.phase).toBe("traveling");

    tickRaids(world, regionMap, world.random.stream("raid-tick-final"));
    expect(getRaid(world.components, raidId!)!.phase).toBe("engaged");
    expect(world.events.eventsOfType("raid-arrived").length).toBe(1);

    // Unopposed raiders loot: the target's stored food genuinely
    // decreases, and the loot returns home PHYSICALLY.
    const loot = lootTarget(world, raidId!);
    expect(loot).toBeGreaterThan(0);
    expect(getSite(world.components, targetSite)!.storedFoodKg).toBe(foodBefore - loot);
    expect(world.events.eventsOfType("raid-looted").length).toBe(1);

    const originBefore = getSite(world.components, originSite)!.storedFoodKg;
    const returnTicks = raid.route.length - 1;
    for (let tick = 0; tick < returnTicks; tick++) tickRaids(world, regionMap, world.random.stream(`raid-return-${tick}`));
    expect(getSite(world.components, originSite)!.storedFoodKg).toBe(originBefore + loot);
    expect(world.events.eventsOfType("raid-returned").length).toBe(1);
    expect(world.entities.isKnown(raidId!)).toBe(true);
  });

  it("hostile creatures enter a site for prey using ordinary travel", () => {
    const { world, regionMap } = buildWorld();
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) regionMap.setElevation(x, z, 0);

    const targetSite = createSite(world, regionMap, 10, 10, 10, 200);
    const foodBefore = getSite(world.components, targetSite)!.storedFoodKg;

    // A predator band from a real wilderness cell travels the same network.
    const raidId = planPredatorRaid(world, regionMap, 2, 2, targetSite, 4);
    expect(raidId).toBeDefined();
    const raid = getRaid(world.components, raidId!)!;
    expect(raid.motive).toBe("prey");
    const routeTicks = raid.route.length - 1;
    for (let tick = 0; tick < routeTicks; tick++) tickRaids(world, regionMap, world.random.stream(`pred-${tick}`));

    // Creatures eat real food at the target; the raid dissolves (no loot
    // to carry home).
    expect(getSite(world.components, targetSite)!.storedFoodKg).toBeLessThan(foodBefore);
    expect(world.events.eventsOfType("raid-looted").length).toBe(1);
    expect(world.entities.isKnown(raidId!)).toBe(true);
  });

  it("a defended site contests the arrival (real defenders, real mission)", () => {
    const { world, regionMap } = buildWorld();
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) regionMap.setElevation(x, z, 0);

    const originSite = createSite(world, regionMap, 1, 1, 5, 50);
    const targetSite = createSite(world, regionMap, 5, 5, 5, 200);

    const raiderUnit = createOrganization(world, ["raider"], world.random.stream("r-unit"));
    formMilitaryUnit(world, raiderUnit);
    joinOrganization(world, raiderUnit, spawnBeaver(world, { name: "R1", position: { x: 3, y: 3, z: 3 } }), "raider");

    const defenderUnit = createOrganization(world, ["defender"], world.random.stream("d-unit"));
    formMilitaryUnit(world, defenderUnit);
    joinOrganization(world, defenderUnit, spawnBeaver(world, { name: "D1", position: { x: 7, y: 3, z: 7 } }), "defender");
    assignMission(world, defenderUnit, "defend", defenderUnit, targetSite);
    expect(targetDefenders(world, targetSite)).toBe(defenderUnit);

    const raidId = planSettlementRaid(world, regionMap, raiderUnit, originSite, targetSite, "resources")!;
    const routeTicks = getRaid(world.components, raidId)!.route.length - 1;
    for (let tick = 0; tick < routeTicks; tick++) tickRaids(world, regionMap, world.random.stream(`c-${tick}`));
    // The arrival is contested: the raid stays engaged (no free loot).
    expect(getRaid(world.components, raidId)!.phase).toBe("engaged");
    expect(getSite(world.components, targetSite)!.storedFoodKg).toBe(200);
  });
});
