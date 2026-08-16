/**
 * Headless acceptance test for P1-10 — Construction jobs.
 *
 * Roadmap acceptance test (DAMN_BEAVERS_MASTER_ROADMAP.md, P1-10):
 *   "cancelling construction before assembly leaves delivered physical
 *   materials in the world."
 *
 * Drives the full, real pipeline end to end (not hand-placed shortcuts):
 * designate a construction, let it use the project's own real material-
 * search/haul machinery (`ensureMaterialHaul`, reusing P1-09's `Hauling.ts`
 * completely unmodified) to actually walk a beaver over, pick up a real
 * felled log, and carry it to the site; confirm the construction genuinely
 * transitions out of "awaiting materials" once enough real mass has
 * arrived; start real labor (a second beaver actually walks to the site and
 * accumulates real work); then cancel BEFORE that labor finishes, and prove
 * the delivered log is still a live, physical, undestroyed entity sitting
 * exactly where it was dropped -- not vanished, not silently consumed.
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
import type { World } from "../../src/sim/persistence/WorldSnapshot.js";
import type { NavigationProfile } from "../../src/sim/navigation/Pathfinding.js";
import { spawnBeaver, getSwimmer } from "../../src/sim/creatures/Beaver.js";
import { getDesignation } from "../../src/sim/jobs/Designation.js";
import { getJob } from "../../src/sim/jobs/Job.js";
import { setPlant } from "../../src/sim/ecology/Plant.js";
import { PlantSpeciesRegistry } from "../../src/sim/ecology/PlantSpecies.js";
import { registerStandardPlantSpecies } from "../../src/sim/ecology/standardPlantSpecies.js";
import { designateTreeCut, generateTreeCutJob, tickTreeCutJob } from "../../src/sim/labor/TreeCutting.js";
import { getLog, getHeld } from "../../src/sim/labor/Log.js";
import { tickHaulJob } from "../../src/sim/labor/Hauling.js";
import {
  designateConstruction,
  getConstruction,
  deliveredMassAtSite,
  ensureMaterialHaul,
  checkMaterialsDelivered,
  generateBuildJob,
  tickBuildJob,
  cancelConstruction,
} from "../../src/sim/labor/Construction.js";

const SIZE_X = 20;
const SIZE_Y = 8;
const SIZE_Z = 12;
const TREE_AT = { x: 2, z: 4 };
const SITE = { x: 10, z: 4 };

function buildWorld(): { world: World; materials: MaterialRegistry; water: WaterField; plantSpecies: PlantSpeciesRegistry } {
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
  const plantSpecies = new PlantSpeciesRegistry();
  registerStandardPlantSpecies(plantSpecies);
  const clock = new SimulationClock({ tickRateHz: 20 });
  const random = new RandomStreams("p1-10-construction");
  const events = new EventLog(entities);
  const world: World = { clock, random, entities, components, grid, terrain, events };
  return { world, materials, water, plantSpecies };
}

function spawnAt(world: World, x: number, z: number, name: string) {
  const floor = world.grid.surfaceY(x, z)!;
  return spawnBeaver(world, { name, position: { x, y: floor + 1, z } });
}

describe("P1-10 acceptance: cancelling construction before assembly leaves delivered physical materials in the world", () => {
  it("real felled logs are really hauled to a real site by a real beaver, labor really begins, and cancelling mid-labor leaves the delivered log alive and physical", () => {
    const { world, materials, water, plantSpecies } = buildWorld();

    // A real tree, really felled by a real beaver via P1-08's own pipeline
    // -- not a hand-placed log standing in for one.
    const woodcutter = spawnAt(world, TREE_AT.x - 1, TREE_AT.z, "Chop");
    const woodcutterProfile = getSwimmer(world.components, woodcutter)!;
    const tree = world.entities.create("tree");
    world.grid.setEntityPosition(tree, TREE_AT.x, world.grid.surfaceY(TREE_AT.x, TREE_AT.z)! + 1, TREE_AT.z);
    setPlant(world.components, tree, { speciesId: "aspen", ageTicks: 8_000, health: 1 });
    const [cutJobId] = generateTreeCutJob(world, materials, plantSpecies, designateTreeCut(world, tree));

    let cutOutcome: string;
    let iterations = 0;
    do {
      cutOutcome = tickTreeCutJob(world.grid, world.terrain, water, materials, plantSpecies, world.entities, world.components, woodcutter, woodcutterProfile, [cutJobId!]);
      iterations++;
      expect(iterations).toBeLessThan(200);
    } while (cutOutcome !== "felled");

    const felledLogs = world.entities.liveIdsOfKind("log");
    expect(felledLogs.length).toBeGreaterThan(0);
    const totalFelledMassKg = felledLogs.reduce((sum, id) => sum + getLog(world.components, id)!.massKg, 0);

    // Designate a real construction at a real site, far from the felled logs.
    const constructionId = designateConstruction(world, "wall", SITE);
    const construction = getConstruction(world.components, constructionId)!;
    expect(construction.status).toBe("awaiting-materials");
    expect(totalFelledMassKg).toBeGreaterThanOrEqual(construction.requiredMassKg); // enough real wood exists to satisfy this wall

    // Real hauling: repeatedly ask for more material and actually drive the
    // resulting haul job(s) to completion with a second, dedicated beaver
    // -- reuses P1-09's tickHaulJob completely unmodified.
    const hauler = spawnAt(world, TREE_AT.x, TREE_AT.z, "Haul");
    const haulerProfile = getSwimmer(world.components, hauler)!;

    let safety = 0;
    while (!checkMaterialsDelivered(world, constructionId)) {
      safety++;
      expect(safety).toBeLessThan(50);
      const haulJobId = ensureMaterialHaul(world, constructionId);
      if (haulJobId === undefined) break; // nothing more available to haul right now
      let haulOutcome = "";
      let haulIterations = 0;
      do {
        haulOutcome = tickHaulJob(world.grid, world.terrain, water, materials, world.entities, world.components, hauler, haulerProfile, [haulJobId]);
        haulIterations++;
        expect(haulIterations).toBeLessThan(100);
      } while (haulOutcome !== "delivered" && haulOutcome !== "failed" && haulOutcome !== "requeued");
      expect(haulOutcome).toBe("delivered");
    }

    // Materials genuinely arrived: real physical logs sitting at the real site.
    expect(getConstruction(world.components, constructionId)!.status).toBe("awaiting-labor");
    const deliveredMassBeforeCancel = deliveredMassAtSite(world.entities, world.components, world.grid, constructionId);
    expect(deliveredMassBeforeCancel).toBeGreaterThanOrEqual(construction.requiredMassKg);
    const deliveredLogIds = world.grid
      .entitiesAt(SITE.x, world.grid.surfaceY(SITE.x, SITE.z)! + 1, SITE.z)
      .filter((id) => world.entities.kindOf(id) === "log");
    expect(deliveredLogIds.length).toBeGreaterThan(0);
    for (const id of deliveredLogIds) expect(getHeld(world.components, id)).toBeUndefined(); // resting on the ground, not phantom-held

    // Real labor: a third beaver walks to the site and actually starts
    // accumulating work, BEFORE assembly completes.
    const builder = spawnAt(world, SITE.x - 3, SITE.z, "Build");
    const builderProfile = getSwimmer(world.components, builder)!;
    const [buildJobId] = generateBuildJob(world, constructionId);
    let buildOutcome: string;
    do {
      buildOutcome = tickBuildJob(world.grid, world.terrain, water, materials, world.entities, world.components, builder, builderProfile, [buildJobId!]);
    } while (buildOutcome === "traveling" || buildOutcome === "assigned");
    expect(buildOutcome).toBe("working"); // real labor genuinely underway, not yet complete
    expect(getConstruction(world.components, constructionId)!.status).toBe("awaiting-labor"); // still not assembled

    // Cancel BEFORE assembly finishes.
    cancelConstruction(world.entities, world.components, world.grid, constructionId);

    const cancelled = getConstruction(world.components, constructionId)!;
    expect(cancelled.status).toBe("cancelled");
    expect(getDesignation(world.components, cancelled.designationId)!.status).toBe("cancelled");
    expect(getJob(world.components, buildJobId!)!.status).toBe("failed");

    // The roadmap's own literal claim: delivered physical materials remain
    // in the world -- real, live, undestroyed log entities, still sitting
    // exactly where the haul dropped them.
    for (const id of deliveredLogIds) {
      expect(world.entities.isLive(id)).toBe(true);
      expect(getLog(world.components, id)).toBeDefined();
      expect(world.grid.positionOf(id)).toEqual({ x: SITE.x, y: world.grid.surfaceY(SITE.x, SITE.z)! + 1, z: SITE.z });
    }
    expect(deliveredMassAtSite(world.entities, world.components, world.grid, constructionId)).toBe(deliveredMassBeforeCancel);

    // No further work can ever accumulate on a cancelled construction.
    const outcomeAfterCancel = tickBuildJob(world.grid, world.terrain, water, materials, world.entities, world.components, builder, builderProfile, [buildJobId!]);
    expect(outcomeAfterCancel).toBe("idle");
    expect(getConstruction(world.components, constructionId)!.workDone).toBe(cancelled.workDone);
  });
});
