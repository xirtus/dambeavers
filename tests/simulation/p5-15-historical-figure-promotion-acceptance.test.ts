/**
 * Headless acceptance test for P5-15 -- Historical figure promotion.
 *
 * Roadmap acceptance test: "ordinary entities can become historically
 * significant based on recorded deeds without spawning a separate
 * 'historical version.'"
 *
 * Significance is a real weighted sum over ACTUAL recorded deeds
 * (offspring, leadership, artworks, extreme reputation). The SAME beaver
 * entity that lived the history IS the historical figure -- no separate
 * entity is ever spawned -- and a deedless beaver stays below the
 * threshold.
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
import { spawnBeaver } from "../../src/sim/creatures/Beaver.js";
import { setSkills } from "../../src/sim/creatures/Beaver.js";
import { ensureSharedHousehold } from "../../src/sim/creatures/Household.js";
import { assignLeader } from "../../src/sim/creatures/Leadership.js";
import { significanceOf, isHistoricalFigure, allHistoricalFigures } from "../../src/sim/creatures/HistoricalFigure.js";

function buildWorld(): World {
  const entities = new EntityIdRegistry();
  const components = new ComponentStore(entities);
  const grid = new WorldGrid({ sizeX: 20, sizeY: 10, sizeZ: 20 }, entities);
  const materials = new MaterialRegistry();
  registerStandardMaterials(materials);
  const terrain = new TerrainField(grid, materials);
  for (let x = 0; x < 20; x++) for (let z = 0; z < 20; z++) for (let y = 0; y <= 2; y++) terrain.setMaterial(x, y, z, "soil");
  const water = new WaterField(grid);
  const weather = new Weather();
  const clock = new SimulationClock({ tickRateHz: 20 });
  const random = new RandomStreams(515);
  const events = new EventLog(entities);
  return { clock, random, entities, components, grid, terrain, events, water, weather };
}

function spawn(world: World, name: string, x: number, z: number): EntityId {
  return spawnBeaver(world, { name, position: { x, y: 3, z } });
}

describe("P5-15 -- Historical figure promotion", () => {
  it("recorded deeds make the SAME beaver entity a historical figure -- no separate version exists", () => {
    const world = buildWorld();
    const nobody = spawn(world, "Nobody", 17, 17);
    expect(isHistoricalFigure(world, nobody)).toBe(false);

    // Real recorded deeds: leadership (0.4) plus offspring (0.1 x 2).
    const figure = spawn(world, "Founder", 17, 18);
    const partner = spawn(world, "Partner", 17, 19);
    setSkills(world.components, figure, { levels: { woodcutting: 12 } });
    const householdId = ensureSharedHousehold(world, figure, partner);
    assignLeader(world, householdId);
    world.events.record({ tick: 1, eventType: "offspring-born", subjectIds: [partner], objectIds: [figure], location: { x: 17, y: 3, z: 18 } });
    world.events.record({ tick: 2, eventType: "offspring-born", subjectIds: [partner], objectIds: [figure], location: { x: 17, y: 3, z: 18 } });

    const significance = significanceOf(world, figure);
    expect(significance).toBeGreaterThanOrEqual(0.5);
    expect(isHistoricalFigure(world, figure)).toBe(true);

    // The SAME entity that lived the history IS the historical figure:
    // no separate "historical version" entity is ever spawned.
    const figures = allHistoricalFigures(world);
    expect(figures).toContain(figure);
    expect(figures).not.toContain(nobody);
    expect(world.entities.isLive(figure)).toBe(true);
    expect(world.entities.liveIdsOfKind("beaver").filter((id) => id !== figure)).not.toContain(figure); // no duplicate identity
  });
});
