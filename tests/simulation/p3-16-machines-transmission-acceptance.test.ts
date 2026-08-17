/**
 * Headless acceptance test for P3-16 -- Machines/transmission.
 *
 * Roadmap acceptance test: "generated power can be transmitted to a
 * workshop/mechanism and ceases when the physical source stops."
 *
 * A real `power-transmission` entity links a water wheel to a workshop.
 * Delivered power is re-derived fresh from the live source on EVERY
 * query: destroy the wheel and the next query reads zero; let the water
 * dry up and the next query reads zero -- no unplug step exists because
 * none is needed.
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
import { createWaterWheel } from "../../src/sim/mechanics/WaterPower.js";
import { connectPower, transmittedPowerTo, workshopPowerMultiplier } from "../../src/sim/mechanics/Machine.js";
import { createWorkshop } from "../../src/sim/economy/Workshop.js";

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
  const random = new RandomStreams(116);
  const events = new EventLog(entities);
  return { world: { clock, random, entities, components, grid, terrain, events, water, weather } };
}

describe("P3-16 -- Machines/transmission", () => {
  it("transmitted power reaches a workshop and ceases the moment the physical source stops", () => {
    const { world } = buildWorld();
    world.water.setDepth(9, 9, 3);
    world.water.setDepth(9, 10, 0);

    const wheelId = createWaterWheel(world, { x: 9, z: 9 }, { x: 9, z: 10 });
    const workshopId = createWorkshop(world, "carpenter", { x: 9, z: 9 });
    connectPower(world, wheelId, workshopId);

    const powered = transmittedPowerTo(world.entities, world.components, world.water, workshopId);
    expect(powered).toBeGreaterThan(0);
    expect(workshopPowerMultiplier(world.entities, world.components, world.water, workshopId)).toBeGreaterThan(1);

    // The physical source is destroyed: the very next query is zero -- no
    // cached wattage, no unplug step.
    world.entities.destroy(wheelId);
    expect(transmittedPowerTo(world.entities, world.components, world.water, workshopId)).toBe(0);

    // And with a live source whose water simply dries up: zero too.
    const dry = buildWorld();
    dry.world.water.setDepth(9, 9, 3);
    dry.world.water.setDepth(9, 10, 0);
    const dryWheelId = createWaterWheel(dry.world, { x: 9, z: 9 }, { x: 9, z: 10 });
    const dryWorkshopId = createWorkshop(dry.world, "carpenter", { x: 9, z: 9 });
    connectPower(dry.world, dryWheelId, dryWorkshopId);
    expect(transmittedPowerTo(dry.world.entities, dry.world.components, dry.world.water, dryWorkshopId)).toBeGreaterThan(0);

    dry.world.water.setDepth(9, 9, 0);
    dry.world.water.setDepth(9, 10, 0);
    expect(transmittedPowerTo(dry.world.entities, dry.world.components, dry.world.water, dryWorkshopId)).toBe(0);
  });
});
