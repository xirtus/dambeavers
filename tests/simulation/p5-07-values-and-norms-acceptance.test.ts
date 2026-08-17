/**
 * Headless acceptance test for P5-07 -- Values and norms.
 *
 * Roadmap acceptance test: "two settlements can evaluate the same
 * behavior differently because of generated norms."
 *
 * Each household's norm profile is generated ONCE from its founding
 * members' real traits plus real variation, and persists. The SAME
 * behavior, fed through the SAME evaluation formula against two
 * households' own generated values, scores differently -- culture
 * genuinely differs between groups, never a shared global table.
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
import { Weather } from "../../src/sim/weather/Weather.js";
import type { World } from "../../src/sim/persistence/WorldSnapshot.js";
import { spawnBeaver } from "../../src/sim/creatures/Beaver.js";
import { setWorldTraits } from "../../src/sim/creatures/Traits.js";
import { ensureSharedHousehold } from "../../src/sim/creatures/Household.js";
import { getNormProfile, evaluateBehavior, generateNorms } from "../../src/sim/creatures/Norms.js";

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
  const random = new RandomStreams(507);
  const events = new EventLog(entities);
  return { clock, random, entities, components, grid, terrain, events, water, weather };
}

function spawn(world: World, name: string, x: number, z: number): EntityId {
  return spawnBeaver(world, { name, position: { x, y: 3, z } });
}

describe("P5-07 -- Values and norms", () => {
  it("two households' generated norms evaluate the same behavior differently", () => {
    const world = buildWorld();

    // Household A: founded by industrious beavers.
    const a1 = spawn(world, "A1", 9, 9);
    const a2 = spawn(world, "A2", 9, 10);
    setWorldTraits(world, a1, { sociability: 0.5, resilience: 0.5, industriousness: 1, assignedTick: 0 });
    setWorldTraits(world, a2, { sociability: 0.5, resilience: 0.5, industriousness: 1, assignedTick: 0 });
    const householdA = ensureSharedHousehold(world, a1, a2);

    // Household B: founded by idle beavers.
    const b1 = spawn(world, "B1", 10, 9);
    const b2 = spawn(world, "B2", 10, 10);
    setWorldTraits(world, b1, { sociability: 0.5, resilience: 0.5, industriousness: 0, assignedTick: 0 });
    setWorldTraits(world, b2, { sociability: 0.5, resilience: 0.5, industriousness: 0, assignedTick: 0 });
    const householdB = ensureSharedHousehold(world, b1, b2);

    // Generated once, from real founders + real variation, and persisted.
    const normsA = getNormProfile(world.components, householdA)!;
    const normsB = getNormProfile(world.components, householdB)!;
    expect(normsA.values.industriousness).toBeGreaterThan(normsB.values.industriousness);
    expect(() => generateNorms(world, householdA, world.random.stream("norms-regen"))).toThrow(RangeError); // culture is not silently re-rolled

    // The SAME behavior (identical magnitude along the same dimension)
    // evaluates differently for the two households.
    const evalA = evaluateBehavior(normsA, "industriousness", 1);
    const evalB = evaluateBehavior(normsB, "industriousness", 1);
    expect(evalA).toBeGreaterThan(evalB);
  });
});
