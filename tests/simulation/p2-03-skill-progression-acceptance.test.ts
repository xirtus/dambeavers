/**
 * Headless acceptance test for P2-03 -- Skill progression.
 *
 * Roadmap acceptance:
 *   "repeated work measurably improves speed/quality according to skill state."
 *
 * Current shipped labor exposes speed hooks, not product-quality hooks:
 * P1-08 tree cutting and P1-10 construction already scale work speed from
 * skill level. This test therefore proves the speed half literally, using
 * a real tree-cut job whose repeated real work raises persistent
 * `Skills.levels.woodcutting`, which then increases later work-per-tick.
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
import { restoreWorld, snapshotWorld } from "../../src/sim/persistence/WorldSnapshot.js";
import { ALL_COMPONENT_TYPES } from "../../src/sim/persistence/AllComponentTypes.js";
import type { NavigationProfile } from "../../src/sim/navigation/Pathfinding.js";
import { setPlant } from "../../src/sim/ecology/Plant.js";
import { PlantSpeciesRegistry } from "../../src/sim/ecology/PlantSpecies.js";
import { registerStandardPlantSpecies } from "../../src/sim/ecology/standardPlantSpecies.js";
import { spawnBeaver, getSkills } from "../../src/sim/creatures/Beaver.js";
import { designateTreeCut, generateTreeCutJob, getTreeCutProgress, tickTreeCutJob } from "../../src/sim/labor/TreeCutting.js";

const PROFILE: NavigationProfile = { canSwim: true, maxWadingDepth: 0.5 };

function buildWorld(): { world: World; materials: MaterialRegistry; plantSpecies: PlantSpeciesRegistry } {
  const entities = new EntityIdRegistry();
  const components = new ComponentStore(entities);
  const grid = new WorldGrid({ sizeX: 10, sizeY: 8, sizeZ: 10 }, entities);
  const materials = new MaterialRegistry();
  registerStandardMaterials(materials);
  const terrain = new TerrainField(grid, materials);
  for (let x = 0; x < grid.dims.sizeX; x++) {
    for (let z = 0; z < grid.dims.sizeZ; z++) {
      for (let y = 0; y <= 2; y++) terrain.setMaterial(x, y, z, "soil");
    }
  }
  const plantSpecies = new PlantSpeciesRegistry();
  registerStandardPlantSpecies(plantSpecies);
  const water = new WaterField(grid);
  const weather = new Weather();
  const clock = new SimulationClock({ tickRateHz: 20 });
  const random = new RandomStreams(203);
  const events = new EventLog(entities);
  return { world: { clock, random, entities, components, grid, terrain, events, water, weather }, materials, plantSpecies };
}

function spawnAt(world: World, x: number, z: number, name: string): EntityId {
  const floor = world.grid.surfaceY(x, z)!;
  return spawnBeaver(world, { name, position: { x, y: floor + 1, z } });
}

function spawnTree(world: World, x: number, z: number): EntityId {
  const id = world.entities.create("tree");
  const floor = world.grid.surfaceY(x, z)!;
  world.grid.setEntityPosition(id, x, floor + 1, z);
  setPlant(world.components, id, { speciesId: "willow", ageTicks: 100_000, health: 1 });
  return id;
}

function workingDelta(world: World, materials: MaterialRegistry, plantSpecies: PlantSpeciesRegistry, beaver: EntityId, jobId: EntityId): number {
  const before = getTreeCutProgress(world.components, jobId)!.workDone;
  const outcome = tickTreeCutJob(world.grid, world.terrain, world.water, materials, plantSpecies, world.entities, world.components, beaver, PROFILE, [jobId]);
  expect(outcome).toBe("working");
  const after = getTreeCutProgress(world.components, jobId)!.workDone;
  return after - before;
}

describe("P2-03 acceptance: repeated real work improves skill-scaled speed", () => {
  it("raises woodcutting skill from repeated tree-cut work, and later ticks cut measurably faster after save/reload", () => {
    const { world, materials, plantSpecies } = buildWorld();
    const beaver = spawnAt(world, 5, 6, "Learner");
    const tree = spawnTree(world, 5, 5);
    const [jobId] = generateTreeCutJob(world, materials, plantSpecies, designateTreeCut(world, tree));

    const assignmentOutcome = tickTreeCutJob(world.grid, world.terrain, world.water, materials, plantSpecies, world.entities, world.components, beaver, PROFILE, [
      jobId!,
    ]);
    expect(assignmentOutcome).toBe("assigned");
    expect(getSkills(world.components, beaver)!.levels.woodcutting).toBeUndefined();

    const firstWorkDelta = workingDelta(world, materials, plantSpecies, beaver, jobId!);
    expect(firstWorkDelta).toBeCloseTo(1, 10);

    for (let i = 0; i < 20; i++) {
      workingDelta(world, materials, plantSpecies, beaver, jobId!);
    }
    const practicedLevel = getSkills(world.components, beaver)!.levels.woodcutting!;
    expect(practicedLevel).toBeGreaterThan(0);

    const restoreMaterials = new MaterialRegistry();
    registerStandardMaterials(restoreMaterials);
    const restored = restoreWorld(JSON.parse(JSON.stringify(snapshotWorld(world))), { componentTypes: ALL_COMPONENT_TYPES, materials: restoreMaterials });
    expect(getSkills(restored.components, beaver)!.levels.woodcutting).toBeCloseTo(practicedLevel, 10);

    const laterWorkDelta = workingDelta(restored, restoreMaterials, plantSpecies, beaver, jobId!);
    expect(laterWorkDelta).toBeGreaterThan(firstWorkDelta);
  });
});
