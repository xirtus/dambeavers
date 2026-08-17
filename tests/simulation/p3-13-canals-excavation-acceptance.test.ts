/**
 * Headless acceptance test for P3-13 -- Canals and excavation.
 *
 * Roadmap acceptance test: "excavating terrain creates a new water path
 * that hydrology discovers automatically."
 *
 * A dirt ridge holds back a real pond. Beavers dig the ridge down through
 * the ordinary dig-job pipeline; then plain `stepFlow` -- with no
 * "recompute hydrology" call anywhere -- discovers the new path and water
 * crosses into the dry basin beyond. Hydrology reads live terrain every
 * step; nothing is ever told the canal exists.
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
import type { NavigationProfile } from "../../src/sim/navigation/Pathfinding.js";
import { stepFlow } from "../../src/sim/hydrology/Flow.js";
import { spawnBeaver } from "../../src/sim/creatures/Beaver.js";
import { designateDig, generateDigJob, tickDigJob } from "../../src/sim/labor/Digging.js";

const PROFILE: NavigationProfile = { canSwim: true, maxWadingDepth: 0.5 };

function buildWorld(): { world: World; materials: MaterialRegistry } {
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
  const random = new RandomStreams(113);
  const events = new EventLog(entities);
  return { world: { clock, random, entities, components, grid, terrain, events, water, weather }, materials };
}

function digColumn(world: World, materials: MaterialRegistry, digger: EntityId, x: number, z: number): void {
  const designationId = designateDig(world, { x, z });
  const [jobId] = generateDigJob(world, materials, designationId);
  let outcome: string = "idle";
  for (let i = 0; i < 200 && outcome !== "dug"; i++) {
    outcome = tickDigJob(world.grid, world.terrain, world.water, materials, world.entities, world.components, digger, PROFILE, [jobId!]);
  }
  expect(outcome).toBe("dug");
}

describe("P3-13 -- Canals and excavation", () => {
  it("excavating a ridge creates a new water path that hydrology discovers automatically", () => {
    const { world, materials } = buildWorld();
    // A ridge (top at y=5) holds back a real pond (surface at y=5) from
    // the dry basin at (7,5).
    world.terrain.setMaterial(6, 3, 5, "soil");
    world.terrain.setMaterial(6, 4, 5, "soil");
    world.terrain.setMaterial(6, 5, 5, "soil");
    world.water.setDepth(5, 5, 3);
    const pondDepthBefore = world.water.depthAt(5, 5);

    // Control: with the ridge intact, ordinary flow cannot cross it.
    for (let i = 0; i < 4; i++) stepFlow(world.water, world.terrain, materials, 1.0, { conductance: 0.5 });
    expect(world.water.depthAt(7, 5)).toBeLessThan(1e-6);

    // A real beaver digs the ridge down through the ordinary job pipeline.
    const digger = spawnBeaver(world, { name: "Digger", position: { x: 7, y: 3, z: 6 } });
    digColumn(world, materials, digger, 6, 5); // removes y=5
    digColumn(world, materials, digger, 6, 5); // removes y=4 -- sill now y=3, below the pond surface

    // No "recompute hydrology" call exists or is needed: plain stepFlow
    // reads live terrain and discovers the new path itself.
    for (let i = 0; i < 60; i++) stepFlow(world.water, world.terrain, materials, 1.0, { conductance: 0.5 });
    expect(world.water.depthAt(7, 5)).toBeGreaterThan(0.01);
    expect(world.water.depthAt(5, 5)).toBeLessThan(pondDepthBefore);
  });
});
