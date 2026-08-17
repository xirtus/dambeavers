import type { PlantSpeciesDefinition, PlantSpeciesRegistry } from "./PlantSpecies.js";

/**
 * The initial plant species set for this project's early beaver-pond
 * scope. Deliberately just two species, not the "hundreds of species"
 * AGENTS.md explicitly warns against wandering into before Milestone 0 --
 * aspen and willow are both real beaver forage/building trees, giving the
 * P0-10 acceptance test two genuinely different species (different wood
 * material, different mature trunk volume/growth time) without inventing
 * unneeded breadth. As of P1-17, they're also genuinely different in
 * `moisturePreference` -- aspen a dry-ground specialist, willow a real
 * wetland species (already reflected in this file's own pre-existing
 * "willows grow larger/faster near water" comment, now backed by an
 * actual mechanism, `EcologyResponse.ts`) -- so the roadmap's own
 * "persistently flooded dry vegetation declines while suitable wetland
 * vegetation gains viability" has two genuinely different species to
 * demonstrate it with, not an invented third one.
 *
 * Versioning: mirrors `STANDARD_MATERIALS_VERSION` (materials/standardMaterials.ts)
 * for the identical reason -- this is tunable balance data with no
 * per-entity identity of its own, so a future save/replay system that
 * needs exact historical reproduction across balance patches has a
 * version to pin against.
 */
export const STANDARD_PLANT_SPECIES_VERSION = 2;
export const STANDARD_PLANT_SPECIES: readonly PlantSpeciesDefinition[] = [
  {
    id: "aspen",
    displayName: "Aspen",
    woodMaterialId: "wood",
    matureTrunkVolumeM3: 0.3, // a modest-sized mature aspen trunk
    matureAgeTicks: 20_000,
    // Exactly 0, not merely "low": `EcologyResponse.ts`'s own fitness
    // formula (`1 - |wetness - moisturePreference|`) only reaches its
    // maximum of 1 when the site's real wetness EXACTLY equals this
    // value -- so a species' own truly-ideal habitat must itself be a
    // value real wetness can actually land on (0, ordinary dry ground
    // with zero standing water; `WaterField.depthAt` reads exactly 0
    // there). A near-but-not-exact value (an earlier version of this
    // data used 0.2) would mean even a perfectly healthy aspen standing
    // on ordinary, never-flooded ground could never sustain full health
    // -- silently decaying toward 80% forever once this mechanism is
    // ever wired to an automatic per-tick driver. Caught during this
    // task's own critic review.
    moisturePreference: 0,
  },
  {
    id: "willow",
    displayName: "Willow",
    woodMaterialId: "wood",
    matureTrunkVolumeM3: 0.6, // willows grow larger/faster near water
    matureAgeTicks: 12_000,
    // Exactly 1, for the identical reason aspen is exactly 0 (see that
    // field's own comment) -- a real wetland species' own ideal habitat
    // is full, sustained saturation, and `currentWetness` clamps at
    // exactly 1 for any sufficiently deep flood, so this is the value
    // that formula can genuinely reach.
    moisturePreference: 1,
  },
];

export function registerStandardPlantSpecies(registry: PlantSpeciesRegistry): void {
  for (const species of STANDARD_PLANT_SPECIES) {
    registry.define(species);
  }
}
