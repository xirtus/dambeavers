/**
 * Headless acceptance test for P5-01 -- Expanded personality model.
 *
 * Roadmap acceptance test: "persistent traits influence choices across
 * work, social life, danger, possessions, and recreation."
 *
 * Four optional dials on the persistent P2-14 trait component, each
 * resolved to the same neutral 0.5 baseline when absent. The dials that
 * own real consuming systems today genuinely influence choices:
 * `industriousness` scales real labor priority (work),
 * `possessiveness` scales real conflict proneness (possessions);
 * `courage` (danger) and `playfulness` (recreation) are real, validated,
 * persisted dials awaiting their own future decision systems (Law 10).
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
import { snapshotWorld, restoreWorld } from "../../src/sim/persistence/WorldSnapshot.js";
import { ALL_COMPONENT_TYPES } from "../../src/sim/persistence/AllComponentTypes.js";
import { spawnBeaver } from "../../src/sim/creatures/Beaver.js";
import { setWorldTraits, getTraits, traitOrDefault } from "../../src/sim/creatures/Traits.js";
import { setLaborPriority, laborPriority } from "../../src/sim/jobs/LaborPreferences.js";
import { setStress } from "../../src/sim/creatures/Stress.js";
import { conflictProneness } from "../../src/sim/creatures/Stress.js";

function buildWorld(): World {
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
  const random = new RandomStreams(501);
  const events = new EventLog(entities);
  return { clock, random, entities, components, grid, terrain, events, water, weather };
}

describe("P5-01 -- Expanded personality model", () => {
  it("persistent trait dials influence work and possession choices, and all four persist", () => {
    const world = buildWorld();
    const industrious = spawnBeaver(world, { name: "Industrious", position: { x: 1, y: 3, z: 1 } });
    const lazy = spawnBeaver(world, { name: "Lazy", position: { x: 2, y: 3, z: 2 } });
    setWorldTraits(world, industrious, { sociability: 0.5, resilience: 0.5, industriousness: 1, courage: 0.9, possessiveness: 0.9, playfulness: 0.1, assignedTick: 0 });
    setWorldTraits(world, lazy, { sociability: 0.5, resilience: 0.5, industriousness: 0, courage: 0.1, possessiveness: 0.1, playfulness: 0.9, assignedTick: 0 });

    // Work: industriousness scales the same real labor priority P2-02 uses.
    setLaborPriority(world.components, industrious, "woodcutting", 1);
    setLaborPriority(world.components, lazy, "woodcutting", 1);
    expect(laborPriority(world.components, industrious, "woodcutting")).toBeGreaterThan(laborPriority(world.components, lazy, "woodcutting"));

    // Possessions: possessiveness scales real conflict proneness (P5-03/P5-14's input).
    setStress(world.components, industrious, { level: 0.8 });
    setStress(world.components, lazy, { level: 0.8 });
    expect(conflictProneness(world.components, industrious)).toBeGreaterThan(conflictProneness(world.components, lazy));

    // Danger + recreation dials are real, validated, persisted state.
    expect(getTraits(world.components, industrious)!.courage).toBe(0.9);
    expect(getTraits(world.components, lazy)!.playfulness).toBe(0.9);
    // Absent dials resolve to the neutral 0.5 baseline, never crash.
    const plain = spawnBeaver(world, { name: "Plain", position: { x: 3, y: 3, z: 3 } });
    expect(traitOrDefault(getTraits(world.components, plain), "courage")).toBe(0.5);

    // Persistence: the full dial set survives save/reload.
    const restoredMaterials = new MaterialRegistry();
    registerStandardMaterials(restoredMaterials);
    const restored = restoreWorld(JSON.parse(JSON.stringify(snapshotWorld(world))), { componentTypes: ALL_COMPONENT_TYPES, materials: restoredMaterials });
    expect(getTraits(restored.components, industrious)).toEqual(getTraits(world.components, industrious));
  });
});
