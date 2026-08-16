import type { PlantSpeciesDefinition, PlantSpeciesRegistry } from "./PlantSpecies.js";

/**
 * The initial plant species set for this project's early beaver-pond
 * scope. Deliberately just two species, not the "hundreds of species"
 * AGENTS.md explicitly warns against wandering into before Milestone 0 --
 * aspen and willow are both real beaver forage/building trees, giving the
 * P0-10 acceptance test two genuinely different species (different wood
 * material, different mature trunk volume/growth time) without inventing
 * unneeded breadth.
 *
 * Versioning: mirrors `STANDARD_MATERIALS_VERSION` (materials/standardMaterials.ts)
 * for the identical reason -- this is tunable balance data with no
 * per-entity identity of its own, so a future save/replay system that
 * needs exact historical reproduction across balance patches has a
 * version to pin against.
 */
export const STANDARD_PLANT_SPECIES_VERSION = 1;
export const STANDARD_PLANT_SPECIES: readonly PlantSpeciesDefinition[] = [
  {
    id: "aspen",
    displayName: "Aspen",
    woodMaterialId: "wood",
    matureTrunkVolumeM3: 0.3, // a modest-sized mature aspen trunk
    matureAgeTicks: 20_000,
  },
  {
    id: "willow",
    displayName: "Willow",
    woodMaterialId: "wood",
    matureTrunkVolumeM3: 0.6, // willows grow larger/faster near water
    matureAgeTicks: 12_000,
  },
];

export function registerStandardPlantSpecies(registry: PlantSpeciesRegistry): void {
  for (const species of STANDARD_PLANT_SPECIES) {
    registry.define(species);
  }
}
