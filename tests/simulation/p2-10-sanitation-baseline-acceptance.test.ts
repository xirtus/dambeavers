/**
 * Headless acceptance test for P2-10 -- Sanitation baseline.
 *
 * Roadmap acceptance test:
 *   "accumulated waste can degrade local environmental quality through a
 *   measurable state variable."
 *
 * Sanitation is deliberately derived from ordinary authoritative facts:
 * physical refuse entities (P2-09), their live grid positions, material
 * decay resistance, and the real water field (P1-03). No cleanup counter,
 * scripted filth zone, or hidden pollution event is introduced here.
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
import { stepFlow } from "../../src/sim/hydrology/Flow.js";
import { Weather } from "../../src/sim/weather/Weather.js";
import type { World } from "../../src/sim/persistence/WorldSnapshot.js";
import { createRefuse } from "../../src/sim/logistics/Refuse.js";
import { sanitationAt } from "../../src/sim/logistics/Sanitation.js";

function buildFlatWorld(sizeX = 8, sizeY = 8, sizeZ = 8, floor = 2): { world: World; materials: MaterialRegistry; water: WaterField } {
  const entities = new EntityIdRegistry();
  const components = new ComponentStore(entities);
  const grid = new WorldGrid({ sizeX, sizeY, sizeZ }, entities);
  const materials = new MaterialRegistry();
  registerStandardMaterials(materials);
  const terrain = new TerrainField(grid, materials);
  for (let x = 0; x < sizeX; x++) {
    for (let z = 0; z < sizeZ; z++) {
      for (let y = 0; y <= floor; y++) terrain.setMaterial(x, y, z, "soil");
    }
  }
  const water = new WaterField(grid);
  const weather = new Weather();
  const clock = new SimulationClock({ tickRateHz: 20 });
  const random = new RandomStreams(210);
  const events = new EventLog(entities);
  return { world: { clock, random, entities, components, grid, terrain, events, water, weather }, materials, water };
}

function placeRefuse(world: World, x: number, z: number, massKg: number): EntityId {
  const floor = world.grid.surfaceY(x, z)!;
  return createRefuse(world.entities, world.components, world.grid, { x, y: floor + 1, z }, {
    materialId: "plant-matter",
    massKg,
    origin: "food-consumption",
  });
}

describe("P2-10 -- Sanitation baseline", () => {
  it("accumulated physical waste degrades a measurable local environmental-quality value", () => {
    const { world, materials, water } = buildFlatWorld();
    const column = { x: 3, z: 3 };
    const pristine = sanitationAt(world, materials, column);

    const first = placeRefuse(world, column.x, column.z, 1);
    const oneWasteItem = sanitationAt(world, materials, column);
    const second = placeRefuse(world, column.x, column.z, 2);
    const accumulatedWaste = sanitationAt(world, materials, column);

    expect(pristine.environmentalQuality).toBe(1);
    expect(oneWasteItem.refuseItemIds).toEqual([first]);
    expect(accumulatedWaste.refuseItemIds).toEqual([first, second]);
    expect(accumulatedWaste.refuseMassKg).toBe(3);
    expect(accumulatedWaste.contamination).toBeGreaterThan(oneWasteItem.contamination);
    expect(accumulatedWaste.environmentalQuality).toBeLessThan(oneWasteItem.environmentalQuality);

    water.addVolume(column.x, column.z, 2);
    stepFlow(water, world.terrain, materials, 1, { conductance: 0.05 });
    const wetWaste = sanitationAt(world, materials, column);

    expect(wetWaste.waterDepth).toBeGreaterThan(0);
    expect(wetWaste.refuseMassKg).toBe(accumulatedWaste.refuseMassKg);
    expect(wetWaste.contamination).toBeGreaterThan(accumulatedWaste.contamination);
    expect(wetWaste.environmentalQuality).toBeLessThan(accumulatedWaste.environmentalQuality);
  });
});
