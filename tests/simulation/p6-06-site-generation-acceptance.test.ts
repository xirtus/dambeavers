/**
 * Headless acceptance test for P6-06 -- Site generation.
 *
 * Roadmap acceptance test: "settlements/sites can be instantiated with
 * persistent location, population, structures, and history."
 *
 * A site is a real, permanent entity (P0-02 identity) with a persistent
 * region location, summary population/food/structure state, and a real
 * `"site-founded"` event making its history genuinely queryable through
 * the existing `EventLog`. All four clauses are checked literally,
 * including persistence across a real save/reload round trip.
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
import { snapshotWorld, restoreWorld } from "../../src/sim/persistence/WorldSnapshot.js";
import { ALL_COMPONENT_TYPES } from "../../src/sim/persistence/AllComponentTypes.js";
import { RegionMap } from "../../src/sim/region/RegionMap.js";
import { createSite, getSite } from "../../src/sim/region/Site.js";
import { explainEntityHistory } from "../../src/sim/history/EcosystemCausality.js";

const REGION_SIZE = 32;

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
  const random = new RandomStreams(606);
  const events = new EventLog(entities);
  return {
    world: { clock, random, entities, components, grid, terrain, events, water, weather },
    regionMap: new RegionMap(REGION_SIZE, REGION_SIZE),
  };
}

describe("P6-06 -- Site generation", () => {
  it("sites are instantiated with persistent location, population, structures, and history", () => {
    const { world, regionMap } = buildWorld();

    // Location + population + structures: instantiated together, persisted
    // through a real save/reload round trip.
    const siteId = createSite(world, regionMap, 11, 17, 9, 120, 3);
    const before = getSite(world.components, siteId)!;
    expect(before.regionX).toBe(11);
    expect(before.regionZ).toBe(17);
    expect(before.populationCount).toBe(9);
    expect(before.structureCount).toBe(3);

    const restoreMaterials = new MaterialRegistry();
    registerStandardMaterials(restoreMaterials);
    const restored = restoreWorld(JSON.parse(JSON.stringify(snapshotWorld(world))), {
      componentTypes: ALL_COMPONENT_TYPES,
      materials: restoreMaterials,
    });
    const after = getSite(restored.components, siteId)!;
    expect(after.regionX).toBe(before.regionX);
    expect(after.regionZ).toBe(before.regionZ);
    expect(after.populationCount).toBe(before.populationCount);
    expect(after.structureCount).toBe(before.structureCount);

    // History: the founding event is genuinely queryable through the
    // existing event-history machinery -- the same composition P4-16's
    // causality reports and P5-16's settlement history already use.
    const explanation = explainEntityHistory(world, siteId);
    const founding = explanation.find((entry) => entry.event.eventType === "site-founded");
    expect(founding).toBeDefined();
    expect(founding!.event.subjectIds).toEqual([siteId]);
    expect(world.events.eventsInvolving(siteId).length).toBeGreaterThan(0);
  });
});
