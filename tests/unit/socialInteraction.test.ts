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
import { spawnBeaver } from "../../src/sim/creatures/Beaver.js";
import { BASELINE_NEEDS, setNeeds } from "../../src/sim/creatures/Needs.js";
import { relationshipWith, setRelationshipWith } from "../../src/sim/creatures/Relationships.js";
import {
  SOCIAL_INTERACTION_RELIEF,
  SOCIAL_INTERACTION_THRESHOLD,
  SOCIAL_NEED_INCREASE_PER_IDLE_TICK,
  SocialStateComponent,
  assertValidSocialState,
  getSocialDebugState,
  getSocialState,
  isSociallyIdle,
  setWorldSocialState,
  tickSocialInteractions,
  tickSocialNeeds,
} from "../../src/sim/creatures/SocialInteraction.js";
import { createDesignation } from "../../src/sim/jobs/Designation.js";
import { generateJobs } from "../../src/sim/jobs/Job.js";
import { reserveJob } from "../../src/sim/jobs/JobBoard.js";
import { setConstruction } from "../../src/sim/labor/Construction.js";
import { createZone } from "../../src/sim/spaces/FunctionalSpace.js";
import { claimSleepSpace, createSleepSpace } from "../../src/sim/spaces/SleepSpace.js";

function buildFlatWorld(sizeX = 10, sizeY = 8, sizeZ = 10, floor = 2): { world: World; materials: MaterialRegistry } {
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
  const random = new RandomStreams(213);
  const events = new EventLog(entities);
  return { world: { clock, random, entities, components, grid, terrain, events, water, weather }, materials };
}

function spawnAt(world: World, name: string, x: number, z: number): EntityId {
  const floor = world.grid.surfaceY(x, z)!;
  return spawnBeaver(world, { name, position: { x, y: floor + 1, z } });
}

function completeConstruction(world: World, kind: "wall" | "lodge-segment", x: number, z: number): EntityId {
  const id = world.entities.create("construction");
  setConstruction(world.components, id, {
    designationId: id,
    kind,
    site: { x, z },
    requiredMaterialId: "wood",
    requiredMassKg: 1,
    workDone: 1,
    workRequired: 1,
    status: "complete",
  });
  return id;
}

function createClaimedLodgeRoom(world: World, leftResident: EntityId, rightResident: EntityId, originX = 3, originZ = 3): EntityId {
  const zoneId = createZone(world, {
    cells: [
      { x: originX, z: originZ },
      { x: originX + 1, z: originZ },
    ],
    declaredFunction: "general-zone",
  });
  for (const wall of [
    { x: originX - 1, z: originZ },
    { x: originX, z: originZ - 1 },
    { x: originX, z: originZ + 1 },
    { x: originX + 1, z: originZ - 1 },
    { x: originX + 1, z: originZ + 1 },
    { x: originX + 2, z: originZ },
  ]) {
    completeConstruction(world, "wall", wall.x, wall.z);
  }
  completeConstruction(world, "lodge-segment", originX, originZ);
  const leftSpace = createSleepSpace(world, { zoneId, kind: "nest", cell: { x: originX, z: originZ } });
  const rightSpace = createSleepSpace(world, { zoneId, kind: "nest", cell: { x: originX + 1, z: originZ } });
  claimSleepSpace(world, leftResident, leftSpace);
  claimSleepSpace(world, rightResident, rightSpace);
  return zoneId;
}

function relateAsMates(world: World, a: EntityId, b: EntityId, familiarity = 0.2, affinity = 0.1): void {
  setRelationshipWith(world.components, a, { withId: b, kin: "mate", familiarity, affinity });
  setRelationshipWith(world.components, b, { withId: a, kin: "mate", familiarity, affinity });
}

