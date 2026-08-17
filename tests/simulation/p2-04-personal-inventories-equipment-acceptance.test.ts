/**
 * Headless acceptance test for P2-04 -- Personal inventories and
 * equipment.
 *
 * Roadmap acceptance:
 *   "tools are physical items; losing access to a required tool prevents
 *   or changes work."
 *
 * The tool here is a real `"tool"` entity, physically picked up through
 * P1-09's existing `pickUp` path into the beaver's `Inventory`/`Held`
 * state. The tree-cut job is ordinary P1-08 work with a P2-04
 * `RequiredTool` component attached; there is no direct job assignment
 * and no separate invisible capability flag.
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
import { spawnBeaver, getInventory } from "../../src/sim/creatures/Beaver.js";
import { getJob } from "../../src/sim/jobs/Job.js";
import { getHeld, pickUp, drop } from "../../src/sim/labor/Log.js";
import { createTool, setRequiredTool } from "../../src/sim/labor/Equipment.js";
import { designateTreeCut, generateTreeCutJob, getTreeCutProgress, isEligibleForTreeCut, tickTreeCutJob } from "../../src/sim/labor/TreeCutting.js";

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
  const random = new RandomStreams(204);
  const events = new EventLog(entities);
  return { world: { clock, random, entities, components, grid, terrain, events, water, weather }, materials, plantSpecies };
}

function spawnAt(world: World, x: number, z: number): EntityId {
  const floor = world.grid.surfaceY(x, z)!;
  return spawnBeaver(world, { name: "Cutter", position: { x, y: floor + 1, z } });
}

function spawnTree(world: World, x: number, z: number): EntityId {
  const id = world.entities.create("tree");
  const floor = world.grid.surfaceY(x, z)!;
  world.grid.setEntityPosition(id, x, floor + 1, z);
  setPlant(world.components, id, { speciesId: "aspen", ageTicks: 20_000, health: 1 });
  return id;
}

describe("P2-04 acceptance: physical tools gate required work through personal inventory", () => {
  it("requires a held tool for a tool-gated tree-cut job, and losing the physical tool prevents further work", () => {
    const { world, materials, plantSpecies } = buildWorld();
    const beaver = spawnAt(world, 4, 5);
    const tree = spawnTree(world, 4, 4);
    const [jobId] = generateTreeCutJob(world, materials, plantSpecies, designateTreeCut(world, tree));
    setRequiredTool(world.components, jobId!, { toolKind: "stone-axe" });

    expect(isEligibleForTreeCut(world.entities, world.components, beaver, jobId!)).toBe(false);
    expect(tickTreeCutJob(world.grid, world.terrain, world.water, materials, plantSpecies, world.entities, world.components, beaver, PROFILE, [jobId!])).toBe(
      "idle",
    );
    expect(getJob(world.components, jobId!)!.status).toBe("unclaimed");

    const floor = world.grid.surfaceY(4, 5)!;
    const axe = createTool(world, { toolKind: "stone-axe", laborKinds: ["woodcutting"] }, { x: 4, y: floor + 1, z: 5 });
    pickUp(world.components, world.grid, axe, beaver);
    expect(getInventory(world.components, beaver)!.itemIds).toEqual([axe]);
    expect(getHeld(world.components, axe)).toEqual({ by: beaver });

    const restoreMaterials = new MaterialRegistry();
    registerStandardMaterials(restoreMaterials);
    const restored = restoreWorld(JSON.parse(JSON.stringify(snapshotWorld(world))), { componentTypes: ALL_COMPONENT_TYPES, materials: restoreMaterials });
    expect(isEligibleForTreeCut(restored.entities, restored.components, beaver, jobId!)).toBe(true);

    expect(
      tickTreeCutJob(
        restored.grid,
        restored.terrain,
        restored.water,
        restoreMaterials,
        plantSpecies,
        restored.entities,
        restored.components,
        beaver,
        PROFILE,
        [jobId!],
      ),
    ).toBe("assigned");
    expect(
      tickTreeCutJob(
        restored.grid,
        restored.terrain,
        restored.water,
        restoreMaterials,
        plantSpecies,
        restored.entities,
        restored.components,
        beaver,
        PROFILE,
        [jobId!],
      ),
    ).toBe("working");
    const workDoneWithTool = getTreeCutProgress(restored.components, jobId!)!.workDone;
    expect(workDoneWithTool).toBeGreaterThan(0);

    drop(restored.components, restored.grid, axe, { x: 4, z: 4 });
    expect(getHeld(restored.components, axe)).toBeUndefined();
    expect(getInventory(restored.components, beaver)!.itemIds).toEqual([]);

    expect(
      tickTreeCutJob(
        restored.grid,
        restored.terrain,
        restored.water,
        restoreMaterials,
        plantSpecies,
        restored.entities,
        restored.components,
        beaver,
        PROFILE,
        [jobId!],
      ),
    ).toBe("requeued");
    expect(getJob(restored.components, jobId!)!.status).toBe("unclaimed");
    expect(getTreeCutProgress(restored.components, jobId!)!.workDone).toBe(workDoneWithTool);

    expect(
      tickTreeCutJob(
        restored.grid,
        restored.terrain,
        restored.water,
        restoreMaterials,
        plantSpecies,
        restored.entities,
        restored.components,
        beaver,
        PROFILE,
        [jobId!],
      ),
    ).toBe("idle");
  });

  it("REGRESSION (P2-04 critic Minor): destroying the held tool mid-job also prevents further work", () => {
    const { world, materials, plantSpecies } = buildWorld();
    const beaver = spawnAt(world, 4, 5);
    const tree = spawnTree(world, 4, 4);
    const [jobId] = generateTreeCutJob(world, materials, plantSpecies, designateTreeCut(world, tree));
    setRequiredTool(world.components, jobId!, { toolKind: "stone-axe" });
    const floor = world.grid.surfaceY(4, 5)!;
    const axe = createTool(world, { toolKind: "stone-axe", laborKinds: ["woodcutting"] }, { x: 4, y: floor + 1, z: 5 });
    pickUp(world.components, world.grid, axe, beaver);

    expect(tickTreeCutJob(world.grid, world.terrain, world.water, materials, plantSpecies, world.entities, world.components, beaver, PROFILE, [jobId!])).toBe(
      "assigned",
    );
    expect(tickTreeCutJob(world.grid, world.terrain, world.water, materials, plantSpecies, world.entities, world.components, beaver, PROFILE, [jobId!])).toBe(
      "working",
    );
    const workDoneWithTool = getTreeCutProgress(world.components, jobId!)!.workDone;

    world.entities.destroy(axe);

    expect(tickTreeCutJob(world.grid, world.terrain, world.water, materials, plantSpecies, world.entities, world.components, beaver, PROFILE, [jobId!])).toBe(
      "requeued",
    );
    expect(getTreeCutProgress(world.components, jobId!)!.workDone).toBe(workDoneWithTool);
    expect(isEligibleForTreeCut(world.entities, world.components, beaver, jobId!)).toBe(false);
  });
});
