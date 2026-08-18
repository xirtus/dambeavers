/**
 * Headless acceptance test for P11-08 -- Cultural evolution.
 *
 * Roadmap acceptance test:
 *   "norms, symbols, practices, and narratives drift measurably across
 *   separated populations over centuries."
 *
 * Norm profiles are no longer frozen founding facts: every generational
 * turnover inherits the parent culture WITH one real random-walk drift
 * step (`inheritNormsWithDrift`), and each generation has a real chance
 * to drop a held belief (`driftBeliefHoldings` -- narratives fade).
 * Two separated household lines run through many generations with their
 * own streams genuinely diverge -- a statistical consequence of the
 * walk, asserted as a distributional statement rather than one exact
 * value.
 */
import { describe, expect, it } from "vitest";
import { buildDetailedWorld, spawnAt } from "../unit/parityHarness.js";
import { createHousehold, setHouseholdMembership } from "../../src/sim/creatures/Relationships.js";
import { generateNorms, inheritNormsWithDrift, getNormProfile, setNormProfile, evaluateBehavior, NORM_DIMENSIONS } from "../../src/sim/creatures/Norms.js";
import { formBelief, driftBeliefHoldings } from "../../src/sim/creatures/Belief.js";
import { RandomStreams } from "../../src/sim/core/Random.js";

function profileDistance(a: Record<string, number>, b: Record<string, number>): number {
  return Math.sqrt(NORM_DIMENSIONS.reduce((sum, dim) => sum + Math.pow(a[dim] - b[dim], 2), 0));
}

describe("P11-08 cultural evolution acceptance", () => {
  it("two separated lines genuinely diverge from identical starting profiles", () => {
    const { world } = buildDetailedWorld("p11-08c");
    const founderA = spawnAt(world, "FA", 3, 3);
    const founderB = spawnAt(world, "FB", 3, 5);
    const lineA = createHousehold(world);
    const lineB = createHousehold(world);
    setHouseholdMembership(world.components, founderA, { householdId: lineA });
    setHouseholdMembership(world.components, founderB, { householdId: lineB });
    generateNorms(world, lineA, new RandomStreams(83001).stream("a"));
    // Line B starts from line A's EXACT profile -- a true identical
    // starting point, so any later separation is the walk's own doing.
    const shared = getNormProfile(world.components, lineA)!;
    setNormProfile(world.components, lineB, { values: { ...shared.values }, generatedTick: shared.generatedTick });

    let currentA = lineA;
    let currentB = lineB;
    for (let generation = 0; generation < 120; generation++) {
      const childA = createHousehold(world);
      const childB = createHousehold(world);
      inheritNormsWithDrift(world, currentA, childA, new RandomStreams(84001 + generation).stream("a"));
      inheritNormsWithDrift(world, currentB, childB, new RandomStreams(85001 + generation).stream("b"));
      currentA = childA;
      currentB = childB;
    }
    const finalA = getNormProfile(world.components, currentA)!;
    const finalB = getNormProfile(world.components, currentB)!;
    const divergence = profileDistance(finalA.values, finalB.values);
    // 120 independent small random-walk steps per dimension: the two
    // lines' expected separation is several times the per-step scale --
    // assert a real, measurable divergence (not an exact value).
    expect(divergence).toBeGreaterThan(0.15);
    // Each line also moved away from its own founder -- culture
    // evolves, it doesn't just differ at the start.
    expect(profileDistance(finalA.values, shared.values)).toBeGreaterThan(0.05);
    expect(profileDistance(finalB.values, shared.values)).toBeGreaterThan(0.05);
  });

  it("culture transmits with drift and narratives fade across generations", () => {
    const { world } = buildDetailedWorld("p11-08b");
    const founder = spawnAt(world, "F", 3, 3);
    const household = createHousehold(world);
    setHouseholdMembership(world.components, founder, { householdId: household });
    generateNorms(world, household, new RandomStreams(81001).stream("n"));
    const initial = getNormProfile(world.components, household)!;

    // Generational turnover: each generation inherits the previous
    // profile with one drift step -- the child line genuinely moves
    // away from the founder.
    let current = initial;
    let currentHousehold = household;
    for (let generation = 0; generation < 60; generation++) {
      const child = createHousehold(world);
      current = inheritNormsWithDrift(world, currentHousehold, child, new RandomStreams(81002 + generation).stream("g"));
      currentHousehold = child;
    }
    const finalProfile = current;
    expect(profileDistance(finalProfile.values, initial.values)).toBeGreaterThan(0.1);
    // The walk genuinely moved values (not a frozen founding fact), and
    // they stayed valid.
    for (const dim of NORM_DIMENSIONS) {
      expect(finalProfile.values[dim]).toBeGreaterThanOrEqual(0);
      expect(finalProfile.values[dim]).toBeLessThanOrEqual(1);
    }
    // Behavior evaluation genuinely differs between founder and late
    // culture for the same observed magnitude -- the roadmap's
    // "practices drift" clause, through the existing P5-07 formula.
    const magnitude = 0.5;
    expect(evaluateBehavior(initial, "industriousness", magnitude)).not.toBe(evaluateBehavior(finalProfile, "industriousness", magnitude));
  });

  it("narratives genuinely fade: beliefs drop across generational turnover", () => {
    const { world } = buildDetailedWorld("p11-08d");
    const founder = spawnAt(world, "F", 3, 3);
    const household = createHousehold(world);
    setHouseholdMembership(world.components, founder, { householdId: household });
    const eventId = world.events.record({ tick: world.clock.tick, eventType: "world-disaster", subjectIds: [founder], objectIds: [], location: { x: 3, y: 3, z: 3 } });
    const beliefId = formBelief(world, eventId, household);
    expect(world.entities.isLive(beliefId)).toBe(true);

    // Turn the generations over long enough that the drop chance
    // (0.15/turnover) must eventually fire; the belief's holder list
    // shrinks as lineages forget.
    let dropped = false;
    for (let generation = 0; generation < 80; generation++) {
      driftBeliefHoldings(world, household, new RandomStreams(87001 + generation).stream("b"));
      const belief = world.components.get(beliefId, world.components.allTypes().find((t) => t.name === "belief")!);
      if (belief === undefined || (belief as { heldByHouseholdIds: number[] }).heldByHouseholdIds.length === 0) {
        dropped = true;
        break;
      }
    }
    expect(dropped).toBe(true);
  });
});
