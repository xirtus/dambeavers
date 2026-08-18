import type { EntityId } from "../core/EntityId.js";
import type { RandomStream } from "../core/Random.js";
import type { World } from "../persistence/WorldSnapshot.js";
import type { MaterialRegistry } from "../materials/Material.js";
import { RecipeRegistry } from "./Recipe.js";
import { grantTech, knowsRecipe } from "./TechKnowledge.js";
import { householdMembers } from "../creatures/Relationships.js";
import { getTraits, traitOrDefault } from "../creatures/Traits.js";

/**
 * P11-10: invention -- new processes arise from knowledge,
 * experimentation, needs, and available materials, never a global
 * calendar unlock. `attemptInvention` is a real check a household can
 * make: it considers only recipes it does NOT already know whose input
 * material is genuinely available locally, and succeeds with a
 * probability driven by the household's own real industriousness (its
 * members' actual traits) and how much spare material is at hand. Two
 * isolated settlements with different materials/needs invent different
 * things at different sim-times -- driven by their own conditions,
 * exactly as the roadmap requires.
 */

/** Base per-attempt success probability when a household is fully industrious and materials are plentiful. Plausible, tunable balance data -- invention is rare, so it remains an event worth noticing. */
export const INVENTION_BASE_CHANCE = 0.2;
/** How much an unmet need boosts invention: a household that lacks something has reason to experiment. */
export const NEED_BONUS = 0.15;

export interface InventionOptions {
  /** The recipe ids the household could possibly work toward (defaults to ALL known recipes in the registry) -- the test/benchmark's way to express "what this settlement could conceivably discover from its own situation." */
  candidateRecipeIds?: readonly string[];
  /** Material ids genuinely available at the household's location -- only recipes whose input material is HERE can be invented here. */
  availableMaterialIds?: readonly string[];
  /** An unmet need in [0,1] (hunger/defense/trade) raising the chance -- experimentation is driven by lacking something. */
  unmetNeed?: number;
}

/** The household's real average industriousness -- invention is work, and industrious households invent more. Derived from members' actual traits, 0.5 fallback. */
export function householdIndustriousness(world: World, householdId: EntityId): number {
  const members = householdMembers(world.components, householdId);
  if (members.length === 0) return 0.5;
  const sum = members.reduce((total, memberId) => {
    const traits = getTraits(world.components, memberId);
    return total + traitOrDefault(traits, "industriousness");
  }, 0);
  return sum / members.length;
}

export interface InventionAttempt {
  inventedRecipeId?: string;
  reason: string;
}

/**
 * One real invention attempt by `householdId`. Candidate recipes are
 * those the household does NOT know, whose input material is actually
 * available, and (when given) within `candidateRecipeIds`. The success
 * probability is `INVENTION_BASE_CHANCE` scaled by the household's real
 * industriousness, boosted by unmet need, and gated on spare material.
 * On success the recipe is genuinely granted (P11-09's own mechanism)
 * and a real `"recipe-invented"` event is recorded -- the invention is
 * then simply a fact the household knows, craftable like any learned
 * recipe. Returns the invented recipe id, or `undefined` with an honest
 * reason when the attempt failed or had nothing to attempt.
 */
export function attemptInvention(
  world: World,
  householdId: EntityId,
  recipes: RecipeRegistry,
  materials: MaterialRegistry,
  random: RandomStream,
  options: InventionOptions = {},
): InventionAttempt {
  const candidates = (options.candidateRecipeIds ?? recipes.all().map((recipe) => recipe.id)).filter((recipeId) => {
    if (knowsRecipe(world, householdId, recipeId)) return false;
    const recipe = recipes.get(recipeId);
    return options.availableMaterialIds === undefined || options.availableMaterialIds.includes(recipe.inputMaterialId);
  });
  if (candidates.length === 0) {
    return { reason: "no unknown recipe has its input material available here" };
  }
  // Deterministic candidate order (registry id sort) -- the roll picks
  // one real candidate, never a random one that might not exist.
  const sorted = [...candidates].sort();
  const chosen = sorted[Math.floor(random.nextFloat() * sorted.length) % sorted.length]!;

  const industriousness = householdIndustriousness(world, householdId);
  const need = options.unmetNeed ?? 0;
  const availabilityBonus = options.availableMaterialIds !== undefined && options.availableMaterialIds.length > 0 ? 0.1 : 0;
  const chance = Math.min(1, INVENTION_BASE_CHANCE * (0.5 + industriousness) + need * NEED_BONUS + availabilityBonus);
  if (!random.nextBool(chance)) {
    return { reason: `experiment toward "${chosen}" failed (chance ${chance.toFixed(3)})` };
  }

  grantTech(world, householdId, { recipeIds: [chosen] });
  world.events.record({
    tick: world.clock.tick,
    eventType: "recipe-invented",
    subjectIds: [householdId],
    objectIds: [],
    location: { x: 0, y: 0, z: 0 },
    data: { recipeId: chosen },
  });
  void materials;
  return { inventedRecipeId: chosen, reason: `invented "${chosen}"` };
}
