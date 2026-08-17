/**
 * Headless acceptance test for P2-06 -- Beds/nests/lodge occupancy.
 *
 * Roadmap acceptance:
 *   "residents claim or prefer sleeping spaces through ordinary
 *   ownership/preference logic."
 *
 * The lodge room is recognized from P2-05 geometry/contents, built here
 * through real P1-10 construction jobs. The residents do not receive a
 * scripted sleep destination: they claim preferred `sleep-space` entities,
 * then fatigue-driven rest receives those claimed cells as the ordinary
 * preferred target and moves through the existing navigation/needs tick.
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
import { spawnBeaver, getSwimmer } from "../../src/sim/creatures/Beaver.js";
import { setNeeds, getNeeds, NEED_URGENT_THRESHOLD } from "../../src/sim/creatures/Needs.js";
import { setLog } from "../../src/sim/labor/Log.js";
import {
  checkMaterialsDelivered,
  designateConstruction,
  generateBuildJob,
  getConstruction,
  tickBuildJob,
  type ConstructionKind,
} from "../../src/sim/labor/Construction.js";
import { createZone, recognizeFunctionalSpace } from "../../src/sim/spaces/FunctionalSpace.js";
import {
  claimPreferredSleepSpace,
  createSleepSpace,
  getSleepClaim,
  preferredSleepSpace,
  sleepSpaceClaimedBy,
  tickBeaverNeedsWithSleepPreferences,
} from "../../src/sim/spaces/SleepSpace.js";

function buildWorld(): { world: World; materials: MaterialRegistry } {
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
  const water = new WaterField(grid);
  const weather = new Weather();
  const clock = new SimulationClock({ tickRateHz: 20 });
  const random = new RandomStreams(206);
  const events = new EventLog(entities);
  return { world: { clock, random, entities, components, grid, terrain, events, water, weather }, materials };
}

function spawnLogAt(world: World, site: { x: number; z: number }, massKg = 80): EntityId {
  const log = world.entities.create("log");
  const floor = world.grid.surfaceY(site.x, site.z)!;
  world.grid.setEntityPosition(log, site.x, floor + 1, site.z);
  setLog(world.components, log, { materialId: "wood", massKg });
  return log;
}

function buildCompletedConstruction(world: World, materials: MaterialRegistry, kind: ConstructionKind, site: { x: number; z: number }): EntityId {
  const constructionId = designateConstruction(world, kind, site);
  spawnLogAt(world, site);
  expect(checkMaterialsDelivered(world, constructionId)).toBe(true);
  const [jobId] = generateBuildJob(world, constructionId);
  const floor = world.grid.surfaceY(site.x, site.z)!;
  const builder = spawnBeaver(world, { name: `Builder-${constructionId}`, position: { x: site.x, y: floor + 1, z: site.z } });
  const builderProfile = getSwimmer(world.components, builder)!;

  let outcome = "";
  let iterations = 0;
  do {
    outcome = tickBuildJob(world.grid, world.terrain, world.water, materials, world.entities, world.components, builder, builderProfile, [jobId!]);
    iterations++;
    expect(iterations).toBeLessThan(100);
  } while (outcome !== "built" && outcome !== "failed" && outcome !== "requeued");

  expect(outcome).toBe("built");
  expect(getConstruction(world.components, constructionId)!.status).toBe("complete");
  return constructionId;
}

function spawnResident(world: World, name: string, site: { x: number; z: number }): EntityId {
  const floor = world.grid.surfaceY(site.x, site.z)!;
  return spawnBeaver(world, { name, position: { x: site.x, y: floor + 1, z: site.z } });
}

function driveUntilAtClaimedSpace(world: World, materials: MaterialRegistry, resident: EntityId, target: { x: number; z: number }): void {
  const profile = getSwimmer(world.components, resident)!;
  for (let tick = 0; tick < 20; tick++) {
    tickBeaverNeedsWithSleepPreferences(world, materials, resident, profile);
    const position = world.grid.positionOf(resident)!;
    if (position.x === target.x && position.z === target.z) return;
  }
  throw new Error(`resident ${resident} never reached claimed sleep space (${target.x}, ${target.z})`);
}

describe("P2-06 acceptance: residents claim or prefer sleeping spaces through ordinary ownership/preference logic", () => {
  it("claims separate bed/nest spaces inside a recognized lodge room and sleeps at the claimed locations after save/reload", () => {
    const { world, materials } = buildWorld();

    const zone = createZone(world, {
      declaredFunction: "general-zone",
      cells: [
        { x: 2, z: 2 },
        { x: 3, z: 2 },
      ],
    });
    for (const wallSite of [
      { x: 1, z: 2 },
      { x: 4, z: 2 },
      { x: 2, z: 1 },
      { x: 2, z: 3 },
      { x: 3, z: 1 },
      { x: 3, z: 3 },
    ]) {
      buildCompletedConstruction(world, materials, "wall", wallSite);
    }
    buildCompletedConstruction(world, materials, "lodge-segment", { x: 2, z: 2 });
    expect(recognizeFunctionalSpace(world, zone).recognizedFunction).toBe("lodge-room");

    const nest = createSleepSpace(world, { zoneId: zone, kind: "nest", cell: { x: 2, z: 2 } });
    const bed = createSleepSpace(world, { zoneId: zone, kind: "bed", cell: { x: 3, z: 2 } });
    const ada = spawnResident(world, "Ada", { x: 2, z: 6 });
    const ben = spawnResident(world, "Ben", { x: 3, z: 6 });
    const adaProfile = getSwimmer(world.components, ada)!;
    const benProfile = getSwimmer(world.components, ben)!;
    setNeeds(world.components, ada, { hunger: 0, thirst: 0, fatigue: NEED_URGENT_THRESHOLD + 0.12, thermalComfort: 1 });
    setNeeds(world.components, ben, { hunger: 0, thirst: 0, fatigue: NEED_URGENT_THRESHOLD + 0.12, thermalComfort: 1 });

    const adaClaim = claimPreferredSleepSpace(world, materials, ada, adaProfile)!;
    const benClaim = claimPreferredSleepSpace(world, materials, ben, benProfile)!;
    expect(adaClaim.spaceId).toBe(bed); // bed preference wins first
    expect(benClaim.spaceId).toBe(nest); // claimed bed is skipped for the second resident
    expect(sleepSpaceClaimedBy(world, bed)).toBe(ada);
    expect(sleepSpaceClaimedBy(world, nest)).toBe(ben);

    const restoreMaterials = new MaterialRegistry();
    registerStandardMaterials(restoreMaterials);
    const restored = restoreWorld(JSON.parse(JSON.stringify(snapshotWorld(world))), { componentTypes: ALL_COMPONENT_TYPES, materials: restoreMaterials });

    expect(getSleepClaim(restored, ada)).toEqual({ spaceId: bed });
    expect(getSleepClaim(restored, ben)).toEqual({ spaceId: nest });
    const restoredAdaProfile = getSwimmer(restored.components, ada)!;
    const restoredBenProfile = getSwimmer(restored.components, ben)!;
    expect(preferredSleepSpace(restored, restoreMaterials, ada, restoredAdaProfile)!.spaceId).toBe(bed);
    expect(preferredSleepSpace(restored, restoreMaterials, ben, restoredBenProfile)!.spaceId).toBe(nest);

    const adaTick = tickBeaverNeedsWithSleepPreferences(restored, restoreMaterials, ada, restoredAdaProfile);
    const benTick = tickBeaverNeedsWithSleepPreferences(restored, restoreMaterials, ben, restoredBenProfile);
    expect(adaTick.intent).toEqual({ kind: "rest", target: { x: 3, z: 2 } });
    expect(benTick.intent).toEqual({ kind: "rest", target: { x: 2, z: 2 } });

    driveUntilAtClaimedSpace(restored, restoreMaterials, ada, { x: 3, z: 2 });
    driveUntilAtClaimedSpace(restored, restoreMaterials, ben, { x: 2, z: 2 });
    const adaFatigueAtArrival = getNeeds(restored.components, ada)!.fatigue;
    tickBeaverNeedsWithSleepPreferences(restored, restoreMaterials, ada, restoredAdaProfile);
    expect(getNeeds(restored.components, ada)!.fatigue).toBeLessThan(adaFatigueAtArrival);
  });
});
