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
import { setNeeds, NEED_URGENT_THRESHOLD } from "../../src/sim/creatures/Needs.js";
import { getConstruction, setConstruction, type ConstructionKind } from "../../src/sim/labor/Construction.js";
import { createZone } from "../../src/sim/spaces/FunctionalSpace.js";
import {
  claimPreferredSleepSpace,
  claimSleepSpace,
  createSleepSpace,
  getSleepClaim,
  getSleepSpace,
  getSleepSpaceDebugState,
  preferredSleepSpace,
  SleepClaimComponent,
  SleepSpaceComponent,
  sleepSpaceClaimedBy,
  tickBeaverNeedsWithSleepPreferences,
} from "../../src/sim/spaces/SleepSpace.js";

function buildFlatWorld(sizeX = 12, sizeY = 8, sizeZ = 12, floor = 2): { world: World; materials: MaterialRegistry } {
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
  const random = new RandomStreams(206);
  const events = new EventLog(entities);
  return { world: { clock, random, entities, components, grid, terrain, events, water, weather }, materials };
}

function completedConstruction(world: World, kind: ConstructionKind, site: { x: number; z: number }): EntityId {
  const designationId = world.entities.create("designation");
  const constructionId = world.entities.create("construction");
  setConstruction(world.components, constructionId, {
    designationId,
    kind,
    site,
    requiredMaterialId: "wood",
    requiredMassKg: 1,
    workDone: 1,
    workRequired: 1,
    status: "complete",
  });
  return constructionId;
}

function completeOneCellLodgeRoom(world: World, cell: { x: number; z: number }): { zone: EntityId; lodge: EntityId } {
  const zone = createZone(world, { declaredFunction: "general-zone", cells: [cell] });
  completedConstruction(world, "wall", { x: cell.x - 1, z: cell.z });
  completedConstruction(world, "wall", { x: cell.x + 1, z: cell.z });
  completedConstruction(world, "wall", { x: cell.x, z: cell.z - 1 });
  completedConstruction(world, "wall", { x: cell.x, z: cell.z + 1 });
  const lodge = completedConstruction(world, "lodge-segment", cell);
  return { zone, lodge };
}

function completeTwoCellLodgeRoom(world: World): EntityId {
  const zone = createZone(world, {
    declaredFunction: "general-zone",
    cells: [
      { x: 2, z: 2 },
      { x: 3, z: 2 },
    ],
  });
  for (const site of [
    { x: 1, z: 2 },
    { x: 4, z: 2 },
    { x: 2, z: 1 },
    { x: 2, z: 3 },
    { x: 3, z: 1 },
    { x: 3, z: 3 },
  ]) {
    completedConstruction(world, "wall", site);
  }
  completedConstruction(world, "lodge-segment", { x: 2, z: 2 });
  return zone;
}

function spawnResident(world: World, at: { x: number; z: number }, name = "Resident"): EntityId {
  const floor = world.grid.surfaceY(at.x, at.z)!;
  return spawnBeaver(world, { name, position: { x: at.x, y: floor + 1, z: at.z } });
}

