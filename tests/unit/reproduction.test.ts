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
import { spawnBeaver, getIdentity } from "../../src/sim/creatures/Beaver.js";
import {
  createHousehold,
  getHouseholdMembership,
  relationshipWith,
  setHouseholdMembership,
  setRelationshipWith,
} from "../../src/sim/creatures/Relationships.js";
import {
  ParentageComponent,
  ReproductiveStateComponent,
  assertValidParentage,
  assertValidReproductiveState,
  getParentage,
  getReproductionDebugState,
  getReproductiveState,
  getWorldParentage,
  produceOffspring,
  reproductionEligibility,
  setWorldParentage,
  tickReproduction,
} from "../../src/sim/creatures/Reproduction.js";
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
  const random = new RandomStreams(211);
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

function createTwoCellLodgeRoom(world: World): { zoneId: EntityId; leftSpace: EntityId; rightSpace: EntityId } {
  const zoneId = createZone(world, { cells: [{ x: 3, z: 3 }, { x: 4, z: 3 }], declaredFunction: "general-zone" });
  for (const wall of [
    { x: 2, z: 3 },
    { x: 3, z: 2 },
    { x: 3, z: 4 },
    { x: 4, z: 2 },
    { x: 4, z: 4 },
    { x: 5, z: 3 },
  ]) {
    completeConstruction(world, "wall", wall.x, wall.z);
  }
  completeConstruction(world, "lodge-segment", 3, 3);
  const leftSpace = createSleepSpace(world, { zoneId, kind: "nest", cell: { x: 3, z: 3 } });
  const rightSpace = createSleepSpace(world, { zoneId, kind: "nest", cell: { x: 4, z: 3 } });
  return { zoneId, leftSpace, rightSpace };
}

function createEligiblePair(world: World): { parentA: EntityId; parentB: EntityId; zoneId: EntityId; householdId: EntityId } {
  const parentA = spawnAt(world, "Alder", 3, 3);
  const parentB = spawnAt(world, "Birch", 4, 3);
  const { zoneId, leftSpace, rightSpace } = createTwoCellLodgeRoom(world);
  claimSleepSpace(world, parentA, leftSpace);
  claimSleepSpace(world, parentB, rightSpace);
  setRelationshipWith(world.components, parentA, { withId: parentB, kin: "mate", familiarity: 1, affinity: 0.8 });
  setRelationshipWith(world.components, parentB, { withId: parentA, kin: "mate", familiarity: 1, affinity: 0.8 });
  const householdId = createHousehold(world);
  setHouseholdMembership(world.components, parentA, { householdId });
  setHouseholdMembership(world.components, parentB, { householdId });
  return { parentA, parentB, zoneId, householdId };
}

