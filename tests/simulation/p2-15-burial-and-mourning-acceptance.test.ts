/**
 * Headless acceptance test for P2-15 -- Burial/mourning.
 *
 * Roadmap acceptance test:
 *   "death creates body-handling work and relationship-sensitive social
 *   consequences."
 *
 * A live beaver dies through the real, unmodified P1-16 `Mortality.ts`
 * `die()` -- the same single mechanism `tickMortality`/`applyTrauma` both
 * already use, now automatically triggering both P2-15 consequences as a
 * real, synchronous byproduct of that one event (see `die()`'s own doc
 * comment):
 *
 *   1. Body-handling work: a real `"bury-corpse"` designation and job
 *      exist on the ordinary P1-07 job board the instant the beaver dies
 *      -- no player action required -- and an ordinary beaver can claim
 *      and complete it through the real `Burial.ts` execution driver,
 *      turning the corpse into a real, permanent `"grave"` entity.
 *   2. Relationship-sensitive social consequences: only the LIVING
 *      beavers who already held a real P1-19 relationship toward the
 *      deceased become subjects of one shared `"beaver-mourned"` event
 *      (`Mourning.ts`); P2-14's `deriveMood` then shows a close
 *      relationship (a mate) hurting measurably more than a distant one
 *      (a weak acquaintance) from that SAME shared event, while a
 *      stranger with no relationship at all feels nothing -- proving the
 *      consequence is genuinely relationship-sensitive, not a flat
 *      "everyone feels the same amount" effect.
 *
 * Finishes with a real full-world save/reload round trip.
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
import { snapshotWorld, restoreWorld } from "../../src/sim/persistence/WorldSnapshot.js";
import { ALL_COMPONENT_TYPES } from "../../src/sim/persistence/AllComponentTypes.js";
import type { NavigationProfile } from "../../src/sim/navigation/Pathfinding.js";
import { spawnBeaver } from "../../src/sim/creatures/Beaver.js";
import { die } from "../../src/sim/creatures/Mortality.js";
import { setRelationshipWith } from "../../src/sim/creatures/Relationships.js";
import { MOURNED_EVENT_TYPE } from "../../src/sim/creatures/Mourning.js";
import { deriveMood } from "../../src/sim/creatures/Mood.js";
import { setWorldTraits } from "../../src/sim/creatures/Traits.js";
import { getDesignation } from "../../src/sim/jobs/Designation.js";
import { getJob } from "../../src/sim/jobs/Job.js";
import { getBurialProgress, getGrave, isEligibleForBurial, tickBurialJob } from "../../src/sim/labor/Burial.js";

const PROFILE: NavigationProfile = { canSwim: true, maxWadingDepth: 0.5 };

function buildFlatWorld(sizeX = 14, sizeY = 8, sizeZ = 14, floor = 2): { world: World; materials: MaterialRegistry; water: WaterField } {
  const entities = new EntityIdRegistry();
  const components = new ComponentStore(entities);
  const grid = new WorldGrid({ sizeX, sizeY, sizeZ }, entities);
  const materials = new MaterialRegistry();
  registerStandardMaterials(materials);
  const terrain = new TerrainField(grid, materials);
  for (let x = 0; x < sizeX; x++) {
    for (let z = 0; z < sizeZ; z++) {
      for (let y = 0; y <= floor; y++) terrain.setMaterial(x, y, z, "soil");
    }
  }
  const water = new WaterField(grid);
  const weather = new Weather();
  const clock = new SimulationClock({ tickRateHz: 20 });
  const random = new RandomStreams("p2-15-burial-and-mourning");
  const events = new EventLog(entities);
  const world: World = { clock, random, entities, components, grid, terrain, events, water, weather };
  return { world, materials, water };
}

function spawnAt(world: World, name: string, x: number, z: number): EntityId {
  const floor = world.grid.surfaceY(x, z)!;
  return spawnBeaver(world, { name, position: { x, y: floor + 1, z } });
}

function driveBurialToCompletion(
  world: World,
  materials: MaterialRegistry,
  water: WaterField,
  beaverId: EntityId,
  candidateJobIds: readonly EntityId[],
  maxTicks = 50,
): string {
  let outcome = "idle";
  for (let i = 0; i < maxTicks; i++) {
    outcome = tickBurialJob(world.grid, world.terrain, water, materials, world.entities, world.components, beaverId, PROFILE, candidateJobIds);
    if (outcome === "buried" || outcome === "failed") return outcome;
  }
  return outcome;
}

describe("P2-15 -- Burial/mourning", () => {
  it("death automatically creates body-handling work and relationship-sensitive social consequences", () => {
    const { world, materials, water } = buildFlatWorld();
    const victim = spawnAt(world, "Victim", 5, 5);
    const mate = spawnAt(world, "Mate", 2, 2);
    const acquaintance = spawnAt(world, "Acquaintance", 3, 2);
    const stranger = spawnAt(world, "Stranger", 4, 2);
    const gravedigger = spawnAt(world, "Digger", 2, 6);

    setRelationshipWith(world.components, mate, { withId: victim, kin: "mate", familiarity: 0.9, affinity: 0.8 });
    setRelationshipWith(world.components, acquaintance, { withId: victim, kin: "unrelated", familiarity: 0.1, affinity: 0 });
    // stranger and gravedigger have no relationship with the victim at all.
    setWorldTraits(world, mate, { sociability: 1, resilience: 0, assignedTick: 0 });
    setWorldTraits(world, acquaintance, { sociability: 1, resilience: 0, assignedTick: 0 });
    setWorldTraits(world, stranger, { sociability: 1, resilience: 0, assignedTick: 0 });

    // The real, unmodified P1-16 death mechanism -- nothing hand-authored
    // for this test beyond choosing WHEN the beaver dies.
    const corpseId = die(world, victim, "trauma");

    // ---- Half 1: body-handling work was CREATED, automatically ----
    const jobIds = world.entities.liveIdsOfKind("job");
    expect(jobIds).toHaveLength(1);
    const burialJobId = jobIds[0]!;
    const progress = getBurialProgress(world.components, burialJobId)!;
    expect(progress).toMatchObject({ corpseId, causeOfDeath: "trauma", deceasedBeaverId: victim, workDone: 0 });
    const designation = getDesignation(world.components, getJob(world.components, burialJobId)!.designationId)!;
    expect(designation).toMatchObject({ kind: "bury-corpse", targetEntity: corpseId, status: "active" });
    expect(isEligibleForBurial(world.entities, world.components, gravedigger, burialJobId)).toBe(true);

    // An ordinary beaver can claim and complete that real work through the
    // real execution driver -- the corpse becomes a real, permanent grave.
    const outcome = driveBurialToCompletion(world, materials, water, gravedigger, [burialJobId]);
    expect(outcome).toBe("buried");
    expect(world.entities.isLive(corpseId)).toBe(false);
    const graves = world.entities.liveIdsOfKind("grave");
    expect(graves).toHaveLength(1);
    expect(getGrave(world.components, graves[0]!)).toEqual({ deceasedBeaverId: victim, causeOfDeath: "trauma" });

    // ---- Half 2: relationship-sensitive social consequences ----
    const mournEvents = world.events.eventsOfType(MOURNED_EVENT_TYPE);
    expect(mournEvents).toHaveLength(1);
    const mournEvent = mournEvents[0]!;
    expect(new Set(mournEvent.subjectIds)).toEqual(new Set([mate, acquaintance])); // only real mourners
    expect(mournEvent.subjectIds).not.toContain(stranger);
    expect(mournEvent.objectIds).toEqual([victim]);

    const mateMood = deriveMood(world, mate);
    const acquaintanceMood = deriveMood(world, acquaintance);
    const strangerMood = deriveMood(world, stranger);
    expect(mateMood.eventContribution).toBeLessThan(0);
    expect(acquaintanceMood.eventContribution).toBeLessThan(0);
    expect(mateMood.eventContribution).toBeLessThan(acquaintanceMood.eventContribution); // the mate grieves harder
    expect(strangerMood.eventContribution).toBe(0); // no relationship, no reaction

    // ---- Full-world save/reload ----
    const restoredMaterials = new MaterialRegistry();
    registerStandardMaterials(restoredMaterials);
    const restored = restoreWorld(JSON.parse(JSON.stringify(snapshotWorld(world))), {
      componentTypes: ALL_COMPONENT_TYPES,
      materials: restoredMaterials,
    });

    expect(getGrave(restored.components, graves[0]!)).toEqual(getGrave(world.components, graves[0]!));
    expect(restored.events.get(mournEvent.id)).toEqual(mournEvent);
    expect(deriveMood(restored, mate)).toEqual(mateMood);
    expect(deriveMood(restored, acquaintance)).toEqual(acquaintanceMood);
  });
});
