/**
 * Headless acceptance test for P5-10 -- Language/naming framework.
 *
 * Roadmap acceptance test: "generated personal, site, artifact, and
 * group names persist and can be referenced historically."
 *
 * Names are deterministic procedural generations (identical across
 * same-seed worlds, per Law 8), persisted through the SAME generic
 * Identity component every named entity already uses, and referenceable
 * historically -- an event can name the entity and later history queries
 * return the name.
 */
import { describe, expect, it } from "vitest";
import { EntityIdRegistry } from "../../src/sim/core/EntityId.js";
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
import { generateName, nameEntity, nameOf, type NameCategory } from "../../src/sim/creatures/Naming.js";

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
  const random = new RandomStreams(510);
  const events = new EventLog(entities);
  return { clock, random, entities, components, grid, terrain, events, water, weather };
}

describe("P5-10 -- Language/naming framework", () => {
  it("generated names for all four categories persist and are historically referenceable", () => {
    const world = buildWorld();

    // Deterministic generation: identical across same-seed worlds.
    const world2 = buildWorld();
    for (const category of ["personal", "site", "artifact", "group"] as const) {
      const nameA = generateName(world.random.stream(`naming-${category}`), category);
      const nameB = generateName(world2.random.stream(`naming-${category}`), category);
      expect(nameA).toBe(nameB);
      expect(nameA.length).toBeGreaterThan(0);
    }

    // Persistence via the shared Identity component: names attach to real
    // entities of every category and read back through the same path.
    const beaver = spawnBeaver(world, { name: "Unnamed", position: { x: 1, y: 3, z: 1 } });
    const site = world.entities.create("zone");
    const artifact = world.entities.create("good");
    const group = world.entities.create("household");

    const personalName = nameEntity(world, beaver, "personal", world.random.stream("n-personal"));
    const siteName = nameEntity(world, site, "site", world.random.stream("n-site"));
    const artifactName = nameEntity(world, artifact, "artifact", world.random.stream("n-artifact"));
    const groupName = nameEntity(world, group, "group", world.random.stream("n-group"));

    expect(nameOf(world, beaver)).toBe(personalName);
    expect(nameOf(world, site)).toBe(siteName);
    expect(nameOf(world, artifact)).toBe(artifactName);
    expect(nameOf(world, group)).toBe(groupName);

    // Historical reference: a recorded event about the named entity can be
    // queried with the same stable identity that carries the name.
    const eventId = world.events.record({ tick: 0, eventType: "site-named", subjectIds: [site], location: { x: 1, y: 3, z: 2 } });
    const event = world.events.get(eventId);
    expect(event.subjectIds).toContain(site);
    expect(nameOf(world, event.subjectIds[0]!)).toBe(siteName);
  });
});