describe("SleepSpace", () => {
  it("creates a persistent sleep-space entity only inside a recognized lodge room", () => {
    const { world } = buildFlatWorld();
    const { zone } = completeOneCellLodgeRoom(world, { x: 2, z: 2 });

    const space = createSleepSpace(world, { zoneId: zone, kind: "bed", cell: { x: 2, z: 2 } });

    expect(world.entities.kindOf(space)).toBe("sleep-space");
    expect(getSleepSpace(world, space)).toEqual({ zoneId: zone, kind: "bed" });
    expect(world.grid.positionOf(space)).toEqual({ x: 2, y: 3, z: 2 });
    expect(getSleepSpaceDebugState(world, space).usable).toBe(true);
  });

  it("rejects spaces in outdoor zones or outside the lodge-room's cells", () => {
    const { world } = buildFlatWorld();
    const outdoor = createZone(world, { declaredFunction: "work-yard", cells: [{ x: 2, z: 2 }] });
    expect(() => createSleepSpace(world, { zoneId: outdoor, kind: "nest", cell: { x: 2, z: 2 } })).toThrow(RangeError);

    const { zone } = completeOneCellLodgeRoom(world, { x: 5, z: 5 });
    expect(() => createSleepSpace(world, { zoneId: zone, kind: "nest", cell: { x: 5, z: 6 } })).toThrow(RangeError);
  });

  it("REGRESSION (P2-06): rejects duplicate physical sleep spaces in the same lodge-room cell", () => {
    const { world } = buildFlatWorld();
    const { zone } = completeOneCellLodgeRoom(world, { x: 2, z: 2 });
    createSleepSpace(world, { zoneId: zone, kind: "bed", cell: { x: 2, z: 2 } });

    expect(() => createSleepSpace(world, { zoneId: zone, kind: "nest", cell: { x: 2, z: 2 } })).toThrow(RangeError);
  });

  it("claims a sleep space through ownership state and prevents a second live resident from claiming the same space", () => {
    const { world } = buildFlatWorld();
    const { zone } = completeOneCellLodgeRoom(world, { x: 2, z: 2 });
    const space = createSleepSpace(world, { zoneId: zone, kind: "bed", cell: { x: 2, z: 2 } });
    const first = spawnResident(world, { x: 1, z: 1 }, "First");
    const second = spawnResident(world, { x: 8, z: 8 }, "Second");

    claimSleepSpace(world, first, space);

    expect(getSleepClaim(world, first)).toEqual({ spaceId: space });
    expect(sleepSpaceClaimedBy(world, space)).toBe(first);
    expect(() => claimSleepSpace(world, second, space)).toThrow(RangeError);
  });

  it("REGRESSION (P2-06): corrupted SleepClaim data on a non-beaver fails loudly instead of blocking real residents silently", () => {
    const { world } = buildFlatWorld();
    const { zone } = completeOneCellLodgeRoom(world, { x: 2, z: 2 });
    const space = createSleepSpace(world, { zoneId: zone, kind: "bed", cell: { x: 2, z: 2 } });
    const log = world.entities.create("log");
    world.components.set(log, SleepClaimComponent, { spaceId: space });

    expect(() => sleepSpaceClaimedBy(world, space)).toThrow(RangeError);
  });

  it("REGRESSION (P2-06): corrupted SleepSpace data on the wrong entity kind fails loudly at the usable-space boundary", () => {
    const { world } = buildFlatWorld();
    const { zone } = completeOneCellLodgeRoom(world, { x: 2, z: 2 });
    const log = world.entities.create("log");
    world.grid.setEntityPosition(log, 2, world.grid.surfaceY(2, 2)! + 1, 2);
    world.components.set(log, SleepSpaceComponent, { zoneId: zone, kind: "bed" });
    const resident = spawnResident(world, { x: 1, z: 1 });

    expect(() => claimSleepSpace(world, resident, log)).toThrow(RangeError);
  });

  it("prefers beds over nests, then skips another resident's claimed bed", () => {
    const { world, materials } = buildFlatWorld();
    const zone = completeTwoCellLodgeRoom(world);
    const nest = createSleepSpace(world, { zoneId: zone, kind: "nest", cell: { x: 2, z: 2 } });
    const bed = createSleepSpace(world, { zoneId: zone, kind: "bed", cell: { x: 3, z: 2 } });
    const first = spawnResident(world, { x: 2, z: 4 }, "First");
    const second = spawnResident(world, { x: 2, z: 5 }, "Second");
    const profile = getSwimmer(world.components, first)!;

    expect(claimPreferredSleepSpace(world, materials, first, profile)!.spaceId).toBe(bed);
    expect(preferredSleepSpace(world, materials, second, profile)!.spaceId).toBe(nest);
  });

  it("honors a resident's existing claim over an unclaimed higher-ranked bed", () => {
    const { world, materials } = buildFlatWorld();
    const zone = completeTwoCellLodgeRoom(world);
    const nest = createSleepSpace(world, { zoneId: zone, kind: "nest", cell: { x: 2, z: 2 } });
    createSleepSpace(world, { zoneId: zone, kind: "bed", cell: { x: 3, z: 2 } });
    const resident = spawnResident(world, { x: 2, z: 4 });
    const profile = getSwimmer(world.components, resident)!;
    claimSleepSpace(world, resident, nest);

    const choice = preferredSleepSpace(world, materials, resident, profile)!;

    expect(choice.spaceId).toBe(nest);
    expect(choice.reason).toBe("claimed");
  });

  it("falls back from a claim whose room is no longer a lodge room", () => {
    const { world, materials } = buildFlatWorld();
    const firstRoom = completeOneCellLodgeRoom(world, { x: 2, z: 2 });
    const invalidated = createSleepSpace(world, { zoneId: firstRoom.zone, kind: "bed", cell: { x: 2, z: 2 } });
    const secondRoom = completeOneCellLodgeRoom(world, { x: 7, z: 7 });
    const fallback = createSleepSpace(world, { zoneId: secondRoom.zone, kind: "nest", cell: { x: 7, z: 7 } });
    const resident = spawnResident(world, { x: 6, z: 7 });
    const profile = getSwimmer(world.components, resident)!;
    claimSleepSpace(world, resident, invalidated);

    setConstruction(world.components, firstRoom.lodge, { ...getConstruction(world.components, firstRoom.lodge)!, status: "cancelled" });

    const choice = preferredSleepSpace(world, materials, resident, profile)!;

    expect(choice.spaceId).toBe(fallback);
    expect(choice.reason).toBe("preferred");
  });

  it("round-trips sleep spaces and resident claims through the full world component registry", () => {
    const { world } = buildFlatWorld();
    const { zone } = completeOneCellLodgeRoom(world, { x: 2, z: 2 });
    const space = createSleepSpace(world, { zoneId: zone, kind: "bed", cell: { x: 2, z: 2 } });
    const resident = spawnResident(world, { x: 1, z: 1 });
    claimSleepSpace(world, resident, space);
    const restoreMaterials = new MaterialRegistry();
    registerStandardMaterials(restoreMaterials);

    const restored = restoreWorld(JSON.parse(JSON.stringify(snapshotWorld(world))), { componentTypes: ALL_COMPONENT_TYPES, materials: restoreMaterials });

    expect(getSleepSpace(restored, space)).toEqual({ zoneId: zone, kind: "bed" });
    expect(getSleepClaim(restored, resident)).toEqual({ spaceId: space });
    expect(sleepSpaceClaimedBy(restored, space)).toBe(resident);
  });

  it("feeds a claimed sleep-space target into fatigue-driven rest movement", () => {
    const { world, materials } = buildFlatWorld();
    const { zone } = completeOneCellLodgeRoom(world, { x: 5, z: 5 });
    const space = createSleepSpace(world, { zoneId: zone, kind: "bed", cell: { x: 5, z: 5 } });
    const resident = spawnResident(world, { x: 2, z: 5 });
    const profile = getSwimmer(world.components, resident)!;
    setNeeds(world.components, resident, { hunger: 0, thirst: 0, fatigue: NEED_URGENT_THRESHOLD + 0.1, thermalComfort: 1 });
    claimSleepSpace(world, resident, space);

    const result = tickBeaverNeedsWithSleepPreferences(world, materials, resident, profile);

    expect(result.intent).toEqual({ kind: "rest", target: { x: 5, z: 5 } });
    expect(result.movement?.outcome).toBe("moved");
  });
});
