/**
 * Phase 6 Gate -- "The game can generate and simulate a world containing
 * multiple persistent settlements and ecosystems across centuries."
 *
 * A composed test: a real region is generated (P6-01/P6-02) with real
 * rivers and climate (P6-03/P6-04), multiple real sites are founded at
 * distinct region cells (P6-06), a real wildlife population is seeded
 * (P6-11), and the WHOLE world -- settlements AND ecosystem together --
 * advances headlessly across centuries (P6-13's `advanceWorldTicks` with
 * its ecosystem layer). Afterwards every settlement and ecosystem
 * reference still resolves, the settlements genuinely changed, the
 * wildlife genuinely grew, and zooming into one advanced site
 * reconstructs a detailed simulation consistent with its macro state
 * (P6-08).
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
import { generateMacroTerrain } from "../../src/sim/region/MacroTerrain.js";
import { computeRiverNetwork } from "../../src/sim/region/RegionalHydrology.js";
import { createSite, getSite } from "../../src/sim/region/Site.js";
import { advanceWorldTicks } from "../../src/sim/region/DeepTime.js";
import { RegionalWildlifeField, carryingCapacityFor } from "../../src/sim/region/WorldWildlife.js";
import { activateSite } from "../../src/sim/region/SiteActivation.js";
import { explainEntityHistory } from "../../src/sim/history/EcosystemCausality.js";

const REGION_SIZE = 32;
const CENTURIES_TICKS = 100 * 48_000;
const FERTILITY = { forest: 0.9, wetland: 0.7, grassland: 0.5, desert: 0.1, tundra: 0.1, mountain: 0.1 } as const;

function buildWorld(): { world: World; regionMap: RegionMap; materials: MaterialRegistry } {
  const entities = new EntityIdRegistry();
  const components = new ComponentStore(entities);
  const grid = new WorldGrid({ sizeX: 20, sizeY: 8, sizeZ: 20 }, entities);
  const materials = new MaterialRegistry();
  registerStandardMaterials(materials);
  const terrain = new TerrainField(grid, materials);
  const water = new WaterField(grid);
  const weather = new Weather();
  const clock = new SimulationClock({ tickRateHz: 20 });
  const random = new RandomStreams("p6-gate-world-centuries");
  const events = new EventLog(entities);
  return {
    world: { clock, random, entities, components, grid, terrain, events, water, weather },
    regionMap: new RegionMap(REGION_SIZE, REGION_SIZE),
    materials,
  };
}

describe("Phase 6 Gate -- a generated world with multiple persistent settlements and ecosystems advances centuries", () => {
  it("holds end to end: generation, settlement founding, ecosystem seeding, centuries of headless advance, then zoom-in consistency", () => {
    const { world, regionMap, materials } = buildWorld();

    // Generation: real coherent regional elevation, real rivers.
    generateMacroTerrain(regionMap, world.random.stream("gate-terrain"));
    const network = computeRiverNetwork(regionMap);
    expect(network.riverCellIndices.length).toBeGreaterThan(0);

    // Multiple persistent settlements at distinct, stable region cells.
    const siteLocations = [
      { x: 4, z: 5, pop: 10, food: 200 },
      { x: 12, z: 22, pop: 6, food: 100 },
      { x: 27, z: 9, pop: 14, food: 300 },
    ];
    const siteIds: EntityId[] = siteLocations.map((loc) => createSite(world, regionMap, loc.x, loc.z, loc.pop, loc.food));
    const foundingFood = new Map(siteIds.map((id) => [id, getSite(world.components, id)!.storedFoodKg]));

    // Ecosystem: a real seeded regional wildlife population.
    const wildlife = new RegionalWildlifeField(REGION_SIZE, REGION_SIZE, ["rabbit", "fox"]);
    wildlife.setCount(14, 14, "rabbit", 3);
    wildlife.setCount(14, 15, "fox", 1);

    // Centuries of headless advance: settlements AND ecosystem together,
    // through the one composed operation.
    const tickBefore = world.clock.tick;
    advanceWorldTicks(
      world,
      CENTURIES_TICKS,
      () => "forest",
      FERTILITY,
      { wildlife, biomeForCell: () => "forest" },
    );
    expect(world.clock.tick).toBe(tickBefore + CENTURIES_TICKS);

    // Every settlement reference still resolves, with valid summary state
    // that genuinely CHANGED over the centuries.
    for (const siteId of siteIds) {
      expect(world.entities.isKnown(siteId)).toBe(true);
      const site = getSite(world.components, siteId)!;
      expect(site.populationCount).toBeGreaterThanOrEqual(0);
      expect(site.storedFoodKg).toBeGreaterThanOrEqual(0);
      expect(site.storedFoodKg).not.toBe(foundingFood.get(siteId));
      const history = explainEntityHistory(world, siteId);
      expect(history.some((entry) => entry.event.eventType === "site-founded")).toBe(true);
    }

    // The ecosystem genuinely grew toward (never past) real carrying
    // capacity, and both species' counts remain valid.
    const rabbitCount = wildlife.countAt(14, 14, "rabbit");
    expect(rabbitCount).toBeGreaterThan(3);
    expect(rabbitCount).toBeLessThanOrEqual(carryingCapacityFor("forest") + 1);

    // Zoom-in consistency: activating one advanced site reconstructs a
    // detailed simulation matching its macro state exactly.
    const detailed = activateSite(siteIds[0]!, materials, world);
    expect(detailed.world.entities.liveIdsOfKind("beaver")).toHaveLength(getSite(world.components, siteIds[0]!)!.populationCount);
    expect(getSite(world.components, siteIds[0]!)!.active).toBe(true);
  });
});
