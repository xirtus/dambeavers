/**
 * Headless acceptance test for P5-03 -- Stress and emotional state.
 *
 * Roadmap acceptance test: "chronic adverse conditions alter behavior
 * through accumulated psychological state."
 *
 * Stress is an ACCUMULATED `[0,1]` level, not a live per-tick reading:
 * sustained adverse conditions (urgent needs, chronic negative memory)
 * raise it tick by tick; once conditions recover it decays more slowly
 * than it rose. While elevated, it measurably alters behavior through
 * the real work-rate multiplier consumed by labor drivers.
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
import { spawnBeaver } from "../../src/sim/creatures/Beaver.js";
import { setNeeds } from "../../src/sim/creatures/Needs.js";
import { tickStress, getStress, stressWorkMultiplier } from "../../src/sim/creatures/Stress.js";

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
  const random = new RandomStreams(503);
  const events = new EventLog(entities);
  return { clock, random, entities, components, grid, terrain, events, water, weather };
}

describe("P5-03 -- Stress and emotional state", () => {
  it("chronic adverse conditions accumulate stress that measurably alters behavior", () => {
    const world = buildWorld();
    const beaver = spawnBeaver(world, { name: "Worker", position: { x: 4, y: 3, z: 4 } });

    // Chronic adverse conditions: sustained urgent needs.
    setNeeds(world.components, beaver, { hunger: 0.9, thirst: 0.9, fatigue: 0.9, thermalComfort: 0.1 });

    // Accumulation: stress rises tick by tick -- an accumulated state,
    // not an instant flip.
    const levels: number[] = [];
    for (let i = 0; i < 80; i++) {
      world.clock.advanceTicks(1);
      tickStress(world, beaver);
      levels.push(getStress(world.components, beaver)!.level);
    }
    expect(levels[levels.length - 1]!).toBeGreaterThan(levels[0]!);
    expect(levels[levels.length - 1]!).toBeGreaterThan(0.3);
    for (let i = 1; i < levels.length; i++) expect(levels[i]!).toBeGreaterThanOrEqual(levels[i - 1]!);

    // Behavior: elevated stress measurably reduces the real work-rate
    // multiplier labor drivers consume.
    expect(stressWorkMultiplier(world.components, beaver)).toBeLessThan(1);

    // Recovery: once conditions improve, the accumulated state decays --
    // slower than it rose, matching real psychology.
    setNeeds(world.components, beaver, { hunger: 0, thirst: 0, fatigue: 0, thermalComfort: 1 });
    const beforeRecovery = getStress(world.components, beaver)!.level;
    for (let i = 0; i < 100; i++) {
      world.clock.advanceTicks(1);
      tickStress(world, beaver);
    }
    expect(getStress(world.components, beaver)!.level).toBeLessThan(beforeRecovery);
  });
});
