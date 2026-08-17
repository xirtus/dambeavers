/**
 * Headless acceptance test for P3-08 -- Liquid handling.
 *
 * Roadmap acceptance test: "liquid transferred between containers
 * conserves quantity and composition."
 *
 * `transferLiquid` moves a real volume from one container to another:
 * total quantity is conserved exactly (the source loses precisely what
 * the destination gains), and composition mixes as the volume-weighted
 * average of what was already there and what arrived (real mixing, not
 * discard-and-replace). Mixing two different base liquids is rejected.
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
import { createLiquidContainer, setLiquidContents, getLiquidContents, transferLiquid } from "../../src/sim/economy/Liquid.js";

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
  const random = new RandomStreams(108);
  const events = new EventLog(entities);
  return { world: { clock, random, entities, components, grid, terrain, events, water, weather } };
}

describe("P3-08 -- Liquid handling", () => {
  it("transferred liquid conserves total quantity and mixes composition as a volume-weighted average", () => {
    const { world } = buildWorld();
    const source = createLiquidContainer(world, 100, { x: 1, y: 3, z: 1 });
    const destination = createLiquidContainer(world, 100, { x: 2, y: 3, z: 1 });

    setLiquidContents(world.components, source, { capacityL: 100, materialId: "water", volumeL: 50, composition: { sugar: 0.2 } });
    setLiquidContents(world.components, destination, { capacityL: 100, materialId: "water", volumeL: 10, composition: { sugar: 0.5 } });

    const moved = transferLiquid(world.components, source, destination, 30);
    expect(moved).toBe(30);

    const fromAfter = getLiquidContents(world.components, source)!;
    const toAfter = getLiquidContents(world.components, destination)!;

    // Quantity conserved: source loses exactly what destination gained.
    expect(fromAfter.volumeL).toBeCloseTo(20);
    expect(toAfter.volumeL).toBeCloseTo(40);
    expect(fromAfter.volumeL + toAfter.volumeL).toBeCloseTo(60);

    // Composition conserved through real mixing: the destination's
    // fraction is the volume-weighted average of what it held (10L @ 0.5)
    // and what arrived (30L @ 0.2) -> (10*0.5 + 30*0.2) / 40 = 0.275.
    expect(toAfter.composition.sugar).toBeCloseTo(0.275);
    expect(fromAfter.composition.sugar).toBeCloseTo(0.2);
  });

  it("rejects mixing two different base liquids rather than silently combining them", () => {
    const { world } = buildWorld();
    const source = createLiquidContainer(world, 100, { x: 1, y: 3, z: 1 });
    const destination = createLiquidContainer(world, 100, { x: 2, y: 3, z: 1 });
    setLiquidContents(world.components, source, { capacityL: 100, materialId: "water", volumeL: 10, composition: {} });
    setLiquidContents(world.components, destination, { capacityL: 100, materialId: "milk", volumeL: 10, composition: {} });

    expect(() => transferLiquid(world.components, source, destination, 5)).toThrow(RangeError);
    expect(getLiquidContents(world.components, source)!.volumeL).toBe(10);
    expect(getLiquidContents(world.components, destination)!.volumeL).toBe(10);
  });
});
