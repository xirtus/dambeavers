/**
 * Headless acceptance test for P3-11 -- Structural damage and wear.
 *
 * Roadmap acceptance test: "repeated hydraulic/mechanical stress can
 * weaken a structure progressively."
 *
 * A real dam segment under sustained hydraulic load loses integrity a
 * little every tick -- measurably weakened while still standing, then
 * collapsing only after enough accumulated exposure, with its material
 * reappearing as real debris. Progressive wear, never a scripted
 * single-event break.
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
import type { NavigationProfile } from "../../src/sim/navigation/Pathfinding.js";
import { spawnBeaver } from "../../src/sim/creatures/Beaver.js";
import { setLog } from "../../src/sim/labor/Log.js";
import { designateConstruction, ensureMaterialHaul, checkMaterialsDelivered, generateBuildJob, tickBuildJob } from "../../src/sim/labor/Construction.js";
import { tickHaulJob } from "../../src/sim/labor/Hauling.js";
import { applyDamSegment, tickDamStructure, getDamSegment } from "../../src/sim/hydrology/Dam.js";
import { getGood } from "../../src/sim/economy/Good.js";

const PROFILE: NavigationProfile = { canSwim: true, maxWadingDepth: 0.5 };

function buildWorld(): { world: World; materials: MaterialRegistry } {
  const entities = new EntityIdRegistry();
  const components = new ComponentStore(entities);
  const grid = new WorldGrid({ sizeX: 20, sizeY: 12, sizeZ: 20 }, entities);
  const materials = new MaterialRegistry();
  registerStandardMaterials(materials);
  const terrain = new TerrainField(grid, materials);
  for (let x = 0; x < 20; x++) for (let z = 0; z < 20; z++) for (let y = 0; y <= 2; y++) terrain.setMaterial(x, y, z, "soil");
  const water = new WaterField(grid);
  const weather = new Weather();
  const clock = new SimulationClock({ tickRateHz: 20 });
  const random = new RandomStreams(111);
  const events = new EventLog(entities);
  return { world: { clock, random, entities, components, grid, terrain, events, water, weather }, materials };
}

function driveJob<T extends string>(step: () => T, doneValue: T, maxTicks = 500): T {
  let outcome: T = "idle" as T;
  for (let i = 0; i < maxTicks && outcome !== doneValue; i++) outcome = step();
  return outcome;
}

function buildDamSegment(world: World, materials: MaterialRegistry, site: { x: number; z: number }): EntityId {
  const logId = world.entities.create("log");
  world.grid.setEntityPosition(logId, site.x + 1, 3, site.z);
  setLog(world.components, logId, { materialId: "wood", massKg: 50 });
  const builder = spawnBeaver(world, { name: "Builder", position: { x: site.x, y: 3, z: site.z } });
  const constructionId = designateConstruction(world, "dam-segment", site);
  for (let i = 0; i < 10; i++) {
    const haulJobId = ensureMaterialHaul(world, constructionId);
    if (haulJobId === undefined) break;
    driveJob(() => tickHaulJob(world.grid, world.terrain, world.water, materials, world.entities, world.components, builder, PROFILE, [haulJobId]), "delivered" as never);
  }
  expect(checkMaterialsDelivered(world, constructionId)).toBe(true);
  const [buildJobId] = generateBuildJob(world, constructionId);
  const outcome = driveJob(
    () => tickBuildJob(world.grid, world.terrain, world.water, materials, world.entities, world.components, builder, PROFILE, [buildJobId!]),
    "built",
  );
  expect(outcome).toBe("built");
  return applyDamSegment(world, constructionId);
}

describe("P3-11 -- Structural damage and wear", () => {
  it("repeated hydraulic stress weakens a dam segment progressively until it collapses", () => {
    const { world, materials } = buildWorld();
    const site = { x: 12, z: 12 };
    const damId = buildDamSegment(world, materials, site);
    expect(getDamSegment(world.components, damId)!.structuralIntegrity).toBe(1);

    // Sustained moderate load: stress = depth * 0.0002 = 0.004 per tick.
    world.water.setDepth(site.x, site.z, 20);

    let after25 = 1;
    let after50 = 1;
    let result: "intact" | "collapsed" = "intact";
    for (let i = 0; i < 25; i++) {
      result = tickDamStructure(world, materials, damId);
      expect(result).toBe("intact");
      after25 = getDamSegment(world.components, damId)!.structuralIntegrity;
    }
    for (let i = 0; i < 25; i++) {
      result = tickDamStructure(world, materials, damId);
      expect(result).toBe("intact");
      after50 = getDamSegment(world.components, damId)!.structuralIntegrity;
    }

    // Progressively weakened while still standing: integrity fell steadily,
    // well below its starting 1 but far from collapse.
    expect(after25).toBeCloseTo(1 - 25 * 0.004);
    expect(after50).toBeCloseTo(1 - 50 * 0.004);
    expect(after25).toBeGreaterThan(after50);
    expect(after50).toBeGreaterThan(0.5);

    // Continued exposure eventually exhausts it -- collapse, not a scripted
    // break, and the material comes back as real debris.
    for (let i = 0; i < 1000 && result === "intact"; i++) {
      result = tickDamStructure(world, materials, damId);
    }
    expect(result).toBe("collapsed");
    const debris = world.entities.liveIdsOfKind("good").map((id) => getGood(world.components, id)!).filter((g) => g.goodKind === "debris");
    expect(debris.length).toBeGreaterThan(0);
    expect(debris[0]!.materialId).toBe("wood");
  });
});
