import type { MaterialId } from "../materials/Material.js";

/**
 * P3-02: a data-defined process/recipe. `Craft.ts`'s execution driver
 * (`tickCraftJob`) is generic over EVERY field here -- adding a new
 * recipe to `STANDARD_RECIPES` never requires touching `Craft.ts`, the
 * literal P3-01/P3-02 acceptance test ("new workshop definitions can
 * consume inputs and produce outputs without custom job architecture" /
 * "a data-defined recipe can be added without changing workshop
 * execution code").
 *
 * Mass-based inputs/outputs (one input material, one output good kind),
 * mirroring `Construction.ts`'s own `requiredMaterialId`/`requiredMassKg`
 * shape -- deliberately reused rather than an itemized "N discrete
 * items" shape, so `Craft.ts` can reuse `Construction.ts`'s already-
 * proven "haul real mass to a site, claim it, consume it on completion"
 * pattern almost verbatim. `outputMassKg` need not equal `inputMassKg`
 * (a process can have real waste, or bulk up with a binder) -- both are
 * independent, tunable balance numbers.
 */
export interface RecipeDefinition {
  readonly id: string;
  readonly displayName: string;
  readonly workshopKind: string;
  readonly inputMaterialId: MaterialId;
  readonly inputMassKg: number;
  readonly outputGoodKind: string;
  /** Defaults to `inputMaterialId` when omitted -- most processes preserve material identity (P3-03's own literal acceptance test), a few (P3-05 clay -> fired brick) genuinely transform it into a distinct material. */
  readonly outputMaterialId?: MaterialId;
  readonly outputMassKg: number;
  readonly workRequired: number;
  readonly skillName: string;
}

export interface RecipeRegistryDebugState {
  recipeCount: number;
  ids: string[];
}

const RECIPE_ID_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

function assertValidRecipe(def: RecipeDefinition): void {
  if (!RECIPE_ID_PATTERN.test(def.id)) throw new RangeError(`recipe id must be non-empty lowercase kebab-case, got ${JSON.stringify(def.id)}`);
  if (def.displayName.length === 0) throw new RangeError(`recipe "${def.id}" must have a non-empty displayName`);
  if (!RECIPE_ID_PATTERN.test(def.workshopKind)) throw new RangeError(`recipe "${def.id}": workshopKind must be lowercase kebab-case`);
  if (def.inputMaterialId.trim().length === 0) throw new RangeError(`recipe "${def.id}": inputMaterialId must be non-empty`);
  if (!(Number.isFinite(def.inputMassKg) && def.inputMassKg > 0)) throw new RangeError(`recipe "${def.id}": inputMassKg must be positive`);
  if (!RECIPE_ID_PATTERN.test(def.outputGoodKind)) throw new RangeError(`recipe "${def.id}": outputGoodKind must be lowercase kebab-case`);
  if (def.outputMaterialId !== undefined && def.outputMaterialId.trim().length === 0) {
    throw new RangeError(`recipe "${def.id}": outputMaterialId must be non-empty when present`);
  }
  if (!(Number.isFinite(def.outputMassKg) && def.outputMassKg > 0)) throw new RangeError(`recipe "${def.id}": outputMassKg must be positive`);
  if (!(Number.isFinite(def.workRequired) && def.workRequired > 0)) throw new RangeError(`recipe "${def.id}": workRequired must be positive`);
  if (!RECIPE_ID_PATTERN.test(def.skillName)) throw new RangeError(`recipe "${def.id}": skillName must be lowercase kebab-case`);
}

/** Named database of recipe definitions -- same shape/contract as `MaterialRegistry` (P0-07): duplicate ids rejected, immutable entries once defined. */
export class RecipeRegistry {
  private readonly recipes = new Map<string, RecipeDefinition>();

  define(definition: RecipeDefinition): void {
    assertValidRecipe(definition);
    if (this.recipes.has(definition.id)) throw new RangeError(`recipe "${definition.id}" is already defined`);
    this.recipes.set(definition.id, Object.freeze({ ...definition }));
  }

  get(id: string): RecipeDefinition {
    const def = this.recipes.get(id);
    if (def === undefined) throw new RangeError(`unknown recipe id "${id}"`);
    return def;
  }

  has(id: string): boolean {
    return this.recipes.has(id);
  }

  all(): RecipeDefinition[] {
    return [...this.recipes.values()];
  }

  forWorkshopKind(workshopKind: string): RecipeDefinition[] {
    return this.all().filter((r) => r.workshopKind === workshopKind);
  }

  getDebugState(): RecipeRegistryDebugState {
    return { recipeCount: this.recipes.size, ids: [...this.recipes.keys()].sort() };
  }
}

/**
 * P3-03/P3-04/P3-05's initial recipe set. Values are plausible, tunable
 * balance data (matching `CONSTRUCTION_REQUIREMENTS`'s own precedent) --
 * not derived from a deeper physical model.
 */
export const STANDARD_RECIPES_VERSION = 1;
export const STANDARD_RECIPES: readonly RecipeDefinition[] = [
  // P3-03 Woodworking: material identity preserved (wood in, wood out).
  {
    id: "saw-planks",
    displayName: "Saw planks",
    workshopKind: "carpenter",
    inputMaterialId: "wood",
    inputMassKg: 20,
    outputGoodKind: "plank",
    outputMassKg: 18,
    workRequired: 12,
    skillName: "woodworking",
  },
  {
    id: "carve-component",
    displayName: "Carve wood component",
    workshopKind: "carpenter",
    inputMaterialId: "wood",
    inputMassKg: 10,
    outputGoodKind: "wood-component",
    outputMassKg: 8,
    workRequired: 15,
    skillName: "woodworking",
  },
  // P3-04 Stoneworking: raw excavated stone (`Digging.ts`) becomes construction/component items.
  {
    id: "cut-blocks",
    displayName: "Cut stone blocks",
    workshopKind: "mason",
    inputMaterialId: "stone",
    inputMassKg: 30,
    outputGoodKind: "stone-block",
    outputMassKg: 25,
    workRequired: 20,
    skillName: "stoneworking",
  },
  // P3-05 Clay/mud working: transforms wet material into a distinct fired-brick material identity.
  {
    id: "fire-bricks",
    displayName: "Fire clay bricks",
    workshopKind: "kiln",
    inputMaterialId: "clay",
    inputMassKg: 15,
    outputGoodKind: "brick",
    outputMaterialId: "clay",
    outputMassKg: 12,
    workRequired: 18,
    skillName: "claywork",
  },
  // P3-18 Trade goods: no survival value, pure crafted-goods provenance chain.
  {
    id: "carve-trinket",
    displayName: "Carve wood trinket",
    workshopKind: "carpenter",
    inputMaterialId: "wood",
    inputMassKg: 2,
    outputGoodKind: "trade-good",
    outputMassKg: 1,
    workRequired: 25,
    skillName: "woodworking",
  },
];

export function registerStandardRecipes(registry: RecipeRegistry): void {
  for (const recipe of STANDARD_RECIPES) registry.define(recipe);
}
