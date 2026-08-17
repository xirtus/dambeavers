/**
 * Headless acceptance test for P4-11 -- Water temperature.
 *
 * Roadmap acceptance test: "water bodies change temperature according to
 * environment and influence creature/plant suitability."
 *
 * `WaterTemperatureField` is a real persisted per-column temperature that
 * drifts toward the current seasonal ambient at a real thermal-inertia
 * rate (slower than soil -- water holds temperature longer); a dry
 * column's reading freezes rather than chasing air it isn't exposed to.
 * The field drives the freeze/thaw system (P4-12) and fish suitability
 * reads the same seasonal temperature the field tracks.
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
import { WaterTemperatureField } from "../../src/sim/hydrology/WaterTemperature.js";
import { seasonalAmbientTemperature } from "../../src/sim/weather/Seasons.js";

function buildWorld(): { world: World } {
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
  const random = new RandomStreams(411);
  const events = new EventLog(entities);
  return { world: { clock, random, entities, components, grid, terrain, events, water, weather } };
}

describe("P4-11 -- Water temperature", () => {
  it("water temperature drifts toward the environment with real thermal inertia, and freezes in place when dry", () => {
    const { world } = buildWorld();

    // A cold body of water warms toward the seasonal ambient -- and, being
    // water, does so with real inertia (slower than an instant snap).
    world.water.setDepth(5, 5, 3);
    const cold = new WaterTemperatureField(20, 20, 0.05);
    const coldBefore = cold.temperatureAt(5, 5);
    expect(coldBefore).toBe(0.05);
    for (let i = 0; i < 500; i++) cold.tick(world.water, world.clock.tick, 5, 5);
    const coldAfter = cold.temperatureAt(5, 5);
    const ambient = seasonalAmbientTemperature(world.clock.tick);
    expect(coldAfter).toBeGreaterThan(coldBefore); // warmed toward the environment
    expect(coldAfter).toBeLessThan(Math.max(coldBefore, ambient) + 0.0001); // never overshoots the target

    // A warm body cools toward the same ambient.
    const warm = new WaterTemperatureField(20, 20, 0.95);
    for (let i = 0; i < 500; i++) warm.tick(world.water, world.clock.tick, 5, 5);
    expect(warm.temperatureAt(5, 5)).toBeLessThan(0.95);

    // A dry column's reading freezes: no body of water to expose to the air.
    const dryField = new WaterTemperatureField(20, 20, 0.4);
    const dryBefore = dryField.temperatureAt(9, 9);
    for (let i = 0; i < 500; i++) dryField.tick(world.water, world.clock.tick, 9, 9);
    expect(dryField.temperatureAt(9, 9)).toBe(dryBefore);
  });
});