describe("SocialInteraction", () => {
  it("validates persistent social state", () => {
    expect(() => assertValidSocialState({ socialNeed: 0 })).not.toThrow();
    expect(() => assertValidSocialState({ socialNeed: 1, lastInteractionTick: 3 })).not.toThrow();
    expect(() => assertValidSocialState({ socialNeed: -0.1 })).toThrow(RangeError);
    expect(() => assertValidSocialState({ socialNeed: 1.1 })).toThrow(RangeError);
    expect(() => assertValidSocialState({ socialNeed: 0, lastInteractionTick: -1 })).toThrow(RangeError);
  });

  it("accumulates social pressure only for live idle beavers", () => {
    const { world } = buildFlatWorld();
    const idle = spawnAt(world, "Idle", 2, 2);
    const urgent = spawnAt(world, "Urgent", 3, 2);
    const busy = spawnAt(world, "Busy", 4, 2);
    setWorldSocialState(world, idle, { socialNeed: 0.1 });
    setWorldSocialState(world, urgent, { socialNeed: 0.1 });
    setWorldSocialState(world, busy, { socialNeed: 0.1 });
    setNeeds(world.components, urgent, { ...BASELINE_NEEDS, thirst: 0.8 });
    const designation = createDesignation(world, "go-to", { x: 5, z: 2 });
    const [job] = generateJobs(world, designation);
    reserveJob(world.components, world.entities, job!, busy);

    expect(isSociallyIdle(world, idle)).toBe(true);
    expect(isSociallyIdle(world, urgent)).toBe(false);
    expect(isSociallyIdle(world, busy)).toBe(false);
    tickSocialNeeds(world);

    expect(getSocialState(world.components, idle)!.socialNeed).toBeCloseTo(0.1 + SOCIAL_NEED_INCREASE_PER_IDLE_TICK);
    expect(getSocialState(world.components, urgent)!.socialNeed).toBe(0.1);
    expect(getSocialState(world.components, busy)!.socialNeed).toBe(0.1);
  });

  it("schedules a generic social interaction from relationship and shared lodge state", () => {
    const { world } = buildFlatWorld();
    const a = spawnAt(world, "Alder", 3, 3);
    const b = spawnAt(world, "Birch", 4, 3);
    const zoneId = createClaimedLodgeRoom(world, a, b);
    relateAsMates(world, a, b);
    setWorldSocialState(world, a, { socialNeed: SOCIAL_INTERACTION_THRESHOLD });
    setWorldSocialState(world, b, { socialNeed: SOCIAL_INTERACTION_THRESHOLD + 0.1 });

    const interactions = tickSocialInteractions(world);

    expect(interactions).toHaveLength(1);
    expect(interactions[0]).toMatchObject({ participantIds: [a, b], venueZoneId: zoneId, location: world.grid.positionOf(a) });
    expect(getSocialState(world.components, a)).toEqual({
      socialNeed: SOCIAL_INTERACTION_THRESHOLD - SOCIAL_INTERACTION_RELIEF,
      lastInteractionTick: world.clock.tick,
    });
    expect(getSocialState(world.components, b)).toEqual({
      socialNeed: SOCIAL_INTERACTION_THRESHOLD + 0.1 - SOCIAL_INTERACTION_RELIEF,
      lastInteractionTick: world.clock.tick,
    });
    expect(relationshipWith(world.components, a, b)).toMatchObject({ kin: "mate", affinity: 0.13 });
    expect(relationshipWith(world.components, a, b)!.familiarity).toBeCloseTo(0.3);
    expect(relationshipWith(world.components, b, a)).toMatchObject({ kin: "mate", affinity: 0.13 });
    expect(relationshipWith(world.components, b, a)!.familiarity).toBeCloseTo(0.3);
    const event = world.events.get(interactions[0]!.eventId);
    expect(event.eventType).toBe("social-interaction");
    expect(event.subjectIds).toEqual([a, b]);
    expect(event.objectIds).toEqual([zoneId]);
  });

  it("does not fabricate interactions without a relationship edge, shared usable lodge, or physical contact", () => {
    const { world } = buildFlatWorld();
    const a = spawnAt(world, "Alder", 3, 3);
    const b = spawnAt(world, "Birch", 4, 3);
    createClaimedLodgeRoom(world, a, b);
    setWorldSocialState(world, a, { socialNeed: SOCIAL_INTERACTION_THRESHOLD });
    setWorldSocialState(world, b, { socialNeed: SOCIAL_INTERACTION_THRESHOLD });
    expect(tickSocialInteractions(world)).toHaveLength(0);

    relateAsMates(world, a, b);
    world.grid.setEntityPosition(b, 7, world.grid.surfaceY(7, 7)! + 1, 7);
    expect(tickSocialInteractions(world)).toHaveLength(0);
  });

  it("does not schedule an interaction when participants stand outside the shared lodge room", () => {
    const { world } = buildFlatWorld();
    const a = spawnAt(world, "Alder", 3, 3);
    const b = spawnAt(world, "Birch", 4, 3);
    createClaimedLodgeRoom(world, a, b);
    relateAsMates(world, a, b);
    setWorldSocialState(world, a, { socialNeed: SOCIAL_INTERACTION_THRESHOLD });
    setWorldSocialState(world, b, { socialNeed: SOCIAL_INTERACTION_THRESHOLD });

    // Both beavers keep their claimed lodge-room sleep spaces but stand
    // physically adjacent far outside that room. Claimed lodge state alone
    // must not count as the interaction venue.
    world.grid.setEntityPosition(a, 7, world.grid.surfaceY(7, 7)! + 1, 7);
    world.grid.setEntityPosition(b, 8, world.grid.surfaceY(8, 7)! + 1, 7);

    expect(tickSocialInteractions(world)).toHaveLength(0);
    expect(getSocialDebugState(world, a)).not.toHaveProperty("venueZoneId");
  });

  it("persists social state, relationship changes, and interaction events through full-world save/reload", () => {
    const { world } = buildFlatWorld();
    const a = spawnAt(world, "Alder", 3, 3);
    const b = spawnAt(world, "Birch", 4, 3);
    createClaimedLodgeRoom(world, a, b);
    relateAsMates(world, a, b);
    setWorldSocialState(world, a, { socialNeed: 0.9 });
    setWorldSocialState(world, b, { socialNeed: 0.8 });
    const [interaction] = tickSocialInteractions(world);

    const restoredMaterials = new MaterialRegistry();
    registerStandardMaterials(restoredMaterials);
    const restored = restoreWorld(JSON.parse(JSON.stringify(snapshotWorld(world))), {
      componentTypes: ALL_COMPONENT_TYPES,
      materials: restoredMaterials,
    });

    expect(getSocialState(restored.components, a)).toEqual(getSocialState(world.components, a));
    expect(relationshipWith(restored.components, a, b)).toEqual(relationshipWith(world.components, a, b));
    expect(restored.events.get(interaction!.eventId)).toEqual(world.events.get(interaction!.eventId));
  });

  it("validating world-aware paths catch corrupted restored future social state", () => {
    const { world } = buildFlatWorld();
    const beaver = spawnAt(world, "Alder", 3, 3);
    world.components.set(beaver, SocialStateComponent, { socialNeed: 0.5, lastInteractionTick: world.clock.tick + 1 });

    expect(() => getSocialDebugState(world, beaver)).toThrow(RangeError);
    expect(() => tickSocialNeeds(world)).toThrow(RangeError);
    expect(() => tickSocialInteractions(world)).toThrow(RangeError);
    expect(() => setWorldSocialState(world, beaver, { socialNeed: 0.5, lastInteractionTick: world.clock.tick + 1 })).toThrow(RangeError);
  });
});
