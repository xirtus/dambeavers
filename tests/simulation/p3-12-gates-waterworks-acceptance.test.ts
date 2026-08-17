/**
 * Headless acceptance test for P3-12 -- Gates and controllable
 * waterworks.
 *
 * Roadmap acceptance test: "opening/closing a physical gate changes flow
 * through ordinary obstruction geometry."
 *
 * A gate is real `TerrainField` material at a sill. Closed, its dense
 * low-permeability material throttles the SAME `stepFlow` pair that
 * crosses it; opened, the sill frees and water flows through the exact
 * same ordinary flow geometry -- no special gate physics anywhere.
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
import { stepFlow } from "../../src/sim/hydrology/Flow.js";
import { createGate, openGate } from "../../src/sim/hydrology/Gate.js";

function buildWorld(): { world: World; materials: MaterialRegistry } {
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
  const random = new RandomStreams(112);
  const events = new EventLog(entities);
  return { world: { clock, random, entities, components, grid, terrain, events, water, weather }, materials };
}

function stepFour(world: World, materials: MaterialRegistry): void {
  for (let i = 0; i < 4; i++) stepFlow(world.water, world.terrain, materials, 1.0, { conductance: 0.5 });
}

describe("P3-12 -- Gates and controllable waterworks", () => {
  it("opening a physical gate lets water flow through ordinary obstruction geometry where a closed gate held it back", () => {
    const closed = buildWorld();
    closed.world.water.setDepth(5, 5, 4);
    createGate(closed.world, { x: 6, z: 5 }, 3, "stone"); // starts closed: real stone fills the sill
    stepFour(closed.world, closed.materials);
    const closedDownstreamDepth = closed.world.water.depthAt(6, 5);

    const open = buildWorld();
    open.world.water.setDepth(5, 5, 4);
    const gateId = createGate(open.world, { x: 6, z: 5 }, 3, "stone");
    openGate(open.world, gateId); // sill freed: ordinary stepFlow does the rest
    stepFour(open.world, open.materials);
    const openDownstreamDepth = open.world.water.depthAt(6, 5);

    // The same geometry, the same flow step: only the gate's own real
    // obstruction differs, and the downstream depth changes with it.
    expect(closedDownstreamDepth).toBeLessThan(0.1);
    expect(openDownstreamDepth).toBeGreaterThan(0.3);
    expect(openDownstreamDepth).toBeGreaterThan(closedDownstreamDepth * 4);
  });
});
