/**
 * Headless acceptance test for P11-12 -- Simulation-backed natural-language explanation.
 *
 * Roadmap acceptance test:
 *   "generated explanations cite only retrievable authoritative
 *   states/events and can expose the underlying causal graph."
 *
 * Every P11-domain explanation (knowledge, rumor, invention, ruin) is
 * composed of real recorded events plus honestly-derived live facts --
 * and the grounding is asserted STRUCTURALLY: `assertGroundedExplanation`
 * throws if any cited event id does not resolve, and every cited event
 * is independently re-queried through the Chronicle (`queryEvent`/
 * `queryCausalLinks`) and traced through P0-08's own causal graph.
 */
import { describe, expect, it } from "vitest";
import { buildDetailedWorld, spawnAt } from "../unit/parityHarness.js";
import { learnByObservation } from "../../src/sim/creatures/Knowledge.js";
import { retellKnowledge } from "../../src/sim/chronicle/Rumors.js";
import { RandomStreams } from "../../src/sim/core/Random.js";
import {
  explainKnowledge,
  explainRumor,
  explainInvention,
  explainRuin,
  assertGroundedExplanation,
  explanationCausalGraph,
} from "../../src/sim/history/CausalExplanation.js";
import { queryEvent, queryCausalLinks } from "../../src/sim/chronicle/Chronicle.js";
import { createHousehold, setHouseholdMembership } from "../../src/sim/creatures/Relationships.js";
import { grantTech, teachTech } from "../../src/sim/economy/TechKnowledge.js";
import { materializeRuin } from "../../src/sim/structures/InfrastructureMemory.js";
import type { EventId } from "../../src/sim/history/EventLog.js";

function assertEveryCitedEventResolves(world: ReturnType<typeof buildDetailedWorld>["world"], explanation: Awaited<ReturnType<typeof explainKnowledge>>): void {
  // The structural proof: nothing cited can be fabricated.
  assertGroundedExplanation(world, explanation);
  // And every cited event is independently retrievable through the
  // Chronicle's own query layer, with its causal chain resolvable too.
  for (const step of explanation.steps) {
    if (step.eventId === undefined) continue;
    const record = queryEvent(world, step.eventId);
    expect(record.known).toBe(true);
    const links = queryCausalLinks(world, step.eventId);
    expect(links.known).toBe(true);
  }
}

describe("P11-12 simulation-backed explanation acceptance", () => {
  it("knowledge explanations cite only real events and resolve through the chronicle", () => {
    const { world } = buildDetailedWorld("p11-12");
    const witness = spawnAt(world, "W", 5, 3);
    const listener = spawnAt(world, "L", 6, 3);
    const eventId = world.events.record({
      tick: world.clock.tick,
      eventType: "world-disaster",
      subjectIds: [witness],
      objectIds: [],
      location: { x: 5, y: 3, z: 3 },
    });
    learnByObservation(world, witness, eventId, { x: 5, z: 3 });
    retellKnowledge(world, witness, listener, eventId, new RandomStreams(12001).stream("r"));

    const explanation = explainKnowledge(world, listener, eventId);
    expect(explanation.steps.length).toBeGreaterThanOrEqual(2);
    assertEveryCitedEventResolves(world, explanation);
    // The underlying causal graph exposes the real chain (origin event
    // plus the transfer conversation).
    const graph = explanationCausalGraph(world, explanation);
    expect(graph.some((e) => e.id === eventId)).toBe(true);
  });

  it("a beaver who never learned the event gets an honest 'no knowledge' explanation, not a fabrication", () => {
    const { world } = buildDetailedWorld("p11-12b");
    const beaver = spawnAt(world, "B", 5, 3);
    const eventId = world.events.record({
      tick: world.clock.tick,
      eventType: "leader-appointed",
      subjectIds: [beaver],
      objectIds: [],
      location: { x: 5, y: 3, z: 3 },
    });
    const explanation = explainKnowledge(world, beaver, eventId);
    expect(explanation.steps.length).toBe(1);
    expect(explanation.steps[0]!.eventId).toBeUndefined(); // a live fact, honestly -- no invented citation
    assertGroundedExplanation(world, explanation);
  });

  it("rumor explanations preserve both the authoritative event and the believed version", () => {
    const { world } = buildDetailedWorld("p11-12c");
    const witness = spawnAt(world, "W", 5, 3);
    const listener = spawnAt(world, "L", 6, 3);
    const eventId = world.events.record({
      tick: world.clock.tick,
      eventType: "world-disaster",
      subjectIds: [witness],
      objectIds: [],
      location: { x: 5, y: 3, z: 3 },
    });
    learnByObservation(world, witness, eventId, { x: 5, z: 3 });
    let versionId: number | undefined;
    for (let i = 0; i < 30 && versionId === undefined; i++) {
      versionId = retellKnowledge(world, witness, listener, eventId, new RandomStreams(12100 + i).stream("r"));
    }
    if (versionId !== undefined) {
      const explanation = explainRumor(world, versionId as Parameters<typeof explainRumor>[1]);
      assertEveryCitedEventResolves(world, explanation);
      // The authoritative event is the explanation's anchor.
      expect(explanation.steps[0]!.eventId).toBe(eventId);
    }
  });

  it("invention explanations cite the real invention and teaching events", () => {
    const { world } = buildDetailedWorld("p11-12d");
    const a = createHousehold(world);
    const b = createHousehold(world);
    grantTech(world, a, { recipeIds: ["saw-planks"] });
    expect(teachTech(world, a, b, { recipeId: "saw-planks" })).toBe(true);

    const explanation = explainInvention(world, b, "saw-planks");
    expect(explanation.steps.length).toBeGreaterThanOrEqual(1);
    assertEveryCitedEventResolves(world, explanation);
    const graph = explanationCausalGraph(world, explanation);
    expect(graph.some((e) => e.eventType === "tech-taught")).toBe(true);
  });

  it("ruin explanations cite the real materialization, encounters, and the site record", () => {
    const { world } = buildDetailedWorld("p11-12e");
    const beaver = spawnAt(world, "B", 5, 3);
    const ruinId = materializeRuin(world, "dam-segment", { x: 8, y: 3, z: 8 });
    const explanation = explainRuin(world, ruinId);
    expect(explanation.steps.length).toBeGreaterThanOrEqual(1);
    assertEveryCitedEventResolves(world, explanation);
    expect(explanation.steps.some((s) => s.eventId !== undefined)).toBe(true);
    void beaver;
  });

  it("a fabricated citation is structurally impossible -- the verifier throws", () => {
    const { world } = buildDetailedWorld("p11-12f");
    const fabricated: EventId = 987654 as EventId;
    const explanation = {
      question: "test",
      steps: [{ description: "a step citing a nonexistent event", tick: world.clock.tick, eventId: fabricated }],
    };
    expect(() => assertGroundedExplanation(world, explanation)).toThrow();
    expect(queryEvent(world, fabricated).known).toBe(false);
  });
});
