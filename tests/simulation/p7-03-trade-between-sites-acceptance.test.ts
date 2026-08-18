/**
 * Headless acceptance test for P7-03 -- Trade between sites.
 *
 * Roadmap acceptance test: "shortages/surpluses create physical
 * inter-site trade flows."
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
import {
  dispatchCaravan, tickCaravans, scheduleTrade, hasActiveCaravanBetween,
  foodBalance, hasFoodShortage, hasFoodSurplus, getCaravan,
} from "../../src/sim/politics/Trade.js";

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
  const random = new RandomStreams(703);
  const events = new EventLog(entities);
  return {
    world: { clock, random, entities, components, grid, terrain, events, water, weather },
    regionMap: new RegionMap(12, 12),
  };
}

describe("P7-03 -- Trade between sites", () => {
  it("shortages and surpluses create physical inter-site trade flows", () => {
    const { world, regionMap } = buildWorld();
    // Flat region: all elevations 0, so the real travel cost is pure distance.
    for (let x = 0; x < 12; x++) for (let z = 0; z < 12; z++) regionMap.setElevation(x, z, 0);

    const surplusSite = createSite(world, regionMap, 1, 1, 5, 200);   // balance +150
    const shortageSite = createSite(world, regionMap, 9, 9, 10, 10);  // reserve 100, well below half
    expect(hasFoodSurplus(world, surplusSite)).toBe(true);
    expect(hasFoodShortage(world, shortageSite)).toBe(true);

    const foodBefore = getSite(world.components, shortageSite)!.storedFoodKg;
    const originBefore = getSite(world.components, surplusSite)!.storedFoodKg;

    // The flow is a real caravan carrying real food deducted at departure.
    const caravanId = dispatchCaravan(world, regionMap, surplusSite, shortageSite);
    expect(caravanId).toBeDefined();
    const caravan = getCaravan(world.components, caravanId!)!;
    expect(caravan.foodKg).toBeGreaterThan(0);
    expect(caravan.foodKg).toBeLessThanOrEqual(90); // shortfall cap
    expect(getSite(world.components, surplusSite)!.storedFoodKg).toBeLessThan(originBefore);
    // Nothing arrived yet: the food is physically in transit.
    expect(getSite(world.components, shortageSite)!.storedFoodKg).toBe(foodBefore);
    expect(hasActiveCaravanBetween(world, surplusSite, shortageSite)).toBe(true);
    // No duplicate flows while one is in transit.
    expect(dispatchCaravan(world, regionMap, surplusSite, shortageSite)).toBeUndefined();

    // The caravan travels the ordinary network one cell per tick and
    // delivers ONLY when its real route completes.
    const routeTicks = caravan.route.length - 1;
    for (let tick = 0; tick < routeTicks - 1; tick++) tickCaravans(world, regionMap);
    expect(getSite(world.components, shortageSite)!.storedFoodKg).toBe(foodBefore);
    tickCaravans(world, regionMap);

    expect(getSite(world.components, shortageSite)!.storedFoodKg).toBe(foodBefore + caravan.foodKg);
    expect(world.entities.isKnown(caravanId!)).toBe(true); // retired, still historically resolvable
    const delivered = world.events.eventsOfType("trade-goods-delivered");
    expect(delivered.length).toBe(1);
    expect(delivered[0]!.subjectIds).toContain(surplusSite);
    expect(delivered[0]!.objectIds).toContain(shortageSite);
    // The delivery is causally chained to the departure.
    expect(delivered[0]!.causeEventId).toBe(caravan.departedEventId);

    // No flow without real shortage/surplus states.
    const balancedSite = createSite(world, regionMap, 5, 5, 5, 50); // exactly at reserve
    expect(dispatchCaravan(world, regionMap, surplusSite, balancedSite)).toBeUndefined();

    // scheduleTrade dispatches flows from state alone: a still-short site
    // receives a caravan while the resolved one does not.
    const stillShortSite = createSite(world, regionMap, 7, 7, 10, 20);
    scheduleTrade(world, regionMap, [surplusSite, shortageSite, balancedSite, stillShortSite]);
    expect(hasActiveCaravanBetween(world, surplusSite, stillShortSite)).toBe(true);
  });
});
