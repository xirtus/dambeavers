/**
 * Headless acceptance test for P3-15 -- Mechanical power baseline.
 *
 * Roadmap acceptance test: "Sources may include water wheels or
 * beaver-appropriate equivalents."
 *
 * A real water wheel derives its power from the head difference between
 * its own column and its downstream neighbor's -- real `WaterField`
 * state, never an invented constant: falling water produces power, a
 * flat or dry stretch produces genuinely zero.
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
import { createWaterWheel, getWaterWheel, waterWheelPowerOutput } from "../../src/sim/mechanics/WaterPower.js";

function buildWorld(): { world: World } {
  const entities = new EntityIdRegistry();
  const components = new ComponentStore(entities);
  const grid = new WorldGrid({ sizeX: 20, sizeY: 12, sizeZ: 20 }, entities);
  const materials = new MaterialRegistry();
  registerStandardMaterials(materials);
  const terrain = new TerrainField(grid, materials);
  for (let x = 0; x < 20; x++) for (let z = 0; z < 20; z++) for (let y = 0; y <= 2; y++) terrain.setMaterial(x, y, z, "soil");
  const water = new WaterField(grid);
  const weather = new Weather();
  const clock = new SimulationClock({ tickRateHz: 20 });
  const random = new RandomStreams(115);
  const events = new EventLog(entities);
  return { world: { clock, random, entities, components, grid, terrain, events, water, weather } };
}

describe("P3-15 -- Mechanical power baseline", () => {
  it("a water wheel derives power from real head, and produces zero power without it", () => {
    const { world } = buildWorld();

    // Falling water: upstream depth 3, downstream 0 -> real head -> power.
    world.water.setDepth(9, 9, 3);
    world.water.setDepth(9, 10, 0);
    const wheelId = createWaterWheel(world, { x: 9, z: 9 }, { x: 9, z: 10 });
    const wheel = getWaterWheel(world.components, wheelId)!;
    expect(waterWheelPowerOutput(world.water, wheel)).toBeGreaterThan(0);

    // Flat water: no head difference -> genuinely zero power.
    world.water.setDepth(9, 10, 3);
    expect(waterWheelPowerOutput(world.water, wheel)).toBe(0);

    // Dry wheel: no water at all -> zero.
    world.water.setDepth(9, 9, 0);
    world.water.setDepth(9, 10, 0);
    expect(waterWheelPowerOutput(world.water, wheel)).toBe(0);

    // Placement sanity: the downstream neighbor must be orthogonally
    // adjacent -- the wheel is a real physical mechanism, not a tag.
    expect(() => createWaterWheel(world, { x: 5, z: 5 }, { x: 7, z: 7 })).toThrow(RangeError);
  });
});
