/**
 * Headless acceptance test for P6-13 -- Deep-time simulator.
 *
 * Roadmap acceptance test: "the world can advance centuries headlessly
 * while preserving valid genealogical, settlement, ecological, and event
 * references."
 *
 * `advanceWorldTicks` drives every inactive site through P6-07's real
 * closed-form offscreen LOD while advancing the authoritative clock by
 * the exact requested count -- and preserves every reference by
 * construction (no new entity-destruction path; `EntityIdRegistry`'s and
 * `EventLog`'s own Phase 0 "ids/history never invalidate" contracts do
 * the work). All four reference classes are checked literally below.
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
import { RegionMap } from "../../src/sim/region/RegionMap.js";
import { createSite, getSite } from "../../src/sim/region/Site.js";
import { advanceWorldTicks } from "../../src/sim/region/DeepTime.js";
import { RegionalWildlifeField, carryingCapacityFor } from "../../src/sim/region/WorldWildlife.js";
import { explainEntityHistory } from "../../src/sim/history/EcosystemCausality.js";

const REGION_SIZE = 32;
const CENTURIES_TICKS = 100 * 48_000; // a hundred simulated years

function buildWorld(): { world: World; regionMap: RegionMap } {
  const entities = new EntityIdRegistry();
  const components = new ComponentStore(entities);
  const grid = new WorldGrid({ sizeX: 20, sizeY: 8, sizeZ: 20 }, entities);
  const materials = new MaterialRegistry();
  registerStandardMaterials(materials);
  const terrain = new TerrainField(grid, materials);
  const water = new WaterField(grid);
  const weather = new Weather();
  const clock = new SimulationClock({ tickRateHz: 20 });
  const random = new RandomStreams(613);
  const events = new EventLog(entities);
  return {
    world: { clock, random, entities, components, grid, terrain, events, water, weather },
    regionMap: new RegionMap(REGION_SIZE, REGION_SIZE),
  };
}

describe("P6-13 -- Deep-time simulator", () => {
  it("the world advances centuries headlessly while preserving genealogical, settlement, ecological, and event references", () => {
    const { world, regionMap } = buildWorld();
    const siteId = createSite(world, regionMap, 10, 10, 12, 300);

    // Real pre-advance references of every required class:
    // - genealogical: a real beaver entity named as an offspring-born subject/object
    // - settlement: the site entity itself
    // - ecological: a real recorded ecosystem event involving a real tree entity
    // - event: the founding + birth + ecology events themselves
    const parentId = world.entities.create("beaver");
    const childId = world.entities.create("beaver");
    const treeId = world.entities.create("tree");
    const birthEventId = world.events.record({ tick: 1, eventType: "offspring-born", subjectIds: [childId], objectIds: [parentId], location: { x: 0, y: 0, z: 0 } });
    const ecologyEventId = world.events.record({ tick: 2, eventType: "plant-died", subjectIds: [treeId], location: { x: 1, y: 0, z: 0 } });

    // The ecosystem layer (P6-11's real regional wildlife) advances across
    // the SAME span -- a seeded rabbit population grows toward its real
    // biome carrying capacity through the closed-form logistic step.
    const wildlife = new RegionalWildlifeField(REGION_SIZE, REGION_SIZE, ["rabbit"]);
    wildlife.setCount(14, 14, "rabbit", 2);
    const tickBefore = world.clock.tick;

    advanceWorldTicks(world, CENTURIES_TICKS, () => "forest", { forest: 0.8, wetland: 0.7, grassland: 0.5, desert: 0.1, tundra: 0.1, mountain: 0.1 }, {
      wildlife,
      biomeForCell: () => "forest",
    });

    const rabbitCount = wildlife.countAt(14, 14, "rabbit");
    expect(rabbitCount).toBeGreaterThan(2);
    expect(rabbitCount).toBeLessThanOrEqual(carryingCapacityFor("forest") + 1);

    // The clock advanced by the EXACT requested span.
    expect(world.clock.tick).toBe(tickBefore + CENTURIES_TICKS);

    // Settlement references: the site is still real and known, its summary
    // still valid, its founding still queryable.
    const site = getSite(world.components, siteId)!;
    expect(site.populationCount).toBeGreaterThanOrEqual(0);
    expect(site.storedFoodKg).toBeGreaterThanOrEqual(0);
    expect(world.entities.isKnown(siteId)).toBe(true);

    // Genealogical/event references: the birth event and the ecology event
    // both still resolve to their exact original ids and participants,
    // including entities that pre-date the centuries-long advance.
    expect(world.events.get(birthEventId).subjectIds).toEqual([childId]);
    expect(world.events.get(birthEventId).objectIds).toEqual([parentId]);
    expect(world.events.get(ecologyEventId).subjectIds).toEqual([treeId]);
    expect(world.entities.isKnown(parentId)).toBe(true);
    expect(world.entities.isKnown(treeId)).toBe(true);

    // The site's own history remains fully explainable after the jump.
    const explanation = explainEntityHistory(world, siteId);
    expect(explanation.some((entry) => entry.event.eventType === "site-founded")).toBe(true);
  });
});
