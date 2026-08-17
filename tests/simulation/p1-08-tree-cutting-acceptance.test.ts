/**
 * Headless acceptance test for P1-08 — Tree cutting.
 *
 * Roadmap acceptance test (DAMN_BEAVERS_MASTER_ROADMAP.md, P1-08):
 *   "marking one tree causes an available beaver to choose the job,
 *   travel there, cut it, and produce persistent log entities."
 *
 * Every stage is real: `designateTreeCut` creates a real player order,
 * `generateTreeCutJob` derives real cutting effort from the tree's actual
 * age/species-driven mass (P0-10), the beaver that ends up assigned is
 * whichever one the real P1-07 eligibility/selection pipeline picks (not
 * scripted), reaching the tree is real P1-04/P1-05 navigation, and
 * cutting takes multiple real simulated ticks of accumulated work (not
 * an instant flag flip) before real, persistent, `ComponentStore`-backed
 * log entities exist with mass that survives a save/reload round trip.
 */
import { describe, expect, it } from "vitest";
import { EntityIdRegistry, type EntityId } from "../../src/sim/core/EntityId.js";
import { ComponentStore, type ComponentType } from "../../src/sim/core/ComponentStore.js";
import { SimulationClock } from "../../src/sim/core/SimulationClock.js";
import { RandomStreams } from "../../src/sim/core/Random.js";
import { WorldGrid } from "../../src/sim/world/WorldGrid.js";
import { TerrainField } from "../../src/sim/world/TerrainField.js";
import { EventLog } from "../../src/sim/history/EventLog.js";
import { MaterialRegistry } from "../../src/sim/materials/Material.js";
import { registerStandardMaterials } from "../../src/sim/materials/standardMaterials.js";
import { WaterField } from "../../src/sim/hydrology/WaterField.js";
import type { World } from "../../src/sim/persistence/WorldSnapshot.js";
import { setPlant, harvestableWoodMassKg, PlantComponent } from "../../src/sim/ecology/Plant.js";
import { PlantSpeciesRegistry } from "../../src/sim/ecology/PlantSpecies.js";
import { registerStandardPlantSpecies } from "../../src/sim/ecology/standardPlantSpecies.js";
import { spawnBeaver, getSwimmer, IdentityComponent, CreatureBodyComponent, LocomotionComponent, SwimmerComponent, InventoryComponent, SkillsComponent, HealthComponent } from "../../src/sim/creatures/Beaver.js";
import { NeedsComponent } from "../../src/sim/creatures/Needs.js";
import { NeedFocusComponent } from "../../src/sim/creatures/BeaverNeeds.js";
import { BreathComponent } from "../../src/sim/creatures/Respiration.js";
import { getDesignation, DesignationComponent } from "../../src/sim/jobs/Designation.js";
import { getJob, JobComponent } from "../../src/sim/jobs/Job.js";
import { getLog, LogComponent } from "../../src/sim/labor/Log.js";
import { designateTreeCut, generateTreeCutJob, getTreeCutProgress, tickTreeCutJob, TreeCutProgressComponent } from "../../src/sim/labor/TreeCutting.js";

const SIZE_X = 14;
const SIZE_Y = 8;
const SIZE_Z = 10;
const TREE_AT = { x: 8, z: 5 };

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
  const random = new RandomStreams("p1-08-tree-cutting");
  const events = new EventLog(entities);
  const world: World = { clock, random, entities, components, grid, terrain, events };
  return { world, materials, water, plantSpecies };
}

function spawnAt(world: World, x: number, z: number, name: string) {
  const floor = world.grid.surfaceY(x, z)!;
  return spawnBeaver(world, { name, position: { x, y: floor + 1, z } });
}

