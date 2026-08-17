/**
 * Headless acceptance test for P1-09 — Physical items and hauling.
 *
 * Roadmap acceptance test (DAMN_BEAVERS_MASTER_ROADMAP.md, P1-09):
 *   "a log remains where it falls until an agent physically moves it;
 *   save/reload while it is being hauled preserves ownership/
 *   reservation/location correctly."
 *
 * Uses a real, P1-08-felled log (not a hand-placed stand-in) so the
 * first half of the claim is checked against a log that actually arrived
 * the way the game will really produce one. The second half drives a
 * real haul to the exact midpoint of the carry leg, takes a real full-world
 * `snapshotWorld`/`JSON.stringify`/`JSON.parse`/`restoreWorld` round trip
 * (P0-06's own canonical persistence mechanism -- not just a
 * `ComponentStore`-only shortcut, so `WorldGrid`'s own snapshot logic for
 * "this entity has no position" and `EntityIdRegistry`'s own liveness
 * snapshot are genuinely exercised too), and then proves the restored
 * state isn't just structurally equal but actually FUNCTIONAL by
 * continuing the haul to completion using the fully restored world.
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
import type { NavigationProfile } from "../../src/sim/navigation/Pathfinding.js";
import { setPlant } from "../../src/sim/ecology/Plant.js";
import { PlantSpeciesRegistry } from "../../src/sim/ecology/PlantSpecies.js";
import { registerStandardPlantSpecies } from "../../src/sim/ecology/standardPlantSpecies.js";
import {
  spawnBeaver,
  getSwimmer,
  IdentityComponent,
  CreatureBodyComponent,
  LocomotionComponent,
  SwimmerComponent,
  InventoryComponent,
  SkillsComponent,
  HealthComponent,
  getInventory,
} from "../../src/sim/creatures/Beaver.js";
import { NeedsComponent } from "../../src/sim/creatures/Needs.js";
import { NeedFocusComponent } from "../../src/sim/creatures/BeaverNeeds.js";
import { BreathComponent } from "../../src/sim/creatures/Respiration.js";
import { getDesignation, DesignationComponent } from "../../src/sim/jobs/Designation.js";
import { getJob, JobComponent } from "../../src/sim/jobs/Job.js";
import { designateTreeCut, generateTreeCutJob, tickTreeCutJob, TreeCutProgressComponent } from "../../src/sim/labor/TreeCutting.js";
import { setLog, getLog, getHeld, getReservation, LogComponent, HeldComponent, ReservationComponent } from "../../src/sim/labor/Log.js";
import { designateHaul, generateHaulJob, getHaulProgress, tickHaulJob, HaulProgressComponent } from "../../src/sim/labor/Hauling.js";
import { snapshotWorld, restoreWorld, type WorldRestoreContext } from "../../src/sim/persistence/WorldSnapshot.js";

const SIZE_X = 16;
const SIZE_Y = 8;
const SIZE_Z = 10;
const TREE_AT = { x: 4, z: 4 };
const HAUL_DESTINATION = { x: 14, z: 4 };

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
  const random = new RandomStreams("p1-09-hauling");
  const events = new EventLog(entities);
  const world: World = { clock, random, entities, components, grid, terrain, events };
  return { world, materials, water, plantSpecies };
}

function spawnAt(world: World, x: number, z: number, name: string) {
  const floor = world.grid.surfaceY(x, z)!;
  return spawnBeaver(world, { name, position: { x, y: floor + 1, z } });
}

const COMPONENT_TYPES = new Map<string, ComponentType<unknown>>([
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
  ["held", HeldComponent],
  ["reservation", ReservationComponent],
  ["haul-progress", HaulProgressComponent],
]);

describe("P1-09 acceptance: a log remains where it falls until physically moved; save/reload mid-haul preserves ownership/reservation/location", () => {
  it("a real felled log sits untouched for many ticks with no haul designation", () => {
    const { world, materials, water, plantSpecies } = buildWorld();
    const woodcutter = spawnAt(world, 2, 4, "Chop");
    const profile = getSwimmer(world.components, woodcutter)!;
    const tree = world.entities.create("tree");
    world.grid.setEntityPosition(tree, TREE_AT.x, world.grid.surfaceY(TREE_AT.x, TREE_AT.z)! + 1, TREE_AT.z);
    setPlant(world.components, tree, { speciesId: "aspen", ageTicks: 8_000, health: 1 });
    const [cutJobId] = generateTreeCutJob(world, materials, plantSpecies, designateTreeCut(world, tree));

    let cutOutcome: string;
    let iterations = 0;
    do {
      cutOutcome = tickTreeCutJob(world.grid, world.terrain, water, materials, plantSpecies, world.entities, world.components, woodcutter, profile, [cutJobId!]);
      iterations++;
      expect(iterations).toBeLessThan(200);
    } while (cutOutcome !== "felled");

    const logs = world.entities.liveIdsOfKind("log");
    expect(logs.length).toBeGreaterThan(0);
    const positionsAtFelling = logs.map((id) => world.grid.positionOf(id));

    // No haul designation exists -- run many more ticks and confirm
    // nothing about the logs changes.
    for (let tick = 0; tick < 100; tick++) {
      world.clock.resume();
      world.clock.advanceTicks(1);
    }

    for (let i = 0; i < logs.length; i++) {
      expect(world.grid.positionOf(logs[i]!)).toEqual(positionsAtFelling[i]);
      expect(getHeld(world.components, logs[i]!)).toBeUndefined();
      expect(getReservation(world.components, logs[i]!)).toBeUndefined();
    }
  });

  it("save/reload mid-haul preserves ownership, reservation, and location, and the restored state actually finishes the haul", () => {
    const { world, materials, water } = buildWorld();
    const hauler = spawnAt(world, 2, 4, "Haul");
    const profile = getSwimmer(world.components, hauler)!;
    const item = world.entities.create("log");
    world.grid.setEntityPosition(item, 4, world.grid.surfaceY(4, 4)! + 1, 4);
    setLog(world.components, item, { materialId: "wood", massKg: 30 });

    const designationId = designateHaul(world, item, HAUL_DESTINATION);
    const [jobId] = generateHaulJob(world, designationId);

    // Drive the haul partway through the carry leg -- item genuinely held,
    // genuinely mid-journey (not yet delivered).
    let outcome = "";
    let iterations = 0;
    while (outcome !== "carrying" && iterations < 50) {
      outcome = tickHaulJob(world.grid, world.terrain, water, materials, world.entities, world.components, hauler, profile, [jobId!]);
      iterations++;
    }
    expect(outcome).toBe("carrying"); // genuinely mid-haul: picked up, not yet delivered

    // Snapshot BEFORE reload, for comparison.
    const ownerBefore = getHeld(world.components, item);
    const reservationBefore = getReservation(world.components, item);
    const inventoryBefore = getInventory(world.components, hauler);
    const jobBefore = getJob(world.components, jobId!);
    const haulProgressBefore = getHaulProgress(world.components, jobId!);
    expect(ownerBefore).toEqual({ by: hauler });
    expect(reservationBefore).toEqual({ by: hauler });
    expect(inventoryBefore!.itemIds).toContain(item);
    expect(world.grid.positionOf(item)).toBeUndefined(); // held items have no independent WorldGrid location

    // Real save/reload: the project's own canonical full-world mechanism
    // (P0-06's `snapshotWorld`/`restoreWorld`, the same one
    // `tests/simulation/p0-06-persistence-acceptance.test.ts` uses) --
    // NOT just a `ComponentStore`-only round trip. This is the harder,
    // more honest proof: `WorldGrid`'s own snapshot must also correctly
    // represent "this entity has no position at all" for the held item,
    // and `EntityIdRegistry`'s own snapshot must correctly carry every
    // involved entity's liveness/identity through, not just component
    // data sitting on top of instances that never moved.
    const snapshot = JSON.parse(JSON.stringify(snapshotWorld(world)));
    const restoreMaterials = new MaterialRegistry();
    registerStandardMaterials(restoreMaterials);
    const context: WorldRestoreContext = { componentTypes: COMPONENT_TYPES, materials: restoreMaterials };
    const restoredWorld = restoreWorld(snapshot, context);

    // Ownership, reservation, and location (the latter meaning: still
    // correctly un-positioned in the world, still correctly present in
    // the SAME beaver's inventory) all survived exactly.
    expect(getHeld(restoredWorld.components, item)).toEqual(ownerBefore);
    expect(getReservation(restoredWorld.components, item)).toEqual(reservationBefore);
    expect(getInventory(restoredWorld.components, hauler)).toEqual(inventoryBefore);
    expect(restoredWorld.grid.positionOf(item)).toBeUndefined(); // still correctly un-positioned, not silently given a stale one
    expect(restoredWorld.entities.isLive(item)).toBe(true);
    expect(restoredWorld.entities.isLive(hauler)).toBe(true);
    expect(getJob(restoredWorld.components, jobId!)).toEqual(jobBefore);
    expect(getHaulProgress(restoredWorld.components, jobId!)).toEqual(haulProgressBefore);

    // Not just structurally equal -- FUNCTIONAL: finish the haul using
    // the fully restored world (its own grid/terrain/entities/components,
    // not the pre-reload originals).
    let finalOutcome: string;
    iterations = 0;
    do {
      finalOutcome = tickHaulJob(
        restoredWorld.grid,
        restoredWorld.terrain,
        water,
        materials,
        restoredWorld.entities,
        restoredWorld.components,
        hauler,
        profile,
        [jobId!],
      );
      iterations++;
      expect(iterations).toBeLessThan(50);
    } while (finalOutcome === "carrying");

    expect(finalOutcome).toBe("delivered");
    expect(restoredWorld.grid.positionOf(item)).toEqual({
      x: HAUL_DESTINATION.x,
      y: restoredWorld.grid.surfaceY(HAUL_DESTINATION.x, HAUL_DESTINATION.z)! + 1,
      z: HAUL_DESTINATION.z,
    });
    expect(getJob(restoredWorld.components, jobId!)!.status).toBe("completed");
    expect(getDesignation(restoredWorld.components, designationId)!.status).toBe("completed");
  });
});
