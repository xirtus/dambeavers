/**
 * Headless acceptance test for P2-05 -- Rooms, zones, and functional
 * spaces.
 *
 * Roadmap acceptance:
 *   "enclosing/defining a space changes its recognized function based on
 *   geometry and contents."
 *
 * The zone is a real persistent `zone` entity. The enclosure and contents
 * are completed through ordinary P1-10 construction jobs; recognition
 * then derives function from those completed construction sites.
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
import type { NavigationProfile } from "../../src/sim/navigation/Pathfinding.js";
import { spawnBeaver } from "../../src/sim/creatures/Beaver.js";
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

const PROFILE: NavigationProfile = { canSwim: true, maxWadingDepth: 0.5 };

function buildWorld(): { world: World; materials: MaterialRegistry } {
  const entities = new EntityIdRegistry();
  const components = new ComponentStore(entities);
  const grid = new WorldGrid({ sizeX: 8, sizeY: 8, sizeZ: 8 }, entities);
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
  const random = new RandomStreams(205);
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

  let outcome = "";
  let iterations = 0;
  do {
    outcome = tickBuildJob(world.grid, world.terrain, world.water, materials, world.entities, world.components, builder, PROFILE, [jobId!]);
    iterations++;
    expect(iterations).toBeLessThan(80);
  } while (outcome !== "built" && outcome !== "failed" && outcome !== "requeued");

  expect(outcome).toBe("built");
  expect(getConstruction(world.components, constructionId)!.status).toBe("complete");
  return constructionId;
}

describe("P2-05 acceptance: defined/enclosed spaces derive function from geometry and contents", () => {
  it("classifies a defined outdoor zone, then an empty enclosed room, then a lodge room after real construction contents are built", () => {
    const { world, materials } = buildWorld();
    const zone = createZone(world, { declaredFunction: "work-yard", cells: [{ x: 2, z: 2 }] });

    const beforeWalls = recognizeFunctionalSpace(world, zone);
    expect(beforeWalls.enclosed).toBe(false);
    expect(beforeWalls.recognizedFunction).toBe("work-yard");

    const walls = [
      buildCompletedConstruction(world, materials, "wall", { x: 1, z: 2 }),
      buildCompletedConstruction(world, materials, "wall", { x: 3, z: 2 }),
      buildCompletedConstruction(world, materials, "wall", { x: 2, z: 1 }),
      buildCompletedConstruction(world, materials, "wall", { x: 2, z: 3 }),
    ];

    const enclosed = recognizeFunctionalSpace(world, zone);
    expect(enclosed.enclosed).toBe(true);
    expect(enclosed.recognizedFunction).toBe("empty-room");
    expect(enclosed.boundaryConstructionIds).toEqual([...walls].sort((a, b) => a - b));
    expect(enclosed.contentConstructionIds).toEqual([]);

    const lodge = buildCompletedConstruction(world, materials, "lodge-segment", { x: 2, z: 2 });
    const lodgeRoom = recognizeFunctionalSpace(world, zone);
    expect(lodgeRoom.enclosed).toBe(true);
    expect(lodgeRoom.recognizedFunction).toBe("lodge-room");
    expect(lodgeRoom.contentConstructionIds).toEqual([lodge]);

    const restoreMaterials = new MaterialRegistry();
    registerStandardMaterials(restoreMaterials);
    const restored = restoreWorld(JSON.parse(JSON.stringify(snapshotWorld(world))), { componentTypes: ALL_COMPONENT_TYPES, materials: restoreMaterials });
    expect(recognizeFunctionalSpace(restored, zone)).toEqual(lodgeRoom);
  });
});