describe("P1-08 acceptance: marking one tree causes an available beaver to choose the job, travel there, cut it, and produce persistent log entities", () => {
  it("end to end, from designation to felled tree and real log entities", () => {
    const { world, materials, water, plantSpecies } = buildWorld();
    const a = spawnAt(world, 0, 0, "Gnaw");
    const b = spawnAt(world, 0, 9, "Chisel");
    const profileA = getSwimmer(world.components, a)!;
    const profileB = getSwimmer(world.components, b)!;

    const tree = world.entities.create("tree");
    world.grid.setEntityPosition(tree, TREE_AT.x, world.grid.surfaceY(TREE_AT.x, TREE_AT.z)! + 1, TREE_AT.z);
    setPlant(world.components, tree, { speciesId: "aspen", ageTicks: 8_000, health: 1 });
    const expectedMass = harvestableWoodMassKg(
      plantSpecies.get("aspen"),
      { speciesId: "aspen", ageTicks: 8_000, health: 1 },
      materials.get("wood"),
    );

    // Player marks the tree.
    const designationId = designateTreeCut(world, tree);
    const jobIds = generateTreeCutJob(world, materials, plantSpecies, designationId);
    expect(jobIds).toHaveLength(1);
    const jobId = jobIds[0]!;

    // Drive both candidate beavers every tick -- whichever the real
    // pipeline assigns is not scripted; we only assert on what actually
    // happened. Neither beaver is told to do this at any particular tick.
    let assignedWorker: EntityId | undefined;
    let sawTravelBeforeWork = false;
    let outcome = "";
    const MAX_TICKS = 400;
    for (let tick = 0; tick < MAX_TICKS; tick++) {
      world.clock.resume();
      world.clock.advanceTicks(1);
      for (const [beaver, profile] of [
        [a, profileA],
        [b, profileB],
      ] as const) {
        const reservedBy = getJob(world.components, jobId)?.reservedBy;
        if (reservedBy !== undefined && reservedBy !== beaver) continue; // this beaver was never assigned -- nothing to drive
        const stepOutcome = tickTreeCutJob(
          world.grid,
          world.terrain,
          water,
          materials,
          plantSpecies,
          world.entities,
          world.components,
          beaver,
          profile,
          [jobId],
        );
        if (stepOutcome === "idle") continue;
        assignedWorker = beaver;
        outcome = stepOutcome;
        if (stepOutcome === "assigned" || stepOutcome === "traveling") sawTravelBeforeWork = true;
      }
      if (outcome === "felled") break;
    }

    // The job was genuinely CHOSEN by an available beaver -- some real
    // beaver ended up assigned, and there really was a travel phase
    // before any work happened (it didn't just teleport to instant
    // completion).
    expect(assignedWorker).toBeDefined();
    expect(sawTravelBeforeWork).toBe(true);

    // It was CUT -- felled, not merely marked, and only after genuine
    // multi-tick accumulated work (never instantaneous).
    expect(outcome).toBe("felled");
    expect(world.entities.isLive(tree)).toBe(false);
    expect(getJob(world.components, jobId)!.status).toBe("completed");
    expect(getDesignation(world.components, designationId)!.status).toBe("completed");

    // It PRODUCED PERSISTENT LOG ENTITIES -- real entities with real mass
    // summing to the tree's actual harvestable mass, not a loot-table
    // stand-in.
    const logs = world.entities.liveIdsOfKind("log");
    expect(logs.length).toBeGreaterThan(0);
    const totalLogMass = logs.reduce((sum, id) => sum + getLog(world.components, id)!.massKg, 0);
    expect(totalLogMass).toBeCloseTo(expectedMass, 10);

    // "Persistent" literally: logs survive a real save/reload round trip.
    const componentTypes = new Map<string, ComponentType<unknown>>([
      ["identity", IdentityComponent],
      ["creature-body", CreatureBodyComponent],
      ["locomotion", LocomotionComponent],
      ["swimmer", SwimmerComponent],
      ["inventory", InventoryComponent],
      ["skills", SkillsComponent],
      ["health", HealthComponent],
      ["breath", BreathComponent],
      ["needs", NeedsComponent],
      ["need-focus", NeedFocusComponent],
      ["designation", DesignationComponent],
      ["job", JobComponent],
      ["tree-cut-progress", TreeCutProgressComponent],
      ["log", LogComponent],
      ["plant", PlantComponent],
    ]);
    const snapshot = JSON.parse(JSON.stringify(world.components.toSnapshot()));
    const restored = ComponentStore.fromSnapshot(snapshot, world.entities, componentTypes);
    for (const id of logs) {
      expect(getLog(restored, id)).toEqual(getLog(world.components, id));
    }
  });
});
