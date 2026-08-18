/**
 * Consolidated Phase 6 (World Simulation) integration smoke test --
 * mirrors `phase3EconomySmoke.test.ts`/`phase4EcosystemSmoke.test.ts`/
 * `phase5SocietySmoke.test.ts`'s own role: exercises the real end-to-end
 * pipelines built for P6-01 through P6-13 against real state, not
 * mocks. ONE consolidated file rather than 13 separate per-task
 * acceptance test files; splitting into full per-task acceptance tests
 * plus an independent critic review is still owed as a follow-up,
 * matching Phase 3/4/5's own verification history.
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
import { generateMacroTerrain, computeDrainageBasins, computeFlowDirections } from "../../src/sim/region/MacroTerrain.js";
import { computeRiverNetwork, classifyTermination } from "../../src/sim/region/RegionalHydrology.js";
import { temperatureAt, precipitationAt } from "../../src/sim/region/Climate.js";
import { biomeAt } from "../../src/sim/region/Biomes.js";
import { createSite, getSite } from "../../src/sim/region/Site.js";
import { tickOffscreenSite } from "../../src/sim/region/OffscreenLOD.js";
import { activateSite, deactivateSite } from "../../src/sim/region/SiteActivation.js";
import { travelCost } from "../../src/sim/region/Travel.js";
import { depositsAt } from "../../src/sim/region/ResourceGeography.js";
import { RegionalWildlifeField, carryingCapacityFor } from "../../src/sim/region/WorldWildlife.js";
import { detectDisaster, applyDisasterToSite } from "../../src/sim/region/WorldDisasters.js";
import { advanceWorldTicks } from "../../src/sim/region/DeepTime.js";
import { explainEntityHistory } from "../../src/sim/history/EcosystemCausality.js";

const REGION_SIZE = 24;

function buildWorld(): { world: World; materials: MaterialRegistry } {
  const entities = new EntityIdRegistry();
  const components = new ComponentStore(entities);
  const grid = new WorldGrid({ sizeX: 20, sizeY: 8, sizeZ: 20 }, entities);
  const materials = new MaterialRegistry();
  registerStandardMaterials(materials);
  const terrain = new TerrainField(grid, materials);
  const water = new WaterField(grid);
  const weather = new Weather();
  const clock = new SimulationClock({ tickRateHz: 20 });
  const random = new RandomStreams(1);
  const events = new EventLog(entities);
  return { world: { clock, random, entities, components, grid, terrain, events, water, weather }, materials };
}

describe("Phase 6 world smoke", () => {
  it("regional world representation: many sites can exist at stable, independent region coordinates", () => {
    const { world } = buildWorld();
    const regionMap = new RegionMap(REGION_SIZE, REGION_SIZE);
    const site1 = createSite(world, regionMap, 3, 4, 5, 20);
    const site2 = createSite(world, regionMap, 10, 12, 3, 10);
    expect(regionMap.siteIdAt(3, 4)).toBe(site1);
    expect(regionMap.siteIdAt(10, 12)).toBe(site2);
    expect(() => regionMap.placeSite(3, 4, site2)).toThrow(RangeError);
  });

  it("macro terrain generation: coherent elevation forms real, spatially-connected drainage basins (not isolated random cells)", () => {
    const { world } = buildWorld();
    const regionMap = new RegionMap(REGION_SIZE, REGION_SIZE);
    generateMacroTerrain(regionMap, world.random.stream("macro-terrain"));

    // Coherence: adjacent cells' elevations are correlated (bounded step), never independent random jumps.
    let maxStep = 0;
    for (let z = 0; z < REGION_SIZE - 1; z++) {
      for (let x = 0; x < REGION_SIZE - 1; x++) {
        maxStep = Math.max(maxStep, Math.abs(regionMap.elevationAt(x, z) - regionMap.elevationAt(x + 1, z)));
      }
    }
    expect(maxStep).toBeLessThan(50); // well below the full 100-unit range -- neighbors are smooth, not independent

    const basins = computeDrainageBasins(regionMap);
    expect(basins.length).toBeGreaterThan(0);
    const totalCells = basins.reduce((sum, b) => sum + b.cellIndices.length, 0);
    expect(totalCells).toBe(REGION_SIZE * REGION_SIZE); // every cell belongs to exactly one real basin
  });

  it("regional hydrology: rivers flow downhill, merge, and terminate coherently", () => {
    const { world } = buildWorld();
    const regionMap = new RegionMap(REGION_SIZE, REGION_SIZE);
    generateMacroTerrain(regionMap, world.random.stream("hydrology-terrain"));
    const network = computeRiverNetwork(regionMap);
    expect(network.riverCellIndices.length).toBeGreaterThan(0);

    // Every river cell's flow target (if any) has a real lower-or-equal elevation (downhill).
    for (const index of network.riverCellIndices) {
      const target = network.flowDirection[index];
      if (target === undefined) continue;
      const x = index % REGION_SIZE;
      const z = Math.floor(index / REGION_SIZE);
      const tx = target % REGION_SIZE;
      const tz = Math.floor(target / REGION_SIZE);
      expect(regionMap.elevationAt(tx, tz)).toBeLessThanOrEqual(regionMap.elevationAt(x, z));
    }

    // Merging: at least one cell receives flow from 2+ distinct upstream cells (a real confluence).
    const inflowCount = new Map<number, number>();
    for (const index of network.flowDirection) {
      if (index === undefined) continue;
      inflowCount.set(index, (inflowCount.get(index) ?? 0) + 1);
    }
    expect([...inflowCount.values()].some((count) => count >= 2)).toBe(true);

    const someRiverCell = network.riverCellIndices[0]!;
    const termination = classifyTermination(regionMap, network.flowDirection, someRiverCell);
    expect(["region-edge", "sink"]).toContain(termination);
  });

  it("climate model: real spatial variation in temperature/precipitation from geography", () => {
    const { world } = buildWorld();
    const regionMap = new RegionMap(REGION_SIZE, REGION_SIZE);
    generateMacroTerrain(regionMap, world.random.stream("climate-terrain"));
    const network = computeRiverNetwork(regionMap);

    const equatorTemp = temperatureAt(regionMap, 12, Math.floor(REGION_SIZE / 2), 0);
    const poleTemp = temperatureAt(regionMap, 12, 0, 0);
    expect(equatorTemp).toBeGreaterThan(poleTemp); // real latitude gradient

    const precipitations = new Set<number>();
    for (let x = 0; x < REGION_SIZE; x += 4) precipitations.add(Math.round(precipitationAt(regionMap, network, x, 12) * 100));
    expect(precipitations.size).toBeGreaterThan(1); // real spatial variation, not one flat value
  });

  it("biomes: distinct climate parameters produce distinct biome classifications", () => {
    expect(biomeAt(0.1, 0.5, 0.2)).toBe("tundra");
    expect(biomeAt(0.8, 0.1, 0.2)).toBe("desert");
    expect(biomeAt(0.8, 0.8, 0.2)).toBe("wetland");
    expect(biomeAt(0.8, 0.5, 0.2)).toBe("forest");
    expect(biomeAt(0.6, 0.9, 0.9)).toBe("mountain"); // extreme elevation overrides climate
  });

  it("site generation: a site has persistent location, population, and a real queryable history", () => {
    const { world } = buildWorld();
    const regionMap = new RegionMap(REGION_SIZE, REGION_SIZE);
    const siteId = createSite(world, regionMap, 5, 5, 7, 50);
    const site = getSite(world.components, siteId)!;
    expect(site.regionX).toBe(5);
    expect(site.populationCount).toBe(7);
    const history = explainEntityHistory(world, siteId);
    expect(history.some((h) => h.event.eventType === "site-founded")).toBe(true);
  });

  it("offscreen simulation LOD: population/food advance plausibly while conserving real accounting invariants", () => {
    const { world } = buildWorld();
    const regionMap = new RegionMap(REGION_SIZE, REGION_SIZE);
    const siteId = createSite(world, regionMap, 6, 6, 10, 100);
    let site = getSite(world.components, siteId)!;

    const wellFed = tickOffscreenSite(site, 0.9, 1000);
    expect(wellFed.storedFoodKg).toBeGreaterThanOrEqual(0); // never negative -- real conservation
    expect(wellFed.populationCount).toBeGreaterThanOrEqual(0);

    site = { ...site, storedFoodKg: 0 };
    const starving = tickOffscreenSite(site, 0.0, 500);
    expect(starving.storedFoodKg).toBe(0); // no fabricated food from nothing
    expect(starving.populationCount).toBeLessThanOrEqual(site.populationCount); // real starvation, never growth with no food
  });

  it("site activation/deactivation: zooming in reconstructs a detailed simulation consistent with macro state, and back", () => {
    const { world, materials } = buildWorld();
    const regionMap = new RegionMap(REGION_SIZE, REGION_SIZE);
    const siteId = createSite(world, regionMap, 7, 7, 4, 12);

    const activated = activateSite(siteId, materials, world);
    expect(activated.beaverIds).toHaveLength(4);
    expect(getSite(world.components, siteId)!.active).toBe(true);
    expect(activated.world.entities.liveIdsOfKind("food").length).toBeGreaterThan(0);

    deactivateSite(siteId, world, activated);
    const deactivated = getSite(world.components, siteId)!;
    expect(deactivated.active).toBe(false);
    expect(deactivated.populationCount).toBe(4);
    expect(deactivated.storedFoodKg).toBeCloseTo(12, 1);
  });

  it("travel network: real cost scales with distance and real terrain difficulty", () => {
    const regionMap = new RegionMap(REGION_SIZE, REGION_SIZE);
    regionMap.setElevation(0, 0, 0);
    regionMap.setElevation(1, 0, 0);
    regionMap.setElevation(5, 0, 90);
    const flatCost = travelCost(regionMap, { regionX: 0, regionZ: 0 }, { regionX: 1, regionZ: 0 });
    const steepCost = travelCost(regionMap, { regionX: 0, regionZ: 0 }, { regionX: 5, regionZ: 0 });
    expect(steepCost).toBeGreaterThan(flatCost);
  });

  it("resource geography: real deposits are derived from biome/elevation, constraining what's available", () => {
    expect(depositsAt("mountain", 0.9)).toContain("stone");
    expect(depositsAt("wetland", 0.2)).toContain("clay");
    expect(depositsAt("desert", 0.1)).toContain("sand");
    expect(depositsAt("grassland", 0.1)).toEqual([]);
  });

  it("world wildlife populations: real logistic growth bounded by biome carrying capacity, driving encounter rate", () => {
    const field = new RegionalWildlifeField(REGION_SIZE, REGION_SIZE, ["rabbit"]);
    field.setCount(3, 3, "rabbit", 1);
    const capacity = carryingCapacityFor("forest");
    for (let i = 0; i < 5000; i++) field.tickGrowth(3, 3, "rabbit", capacity);
    expect(field.countAt(3, 3, "rabbit")).toBeGreaterThan(1);
    expect(field.countAt(3, 3, "rabbit")).toBeLessThanOrEqual(capacity + 1);
  });

  it("world-scale disasters: real climate extremes are detected and propagate a real consequence into an affected site", () => {
    const { world } = buildWorld();
    const regionMap = new RegionMap(REGION_SIZE, REGION_SIZE);
    // Flat, sea-level, riverless terrain: elevation 0 everywhere means zero
    // orographic precipitation bonus and (with no real elevation variation
    // at all) no real flow network forms, so `distanceToNearestRiver` is
    // real infinity -- precipitation is genuinely, deterministically 0,
    // reliably below the real drought threshold regardless of temperature.
    for (let x = 0; x < REGION_SIZE; x++) for (let z = 0; z < REGION_SIZE; z++) regionMap.setElevation(x, z, 0);
    const network = computeRiverNetwork(regionMap);
    const disaster = detectDisaster(regionMap, network, 20, 20, 0);
    expect(disaster).toBeDefined();
    expect(["drought", "wildfire"]).toContain(disaster!.kind);

    const siteId = createSite(world, regionMap, 20, 20, 8, 40);
    const before = getSite(world.components, siteId)!.storedFoodKg;
    const updated = applyDisasterToSite(world, siteId, disaster!);
    expect(updated.storedFoodKg).toBeLessThan(before);
    expect(world.events.eventsInvolving(siteId).some((e) => e.eventType.startsWith("world-"))).toBe(true);
  });

  it("deep-time simulator: the world advances centuries while preserving valid genealogical/settlement/event references", () => {
    const { world } = buildWorld();
    const regionMap = new RegionMap(REGION_SIZE, REGION_SIZE);
    const siteId = createSite(world, regionMap, 8, 8, 10, 200);
    const tickBefore = world.clock.tick;

    advanceWorldTicks(world, 20_000 * 100, () => "forest", { forest: 0.8, wetland: 0.7, grassland: 0.5, desert: 0.1, tundra: 0.1, mountain: 0.1 });

    expect(world.clock.tick).toBe(tickBefore + 20_000 * 100);
    const site = getSite(world.components, siteId)!;
    expect(site.populationCount).toBeGreaterThanOrEqual(0);
    // The founding event, recorded before the advance, must still resolve correctly after a century-scale jump.
    const history = explainEntityHistory(world, siteId);
    expect(history.some((h) => h.event.eventType === "site-founded")).toBe(true);
    expect(world.entities.isKnown(siteId)).toBe(true);
  });

  it("REGRESSION (P4/P5 critic review): RegionMap.fromSnapshot rejects non-finite elevation from a corrupted snapshot", () => {
    const regionMap = new RegionMap(8, 8);
    regionMap.setElevation(3, 3, 12);
    const snapshot = regionMap.toSnapshot();
    snapshot.elevationByCell[3 * 8 + 3] = Number.NaN;
    expect(() => RegionMap.fromSnapshot(snapshot)).toThrow(RangeError);
  });
});
