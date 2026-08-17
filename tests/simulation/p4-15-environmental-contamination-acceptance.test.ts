/**
 * Headless acceptance test for P4-15 -- Environmental contamination.
 *
 * Roadmap acceptance test: "contaminants move through water/material
 * transfer and can expose organisms downstream."
 *
 * Contamination is sourced from real sanitation state (P2-10's own
 * formula, unmodified) and transported each tick toward whichever
 * neighbor has the lower real water-surface elevation -- contaminants
 * move WITH water, never merely diffusing in place. The downstream
 * column's concentration is real, queryable exposure.
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
import { setRefuse } from "../../src/sim/logistics/Refuse.js";
import { ContaminationField } from "../../src/sim/ecology/Contamination.js";

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
  const random = new RandomStreams(415);
  const events = new EventLog(entities);
  return { world: { clock, random, entities, components, grid, terrain, events, water, weather }, materials };
}

describe("P4-15 -- Environmental contamination", () => {
  it("contaminants move with water toward downstream columns, where real exposure is derivable", () => {
    const { world, materials } = buildWorld();
    const field = new ContaminationField(20, 20);

    // Real refuse (P2-09) in standing water -- the contamination source is
    // P2-10's own sanitation formula, unmodified.
    world.water.setDepth(16, 16, 3);
    world.water.setDepth(17, 16, 0); // downstream: lower surface, dry
    const refuseId = world.entities.create("refuse");
    world.grid.setEntityPosition(refuseId, 16, 3, 16);
    setRefuse(world.components, refuseId, { materialId: "plant-matter", massKg: 50, origin: "food-consumption" });

    const sourceBefore = field.concentrationAt(16, 16);
    expect(sourceBefore).toBe(0);
    for (let i = 0; i < 300; i++) field.tickAll(world, materials);

    // Real transport with the water: the source column is contaminated and
    // the downstream neighbor's concentration is real, queryable exposure.
    expect(field.concentrationAt(16, 16)).toBeGreaterThan(0);
    expect(field.concentrationAt(17, 16)).toBeGreaterThan(0);

    // An unrelated dry column far from any water never gains contamination.
    expect(field.concentrationAt(5, 5)).toBe(0);
  });
});
