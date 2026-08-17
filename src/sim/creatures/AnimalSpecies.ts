const ANIMAL_SPECIES_ID_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/**
 * P4-05's fixed biological data for an animal species -- mirrors
 * `PlantSpeciesProperties` (ecology/PlantSpecies.ts) deliberately: no
 * `id`/`displayName` here, so every derived-behavior function is typed to
 * accept only `AnimalSpeciesProperties` and cannot identity-branch on a
 * species' name even by accident. `diet`/`preySpeciesIds` (P4-07),
 * `aquatic`/`minHabitatDepth` (P4-06) are the only species-specific
 * facts; everything else an animal needs (mass, speed, swim capability,
 * hunger/thirst/fatigue, health) is the SAME generic `CreatureBody`/
 * `Locomotion`/`Swimmer`/`Needs`/`Health` component set `Beaver.ts`
 * already defined and P0-02/P1-05 already made kind-agnostic -- the
 * literal P4-05 acceptance test ("multiple animal species share general
 * creature/navigation/needs components rather than species-specific AI
 * controllers").
 */
export interface AnimalSpeciesProperties {
  diet: "herbivore" | "carnivore" | "omnivore";
  /** Species ids this species will hunt, when `diet` is `"carnivore"`/`"omnivore"`. Empty for a pure herbivore. */
  preySpeciesIds: readonly string[];
  massKg: number;
  speed: number;
  canSwim: boolean;
  maxWadingDepth: number;
  /** Whether this species lives IN water (fish) rather than merely being able to cross it (a swimming land animal). */
  aquatic: boolean;
  /** Minimum real `WaterField` depth an aquatic species needs to inhabit a column. Meaningless (ignored) for non-aquatic species. */
  minHabitatDepth: number;
}

export type AnimalSpeciesId = string;

export interface AnimalSpeciesDefinition extends AnimalSpeciesProperties {
  readonly id: AnimalSpeciesId;
  readonly displayName: string;
}

export interface AnimalSpeciesRegistryDebugState {
  speciesCount: number;
  ids: string[];
}

function assertValidAnimalSpecies(def: AnimalSpeciesDefinition): void {
  if (!ANIMAL_SPECIES_ID_PATTERN.test(def.id)) {
    throw new RangeError(`animal species id must be non-empty lowercase kebab-case, got ${JSON.stringify(def.id)}`);
  }
  if (def.displayName.length === 0) throw new RangeError(`animal species "${def.id}" must have a non-empty displayName`);
  if (!["herbivore", "carnivore", "omnivore"].includes(def.diet)) {
    throw new RangeError(`animal species "${def.id}": diet must be herbivore/carnivore/omnivore, got ${JSON.stringify(def.diet)}`);
  }
  if (!Array.isArray(def.preySpeciesIds)) throw new RangeError(`animal species "${def.id}": preySpeciesIds must be an array`);
  if (!(def.massKg > 0 && Number.isFinite(def.massKg))) throw new RangeError(`animal species "${def.id}": massKg must be positive`);
  if (!(def.speed > 0 && Number.isFinite(def.speed))) throw new RangeError(`animal species "${def.id}": speed must be positive`);
  if (typeof def.canSwim !== "boolean") throw new RangeError(`animal species "${def.id}": canSwim must be boolean`);
  if (!(def.maxWadingDepth >= 0 && Number.isFinite(def.maxWadingDepth))) throw new RangeError(`animal species "${def.id}": maxWadingDepth must be non-negative`);
  if (typeof def.aquatic !== "boolean") throw new RangeError(`animal species "${def.id}": aquatic must be boolean`);
  if (!(def.minHabitatDepth >= 0 && Number.isFinite(def.minHabitatDepth))) throw new RangeError(`animal species "${def.id}": minHabitatDepth must be non-negative`);
}

/** Named database of animal species definitions -- same contract shape as `PlantSpeciesRegistry`/`MaterialRegistry`. */
export class AnimalSpeciesRegistry {
  private readonly species = new Map<AnimalSpeciesId, AnimalSpeciesDefinition>();

  define(definition: AnimalSpeciesDefinition): void {
    assertValidAnimalSpecies(definition);
    if (this.species.has(definition.id)) throw new RangeError(`animal species "${definition.id}" is already defined`);
    this.species.set(definition.id, Object.freeze({ ...definition, preySpeciesIds: [...definition.preySpeciesIds] }));
  }

  get(id: AnimalSpeciesId): AnimalSpeciesDefinition {
    const def = this.species.get(id);
    if (def === undefined) throw new RangeError(`unknown animal species id "${id}"`);
    return def;
  }

  has(id: AnimalSpeciesId): boolean {
    return this.species.has(id);
  }

  all(): AnimalSpeciesDefinition[] {
    return [...this.species.values()];
  }

  getDebugState(): AnimalSpeciesRegistryDebugState {
    return { speciesCount: this.species.size, ids: [...this.species.keys()].sort() };
  }
}

/** P4-06/P4-07's initial species set. Plausible, tunable balance data, matching `standardPlantSpecies.ts`'s own "supports as many species as data is added for; only define the few this project's scope needs" precedent. */
export const STANDARD_ANIMAL_SPECIES_VERSION = 1;
export const STANDARD_ANIMAL_SPECIES: readonly AnimalSpeciesDefinition[] = [
  {
    id: "trout",
    displayName: "Trout",
    diet: "omnivore",
    preySpeciesIds: [],
    massKg: 1.5,
    speed: 3,
    canSwim: true,
    maxWadingDepth: 0,
    aquatic: true,
    minHabitatDepth: 1,
  },
  {
    id: "rabbit",
    displayName: "Rabbit",
    diet: "herbivore",
    preySpeciesIds: [],
    massKg: 1.2,
    speed: 2.5,
    canSwim: false,
    maxWadingDepth: 0.1,
    aquatic: false,
    minHabitatDepth: 0,
  },
  {
    id: "fox",
    displayName: "Fox",
    diet: "carnivore",
    preySpeciesIds: ["rabbit"],
    massKg: 6,
    speed: 3.5,
    canSwim: true,
    maxWadingDepth: 0.3,
    aquatic: false,
    minHabitatDepth: 0,
  },
];

export function registerStandardAnimalSpecies(registry: AnimalSpeciesRegistry): void {
  for (const species of STANDARD_ANIMAL_SPECIES) registry.define(species);
}
