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
import { RefuseComponent, createRefuse, getRefuse, setRefuse } from "../../src/sim/logistics/Refuse.js";

function buildFlatWorld(sizeX = 6, sizeY = 6, sizeZ = 6, floor = 2): { world: World; materials: MaterialRegistry; water: WaterField } {
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

describe("Refuse", () => {
  it("creates a physical material-bearing refuse item at a real position", () => {
    const { world } = buildFlatWorld();

    const refuseId = createRefuse(world.entities, world.components, world.grid, { x: 2, y: 3, z: 2 }, {
      materialId: "plant-matter",
      massKg: 0.1,
      origin: "food-consumption",
      sourceEntityId: 1 as never,
    });

    expect(world.entities.kindOf(refuseId)).toBe("refuse");
    expect(world.grid.positionOf(refuseId)).toEqual({ x: 2, y: 3, z: 2 });
    expect(getRefuse(world.components, refuseId)).toEqual({
      materialId: "plant-matter",
      massKg: 0.1,
      origin: "food-consumption",
      sourceEntityId: 1,
    });
  });

  it("validates malformed restored refuse at the read boundary", () => {
    const { world } = buildFlatWorld();
    const refuseId = world.entities.create("refuse");
    world.components.set(refuseId, RefuseComponent, {
      materialId: undefined,
      massKg: 0.1,
      origin: "food-consumption",
    } as never);

    expect(() => getRefuse(world.components, refuseId)).toThrow(RangeError);
  });

  it("rejects non-positive mass and unknown origins", () => {
    const { world } = buildFlatWorld();
    const refuseId = world.entities.create("refuse");

    expect(() => setRefuse(world.components, refuseId, { materialId: "plant-matter", massKg: 0, origin: "food-consumption" })).toThrow(RangeError);
    expect(() => setRefuse(world.components, refuseId, { materialId: "plant-matter", massKg: 0.1, origin: "garbage" as never })).toThrow(RangeError);
  });

  it("persists refuse state and position through full-world save/reload", () => {
    const { world } = buildFlatWorld();
    const refuseId = createRefuse(world.entities, world.components, world.grid, { x: 2, y: 3, z: 2 }, {
      materialId: "plant-matter",
      massKg: 0.1,
      origin: "food-consumption",
      sourceEntityId: 1 as never,
    });

    const restoreMaterials = new MaterialRegistry();
    registerStandardMaterials(restoreMaterials);
    const restored = restoreWorld(JSON.parse(JSON.stringify(snapshotWorld(world))), { componentTypes: ALL_COMPONENT_TYPES, materials: restoreMaterials });

    expect(restored.entities.kindOf(refuseId)).toBe("refuse");
    expect(restored.grid.positionOf(refuseId)).toEqual({ x: 2, y: 3, z: 2 });
    expect(getRefuse(restored.components, refuseId)).toEqual(getRefuse(world.components, refuseId));
  });
});
