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
import {
  DEFAULT_BEAVER_CAN_SWIM,
  DEFAULT_BEAVER_MASS_KG,
  DEFAULT_BEAVER_MAX_WADING_DEPTH,
  DEFAULT_BEAVER_SPEED,
  getCreatureBody,
  getLocomotion,
  getSwimmer,
  spawnBeaver,
} from "../../src/sim/creatures/Beaver.js";
import {
  JUVENILE_TO_ADULT_TICKS,
  LIFE_STAGE_CAPABILITIES,
  LifeStageComponent,
  NEWBORN_TO_JUVENILE_TICKS,
  assertValidLifeStageState,
  getAgingDebugState,
  getLifeStage,
  initializeAdultLifeStage,
  initializeNewbornLifeStage,
  lifeStageForAge,
  setWorldLifeStage,
  tickAging,
  tickAllAging,
} from "../../src/sim/creatures/Aging.js";

function buildFlatWorld(sizeX = 8, sizeY = 8, sizeZ = 8, floor = 2): { world: World; materials: MaterialRegistry } {
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

function expectCapabilities(world: World, beaverId: EntityId, stage: "newborn" | "juvenile" | "adult"): void {
  const expected = LIFE_STAGE_CAPABILITIES[stage];
  expect(getCreatureBody(world.components, beaverId)).toEqual({ massKg: expected.massKg });
  expect(getLocomotion(world.components, beaverId)).toEqual({ speed: expected.speed });
  expect(getSwimmer(world.components, beaverId)).toEqual({ canSwim: expected.canSwim, maxWadingDepth: expected.maxWadingDepth });
}

describe("Aging", () => {
  it("derives stage from non-negative tick age and rejects drifted persistent state", () => {
    expect(lifeStageForAge(0)).toBe("newborn");
    expect(lifeStageForAge(NEWBORN_TO_JUVENILE_TICKS - 1)).toBe("newborn");
    expect(lifeStageForAge(NEWBORN_TO_JUVENILE_TICKS)).toBe("juvenile");
    expect(lifeStageForAge(JUVENILE_TO_ADULT_TICKS - 1)).toBe("juvenile");
    expect(lifeStageForAge(JUVENILE_TO_ADULT_TICKS)).toBe("adult");
    expect(() => lifeStageForAge(-1)).toThrow(RangeError);
    expect(() => assertValidLifeStageState({ ageTicks: NEWBORN_TO_JUVENILE_TICKS, stage: "newborn", lastUpdatedTick: 0 })).toThrow(
      RangeError,
    );
    expect(() => assertValidLifeStageState({ ageTicks: 0, stage: "kit" as never, lastUpdatedTick: 0 })).toThrow(RangeError);
  });

  it("initializes newborn and adult states by writing real capability components", () => {
    const { world } = buildFlatWorld();
    const newborn = spawnAt(world, "Sprout", 3, 3);
    const adult = spawnAt(world, "Alder", 4, 3);

    initializeNewbornLifeStage(world, newborn);
    initializeAdultLifeStage(world, adult);

    expect(getLifeStage(world.components, newborn)).toEqual({ ageTicks: 0, stage: "newborn", lastUpdatedTick: 0 });
    expectCapabilities(world, newborn, "newborn");
    expect(getLifeStage(world.components, adult)).toEqual({ ageTicks: JUVENILE_TO_ADULT_TICKS, stage: "adult", lastUpdatedTick: 0 });
    expect(getCreatureBody(world.components, adult)).toEqual({ massKg: DEFAULT_BEAVER_MASS_KG });
    expect(getLocomotion(world.components, adult)).toEqual({ speed: DEFAULT_BEAVER_SPEED });
    expect(getSwimmer(world.components, adult)).toEqual({
      canSwim: DEFAULT_BEAVER_CAN_SWIM,
      maxWadingDepth: DEFAULT_BEAVER_MAX_WADING_DEPTH,
    });
  });

  it("advances newborns into juvenile and adult capabilities from SimulationClock ticks", () => {
    const { world } = buildFlatWorld();
    const child = spawnAt(world, "Sprout", 3, 3);
    initializeNewbornLifeStage(world, child);

    world.clock.advanceTicks(NEWBORN_TO_JUVENILE_TICKS);
    expect(tickAging(world, child)).toEqual({ ageTicks: NEWBORN_TO_JUVENILE_TICKS, stage: "juvenile", lastUpdatedTick: world.clock.tick });
    expectCapabilities(world, child, "juvenile");

    world.clock.advanceTicks(JUVENILE_TO_ADULT_TICKS - NEWBORN_TO_JUVENILE_TICKS);
    expect(tickAging(world, child)).toEqual({ ageTicks: JUVENILE_TO_ADULT_TICKS, stage: "adult", lastUpdatedTick: world.clock.tick });
    expectCapabilities(world, child, "adult");

    const events = world.events.eventsInvolving(child).filter((event) => event.eventType === "life-stage-changed");
    expect(events.map((event) => event.tick)).toEqual([NEWBORN_TO_JUVENILE_TICKS, JUVENILE_TO_ADULT_TICKS]);
    expect(events.map((event) => event.location)).toEqual([world.grid.positionOf(child), world.grid.positionOf(child)]);
  });

  it("ticks all tracked live beavers in deterministic id order and ignores beavers without life-stage state", () => {
    const { world } = buildFlatWorld();
    const first = spawnAt(world, "First", 2, 2);
    const untracked = spawnAt(world, "Untracked", 3, 2);
    const second = spawnAt(world, "Second", 4, 2);
    initializeNewbornLifeStage(world, first);
    initializeNewbornLifeStage(world, second);

    world.clock.advanceTicks(NEWBORN_TO_JUVENILE_TICKS);
    tickAllAging(world);

    expect(getLifeStage(world.components, first)!.stage).toBe("juvenile");
    expect(getLifeStage(world.components, second)!.stage).toBe("juvenile");
    expect(getLifeStage(world.components, untracked)).toBeUndefined();
    expect(world.events.eventsOfType("life-stage-changed").map((event) => event.subjectIds[0])).toEqual([first, second]);
  });

  it("survives save/reload and continues aging deterministically from the restored tick", () => {
    const { world } = buildFlatWorld();
    const child = spawnAt(world, "Sprout", 3, 3);
    initializeNewbornLifeStage(world, child);
    world.clock.advanceTicks(NEWBORN_TO_JUVENILE_TICKS);
    tickAging(world, child);

    const restoredMaterials = new MaterialRegistry();
    registerStandardMaterials(restoredMaterials);
    const restored = restoreWorld(JSON.parse(JSON.stringify(snapshotWorld(world))), {
      componentTypes: ALL_COMPONENT_TYPES,
      materials: restoredMaterials,
    });

    restored.clock.advanceTicks(JUVENILE_TO_ADULT_TICKS - NEWBORN_TO_JUVENILE_TICKS);
    tickAging(restored, child);
    expect(getLifeStage(restored.components, child)).toEqual({ ageTicks: JUVENILE_TO_ADULT_TICKS, stage: "adult", lastUpdatedTick: restored.clock.tick });
    expectCapabilities(restored, child, "adult");
  });

  it("validating debug and read paths catch corrupted restored life-stage state", () => {
    const { world } = buildFlatWorld();
    const child = spawnAt(world, "Sprout", 3, 3);
    initializeNewbornLifeStage(world, child);
    world.components.set(child, LifeStageComponent, { ageTicks: -1, stage: "newborn", lastUpdatedTick: 0 });
    expect(() => getLifeStage(world.components, child)).toThrow(RangeError);

    const tree = world.entities.create("tree");
    world.components.set(tree, LifeStageComponent, { ageTicks: 0, stage: "newborn", lastUpdatedTick: 0 });
    expect(() => getAgingDebugState(world, tree)).toThrow(RangeError);
    expect(() => setWorldLifeStage(world, tree, { ageTicks: 0, stage: "newborn", lastUpdatedTick: 0 })).toThrow(RangeError);

    world.components.set(child, LifeStageComponent, { ageTicks: 0, stage: "newborn", lastUpdatedTick: world.clock.tick + 1 });
    expect(() => getAgingDebugState(world, child)).toThrow(RangeError);
    expect(() => setWorldLifeStage(world, child, { ageTicks: 0, stage: "newborn", lastUpdatedTick: world.clock.tick + 1 })).toThrow(RangeError);
  });
});
