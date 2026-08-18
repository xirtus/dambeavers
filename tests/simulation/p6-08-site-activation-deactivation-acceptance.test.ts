/**
 * Headless acceptance test for P6-08 -- Site activation/deactivation.
 *
 * Roadmap acceptance test: "zooming into an abstracted site reconstructs
 * a detailed simulation consistent with its macro state."
 *
 * Activating a site builds a real, `ColonyLoop`-compatible detailed
 * `World` populated to match the site's own summary state EXACTLY;
 * deactivating reads the detailed world's own live state back -- so
 * changes made while zoomed in are reflected in the macro summary, never
 * discarded.
 */
import { describe, expect, it } from "vitest";
import { EntityIdRegistry } from "../../src/sim/core/EntityId.js";
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
import { activateSite, deactivateSite } from "../../src/sim/region/SiteActivation.js";
import { getFood } from "../../src/sim/labor/Food.js";

const REGION_SIZE = 32;

function buildWorld(): { world: World; regionMap: RegionMap; materials: MaterialRegistry } {
  const entities = new EntityIdRegistry();
  const components = new ComponentStore(entities);
  const grid = new WorldGrid({ sizeX: 20, sizeY: 8, sizeZ: 20 }, entities);
  const materials = new MaterialRegistry();
  registerStandardMaterials(materials);
  const terrain = new TerrainField(grid, materials);
  const water = new WaterField(grid);
  const weather = new Weather();
  const clock = new SimulationClock({ tickRateHz: 20 });
  const random = new RandomStreams(608);
  const events = new EventLog(entities);
  return {
    world: { clock, random, entities, components, grid, terrain, events, water, weather },
    regionMap: new RegionMap(REGION_SIZE, REGION_SIZE),
    materials,
  };
}

describe("P6-08 -- Site activation/deactivation", () => {
  it("zooming into an abstracted site reconstructs a detailed simulation consistent with its macro state, and zooming out reads live state back", () => {
    const { world, regionMap, materials } = buildWorld();
    const siteId = createSite(world, regionMap, 13, 13, 6, 18);

    // Zoom in: a real detailed world, matching the macro state exactly.
    const activated = activateSite(siteId, materials, world);
    expect(getSite(world.components, siteId)!.active).toBe(true);
    expect(activated.world.entities.liveIdsOfKind("beaver")).toHaveLength(6);
    let detailedFoodKg = 0;
    for (const foodId of activated.world.entities.liveIdsOfKind("food")) {
      detailedFoodKg += getFood(activated.world.components, foodId)!.massKg;
    }
    expect(detailedFoodKg).toBeCloseTo(18, 6);

    // Real changes while zoomed in: one resident dies/leaves and some
    // food is consumed -- the detailed world's own live state changes.
    const departingBeaver = activated.world.entities.liveIdsOfKind("beaver")[0]!;
    activated.world.entities.destroy(departingBeaver);
    const consumedFood = activated.world.entities.liveIdsOfKind("food")[0]!;
    activated.world.entities.destroy(consumedFood);

    // Zoom out: the summary reflects the detailed world's ACTUAL live
    // state -- population down by one, food down by the eaten item's mass.
    deactivateSite(siteId, world, activated);
    const after = getSite(world.components, siteId)!;
    expect(after.active).toBe(false);
    expect(after.populationCount).toBe(5);
    expect(after.storedFoodKg).toBeLessThan(18);
    expect(after.storedFoodKg).toBeCloseTo(detailedFoodKg - 1, 6);
  });
});
