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
import { snapshotWorld, restoreWorld } from "../../src/sim/persistence/WorldSnapshot.js";
import { ALL_COMPONENT_TYPES } from "../../src/sim/persistence/AllComponentTypes.js";
import { createRefuse, setRefuse } from "../../src/sim/logistics/Refuse.js";
import { getSanitationDebugState, sanitationAt } from "../../src/sim/logistics/Sanitation.js";

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
  const random = new RandomStreams(1);
  const events = new EventLog(entities);
  return { world: { clock, random, entities, components, grid, terrain, events, water, weather }, materials, water };
}

function placeRefuse(world: World, x: number, z: number, massKg: number, materialId = "plant-matter") {
  const floor = world.grid.surfaceY(x, z)!;
  return createRefuse(world.entities, world.components, world.grid, { x, y: floor + 1, z }, {
    materialId,
    massKg,
    origin: "food-consumption",
  });
}

describe("Sanitation", () => {
  it("reports pristine environmental quality when no live refuse is present", () => {
    const { world, materials } = buildFlatWorld();

    expect(sanitationAt(world, materials, { x: 3, z: 3 })).toEqual({
      column: { x: 3, z: 3 },
      refuseItemIds: [],
      refuseMassKg: 0,
      waterDepth: 0,
      contamination: 0,
      environmentalQuality: 1,
    });
  });

  it("accumulates physical refuse mass into a lower local environmental-quality value", () => {
    const { world, materials } = buildFlatWorld();
    const first = placeRefuse(world, 3, 3, 1);
    const oneItem = sanitationAt(world, materials, { x: 3, z: 3 });
    const second = placeRefuse(world, 3, 3, 2);
    const twoItems = sanitationAt(world, materials, { x: 3, z: 3 });

    expect(oneItem.refuseItemIds).toEqual([first]);
    expect(twoItems.refuseItemIds).toEqual([first, second]);
    expect(twoItems.refuseMassKg).toBe(3);
    expect(twoItems.contamination).toBeGreaterThan(oneItem.contamination);
    expect(twoItems.environmentalQuality).toBeLessThan(oneItem.environmentalQuality);
  });

  it("uses standing water as a real environmental leaching multiplier", () => {
    const { world, materials, water } = buildFlatWorld();
    placeRefuse(world, 3, 3, 1);
    const dry = sanitationAt(world, materials, { x: 3, z: 3 });

    water.setDepth(3, 3, 2);
    const wet = sanitationAt(world, materials, { x: 3, z: 3 });

    expect(wet.waterDepth).toBe(2);
    expect(wet.contamination).toBeGreaterThan(dry.contamination);
    expect(wet.environmentalQuality).toBeLessThan(dry.environmentalQuality);
  });

  it("ignores destroyed, unpositioned, and other-column refuse when sampling one column", () => {
    const { world, materials } = buildFlatWorld();
    const live = placeRefuse(world, 3, 3, 1);
    const destroyed = placeRefuse(world, 3, 3, 5);
    const elsewhere = placeRefuse(world, 4, 3, 5);
    const unpositioned = world.entities.create("refuse");
    world.entities.destroy(destroyed);
    setRefuse(world.components, unpositioned, {
      materialId: "plant-matter",
      massKg: 5,
      origin: "food-consumption",
    });

    const sample = sanitationAt(world, materials, { x: 3, z: 3 });

    expect(sample.refuseItemIds).toEqual([live]);
    expect(sample.refuseItemIds).not.toContain(destroyed);
    expect(sample.refuseItemIds).not.toContain(elsewhere);
    expect(sample.refuseItemIds).not.toContain(unpositioned);
  });

  it("derives identical sanitation after save/reload because refuse and water are the persistent facts", () => {
    const { world, materials, water } = buildFlatWorld();
    placeRefuse(world, 3, 3, 1);
    placeRefuse(world, 3, 3, 2);
    water.setDepth(3, 3, 1);

    const restoreMaterials = new MaterialRegistry();
    registerStandardMaterials(restoreMaterials);
    const restored = restoreWorld(JSON.parse(JSON.stringify(snapshotWorld(world))), { componentTypes: ALL_COMPONENT_TYPES, materials: restoreMaterials });

    expect(sanitationAt(restored, restoreMaterials, { x: 3, z: 3 })).toEqual(sanitationAt(world, materials, { x: 3, z: 3 }));
  });

  it("debug state lists only contaminated columns in deterministic coordinate order", () => {
    const { world, materials } = buildFlatWorld();
    placeRefuse(world, 5, 5, 1);
    placeRefuse(world, 2, 2, 1);

    expect(getSanitationDebugState(world, materials).contaminatedColumns.map((sample) => sample.column)).toEqual([
      { x: 2, z: 2 },
      { x: 5, z: 5 },
    ]);
  });
});
