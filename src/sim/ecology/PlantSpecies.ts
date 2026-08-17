import type { MaterialId } from "../materials/Material.js";

const PLANT_SPECIES_ID_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/**
 * A plant species' fixed biological data. Mirrors `MaterialProperties`
 * (materials/Material.ts) deliberately: this interface has no `id`/
 * `displayName`, so every function below that derives behavior from a
 * species (`growthFraction`, `trunkVolumeM3`) is typed to accept only
 * `PlantSpeciesProperties` and cannot identity-branch on a species' name
 * even by accident -- a compile error, not a convention. Two trees of
 * different species must differ ONLY because these numbers differ, which
 * is exactly what P0-10's acceptance test (harvestable wood mass varies
 * with entity state, not a fixed loot table) requires.
 *
 * AGENTS.md explicitly warns against wandering into "hundreds of species"
 * before Milestone 0 -- this file supports as many species as data is
 * added for, but `standardPlantSpecies.ts` deliberately defines only the
 * few this project's early beaver-pond scope actually needs.
 */
export interface PlantSpeciesProperties {
  /** The `MaterialId` (P0-07) this species' trunk is made of when harvested as a log. Referenced by id, not embedded material data, so a material balance patch (editing `standardMaterials.ts`) automatically applies to every species using it. */
  woodMaterialId: MaterialId;
  /** Trunk volume in m^3 once fully grown (age >= matureAgeTicks). Must be > 0. */
  matureTrunkVolumeM3: number;
  /** Simulation ticks (SimulationClock tick units -- never wall-clock, per ARCHITECTURE_CONTRACT §17) to grow from age 0 to full maturity. Must be a positive integer. */
  matureAgeTicks: number;
  /**
   * `[0, 1]` -- how wet this species is adapted to: `0` a dry-ground
   * specialist, `1` a true wetland species, adapted growing near/in
   * standing water. P1-17's `EcologyResponse.ts` derives BOTH "moisture
   * preference" and "flooding tolerance" from this ONE number (a
   * wetland-adapted species tolerating flooding well and a dry-adapted
   * one tolerating it poorly are the SAME underlying fact, not two
   * independently-tunable ones) -- never a second, redundant field.
   */
  moisturePreference: number;
}

export type PlantSpeciesId = string;

export interface PlantSpeciesDefinition extends PlantSpeciesProperties {
  readonly id: PlantSpeciesId;
  readonly displayName: string;
}

export interface PlantSpeciesRegistryDebugState {
  speciesCount: number;
  ids: string[];
}

function assertValidSpeciesProperties(def: PlantSpeciesDefinition): void {
  if (!PLANT_SPECIES_ID_PATTERN.test(def.id)) {
    throw new RangeError(
      `plant species id must be non-empty lowercase kebab-case (e.g. "aspen", "river-willow"), got ${JSON.stringify(def.id)}`,
    );
  }
  if (def.displayName.length === 0) {
    throw new RangeError(`plant species "${def.id}" must have a non-empty displayName`);
  }
  if (!(def.matureTrunkVolumeM3 > 0) || !Number.isFinite(def.matureTrunkVolumeM3)) {
    throw new RangeError(`plant species "${def.id}": matureTrunkVolumeM3 must be > 0, got ${def.matureTrunkVolumeM3}`);
  }
  if (!Number.isInteger(def.matureAgeTicks) || def.matureAgeTicks <= 0) {
    throw new RangeError(`plant species "${def.id}": matureAgeTicks must be a positive integer, got ${def.matureAgeTicks}`);
  }
  if (!(def.moisturePreference >= 0) || !(def.moisturePreference <= 1)) {
    throw new RangeError(`plant species "${def.id}": moisturePreference must be in [0, 1], got ${def.moisturePreference}`);
  }
}

/**
 * A named database of plant species definitions -- structurally identical
 * in shape and intent to `MaterialRegistry` (materials/Material.ts),
 * including the same reasoning for hard duplicate-id rejection (species
 * are referenced by string id from `Plant` component data, so a duplicate
 * id is unambiguously a bug) and the same "no toSnapshot/fromSnapshot"
 * choice: species are code-defined balance data
 * (`standardPlantSpecies.ts`), not created/destroyed during play, and a
 * fresh registry is rebuilt on every load rather than saved.
 */
export class PlantSpeciesRegistry {
  private readonly species = new Map<PlantSpeciesId, PlantSpeciesDefinition>();

  define(definition: PlantSpeciesDefinition): void {
    assertValidSpeciesProperties(definition);
    if (this.species.has(definition.id)) {
      throw new RangeError(`plant species "${definition.id}" is already defined`);
    }
    this.species.set(definition.id, Object.freeze({ ...definition }));
  }

  get(id: PlantSpeciesId): PlantSpeciesDefinition {
    const def = this.species.get(id);
    if (def === undefined) {
      throw new RangeError(`unknown plant species id "${id}"`);
    }
    return def;
  }

  has(id: PlantSpeciesId): boolean {
    return this.species.has(id);
  }

  all(): PlantSpeciesDefinition[] {
    return [...this.species.values()];
  }

  getDebugState(): PlantSpeciesRegistryDebugState {
    return { speciesCount: this.species.size, ids: [...this.species.keys()].sort() };
  }
}

// --- Generic derived behavior: formulas over properties, never over identity. ---

/**
 * Fraction of full growth reached at `ageTicks`, in [0, 1]. Linear in age
 * up to `matureAgeTicks`, then capped at 1 -- deliberately the simplest
 * curve that satisfies "different age produces different size" without
 * inventing an ecology/growth-stunting model (soil quality, competition,
 * damage) that belongs to a later phase (P1-17 and beyond), not P0-10.
 */
export function growthFraction(species: PlantSpeciesProperties, ageTicks: number): number {
  if (!Number.isInteger(ageTicks) || ageTicks < 0) {
    throw new RangeError(`ageTicks must be a non-negative integer, got ${ageTicks}`);
  }
  return Math.min(1, ageTicks / species.matureAgeTicks);
}

/** Current trunk volume in m^3, scaling linearly with growth. Two trees of the same species at different ages -- or different species at the same age -- differ here purely because the underlying data differs, never because of a species-identity branch. */
export function trunkVolumeM3(species: PlantSpeciesProperties, ageTicks: number): number {
  return species.matureTrunkVolumeM3 * growthFraction(species, ageTicks);
}
