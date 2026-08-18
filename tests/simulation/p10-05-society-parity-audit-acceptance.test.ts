/**
 * Headless acceptance test for P10-05 -- Society parity audit.
 *
 * Roadmap acceptance test: "social consequences can be traced to
 * persistent relationships, institutions, knowledge, and events."
 */
import { describe, expect, it } from "vitest";
import { parityRowsByDomain } from "../../src/sim/parity/ParityMatrix.js";
import { buildDetailedWorld } from "../unit/parityHarness.js";
import { spawnBeaver } from "../../src/sim/creatures/Beaver.js";
import { setGood } from "../../src/sim/economy/Good.js";
import { setOwner } from "../../src/sim/creatures/Ownership.js";
import { reputationOf } from "../../src/sim/creatures/Reputation.js";
import { isProhibited } from "../../src/sim/creatures/Law.js";
import { fileAccusation, renderJudgment, applyPunishment } from "../../src/sim/politics/Justice.js";
import { RegionMap } from "../../src/sim/region/RegionMap.js";
import { setRelationshipWith, relationshipWith } from "../../src/sim/creatures/Relationships.js";
import { recordMemory, getMemories } from "../../src/sim/creatures/Memory.js";

describe("P10-05 -- Society parity audit", () => {
  it("every society-domain row is marked with a verdict and written rationale", () => {
    const rows = parityRowsByDomain("society");
    expect(rows.length).toBeGreaterThanOrEqual(40);
    for (const row of rows) {
      expect(["PASS", "ADAPTED", "EXCEEDED", "OUT_OF_SCOPE"]).toContain(row.verdict);
      expect(row.rationale.trim().length).toBeGreaterThan(0);
    }
  });

  it("social consequences trace to persistent relationships, institutions, knowledge, and events", () => {
    const { world } = buildDetailedWorld("p10-05");
    const thief = spawnBeaver(world, { name: "Thief", position: { x: 4, y: 3, z: 4 } });
    const victim = spawnBeaver(world, { name: "Victim", position: { x: 6, y: 3, z: 6 } });
    const witness = spawnBeaver(world, { name: "Witness", position: { x: 5, y: 3, z: 5 } });
    const judge = spawnBeaver(world, { name: "Judge", position: { x: 7, y: 3, z: 7 } });

    // A real relationship, a real violation, a real knowledge record.
    setRelationshipWith(world.components, witness, { withId: victim, kin: "sibling", familiarity: 0.9, affinity: 0.9 });
    const amulet = world.entities.create("good");
    world.grid.setEntityPosition(amulet, 5, 3, 5);
    setGood(world.components, amulet, { goodKind: "artwork", materialId: "wood", massKg: 2 });
    setOwner(world.components, amulet, { ownerType: "personal", ownerId: victim });
    const violation = isProhibited(world, thief, amulet)!;
    const reputationBefore = reputationOf(world, thief);

    // The whole social pipeline: violation -> accusation -> judgment -> punishment.
    const accusationId = fileAccusation(world, witness, violation, [witness], amulet);
    const violationEvent = world.events.eventsOfType("rule-violated")[0]!;
    renderJudgment(world, accusationId, judge);
    applyPunishment(world, new RegionMap(16, 16), accusationId, "fine", victim);

    // 1. REPUTATION traces to the recorded violation event.
    expect(reputationOf(world, thief)).toBeLessThan(reputationBefore);
    expect(world.events.eventsOfType("rule-violated").some((e) => e.subjectIds.includes(thief) && e.objectIds.includes(amulet))).toBe(true);

    // 2. THE INSTITUTION (the accusation) persists with its real evidence.
    expect(world.events.eventsOfType("accusation-filed").length).toBe(1);
    expect(world.events.eventsOfType("judgment-rendered").length).toBe(1);
    expect(world.events.eventsOfType("punishment-applied").length).toBe(1);

    // 3. KNOWLEDGE: the witness genuinely remembers the violation event.
    recordMemory(world, witness, violationEvent.id, -0.5);
    expect(getMemories(world.components, witness)!.entries.some((m) => m.eventId === violationEvent.id)).toBe(true);

    // 4. RELATIONSHIPS persist through it all.
    expect(relationshipWith(world.components, witness, victim)?.kin).toBe("sibling");

    // 5. Every step is causally chained (the persistent trace).
    const filed = world.events.eventsOfType("accusation-filed")[0]!;
    expect(filed.causeEventId).toBe(violationEvent.id);
  });
});
