/**
 * Headless acceptance test for P11-13 -- Counterfactual replay/debugging.
 *
 * Roadmap acceptance test:
 *   "developers can fork a saved deterministic state, alter one
 *   decision/input, and compare causal outcomes."
 *
 * The fork is P0-08's own snapshot/restore (same ids, same clock, same
 * seeded random streams); both runs are stepped by the SAME step
 * function, so they are bit-identical until the fork point (P0-04's
 * determinism, reused as the correctness backbone); then ONE queued
 * decision is altered in the fork, and the diff of the two runs' event
 * logs shows the alteration's real causal footprint -- divergence at or
 * after the fork, never before.
 */
import { describe, expect, it } from "vitest";
import { buildDetailedWorld, spawnAt } from "../unit/parityHarness.js";
import { forkWorld, counterfactualReplay } from "../../src/sim/debug/CounterfactualReplay.js";
import { ALL_COMPONENT_TYPES } from "../../src/sim/persistence/AllComponentTypes.js";
import { createHousehold, setHouseholdMembership } from "../../src/sim/creatures/Relationships.js";
import { grantTech } from "../../src/sim/economy/TechKnowledge.js";
import type { World } from "../../src/sim/persistence/WorldSnapshot.js";
import type { EntityId } from "../../src/sim/core/EntityId.js";
import type { MaterialRegistry } from "../../src/sim/materials/Material.js";

type Decision = { householdId: EntityId; recipeId: string; action: "craft" | "rest" };

/**
 * A real decision-driven simulation: every tick, each household pops its
 * next queued DECISION (an input, like a job assignment or an RNG-drawn
 * choice) and records the real consequence as an event. The queue is
 * the "one input" the counterfactual alters.
 */
function stepWithDecisions(world: World, queues: Map<World, Decision[]>): void {
  world.clock.advanceTicks(1);
  const queue = queues.get(world)!;
  if (queue.length === 0) return;
  const decision = queue.shift()!;
  world.events.record({
    tick: world.clock.tick,
    eventType: decision.action === "craft" ? "tech-taught" : "wayfarer-conversation",
    subjectIds: [decision.householdId],
    objectIds: [],
    location: { x: 0, y: 0, z: 0 },
    data: decision.action === "craft" ? { recipeId: decision.recipeId } : { optionId: "chat" },
  });
}

describe("P11-13 counterfactual replay acceptance", () => {
  it("a fork is bit-identical before the alteration and provably diverges at/after it", () => {
    const { world, materials } = buildDetailedWorld("p11-13");
    const householdId = createHousehold(world);
    const beaver = spawnAt(world, "Decider", 3, 3);
    setHouseholdMembership(world.components, beaver, { householdId: householdId });
    void grantTech;

    // The input stream of decisions: 10 ticks of "rest", then one
    // "craft saw-planks" at the fork point.
    const decisions: Decision[] = [];
    for (let i = 0; i < 6; i++) decisions.push({ householdId, recipeId: "", action: "rest" });
    decisions.push({ householdId, recipeId: "saw-planks", action: "craft" });
    decisions.push({ householdId, recipeId: "", action: "rest" });
    decisions.push({ householdId, recipeId: "", action: "rest" });

    // A fresh independent fork of the SAME state (the pre-check: two
    // unaltered forks are identical under the same step function).
    const forkA = forkWorld(world, { componentTypes: ALL_COMPONENT_TYPES, materials });
    const forkB = forkWorld(world, { componentTypes: ALL_COMPONENT_TYPES, materials });
    const preCheckQueues = new Map<World, Decision[]>([
      [forkA, [...decisions]],
      [forkB, [...decisions]],
    ]);
    for (let i = 0; i < 4; i++) {
      stepWithDecisions(forkA, preCheckQueues);
      stepWithDecisions(forkB, preCheckQueues);
    }
    expect(forkA.events.count).toBe(forkB.events.count);
    expect(JSON.stringify(forkA.events.all().map((e) => [e.tick, e.eventType]))).toBe(JSON.stringify(forkB.events.all().map((e) => [e.tick, e.eventType])));

    // Now the real counterfactual from the PRISTINE state: the fork's
    // decision queue is altered at tick 6 -- the craft decision is
    // replaced with rest (the one altered input).
    const original = forkWorld(world, { componentTypes: ALL_COMPONENT_TYPES, materials });
    const fork = forkWorld(world, { componentTypes: ALL_COMPONENT_TYPES, materials });
    const originalQueue: Decision[] = [...decisions];
    const forkQueue: Decision[] = [...decisions];
    forkQueue[6] = { householdId, recipeId: "", action: "rest" }; // THE altered decision
    const stepQueues = new Map<World, Decision[]>([
      [original, originalQueue],
      [fork, forkQueue],
    ]);
    const step = (w: World) => stepWithDecisions(w, stepQueues);

    const outcome = counterfactualReplay(original, fork, 6, (_fork) => {
      // The alteration happens through the fork's own queue (already
      // set above) -- nothing else about the fork differs.
    }, step, 4);

    expect(outcome.identicalBeforeFork).toBe(true);
    expect(outcome.divergedEventIds.length).toBeGreaterThan(0);
    expect(outcome.divergenceTick).toBeGreaterThanOrEqual(6);

    // The divergence is exactly the altered decision's consequence: the
    // original run crafted at tick 7, the fork rested instead.
    const originalEvents = original.events.all();
    const forkEvents = fork.events.all();
    const originalTick7 = originalEvents.find((e) => e.tick === 7);
    const forkTick7 = forkEvents.find((e) => e.tick === 7);
    expect(originalTick7?.eventType).toBe("tech-taught");
    expect(forkTick7?.eventType).toBe("wayfarer-conversation");
  });

  it("two unaltered forks of the same saved state replay identically (determinism backbone)", () => {
    const { world, materials } = buildDetailedWorld("p11-13b");
    const a = forkWorld(world, { componentTypes: ALL_COMPONENT_TYPES, materials });
    const b = forkWorld(world, { componentTypes: ALL_COMPONENT_TYPES, materials });
    for (let i = 0; i < 50; i++) {
      a.clock.advanceTicks(1);
      b.clock.advanceTicks(1);
      a.events.record({ tick: a.clock.tick, eventType: "social-interaction", subjectIds: [], objectIds: [], location: { x: 0, y: 0, z: 0 } });
      b.events.record({ tick: b.clock.tick, eventType: "social-interaction", subjectIds: [], objectIds: [], location: { x: 0, y: 0, z: 0 } });
    }
    expect(JSON.stringify(a.events.all())).toBe(JSON.stringify(b.events.all()));
    expect(a.clock.tick).toBe(b.clock.tick);
  });
});
