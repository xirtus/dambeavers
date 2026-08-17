/**
 * Headless acceptance test for P3-09 -- Fermentation.
 *
 * Roadmap acceptance test: "fermentable liquid changes composition over
 * time based on conditions; intoxication is not yet required."
 *
 * `tickFermentation` converts a real fraction of one dissolved substance
 * into another each tick, scaled by the CURRENT ambient temperature
 * (`Weather.ts`'s real day/night sinusoid): the same liquid under a warm
 * noon sky ferments measurably faster than under a cold midnight sky,
 * and substance mass is conserved (what leaves one fraction appears in
 * the other). No intoxication model is required.
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
import { Weather, ambientTemperature } from "../../src/sim/weather/Weather.js";
import type { World } from "../../src/sim/persistence/WorldSnapshot.js";
import { createLiquidContainer, setLiquidContents, getLiquidContents, tickFermentation } from "../../src/sim/economy/Liquid.js";

const TICKS_PER_DAY = 2400;
const NOON_TICK = TICKS_PER_DAY / 2; // phase 0.5: warmest
const MIDNIGHT_TICK = 0; // phase 0: coldest

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
  const random = new RandomStreams(109);
  const events = new EventLog(entities);
  return { world: { clock, random, entities, components, grid, terrain, events, water, weather } };
}

function fermentForTicks(world: World, containerId: EntityId, ticks: number): void {
  for (let i = 0; i < ticks; i++) tickFermentation(world, containerId, "sugar", "alcohol");
}

describe("P3-09 -- Fermentation", () => {
  it("fermentable liquid changes composition over time, faster under warm conditions than cold", () => {
    const warm = buildWorld();
    warm.world.clock.advanceTicks(NOON_TICK);
    expect(ambientTemperature(warm.world.clock.tick)).toBeCloseTo(1.0, 1);

    const cold = buildWorld();
    cold.world.clock.advanceTicks(MIDNIGHT_TICK);
    expect(ambientTemperature(cold.world.clock.tick)).toBeCloseTo(0.4, 1);
    expect(ambientTemperature(warm.world.clock.tick)).toBeGreaterThan(ambientTemperature(cold.world.clock.tick));

    const warmBarrel = createLiquidContainer(warm.world, 100, { x: 1, y: 3, z: 1 });
    setLiquidContents(warm.world.components, warmBarrel, { capacityL: 100, materialId: "water", volumeL: 50, composition: { sugar: 0.4 } });
    const coldBarrel = createLiquidContainer(cold.world, 100, { x: 1, y: 3, z: 1 });
    setLiquidContents(cold.world.components, coldBarrel, { capacityL: 100, materialId: "water", volumeL: 50, composition: { sugar: 0.4 } });

    fermentForTicks(warm.world, warmBarrel, 200);
    fermentForTicks(cold.world, coldBarrel, 200);

    const warmAfter = getLiquidContents(warm.world.components, warmBarrel)!;
    const coldAfter = getLiquidContents(cold.world.components, coldBarrel)!;

    // Composition changes over time in both worlds...
    expect(warmAfter.composition.alcohol).toBeGreaterThan(0);
    expect(coldAfter.composition.alcohol).toBeGreaterThan(0);
    expect(warmAfter.composition.sugar!).toBeLessThan(0.4);
    expect(coldAfter.composition.sugar!).toBeLessThan(0.4);

    // ...but based on conditions: warm ferments measurably faster.
    expect(warmAfter.composition.alcohol).toBeGreaterThan(coldAfter.composition.alcohol!);

    // Substance conservation: converted sugar appears as alcohol.
    const warmSugar = warmAfter.composition.sugar ?? 0;
    const warmAlcohol = warmAfter.composition.alcohol ?? 0;
    expect(warmSugar + warmAlcohol).toBeCloseTo(0.4);
  });
});
