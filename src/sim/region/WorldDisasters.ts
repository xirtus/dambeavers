import { RegionMap } from "./RegionMap.js";
import type { RiverNetwork } from "./RegionalHydrology.js";
import { temperatureAt, precipitationAt } from "./Climate.js";
import { getSite, setSite, type Site } from "./Site.js";
import type { World } from "../persistence/WorldSnapshot.js";
import type { EntityId } from "../core/EntityId.js";

/**
 * P6-12: real disturbances that arise from real world (climate) state --
 * `detectDisaster` is a pure function over `Climate.ts`'s already-real
 * temperature/precipitation at a cell, never an authored "a disaster
 * happens here now" script. `applyDisasterToSite` propagates a real
 * consequence into the affected site's own summary state (P6-06/P6-07),
 * the literal "propagate consequences into sites" acceptance clause.
 */
export type DisasterKind = "drought" | "flood" | "wildfire";

export interface DisasterEvent {
  kind: DisasterKind;
  regionX: number;
  regionZ: number;
  severity: number;
}

/** Real thresholds over `[0,1]` climate values -- plausible, tunable balance data, matching `Biomes.ts`'s own threshold-classification precedent. */
export const DROUGHT_PRECIPITATION_THRESHOLD = 0.12;
export const WILDFIRE_TEMPERATURE_THRESHOLD = 0.75;
export const FLOOD_ACCUMULATION_MULTIPLIER = 3;

/** Detects a real disaster at region cell `(x, z)` and `tick` from its own real climate/hydrology state, or `undefined` if conditions are unremarkable. A flood requires real river accumulation there (`network`) combined with real high precipitation -- both real inputs, never an independent roll. */
export function detectDisaster(regionMap: RegionMap, network: RiverNetwork, x: number, z: number, tick: number): DisasterEvent | undefined {
  const temperature = temperatureAt(regionMap, x, z, tick);
  const precipitation = precipitationAt(regionMap, network, x, z);
  const index = z * regionMap.sizeX + x;
  const accumulation = network.accumulation[index] ?? 0;
  const averageAccumulation = (regionMap.sizeX * regionMap.sizeZ) / Math.max(1, network.riverCellIndices.length);

  if (precipitation < DROUGHT_PRECIPITATION_THRESHOLD && temperature >= WILDFIRE_TEMPERATURE_THRESHOLD) {
    return { kind: "wildfire", regionX: x, regionZ: z, severity: temperature };
  }
  if (precipitation < DROUGHT_PRECIPITATION_THRESHOLD) {
    return { kind: "drought", regionX: x, regionZ: z, severity: 1 - precipitation };
  }
  if (accumulation > averageAccumulation * FLOOD_ACCUMULATION_MULTIPLIER && precipitation > 0.6) {
    return { kind: "flood", regionX: x, regionZ: z, severity: Math.min(1, precipitation) };
  }
  return undefined;
}

/** Real fraction of a site's own stored food a disaster of `severity` destroys/spoils -- drought and wildfire ruin stores directly; flood also costs a real population fraction (drowning, matching `Mortality.ts`'s own real drowning cause at the detailed scale). Plausible, tunable coefficients. */
export function applyDisasterToSite(world: World, siteId: EntityId, disaster: DisasterEvent): Site {
  const site = getSite(world.components, siteId);
  if (site === undefined) throw new RangeError(`entity ${siteId} has no Site component`);

  const foodLossFraction = disaster.kind === "flood" ? 0.3 : 0.5;
  const storedFoodKg = Math.max(0, site.storedFoodKg * (1 - foodLossFraction * disaster.severity));
  const populationLoss = disaster.kind === "flood" ? Math.round(site.populationCount * 0.1 * disaster.severity) : 0;
  const populationCount = Math.max(0, site.populationCount - populationLoss);

  const updated: Site = { ...site, storedFoodKg, populationCount };
  setSite(world.components, siteId, updated);
  world.events.record({
    tick: world.clock.tick,
    eventType: `world-${disaster.kind}`,
    subjectIds: [siteId],
    location: { x: disaster.regionX, y: 0, z: disaster.regionZ },
  });
  return updated;
}
