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
import { setConstruction, type ConstructionKind } from "../../src/sim/labor/Construction.js";
import {
  createZone,
  getZone,
  getZoneDebugState,
  recognizeFunctionalSpace,
  setZone,
  ZoneComponent,
} from "../../src/sim/spaces/FunctionalSpace.js";

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
  const random = new RandomStreams(1);
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

function completeWallsAroundTwoByTwo(world: World): EntityId[] {
  return [
    completedConstruction(world, "wall", { x: 1, z: 2 }),
    completedConstruction(world, "wall", { x: 1, z: 3 }),
    completedConstruction(world, "wall", { x: 4, z: 2 }),
    completedConstruction(world, "wall", { x: 4, z: 3 }),
    completedConstruction(world, "wall", { x: 2, z: 1 }),
    completedConstruction(world, "wall", { x: 3, z: 1 }),
    completedConstruction(world, "wall", { x: 2, z: 4 }),
    completedConstruction(world, "wall", { x: 3, z: 4 }),
  ];
}

describe("Zone component", () => {
  it("normalizes cells for deterministic persistence", () => {
    const { world } = buildFlatWorld();
    const zone = createZone(world, {
      declaredFunction: "work-yard",
      cells: [
        { x: 3, z: 2 },
        { x: 2, z: 2 },
        { x: 2, z: 2 },
      ],
    });

    expect(getZone(world.components, zone)).toEqual({
      declaredFunction: "work-yard",
      cells: [
        { x: 2, z: 2 },
        { x: 3, z: 2 },
      ],
    });
  });

  it("rejects malformed persisted zone data at the read boundary", () => {
    const { world } = buildFlatWorld();
    const zone = world.entities.create("zone");
    world.components.set(zone, ZoneComponent, { declaredFunction: "work-yard", cells: "not-cells" } as never);
    expect(() => getZone(world.components, zone)).toThrow(RangeError);

    world.components.set(zone, ZoneComponent, { declaredFunction: "bad-zone", cells: [{ x: 2, z: 2 }] } as never);
    expect(() => getZone(world.components, zone)).toThrow(RangeError);

    world.components.set(zone, ZoneComponent, { declaredFunction: "work-yard", cells: [null] } as never);
    expect(() => getZone(world.components, zone)).toThrow(RangeError);
  });

  it("rejects zone creation for cells that are not real ground columns before allocating identity", () => {
    const { world } = buildFlatWorld();

    expect(() => createZone(world, { declaredFunction: "work-yard", cells: [{ x: 999, z: 999 }] })).toThrow(RangeError);
    expect(world.entities.liveIdsOfKind("zone")).toEqual([]);
  });
});

describe("recognizeFunctionalSpace", () => {
  it("recognizes a defined outdoor zone from the zone's declared function before enclosure exists", () => {
    const { world } = buildFlatWorld();
    const zone = createZone(world, { declaredFunction: "work-yard", cells: [{ x: 2, z: 2 }] });

    const recognized = recognizeFunctionalSpace(world, zone);

    expect(recognized.enclosed).toBe(false);
    expect(recognized.recognizedFunction).toBe("work-yard");
    expect(recognized.missingBoundaryCells).toHaveLength(4);
  });

  it("REGRESSION (P2-05): refuses to recognize restored zones whose cells are not real ground columns", () => {
    const { world } = buildFlatWorld();
    const zone = world.entities.create("zone");
    world.components.set(zone, ZoneComponent, { declaredFunction: "work-yard", cells: [{ x: 999, z: 999 }] });

    expect(() => recognizeFunctionalSpace(world, zone)).toThrow(RangeError);
  });

  it("recognizes an empty enclosed room from completed wall geometry around the zone", () => {
    const { world } = buildFlatWorld();
    const zone = createZone(world, {
      declaredFunction: "work-yard",
      cells: [
        { x: 2, z: 2 },
        { x: 2, z: 3 },
        { x: 3, z: 2 },
        { x: 3, z: 3 },
      ],
    });
    const wallIds = completeWallsAroundTwoByTwo(world);

    const recognized = recognizeFunctionalSpace(world, zone);

    expect(recognized.enclosed).toBe(true);
    expect(recognized.recognizedFunction).toBe("empty-room");
    expect(recognized.missingBoundaryCells).toEqual([]);
    expect(recognized.boundaryConstructionIds).toEqual([...wallIds].sort((a, b) => a - b));
  });

  it("recognizes a lodge room when completed lodge-segment contents exist inside the enclosed zone", () => {
    const { world } = buildFlatWorld();
    const zone = createZone(world, {
      declaredFunction: "general-zone",
      cells: [
        { x: 2, z: 2 },
        { x: 2, z: 3 },
        { x: 3, z: 2 },
        { x: 3, z: 3 },
      ],
    });
    completeWallsAroundTwoByTwo(world);
    const lodge = completedConstruction(world, "lodge-segment", { x: 2, z: 2 });

    const recognized = getZoneDebugState(world, zone);

    expect(recognized.enclosed).toBe(true);
    expect(recognized.recognizedFunction).toBe("lodge-room");
    expect(recognized.contentConstructionIds).toEqual([lodge]);
  });

  it("ignores unfinished walls and out-of-zone lodge contents", () => {
    const { world } = buildFlatWorld();
    const zone = createZone(world, { declaredFunction: "general-zone", cells: [{ x: 2, z: 2 }] });
    completedConstruction(world, "lodge-segment", { x: 5, z: 5 });
    const wallDesignationId = world.entities.create("designation");
    const unfinishedWall = world.entities.create("construction");
    setConstruction(world.components, unfinishedWall, {
      designationId: wallDesignationId,
      kind: "wall",
      site: { x: 1, z: 2 },
      requiredMaterialId: "wood",
      requiredMassKg: 1,
      workDone: 0,
      workRequired: 1,
      status: "awaiting-labor",
    });

    const recognized = recognizeFunctionalSpace(world, zone);

    expect(recognized.enclosed).toBe(false);
    expect(recognized.recognizedFunction).toBe("general-zone");
    expect(recognized.contentConstructionIds).toEqual([]);
  });

  it("round-trips zones through the full world component registry", () => {
    const { world } = buildFlatWorld();
    const zone = createZone(world, { declaredFunction: "work-yard", cells: [{ x: 2, z: 2 }] });
    const restoreMaterials = new MaterialRegistry();
    registerStandardMaterials(restoreMaterials);

    const restored = restoreWorld(JSON.parse(JSON.stringify(snapshotWorld(world))), { componentTypes: ALL_COMPONENT_TYPES, materials: restoreMaterials });

    expect(getZone(restored.components, zone)).toEqual({ declaredFunction: "work-yard", cells: [{ x: 2, z: 2 }] });
    expect(recognizeFunctionalSpace(restored, zone).recognizedFunction).toBe("work-yard");
  });
});
