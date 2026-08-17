/**
 * Headless acceptance test for P1-15 — Basic temperature exposure.
 *
 * Roadmap acceptance test (DAMN_BEAVERS_MASTER_ROADMAP.md, P1-15):
 *   "a beaver in cold water changes thermal state faster than one on
 *   mild dry ground."
 *
 * Drives the full real pipeline: two real beavers spawned into a real
 * world (real `WaterField`, real `MaterialRegistry` with the standard
 * "water"/"air" materials, P0-07, unmodified), one standing in real
 * standing water, one on real dry ground, both ticked via the SAME
 * `tickBeaverNeeds` real per-tick driver (P1-06/13/14/15 all composed,
 * exactly as any other beaver in this simulation would be) -- not a
 * direct call to the underlying pure `applyThermalExposure` formula
 * (already unit-tested in `tests/unit/needs.test.ts`) or a hand-set
 * `ThermalEnvironment`.
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
import { spawnBeaver, getSwimmer } from "../../src/sim/creatures/Beaver.js";
import { getNeeds } from "../../src/sim/creatures/Needs.js";
import { tickBeaverNeeds } from "../../src/sim/creatures/BeaverNeeds.js";

const SIZE_X = 10;
const SIZE_Y = 8;
const SIZE_Z = 10;

function buildWorld(): { world: World; materials: MaterialRegistry; water: WaterField } {
  const entities = new EntityIdRegistry();
  const components = new ComponentStore(entities);
  const grid = new WorldGrid({ sizeX: SIZE_X, sizeY: SIZE_Y, sizeZ: SIZE_Z }, entities);
  const materials = new MaterialRegistry();
  registerStandardMaterials(materials);
  const terrain = new TerrainField(grid, materials);
  for (let x = 0; x < SIZE_X; x++) {
    for (let z = 0; z < SIZE_Z; z++) {
      for (let y = 0; y <= 2; y++) terrain.setMaterial(x, y, z, "soil");
    }
  }
  const water = new WaterField(grid);
  const weather = new Weather();
  const clock = new SimulationClock({ tickRateHz: 20 });
  const random = new RandomStreams("p1-15-temperature");
  const events = new EventLog(entities);
  const world: World = { clock, random, entities, components, grid, terrain, events, water, weather };
  return { world, materials, water };
}

function spawnAt(world: World, x: number, z: number, name: string) {
  const floor = world.grid.surfaceY(x, z)!;
  return spawnBeaver(world, { name, position: { x, y: floor + 1, z } });
}

describe("P1-15 acceptance: a beaver in cold water changes thermal state faster than one on mild dry ground", () => {
  it("holds across a real, driven simulation of both beavers over many ticks", () => {
    const { world, materials, water } = buildWorld();

    const wetSpot = { x: 3, z: 3 };
    const drySpot = { x: 7, z: 7 };
    water.setDepth(wetSpot.x, wetSpot.z, 0.6); // real standing water, deep enough that a swimmer stays fully in it

    const soaked = spawnAt(world, wetSpot.x, wetSpot.z, "Soaked");
    const soakedProfile = getSwimmer(world.components, soaked)!;
    const dry = spawnAt(world, drySpot.x, drySpot.z, "Dry");
    const dryProfile = getSwimmer(world.components, dry)!;

    // Both start identically comfortable (P1-06's own BASELINE_NEEDS).
    expect(getNeeds(world.components, soaked)!.thermalComfort).toBe(1);
    expect(getNeeds(world.components, dry)!.thermalComfort).toBe(1);

    for (let tick = 0; tick < 30; tick++) {
      world.clock.resume();
      world.clock.advanceTicks(1);
      tickBeaverNeeds(world.grid, world.terrain, water, materials, world.entities, world.components, soaked, soakedProfile);
      tickBeaverNeeds(world.grid, world.terrain, water, materials, world.entities, world.components, dry, dryProfile);
    }

    const soakedComfort = getNeeds(world.components, soaked)!.thermalComfort;
    const dryComfort = getNeeds(world.components, dry)!.thermalComfort;
    const soakedChange = 1 - soakedComfort;
    const dryChange = 1 - dryComfort;

    expect(soakedChange).toBeGreaterThan(0); // genuinely, measurably colder
    expect(soakedChange).toBeGreaterThan(dryChange); // strictly faster thermal-state change than dry ground
  });
});
