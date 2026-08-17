/**
 * Headless acceptance test for P2-11 -- Reproduction and births.
 *
 * Roadmap acceptance test:
 *   "eligible pair relationships can produce persistent offspring
 *   entities with parent references and birth events."
 *
 * Eligibility is not scripted for this scenario: the pair must have real
 * bidirectional P1-19 mate relationship edges and real P2-06 claimed sleep
 * spaces inside the same recognized lodge room. The birth then creates an
 * ordinary persistent beaver entity, parentage data, kin edges, household
 * membership when both parents already share one, and an EventLog record.
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
import { spawnBeaver } from "../../src/sim/creatures/Beaver.js";
import {
  createHousehold,
  getHouseholdMembership,
  relationshipWith,
  setHouseholdMembership,
  setRelationshipWith,
} from "../../src/sim/creatures/Relationships.js";
import { getWorldParentage, tickReproduction } from "../../src/sim/creatures/Reproduction.js";
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

function createClaimedLodgeRoom(world: World, parentA: EntityId, parentB: EntityId): EntityId {
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
  claimSleepSpace(world, parentA, leftSpace);
  claimSleepSpace(world, parentB, rightSpace);
  return zoneId;
}

describe("P2-11 -- Reproduction and births", () => {
  it("eligible mate relationships produce persistent offspring with parent references and birth events", () => {
    const { world, materials } = buildFlatWorld();
    const parentA = spawnAt(world, "Alder", 3, 3);
    const parentB = spawnAt(world, "Birch", 4, 3);
    const zoneId = createClaimedLodgeRoom(world, parentA, parentB);
    setRelationshipWith(world.components, parentA, { withId: parentB, kin: "mate", familiarity: 1, affinity: 0.9 });
    setRelationshipWith(world.components, parentB, { withId: parentA, kin: "mate", familiarity: 1, affinity: 0.9 });
    const household = createHousehold(world);
    setHouseholdMembership(world.components, parentA, { householdId: household });
    setHouseholdMembership(world.components, parentB, { householdId: household });

    const births = tickReproduction(world);

    expect(births).toHaveLength(1);
    const birth = births[0]!;
    const child = birth.offspringId;
    expect(world.entities.isLive(child)).toBe(true);
    expect(world.entities.kindOf(child)).toBe("beaver");
    expect(getWorldParentage(world, child)).toEqual({ parentIds: [parentA, parentB], birthTick: world.clock.tick });
    expect(relationshipWith(world.components, parentA, child)).toMatchObject({ kin: "child" });
    expect(relationshipWith(world.components, child, parentA)).toMatchObject({ kin: "parent" });
    expect(getHouseholdMembership(world.components, child)).toEqual({ householdId: household });

    const event = world.events.get(birth.birthEventId);
    expect(event.eventType).toBe("offspring-born");
    expect(event.subjectIds).toEqual([child]);
    expect(event.objectIds).toEqual([parentA, parentB, zoneId]);
    expect(event.location).toEqual(world.grid.positionOf(child));

    const restoredMaterials = new MaterialRegistry();
    registerStandardMaterials(restoredMaterials);
    const restored = restoreWorld(JSON.parse(JSON.stringify(snapshotWorld(world))), { componentTypes: ALL_COMPONENT_TYPES, materials: restoredMaterials });

    expect(getWorldParentage(restored, child)).toEqual(getWorldParentage(world, child));
    expect(relationshipWith(restored.components, child, parentB)).toEqual(relationshipWith(world.components, child, parentB));
    expect(getHouseholdMembership(restored.components, child)).toEqual({ householdId: household });
    expect(restored.events.get(birth.birthEventId)).toEqual(event);
    expect(materials.getDebugState().materialCount).toBe(restoredMaterials.getDebugState().materialCount);
  });
});
