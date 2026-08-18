/**
 * Headless acceptance test for P6-07 -- Offscreen simulation LOD.
 *
 * Roadmap acceptance test: "an unloaded site advances plausibly while
 * preserving conservation/accounting invariants selected for simulation."
 *
 * An inactive site's population/food advance through a real closed-form
 * per-capita production/consumption model. The selected conservation
 * invariants are: food is never negative, food is never created beyond
 * the real per-capita production term, population never grows without a
 * real food surplus, and population is never negative. All four are
 * checked literally below.
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
import { tickOffscreenSite, OFFSCREEN_FOOD_PRODUCTION_PER_CAPITA } from "../../src/sim/region/OffscreenLOD.js";

const REGION_SIZE = 32;

function buildWorld(): { world: World; regionMap: RegionMap } {
  const entities = new EntityIdRegistry();
  const components = new ComponentStore(entities);
  const grid = new WorldGrid({ sizeX: 20, sizeY: 8, sizeZ: 20 }, entities);
  const materials = new MaterialRegistry();
  registerStandardMaterials(materials);
  const terrain = new TerrainField(grid, materials);
  const water = new WaterField(grid);
  const weather = new Weather();
  const clock = new SimulationClock({ tickRateHz: 20 });
  const random = new RandomStreams(607);
  const events = new EventLog(entities);
  return {
    world: { clock, random, entities, components, grid, terrain, events, water, weather },
    regionMap: new RegionMap(REGION_SIZE, REGION_SIZE),
  };
}

describe("P6-07 -- Offscreen simulation LOD", () => {
  it("an unloaded site advances plausibly while preserving the selected conservation/accounting invariants", () => {
    const { world, regionMap } = buildWorld();
    const siteId = createSite(world, regionMap, 8, 8, 10, 100);
    const initial = getSite(world.components, siteId)!;

    // Plausible advance under a fertile biome: a real surplus accumulates
    // (production outpaces consumption), never exceeding what the real
    // per-capita production term could possibly have produced.
    const fertile = tickOffscreenSite(initial, 0.9, 1000);
    expect(fertile.storedFoodKg).toBeGreaterThan(initial.storedFoodKg);
    const productionCeiling = initial.storedFoodKg + initial.populationCount * OFFSCREEN_FOOD_PRODUCTION_PER_CAPITA * 1000;
    expect(fertile.storedFoodKg).toBeLessThanOrEqual(productionCeiling + 1e-9);
    expect(fertile.storedFoodKg).toBeGreaterThanOrEqual(0); // never negative
    expect(fertile.populationCount).toBeGreaterThanOrEqual(0); // never negative

    // Conservation under starvation: with no food and no fertility, the
    // site never fabricates food and never grows -- it can only decline
    // by the real derived starvation shortfall.
    const starved = tickOffscreenSite({ ...initial, storedFoodKg: 0 }, 0, 500);
    expect(starved.storedFoodKg).toBe(0);
    expect(starved.populationCount).toBeLessThanOrEqual(initial.populationCount);

    // Real accounting: food change equals real production minus real
    // consumption over one exact tick (closed-form, not a drifted loop).
    const single = tickOffscreenSite(initial, 1, 1);
    const expectedFood = initial.storedFoodKg + initial.populationCount * OFFSCREEN_FOOD_PRODUCTION_PER_CAPITA - initial.populationCount * 0.04;
    expect(single.storedFoodKg).toBeCloseTo(expectedFood, 6);
  });
});
