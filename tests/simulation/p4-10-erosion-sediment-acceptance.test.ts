/**
 * Headless acceptance test for P4-10 -- Erosion and sediment.
 *
 * Roadmap acceptance test: "high flow moves sediment and can measurably
 * alter channel geometry over time."
 *
 * Real, mass-conserving sediment transport: a high-flow source column
 * eventually loses its topmost real terrain cell and the SAME material
 * appears one cell higher downstream -- the channel's geometry genuinely
 * changes through the same ordinary terrain-state mechanism flow and
 * navigation already read.
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
import { tickErosion } from "../../src/sim/hydrology/Erosion.js";

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
  const random = new RandomStreams(410);
  const events = new EventLog(entities);
  return { world: { clock, random, entities, components, grid, terrain, events, water, weather }, materials };
}

describe("P4-10 -- Erosion and sediment", () => {
  it("high flow moves real sediment and measurably alters channel geometry", () => {
    const { world, materials } = buildWorld();
    // Soft, erodible sand at the source; deep water pouring onto dry ground
    // (the largest possible real drop -- the previously-fixed bug case).
    world.terrain.setMaterial(9, 3, 9, "sand");
    world.water.setDepth(9, 9, 10);
    world.water.setDepth(10, 9, 0);
    const sourceFloorBefore = world.grid.surfaceY(9, 9);
    const downstreamFloorBefore = world.grid.surfaceY(10, 9);

    const random = world.random.stream("erosion");
    let eroded = false;
    for (let i = 0; i < 30000 && !eroded; i++) {
      if (tickErosion(world.grid, world.terrain, world.water, materials, random, { x: 9, z: 9 }, { x: 10, z: 9 }) === "eroded") eroded = true;
    }
    expect(eroded).toBe(true);

    // Channel geometry measurably changed: the source's top cell is gone
    // and the SAME material now sits one cell higher downstream.
    const sourceFloorAfter = world.grid.surfaceY(9, 9);
    const downstreamFloorAfter = world.grid.surfaceY(10, 9);
    expect(sourceFloorAfter).toBeLessThan(sourceFloorBefore!);
    expect(downstreamFloorAfter).toBeGreaterThan(downstreamFloorBefore!);
    expect(world.terrain.materialAt(10, downstreamFloorAfter!, 9)).toBe("sand");
  });
});