describe("Reproduction", () => {
  it("validates persistent parentage and reproductive state", () => {
    expect(() => assertValidParentage({ parentIds: [1 as EntityId, 2 as EntityId], birthTick: 0 })).not.toThrow();
    expect(() => assertValidParentage({ parentIds: [1 as EntityId, 1 as EntityId], birthTick: 0 })).toThrow(RangeError);
    expect(() => assertValidParentage({ parentIds: [1 as EntityId] as never, birthTick: 0 })).toThrow(RangeError);
    expect(() => assertValidParentage({ parentIds: [1 as EntityId, 2 as EntityId], birthTick: -1 })).toThrow(RangeError);
    expect(() => assertValidReproductiveState({ lastBirthTick: 0 })).not.toThrow();
    expect(() => assertValidReproductiveState({ lastBirthTick: -1 })).toThrow(RangeError);
  });

  it("requires a mutual mate relationship and usable claimed sleep spaces in the same lodge room", () => {
    const { world } = buildFlatWorld();
    const parentA = spawnAt(world, "Alder", 3, 3);
    const parentB = spawnAt(world, "Birch", 4, 3);

    expect(reproductionEligibility(world, parentA, parentB).reason).toBe("not-mutual-mates");
    setRelationshipWith(world.components, parentA, { withId: parentB, kin: "mate", familiarity: 1, affinity: 0.8 });
    setRelationshipWith(world.components, parentB, { withId: parentA, kin: "mate", familiarity: 1, affinity: 0.8 });
    expect(reproductionEligibility(world, parentA, parentB).reason).toBe("missing-usable-claimed-sleep-space");

    const { zoneId, leftSpace, rightSpace } = createTwoCellLodgeRoom(world);
    claimSleepSpace(world, parentA, leftSpace);
    claimSleepSpace(world, parentB, rightSpace);
    expect(reproductionEligibility(world, parentA, parentB)).toMatchObject({ eligible: true, reason: "eligible", lodgeZoneId: zoneId });
  });

  it("creates a persistent offspring with parent references, reciprocal kin edges, household membership, and a birth event", () => {
    const { world } = buildFlatWorld();
    const { parentA, parentB, zoneId, householdId } = createEligiblePair(world);

    const birth = produceOffspring(world, parentA, parentB);
    const child = birth.offspringId;

    expect(world.entities.kindOf(child)).toBe("beaver");
    expect(getIdentity(world.components, child)!.name).toBe(`Kit-${child}`);
    expect(getWorldParentage(world, child)).toEqual({ parentIds: [parentA, parentB], birthTick: world.clock.tick });
    expect(getHouseholdMembership(world.components, child)).toEqual({ householdId });
    expect(relationshipWith(world.components, parentA, child)).toMatchObject({ kin: "child" });
    expect(relationshipWith(world.components, parentB, child)).toMatchObject({ kin: "child" });
    expect(relationshipWith(world.components, child, parentA)).toMatchObject({ kin: "parent" });
    expect(relationshipWith(world.components, child, parentB)).toMatchObject({ kin: "parent" });
    expect(getReproductiveState(world.components, parentA)).toEqual({ lastBirthTick: world.clock.tick });
    expect(getReproductiveState(world.components, parentB)).toEqual({ lastBirthTick: world.clock.tick });
    expect(birth.lodgeZoneId).toBe(zoneId);

    const event = world.events.get(birth.birthEventId);
    expect(event.eventType).toBe("offspring-born");
    expect(event.subjectIds).toEqual([child]);
    expect(event.objectIds).toEqual([parentA, parentB, zoneId]);
    expect(event.location).toEqual(world.grid.positionOf(child));
  });

  it("uses parent reproductive state to prevent repeated immediate births", () => {
    const { world } = buildFlatWorld();
    const { parentA, parentB } = createEligiblePair(world);

    expect(tickReproduction(world)).toHaveLength(1);
    expect(reproductionEligibility(world, parentA, parentB).reason).toBe("birth-interval");
    expect(tickReproduction(world)).toHaveLength(0);
  });

  it("REGRESSION (P2-11 local review): invalid shared household state fails before allocating offspring", () => {
    const { world } = buildFlatWorld();
    const { parentA, parentB, householdId } = createEligiblePair(world);
    const beaversBefore = world.entities.liveIdsOfKind("beaver");
    const eventCountBefore = world.events.count;
    world.entities.destroy(householdId);

    expect(() => produceOffspring(world, parentA, parentB)).toThrow(RangeError);
    expect(world.entities.liveIdsOfKind("beaver")).toEqual(beaversBefore);
    expect(world.events.count).toBe(eventCountBefore);
  });

  it("derives deterministic debug state and survives full-world save/reload", () => {
    const { world } = buildFlatWorld();
    const { parentA, parentB } = createEligiblePair(world);
    const birth = produceOffspring(world, parentA, parentB, { name: "Sprout" });

    expect(getReproductionDebugState(world, birth.offspringId)).toMatchObject({
      beaverId: birth.offspringId,
      name: "Sprout",
      parentage: { parentIds: [parentA, parentB], birthTick: world.clock.tick },
    });

    const restoredMaterials = new MaterialRegistry();
    registerStandardMaterials(restoredMaterials);
    const restored = restoreWorld(JSON.parse(JSON.stringify(snapshotWorld(world))), { componentTypes: ALL_COMPONENT_TYPES, materials: restoredMaterials });

    expect(getWorldParentage(restored, birth.offspringId)).toEqual(getWorldParentage(world, birth.offspringId));
    expect(getReproductiveState(restored.components, parentA)).toEqual(getReproductiveState(world.components, parentA));
    expect(relationshipWith(restored.components, birth.offspringId, parentA)).toEqual(relationshipWith(world.components, birth.offspringId, parentA));
    expect(restored.events.get(birth.birthEventId)).toEqual(world.events.get(birth.birthEventId));
  });

  it("validating read paths catch corrupted restored component shapes", () => {
    const { world } = buildFlatWorld();
    const child = world.entities.create("beaver");
    const parent = world.entities.create("beaver");
    world.components.set(child, ParentageComponent, { parentIds: [parent, parent], birthTick: 0 });
    world.components.set(parent, ReproductiveStateComponent, { lastBirthTick: -1 });

    expect(() => getParentage(world.components, child)).toThrow(RangeError);
    expect(() => getReproductiveState(world.components, parent)).toThrow(RangeError);
  });

  it("REGRESSION (P2-11 critic): world parentage reads reject unknown or non-beaver parent references", () => {
    const { world } = buildFlatWorld();
    const child = world.entities.create("beaver");
    const parent = world.entities.create("beaver");
    const tree = world.entities.create("tree");

    expect(() => setWorldParentage(world, child, { parentIds: [parent, 999 as EntityId], birthTick: 0 })).toThrow(RangeError);
    world.components.set(child, ParentageComponent, { parentIds: [parent, tree], birthTick: 0 });
    expect(() => getWorldParentage(world, child)).toThrow(RangeError);
    expect(() => getReproductionDebugState(world, child)).toThrow(RangeError);
  });
});
