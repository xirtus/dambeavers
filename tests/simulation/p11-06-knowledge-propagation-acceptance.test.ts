/**
 * Headless acceptance test for P11-06 -- Knowledge propagation.
 *
 * Roadmap acceptance test:
 *   "an unwitnessed event is not globally known; knowledge spreads
 *   through observation, conversation, records, or evidence."
 *
 * Knowledge is a real per-beaver ledger (who knows what, how they
 * learned it). Observation is proximity-gated against the event's own
 * recorded location; conversation requires the speaker to genuinely
 * know the event; records and evidence are explicit acts, never
 * automatic. A distant beaver knows nothing until a witness travels to
 * them and tells them -- the literal sentence, satisfied structurally.
 */
import { describe, expect, it } from "vitest";
import { buildDetailedWorld, spawnAt } from "../unit/parityHarness.js";
import {
  learnByObservation,
  learnByConversation,
  learnFromRecords,
  learnFromEvidence,
  knowsEvent,
  knowledgeHolders,
  getKnowledge,
} from "../../src/sim/creatures/Knowledge.js";
import { conductConversation, conversationOptions } from "../../src/sim/wayfarer/Conversation.js";

describe("P11-06 knowledge propagation acceptance", () => {
  it("an unwitnessed event is not globally known until knowledge spreads", () => {
    const { world } = buildDetailedWorld("p11-06");
    const witness = spawnAt(world, "Witness", 5, 3);
    const distant = spawnAt(world, "Distant", 15, 12);

    // A real event happens far from the distant beaver.
    const eventId = world.events.record({
      tick: world.clock.tick,
      eventType: "rule-violated",
      subjectIds: [witness],
      objectIds: [],
      location: { x: 5, y: 3, z: 3 },
    });

    // Unwitnessed = unknown: nobody learned anything automatically.
    expect(knowsEvent(world, witness, eventId)).toBe(false);
    expect(knowsEvent(world, distant, eventId)).toBe(false);
    expect(knowledgeHolders(world, eventId)).toHaveLength(0);

    // The witness observes it (they were there).
    expect(learnByObservation(world, witness, eventId, { x: 5, z: 3 })).toBe(true);
    expect(knowsEvent(world, witness, eventId)).toBe(true);
    // The distant beaver, who was NOT there, still doesn't know.
    expect(knowsEvent(world, distant, eventId)).toBe(false);

    // Knowledge spreads when the witness travels to them and tells
    // them -- a real conversation between adjacent beavers.
    expect(learnByConversation(world, witness, distant, eventId)).toBe(false); // too far to converse
    expect(knowsEvent(world, distant, eventId)).toBe(false);
    // The witness moves next to the distant beaver.
    world.grid.setEntityPosition(witness, 15, 3, 11);
    expect(learnByConversation(world, witness, distant, eventId)).toBe(true);
    expect(knowsEvent(world, distant, eventId)).toBe(true);
    expect(getKnowledge(world.components, distant)!.entries.find((e) => e.eventId === eventId)!.source).toBe("conversation");

    // A third beaver who was never told still doesn't know -- knowledge
    // is per-beaver, never global.
    const stranger = spawnAt(world, "Stranger", 3, 17);
    expect(knowsEvent(world, stranger, eventId)).toBe(false);
  });

  it("observation is genuinely gated on proximity to the event's recorded location", () => {
    const { world } = buildDetailedWorld("p11-06b");
    const beaver = spawnAt(world, "B", 5, 3);
    const eventId = world.events.record({
      tick: world.clock.tick,
      eventType: "wound-inflicted",
      subjectIds: [beaver],
      objectIds: [],
      location: { x: 18, y: 3, z: 18 },
    });
    // The beaver is nowhere near the event's own location.
    expect(learnByObservation(world, beaver, eventId, { x: 5, z: 3 })).toBe(false);
    expect(knowsEvent(world, beaver, eventId)).toBe(false);
    // From right next to it, the same call succeeds.
    expect(learnByObservation(world, beaver, eventId, { x: 18, z: 18 })).toBe(true);
  });

  it("records and evidence are real routes too, and they never fabricate knowledge of nonexistent events", () => {
    const { world } = buildDetailedWorld("p11-06c");
    const beaver = spawnAt(world, "B", 5, 3);
    const eventId = world.events.record({
      tick: world.clock.tick,
      eventType: "wayfarer-conversation",
      subjectIds: [beaver],
      objectIds: [],
      location: { x: 5, y: 3, z: 3 },
    });
    // Records: consulting the chronicle is an explicit act.
    expect(learnFromRecords(world, beaver, eventId)).toBe(true);
    expect(getKnowledge(world.components, beaver)!.entries.find((e) => e.eventId === eventId)!.source).toBe("records");
    // Fabrication is impossible: knowledge must reference a real event.
    expect(() => learnFromRecords(world, beaver, 99999)).toThrow();
  });

  it("evidence requires a live physical trace of the event within reach", () => {
    const { world } = buildDetailedWorld("p11-06d");
    const beaver = spawnAt(world, "B", 5, 3);
    // A real corpse is the evidence (the event's objectIds must include
    // a live entity the beaver can actually reach).
    const corpse = world.entities.create("corpse");
    world.grid.setEntityPosition(corpse, 6, 3, 3);
    const eventId = world.events.record({
      tick: world.clock.tick,
      eventType: "trauma-death",
      subjectIds: [],
      objectIds: [corpse],
      location: { x: 6, y: 3, z: 3 },
    });
    expect(learnFromEvidence(world, beaver, eventId)).toBe(true);
    expect(getKnowledge(world.components, beaver)!.entries.find((e) => e.eventId === eventId)!.source).toBe("evidence");
  });

  it("the conversation UI path really grants the listener knowledge", () => {
    const { world } = buildDetailedWorld("p11-06e");
    const speaker = spawnAt(world, "Speaker", 5, 3);
    const listener = spawnAt(world, "Listener", 6, 3);
    const eventId = world.events.record({
      tick: world.clock.tick,
      eventType: "leader-appointed",
      subjectIds: [speaker],
      objectIds: [],
      location: { x: 5, y: 3, z: 3 },
    });
    learnByObservation(world, speaker, eventId, { x: 5, z: 3 });
    expect(knowsEvent(world, listener, eventId)).toBe(false);

    const option = conversationOptions(world, speaker, listener).find((o) => o.id === `share-memory-${eventId}`);
    expect(option).toBeDefined();
    const result = conductConversation(world, speaker, listener, option!.id);
    expect(result.ok).toBe(true);
    expect(knowsEvent(world, listener, eventId)).toBe(true);
    expect(getKnowledge(world.components, listener)!.entries.find((e) => e.eventId === eventId)!.source).toBe("conversation");
  });
});
