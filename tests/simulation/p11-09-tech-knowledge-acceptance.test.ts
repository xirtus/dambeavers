/**
 * Headless acceptance test for P11-09 -- Technological knowledge as culture.
 *
 * Roadmap acceptance test:
 *   "a settlement cannot construct a technology it has never discovered
 *   or learned, even if the player knows the recipe."
 *
 * Crafting eligibility is gated on the worker's OWN household's real
 * `TechKnowledge` ledger: a beaver whose household never learned the
 * recipe is not eligible for the craft job even with all materials in
 * hand and a ready workshop -- and becomes eligible only after a real
 * teaching act (from a household that genuinely holds the knowledge) or
 * a real invention grant.
 */
import { describe, expect, it } from "vitest";
import { buildDetailedWorld, spawnAt } from "../unit/parityHarness.js";
import { createHousehold, setHouseholdMembership } from "../../src/sim/creatures/Relationships.js";
import { createWorkshop } from "../../src/sim/economy/Workshop.js";
import { designateCraft, generateCraftJob, isEligibleForCraft, checkCraftMaterialsDelivered } from "../../src/sim/economy/Craft.js";
import { setLog } from "../../src/sim/labor/Log.js";
import { RecipeRegistry, registerStandardRecipes } from "../../src/sim/economy/Recipe.js";
import { grantTech, teachTech, knowsRecipe, understandsKind } from "../../src/sim/economy/TechKnowledge.js";

describe("P11-09 technological knowledge acceptance", () => {
  it("an isolated settlement cannot craft an unlearned recipe, even with materials and a workshop -- until real propagation", () => {
    const { world } = buildDetailedWorld("p11-09");
    const recipes = new RecipeRegistry();
    registerStandardRecipes(recipes);

    // Settlement A: an isolated household with a workshop and a real
    // craft order -- but NO tech knowledge.
    const worker = spawnAt(world, "Worker", 3, 3);
    const householdA = createHousehold(world);
    setHouseholdMembership(world.components, worker, { householdId: householdA });
    const workshop = createWorkshop(world, "carpenter", { x: 3, z: 3 });
    // Real materials genuinely delivered at the site -- everything the
    // recipe needs is physically present, yet the settlement still
    // cannot build it without the knowledge.
    const logId = world.entities.create("log");
    world.grid.setEntityPosition(logId, 3, 3, 3);
    setLog(world.components, logId, { materialId: "wood", massKg: 20 });
    const orderId = designateCraft(world, recipes, workshop, "saw-planks");
    expect(checkCraftMaterialsDelivered(world, recipes, orderId)).toBe(true);
    const jobId = generateCraftJob(world, orderId)[0]!;

    // The player "knows" the recipe (it's in the registry), materials
    // could be delivered -- but the settlement genuinely cannot build
    // it: the worker is not eligible.
    expect(knowsRecipe(world, householdA, "saw-planks")).toBe(false);
    expect(isEligibleForCraft(world.entities, world.components, worker, jobId)).toBe(false);

    // A second isolated household that DID learn it (its own ledger).
    const householdB = createHousehold(world);
    grantTech(world, householdB, { recipeIds: ["saw-planks"] });
    expect(knowsRecipe(world, householdB, "saw-planks")).toBe(true);

    // Real propagation: B teaches A. Now -- and only now -- A's worker
    // is eligible for the same job, unchanged in every other respect.
    const taught = teachTech(world, householdB, householdA, { recipeId: "saw-planks" });
    expect(taught).toBe(true);
    expect(knowsRecipe(world, householdA, "saw-planks")).toBe(true);
    expect(isEligibleForCraft(world.entities, world.components, worker, jobId)).toBe(true);
  });

  it("teaching is impossible without genuine knowledge -- a household that never learned cannot teach", () => {
    const { world } = buildDetailedWorld("p11-09b");
    const householdA = createHousehold(world);
    const householdB = createHousehold(world);
    expect(teachTech(world, householdA, householdB, { recipeId: "saw-planks" })).toBe(false);
    expect(knowsRecipe(world, householdB, "saw-planks")).toBe(false);
    // Construction kinds propagate the same way (the P11-11 repair
    // gate reads this).
    grantTech(world, householdA, { understoodKinds: ["dam-segment"] });
    expect(teachTech(world, householdA, householdB, { kind: "dam-segment" })).toBe(true);
    expect(understandsKind(world, householdB, "dam-segment")).toBe(true);
    // And a household that lacks a kind cannot teach it either.
    expect(teachTech(world, householdB, householdA, { kind: "bridge-segment" })).toBe(false);
  });

  it("an unhouseholded worker keeps the historical behavior (own knowledge, no social group to gate)", () => {
    const { world } = buildDetailedWorld("p11-09c");
    const recipes = new RecipeRegistry();
    registerStandardRecipes(recipes);
    const worker = spawnAt(world, "Loner", 3, 3);
    const workshop = createWorkshop(world, "carpenter", { x: 3, z: 3 });
    // Real materials genuinely delivered at the site -- everything the
    // recipe needs is physically present, yet the settlement still
    // cannot build it without the knowledge.
    const logId = world.entities.create("log");
    world.grid.setEntityPosition(logId, 3, 3, 3);
    setLog(world.components, logId, { materialId: "wood", massKg: 20 });
    const orderId = designateCraft(world, recipes, workshop, "saw-planks");
    expect(checkCraftMaterialsDelivered(world, recipes, orderId)).toBe(true);
    const jobId = generateCraftJob(world, orderId)[0]!;
    expect(isEligibleForCraft(world.entities, world.components, worker, jobId)).toBe(true);
  });
});
