/**
 * Headless acceptance test for P6-12 -- World-scale disasters.
 *
 * Roadmap acceptance test: "drought/flood/fire or similar disturbances
 * arise from world state and propagate consequences into sites."
 *
 * Disasters are DETECTED, never scripted: drought/wildfire from real
 * sustained low precipitation (plus high temperature for wildfire), flood
 * from real river accumulation combined with real high precipitation --
 * all pure functions of the world's own climate/hydrology state. A
 * detected disaster then propagates a real consequence (reduced stored
 * food, real population loss for a flood) into the affected site and
 * records the real event.
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
import { RegionMap } from "../../src/sim/region/RegionMap.js";
import { computeRiverNetwork } from "../../src/sim/region/RegionalHydrology.js";
import { detectDisaster, applyDisasterToSite } from "../../src/sim/region/WorldDisasters.js";
import { createSite, getSite } from "../../src/sim/region/Site.js";

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
  const random = new RandomStreams(612);
  const events = new EventLog(entities);
  return {
    world: { clock, random, entities, components, grid, terrain, events, water, weather },
    regionMap: new RegionMap(REGION_SIZE, REGION_SIZE),
  };
}

describe("P6-12 -- World-scale disasters", () => {
  it("drought and flood arise from real world state and propagate real consequences into affected sites", () => {
    // --- Drought (and wildfire) arise from real, sustained aridity. ---
    // Flat, sea-level, riverless terrain: no flow network, zero orographic
    // precipitation -- deterministically below the real drought threshold.
    const dry = buildWorld();
    for (let x = 0; x < REGION_SIZE; x++) for (let z = 0; z < REGION_SIZE; z++) dry.regionMap.setElevation(x, z, 0);
    const dryNetwork = computeRiverNetwork(dry.regionMap);
    const drought = detectDisaster(dry.regionMap, dryNetwork, 15, 15, 0);
    expect(drought).toBeDefined();
    expect(["drought", "wildfire"]).toContain(drought!.kind);

    const droughtSiteId = createSite(dry.world, dry.regionMap, 15, 15, 8, 60);
    const foodBeforeDrought = getSite(dry.world.components, droughtSiteId)!.storedFoodKg;
    applyDisasterToSite(dry.world, droughtSiteId, drought!);
    expect(getSite(dry.world.components, droughtSiteId)!.storedFoodKg).toBeLessThan(foodBeforeDrought);
    expect(dry.world.events.eventsInvolving(droughtSiteId).some((e) => e.eventType === `world-${drought!.kind}`)).toBe(true);

    // --- Flood arises from real flow accumulation + real high precipitation. ---
    // A hand-built bowl: every cell drains to the low center, so the
    // center's real accumulation is the whole map -- far above the real
    // flood threshold -- and its own real precipitation (on the river,
    // low elevation) exceeds the real flood-precipitation floor.
    const wet = buildWorld();
    const center = Math.floor(REGION_SIZE / 2);
    for (let x = 0; x < REGION_SIZE; x++) {
      for (let z = 0; z < REGION_SIZE; z++) {
        const distance = Math.max(Math.abs(x - center), Math.abs(z - center));
        wet.regionMap.setElevation(x, z, distance * 10);
      }
    }
    const wetNetwork = computeRiverNetwork(wet.regionMap);
    const flood = detectDisaster(wet.regionMap, wetNetwork, center, center, 0);
    expect(flood).toBeDefined();
    expect(flood!.kind).toBe("flood");

    const floodSiteId = createSite(wet.world, wet.regionMap, center, center, 8, 60);
    const populationBeforeFlood = getSite(wet.world.components, floodSiteId)!.populationCount;
    const foodBeforeFlood = getSite(wet.world.components, floodSiteId)!.storedFoodKg;
    applyDisasterToSite(wet.world, floodSiteId, flood!);
    const flooded = getSite(wet.world.components, floodSiteId)!;
    expect(flooded.storedFoodKg).toBeLessThan(foodBeforeFlood);
    expect(flooded.populationCount).toBeLessThanOrEqual(populationBeforeFlood); // a real flood costs real lives, never gains them
    expect(wet.world.events.eventsInvolving(floodSiteId).some((e) => e.eventType === "world-flood")).toBe(true);
  });
});
