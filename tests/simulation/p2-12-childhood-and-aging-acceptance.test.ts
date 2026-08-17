/**
 * Headless acceptance test for P2-12 -- Childhood and aging.
 *
 * Roadmap acceptance test:
 *   "newborns progress through age states and capabilities with
 *   simulation time."
 *
 * The newborn comes from the real P2-11 reproduction path: a pair with
 * ordinary mate relationship edges and claimed lodge sleep spaces produces
 * a persistent offspring. P2-12 then advances only authoritative clock
 * ticks and runs the aging query/tick layer; capabilities change by
 * writing the same body, locomotion, and swimmer components other systems
 * already consume.
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
import { DEFAULT_BEAVER_MASS_KG, DEFAULT_BEAVER_SPEED, getCreatureBody, getLocomotion, getSwimmer, spawnBeaver } from "../../src/sim/creatures/Beaver.js";
import {
  JUVENILE_TO_ADULT_TICKS,
  LIFE_STAGE_CAPABILITIES,
  NEWBORN_TO_JUVENILE_TICKS,
  getLifeStage,
  tickAllAging,
} from "../../src/sim/creatures/Aging.js";
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
  const random = new RandomStreams(212);
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

describe("P2-12 -- Childhood and aging", () => {
  it("newborns progress through age states and real capabilities with simulation time", () => {
    const { world } = buildFlatWorld();
    const parentA = spawnAt(world, "Alder", 3, 3);
    const parentB = spawnAt(world, "Birch", 4, 3);
    createClaimedLodgeRoom(world, parentA, parentB);
    setRelationshipWith(world.components, parentA, { withId: parentB, kin: "mate", familiarity: 1, affinity: 0.9 });
    setRelationshipWith(world.components, parentB, { withId: parentA, kin: "mate", familiarity: 1, affinity: 0.9 });
    const household = createHousehold(world);
    setHouseholdMembership(world.components, parentA, { householdId: household });
    setHouseholdMembership(world.components, parentB, { householdId: household });

    const births = tickReproduction(world);

    expect(births).toHaveLength(1);
    const child = births[0]!.offspringId;
    expect(getWorldParentage(world, child)).toEqual({ parentIds: [parentA, parentB], birthTick: 0 });
    expect(getHouseholdMembership(world.components, child)).toEqual({ householdId: household });
    expect(relationshipWith(world.components, child, parentA)).toMatchObject({ kin: "parent" });
    expect(getLifeStage(world.components, child)).toEqual({ ageTicks: 0, stage: "newborn", lastUpdatedTick: 0 });
    expect(getCreatureBody(world.components, child)).toEqual({ massKg: LIFE_STAGE_CAPABILITIES.newborn.massKg });
    expect(getLocomotion(world.components, child)).toEqual({ speed: LIFE_STAGE_CAPABILITIES.newborn.speed });
    expect(getSwimmer(world.components, child)).toEqual({
      canSwim: LIFE_STAGE_CAPABILITIES.newborn.canSwim,
      maxWadingDepth: LIFE_STAGE_CAPABILITIES.newborn.maxWadingDepth,
    });

    world.clock.advanceTicks(NEWBORN_TO_JUVENILE_TICKS);
    tickAllAging(world);
    expect(getLifeStage(world.components, child)).toEqual({
      ageTicks: NEWBORN_TO_JUVENILE_TICKS,
      stage: "juvenile",
      lastUpdatedTick: NEWBORN_TO_JUVENILE_TICKS,
    });
    expect(getSwimmer(world.components, child)!.canSwim).toBe(true);
    expect(getLocomotion(world.components, child)!.speed).toBeGreaterThan(LIFE_STAGE_CAPABILITIES.newborn.speed);

    const restoredMaterials = new MaterialRegistry();
    registerStandardMaterials(restoredMaterials);
    const restored = restoreWorld(JSON.parse(JSON.stringify(snapshotWorld(world))), {
      componentTypes: ALL_COMPONENT_TYPES,
      materials: restoredMaterials,
    });
    restored.clock.advanceTicks(JUVENILE_TO_ADULT_TICKS - NEWBORN_TO_JUVENILE_TICKS);
    tickAllAging(restored);

    expect(getLifeStage(restored.components, child)).toEqual({
      ageTicks: JUVENILE_TO_ADULT_TICKS,
      stage: "adult",
      lastUpdatedTick: JUVENILE_TO_ADULT_TICKS,
    });
    expect(getCreatureBody(restored.components, child)).toEqual({ massKg: DEFAULT_BEAVER_MASS_KG });
    expect(getLocomotion(restored.components, child)).toEqual({ speed: DEFAULT_BEAVER_SPEED });
    expect(getSwimmer(restored.components, child)).toEqual({
      canSwim: LIFE_STAGE_CAPABILITIES.adult.canSwim,
      maxWadingDepth: LIFE_STAGE_CAPABILITIES.adult.maxWadingDepth,
    });
    expect(restored.events.eventsInvolving(child).filter((event) => event.eventType === "life-stage-changed").map((event) => event.tick)).toEqual([
      NEWBORN_TO_JUVENILE_TICKS,
      JUVENILE_TO_ADULT_TICKS,
    ]);
  });
});
