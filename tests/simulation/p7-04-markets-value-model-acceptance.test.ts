/**
 * Headless acceptance test for P7-04 -- Markets/value model.
 *
 * Roadmap acceptance test: "relative scarcity changes exchange value
 * without per-item scripted prices."
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
import { createSite } from "../../src/sim/region/Site.js";
import { setGood } from "../../src/sim/economy/Good.js";
import { setOwner, getOwner } from "../../src/sim/creatures/Ownership.js";
import { exchangeValueOf, exchangeRate, marketSupply, marketDemand, barterExchange, scarcityFactor } from "../../src/sim/politics/Market.js";

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
  const random = new RandomStreams(704);
  const events = new EventLog(entities);
  return {
    world: { clock, random, entities, components, grid, terrain, events, water, weather },
    regionMap: new RegionMap(24, 24),
  };
}

function stockGood(world: World, siteId: EntityId, goodKind: string, materialId: string, massKg: number): EntityId {
  const itemId = world.entities.create("good");
  setGood(world.components, itemId, { goodKind, materialId, massKg });
  setOwner(world.components, itemId, { ownerType: "institutional", ownerId: siteId });
  return itemId;
}

describe("P7-04 -- Markets/value model", () => {
  it("relative scarcity changes exchange value without per-item scripted prices", () => {
    const { world, regionMap } = buildWorld();

    // Two far-apart markets with different real supply/demand states.
    const abundantSite = createSite(world, regionMap, 2, 2, 20, 100);
    const scarceSite = createSite(world, regionMap, 20, 20, 20, 100);
    // The abundant market holds 200 kg of planks; the scarce market none.
    for (let i = 0; i < 10; i++) stockGood(world, abundantSite, "plank", "wood", 20);

    // Same kind, same real population -- different real supply.
    expect(marketSupply(world, "plank", 2, 2, 4)).toBeCloseTo(200);
    expect(marketSupply(world, "plank", 20, 20, 4)).toBeCloseTo(0);
    expect(marketDemand(world, "plank", 2, 2, 4)).toBeCloseTo(marketDemand(world, "plank", 20, 20, 4));

    // Relative scarcity genuinely changes exchange value: identical planks
    // are worth more where they are scarce than where they are abundant.
    const abundantValue = exchangeValueOf(world, "plank", 2, 2, 4);
    const scarceValue = exchangeValueOf(world, "plank", 20, 20, 4);
    expect(scarceValue).toBeGreaterThan(abundantValue);
    expect(scarcityFactor(marketDemand(world, "plank", 20, 20, 4), 0)).toBeGreaterThan(scarcityFactor(marketDemand(world, "plank", 2, 2, 4), 200));

    // Relative scarcity moves the exchange RATE between kinds: flooding
    // the abundant market with stone blocks cheapens stone against plank.
    const rateBefore = exchangeRate(world, "stone-block", "plank", 2, 2, 4);
    for (let i = 0; i < 10; i++) stockGood(world, abundantSite, "stone-block", "stone", 20);
    const rateAfter = exchangeRate(world, "stone-block", "plank", 2, 2, 4);
    expect(rateAfter).toBeLessThan(rateBefore);

    // Real barter at real values: a scarce-market stone block exchanges
    // for planks at the scarce market when values are within tolerance.
    // Real barter at real values: a plank held by the scarce market's
    // site exchanges for stone held by the abundant site, at the scarce
    // market -- the masses chosen so the two lots' computed values match
    // within tolerance there (the stone lot is NOT in the scarce
    // market's local supply: its owner is the distant site, so it
    // honestly doesn't count toward local abundance).
    const plankA = stockGood(world, scarceSite, "plank", "wood", 5);
    const stoneB = stockGood(world, abundantSite, "stone-block", "stone", 2.38);
    expect(barterExchange(world, plankA, stoneB, scarceSite, abundantSite, 20, 20, 4)).toBe(true);
    expect(getOwner(world.components, plankA)).toEqual({ ownerType: "institutional", ownerId: abundantSite });
    expect(getOwner(world.components, stoneB)).toEqual({ ownerType: "institutional", ownerId: scarceSite });
  });
});
