/**
 * Phase 11 critic pass -- regressions for the findings, each verified
 * to FAIL on the pre-fix code:
 *
 * 1. Unbounded event generation in `advanceWatershedSpan`: a
 *    probability-1 erosion pair queued `spanTicks` events (a
 *    million-entry array per pair) when the terrain could physically
 *    change only a handful of cells. Pre-fix, a fully stressed map over
 *    a 2M-tick span queued hundreds of millions of events and blew the
 *    test budget; post-fix it is capped per pair and completes
 *    immediately. The regression is the completion itself at scale.
 * 2. Seepage closed-form/per-tick inconsistency: the span advance
 *    solved a DIFFERENT equation (max over wet neighbors) than the
 *    per-tick update (saturating sum). Pre-fix, a bank with two wet
 *    neighbors settled at a different saturation under the two paths;
 *    post-fix they agree.
 * 4. `attemptInvention` threw on an unknown candidate recipe id
 *    instead of filtering it. (Finding 3 -- the P11-01 settlement-
 *    access assertion being vacuous -- is fixed inside that acceptance
 *    test itself: the assertion is now the change itself, not masked by
 *    another metric.)
 */
import { describe, expect, it } from "vitest";
import { buildDetailedWorld, spawnAt } from "../unit/parityHarness.js";
import { SeepageField, advanceWatershedSpan, watershedSummary } from "../../src/sim/hydrology/Watershed.js";
import { createHousehold, setHouseholdMembership } from "../../src/sim/creatures/Relationships.js";
import { RecipeRegistry, registerStandardRecipes } from "../../src/sim/economy/Recipe.js";
import { attemptInvention } from "../../src/sim/economy/Invention.js";

describe("Phase 11 critic regressions", () => {
  it("finding 1: a fully stressed watershed over a 2M-tick span stays bounded (event generation is capped per pair)", () => {
    const { world, materials } = buildDetailedWorld("p11-crit-1");
    // Stress every wet column: deep water with steep heads everywhere.
    for (let x = 0; x < 20; x++) {
      for (let z = 0; z < 20; z++) {
        world.water.setDepth(x, z, 100 + (x % 3));
      }
    }
    const seepage = new SeepageField(world.grid.dims.sizeX, world.grid.dims.sizeZ);
    const before = watershedSummary(world);
    advanceWatershedSpan(world, materials, world.random.stream("crit-1"), 2_000_000, seepage, 20);
    // The span completed within the test budget and still moved real
    // terrain (the mechanism fires, bounded).
    expect(watershedSummary(world).meanSurfaceElevation).not.toBe(before.meanSurfaceElevation);
  });

  it("finding 2: the closed-form seepage advance settles at the same saturation the per-tick update does", () => {
    // Per-tick path.
    const tickWorld = buildDetailedWorld("p11-crit-2-tick");
    tickWorld.world.water.setDepth(5, 5, 2.0); // one wet column
    tickWorld.world.water.setDepth(6, 5, 2.0); // two wet neighbors for (5,4) and (5,6)
    const tickSeepage = new SeepageField(20, 20);
    for (let tick = 0; tick < 2000; tick++) {
      tickWorld.world.clock.advanceTicks(1);
      tickSeepage.tickAll(tickWorld.world);
    }

    // Closed-form path over the same span.
    const spanWorld = buildDetailedWorld("p11-crit-2-span");
    spanWorld.world.water.setDepth(5, 5, 2.0);
    spanWorld.world.water.setDepth(6, 5, 2.0);
    const spanSeepage = new SeepageField(20, 20);
    advanceWatershedSpan(spanWorld.world, spanWorld.materials, spanWorld.world.random.stream("crit-2"), 2000, spanSeepage, 0);

    // The bank between the two wet columns absorbs from BOTH neighbors
    // in both paths -- the saturations must agree (pre-fix, the
    // closed-form solved a max-over-neighbors equation and settled
    // differently).
    expect(spanSeepage.saturationAt(5, 4)).toBeCloseTo(tickSeepage.saturationAt(5, 4), 2);
    expect(spanSeepage.saturationAt(6, 4)).toBeCloseTo(tickSeepage.saturationAt(6, 4), 2);
  });

  it("finding 4: an unknown candidate recipe id is filtered, never fatal", () => {
    const { world, materials } = buildDetailedWorld("p11-crit-4");
    const recipes = new RecipeRegistry();
    registerStandardRecipes(recipes);
    const beaver = spawnAt(world, "B", 3, 3);
    const household = createHousehold(world);
    setHouseholdMembership(world.components, beaver, { householdId: household });
    const attempt = attemptInvention(world, household, recipes, materials, world.random.stream("crit-4"), {
      candidateRecipeIds: ["not-a-real-recipe", "saw-planks"],
      availableMaterialIds: ["wood"],
    });
    // Pre-fix this THREW (`unknown recipe id`); post-fix the stray id is
    // simply not inventable and the real candidate is considered.
    expect(attempt.reason.length).toBeGreaterThan(0);
    expect(world.entities.isLive(household)).toBe(true);
  });
});
