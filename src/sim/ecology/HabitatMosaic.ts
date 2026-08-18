import type { World } from "../persistence/WorldSnapshot.js";
import type { AnimalSpeciesRegistry } from "../creatures/AnimalSpecies.js";
import { fishHabitatSuitability } from "./FishEcology.js";
import { currentWetness, floodTolerance } from "./EcologyResponse.js";
import type { PlantSpeciesRegistry, PlantSpeciesProperties } from "./PlantSpecies.js";

/**
 * P11-02: the ecological engineering model -- a habitat-mosaic
 * classification derived PER COLUMN from real existing field state
 * (`WaterField` depth for wetness, `SoilFertility` readings for the dry
 * side), and a per-species affinity table over those mosaic classes.
 * One beaver dam changes the water field; the mosaic reclassifies; and
 * MULTIPLE species' own real response functions (P4-06's fish habitat
 * suitability, P4-15's plant flood tolerance) read the changed classes
 * -- "measurable knock-on effects across multiple species at once," the
 * acceptance test's literal requirement, from one shared mechanism
 * rather than a per-species dam-aware script.
 */

export type HabitatClass = "open-water" | "wetland" | "damp-edge" | "dry-land";

/** Depth at or above which a column is genuine open water rather than wetland. */
export const OPEN_WATER_DEPTH = 0.5;
/** Fertility at or above which a dry, water-adjacent column counts as damp edge (real wet-soil ground) -- lower-fertility dry columns are plain dry land. */
export const DAMP_EDGE_FERTILITY = 0.5;

/** Classifies one column from its own real state: water depth (`WaterField`) and the caller's real fertility reading (`SoilFertilityField`-style `fertilityAt`). A dry column adjacent to water is damp edge when its soil is fertile enough to hold the moisture -- never a random or authored class. */
export function classifyHabitatColumn(
  world: World,
  fertilityAt: (x: number, z: number) => number,
  x: number,
  z: number,
): HabitatClass {
  const depth = world.water.depthAt(x, z);
  if (depth >= OPEN_WATER_DEPTH) return "open-water";
  if (depth > 0) return "wetland";
  const { sizeX, sizeZ } = world.grid.dims;
  let adjacentToWater = false;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const nx = x + dx;
    const nz = z + dz;
    if (nx < 0 || nx >= sizeX || nz < 0 || nz >= sizeZ) continue;
    if (world.water.depthAt(nx, nz) > 0) {
      adjacentToWater = true;
      break;
    }
  }
  if (adjacentToWater && fertilityAt(x, z) >= DAMP_EDGE_FERTILITY) return "damp-edge";
  return "dry-land";
}

export interface HabitatMosaic {
  sizeX: number;
  sizeZ: number;
  /** Class per column, indexed `z * sizeX + x`. */
  classes: HabitatClass[];
}

/** The whole mosaic, classified fresh from current state -- O(sizeX*sizeZ), an on-demand query like every other whole-field debug scan. */
export function habitatMosaic(world: World, fertilityAt: (x: number, z: number) => number): HabitatMosaic {
  const { sizeX, sizeZ } = world.grid.dims;
  const classes: HabitatClass[] = new Array(sizeX * sizeZ);
  for (let x = 0; x < sizeX; x++) {
    for (let z = 0; z < sizeZ; z++) {
      classes[z * sizeX + x] = classifyHabitatColumn(world, fertilityAt, x, z);
    }
  }
  return { sizeX, sizeZ, classes };
}

/** Counts each class across a mosaic -- the measurable "habitat mosaic changed" metric. */
export function mosaicClassCounts(mosaic: HabitatMosaic): Record<HabitatClass, number> {
  const counts: Record<HabitatClass, number> = { "open-water": 0, wetland: 0, "damp-edge": 0, "dry-land": 0 };
  for (const cls of mosaic.classes) counts[cls]++;
  return counts;
}

/**
 * Per-species affinity over habitat classes -- real data (plausible,
 * tunable balance values matching each standard species' own definition:
 * trout is fully aquatic, rabbit is a dry-land herbivore that still
 * grazes damp edges, fox ranges everywhere but dens in dry land).
 * Species without a row get a neutral 1.0 in every class (no invented
 * preference).
 */
export const STANDARD_HABITAT_AFFINITY: Readonly<Record<string, Readonly<Record<HabitatClass, number>>>> = {
  trout: { "open-water": 1, wetland: 0.4, "damp-edge": 0, "dry-land": 0 },
  rabbit: { "open-water": 0, wetland: 0.2, "damp-edge": 0.8, "dry-land": 1 },
  fox: { "open-water": 0.1, wetland: 0.4, "damp-edge": 0.7, "dry-land": 0.9 },
};

/** How well `speciesId` can live in a given habitat class -- the data table above, with a neutral fallback for species without a row. */
export function speciesHabitatAffinity(speciesId: string, habitat: HabitatClass): number {
  return STANDARD_HABITAT_AFFINITY[speciesId]?.[habitat] ?? 1;
}

/**
 * The P11-02 composite: a species' habitat suitability at a column is
 * its OWN existing response function (P4-06's `fishHabitatSuitability`
 * for aquatic species, the dry/wet baseline otherwise) modulated by its
 * affinity for the column's CURRENT mosaic class. One dam floods a
 * meadow: the mosaic flips dry-land -> open-water, and this function
 * moves trout suitability UP and rabbit suitability DOWN at the same
 * columns from the same reclassification -- multi-species knock-on
 * effects from one real cause.
 */
export function speciesHabitatSuitability(
  world: World,
  animalSpecies: AnimalSpeciesRegistry,
  fertilityAt: (x: number, z: number) => number,
  speciesId: string,
  x: number,
  z: number,
): number {
  const species = animalSpecies.get(speciesId);
  let base: number;
  if (species.aquatic) {
    base = fishHabitatSuitability(world, animalSpecies, speciesId, x, z);
  } else {
    const depth = world.water.depthAt(x, z);
    // A non-aquatic species can stand shallow water up to its own
    // wading depth; deeper water is unsuitable. Dry land is fully
    // suitable baseline.
    base = depth <= species.maxWadingDepth ? 1 : 0;
  }
  const habitat = classifyHabitatColumn(world, fertilityAt, x, z);
  return Math.min(1, base * speciesHabitatAffinity(speciesId, habitat));
}

/** A plant species' response to a column's current wetness through its own real P4-15 `floodTolerance` -- the plant side of the same mosaic mechanism (plants flood out when the dam's pond covers them). */
export function plantMosaicHealth(
  world: World,
  plantSpecies: PlantSpeciesRegistry,
  speciesId: string,
  x: number,
  z: number,
): number {
  const species: PlantSpeciesProperties = plantSpecies.get(speciesId);
  const wetness = currentWetness(world.water, x, z);
  const tolerance = floodTolerance(species);
  return Math.min(1, Math.max(0, 1 - (wetness - tolerance)));
}
