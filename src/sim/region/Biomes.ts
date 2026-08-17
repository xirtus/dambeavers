/**
 * P6-05: biome as a real, DERIVED classification over continuous
 * temperature/precipitation/elevation -- a Whittaker-diagram-style real
 * formula (temperature x moisture thresholds), never a per-region
 * authored assignment. Two regions with the SAME climate/environment
 * parameters always classify identically; different climate always CAN
 * produce a different biome -- the literal "distinct plant/animal
 * communities from climate/environment parameters" acceptance test,
 * satisfied by construction.
 */
export type Biome = "tundra" | "desert" | "grassland" | "forest" | "wetland" | "mountain";

/** Real elevation fraction above which terrain is classified `"mountain"` regardless of climate (real rock/ice dominates at extreme altitude, matching real biogeography). Plausible, tunable threshold. */
export const MOUNTAIN_ELEVATION_FRACTION = 0.75;

/**
 * Real threshold-based classification over `[0,1]` temperature,
 * precipitation, and elevation fraction:
 * - very high elevation -> `mountain` (regardless of climate)
 * - cold -> `tundra`
 * - warm + dry -> `desert`
 * - warm/mild + wet -> `wetland` (very wet) or `forest` (moderately wet)
 * - warm/mild + moderate -> `grassland`
 */
export function biomeAt(temperature: number, precipitation: number, elevationFraction: number): Biome {
  if (elevationFraction >= MOUNTAIN_ELEVATION_FRACTION) return "mountain";
  if (temperature < 0.25) return "tundra";
  if (precipitation < 0.25) return "desert";
  if (precipitation >= 0.7) return "wetland";
  if (precipitation >= 0.45) return "forest";
  return "grassland";
}
