/**
 * Headless acceptance test for P4-12 -- Ice/freezing.
 *
 * Roadmap acceptance test: "water can freeze/thaw and alter flow/
 * navigation through ordinary material-state changes."
 *
 * When the water temperature reads below freezing, exactly one layer of
 * a column's real water depth becomes a real solid `ice` material cap at
 * the water's surface -- liquid water remains below it. Thaw reverses
 * exactly that conversion. Flow and navigation change only through the
 * same ordinary material-state mechanism every other water structure
 * uses: the cap is real terrain (`surfaceY`/walkability) with the ice
 * material's own real low permeability.
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
import { tickFreeze, ICE_LAYER_THICKNESS } from "../../src/sim/hydrology/Ice.js";

function buildWorld(): { world: World; materials: MaterialRegistry } {
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
  const random = new RandomStreams(412);
  const events = new EventLog(entities);
  return { world: { clock, random, entities, components, grid, terrain, events, water, weather }, materials };
}

describe("P4-12 -- Ice/freezing", () => {
  it("water freezes into a real solid cap and thaws back, altering state through ordinary material changes", () => {
    const { world, materials } = buildWorld();
    const site = { x: 12, z: 12 };
    world.water.setDepth(site.x, site.z, 2);
    const depthBefore = world.water.depthAt(site.x, site.z);
    const cold = new WaterTemperatureField(20, 20, 0.05);

    // Freeze: one real layer of water becomes a solid ice cap at the surface.
    expect(tickFreeze(world.grid, world.terrain, world.water, cold, site)).toBe("froze");
    const capY = world.grid.surfaceY(site.x, site.z)!;
    expect(world.terrain.materialAt(site.x, capY, site.z)).toBe("ice");
    expect(world.grid.isSolid(site.x, capY, site.z)).toBe(true);
    expect(world.water.depthAt(site.x, site.z)).toBeCloseTo(depthBefore - ICE_LAYER_THICKNESS);
    // Real material properties: ice is far less permeable than open water.
    expect(materials.get("ice").permeability).toBeLessThan(materials.get("soil").permeability);

    // Idempotent while still cold and already capped.
    expect(tickFreeze(world.grid, world.terrain, world.water, cold, site)).toBe("unchanged");

    // Thaw: exactly the frozen layer returns to water, the cap disappears.
    const warm = new WaterTemperatureField(20, 20, 0.9);
    expect(tickFreeze(world.grid, world.terrain, world.water, warm, site)).toBe("thawed");
    expect(world.terrain.materialAt(site.x, capY, site.z)).toBeUndefined();
    expect(world.water.depthAt(site.x, site.z)).toBeCloseTo(depthBefore);

    // Too little water to freeze: no partial cap is fabricated.
    world.water.setDepth(14, 14, ICE_LAYER_THICKNESS - 0.5);
    expect(tickFreeze(world.grid, world.terrain, world.water, cold, { x: 14, z: 14 })).toBe("unchanged");
  });
});
