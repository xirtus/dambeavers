/**
 * Headless acceptance test for P0-08 — Event and causality log.
 *
 * Roadmap acceptance test (DAMN_BEAVERS_MASTER_ROADMAP.md, P0-08):
 *   "a test chain of five dependent events can be traversed backward from
 *   outcome to originating action."
 *
 * This models a plausible causal chain from this project's own domain (a
 * beaver felling a tree, eventually raising water behind a dam) purely to
 * make the scenario concrete -- P0-08 itself has no idea what a "tree" or
 * "dam" is; every field here is generic structured data (tick, eventType
 * string, subject/object entity ids, location, optional causeEventId).
 * None of the later systems (P1-08 tree cutting, P1-11 dam physics, ...)
 * exist yet, so entities here are created directly via EntityIdRegistry
 * rather than through any real gameplay system.
 */
import { describe, expect, it } from "vitest";
import { EntityIdRegistry } from "../../src/sim/core/EntityId.js";
import { EventLog } from "../../src/sim/history/EventLog.js";

describe("P0-08 acceptance: a chain of five dependent events traversed backward", () => {
  it("walks from the outcome back to the originating action, with every subject/object id resolving", () => {
    const entities = new EntityIdRegistry();
    const log = new EventLog(entities);

    const beaver = entities.create("beaver");
    const tree = entities.create("tree");
    const log1 = entities.create("log");
    const dam = entities.create("dam-segment");
    const pond = entities.create("water-body");

    // Action 1: a beaver fells a tree.
    const felled = log.record({
      tick: 100,
      eventType: "tree-felled",
      subjectIds: [beaver],
      objectIds: [tree],
      location: { x: 5, y: 2, z: 5 },
    });

    // Action 2: felling the tree produces a log -- caused by the felling.
    const created = log.record({
      tick: 101,
      eventType: "log-created",
      subjectIds: [beaver],
      objectIds: [log1],
      location: { x: 5, y: 2, z: 5 },
      causeEventId: felled,
    });

    // Action 3: the beaver hauls the log to the dam site -- caused by its creation.
    const hauled = log.record({
      tick: 140,
      eventType: "log-hauled",
      subjectIds: [beaver],
      objectIds: [log1],
      location: { x: 10, y: 1, z: 3 },
      causeEventId: created,
    });

    // Action 4: the log is placed into the dam -- caused by the haul.
    const placed = log.record({
      tick: 145,
      eventType: "log-placed-in-dam",
      subjectIds: [beaver],
      objectIds: [log1, dam],
      location: { x: 10, y: 1, z: 3 },
      causeEventId: hauled,
    });

    // Outcome: the pond's water level rises -- caused by the dam placement.
    const roseOutcome = log.record({
      tick: 146,
      eventType: "water-level-rose",
      objectIds: [pond, dam],
      location: { x: 10, y: 1, z: 3 },
      causeEventId: placed,
    });

    // -- traversed backward from outcome to originating action --
    const chain = log.traceBack(roseOutcome);
    expect(chain).toHaveLength(5);
    expect(chain.map((e) => e.id)).toEqual([roseOutcome, placed, hauled, created, felled]);
    expect(chain.map((e) => e.eventType)).toEqual([
      "water-level-rose",
      "log-placed-in-dam",
      "log-hauled",
      "log-created",
      "tree-felled",
    ]);

    // -- ticks strictly increase walking forward along the chain (root -> outcome) --
    const ticksRootToOutcome = [...chain].reverse().map((e) => e.tick);
    for (let i = 1; i < ticksRootToOutcome.length; i++) {
      expect(ticksRootToOutcome[i]!).toBeGreaterThanOrEqual(ticksRootToOutcome[i - 1]!);
    }

    // -- every subject/object id along the chain resolves to a live, correctly-kinded entity --
    for (const event of chain) {
      for (const id of [...event.subjectIds, ...event.objectIds]) {
        expect(entities.isKnown(id)).toBe(true);
      }
    }
    expect(entities.kindOf(chain[4]!.subjectIds[0]!)).toBe("beaver"); // originating action's subject
    expect(entities.kindOf(chain[0]!.objectIds[0]!)).toBe("water-body"); // outcome's object

    // -- the chain survives a real save/reload, with references intact --
    const restoredEntities = EntityIdRegistry.fromSnapshot(JSON.parse(JSON.stringify(entities.toSnapshot())));
    const restoredLog = EventLog.fromSnapshot(JSON.parse(JSON.stringify(log.toSnapshot())), restoredEntities);
    const restoredChain = restoredLog.traceBack(roseOutcome);
    expect(restoredChain.map((e) => e.id)).toEqual(chain.map((e) => e.id));
    expect(restoredChain.map((e) => e.eventType)).toEqual(chain.map((e) => e.eventType));
    expect(restoredEntities.kindOf(restoredChain[4]!.subjectIds[0]!)).toBe("beaver");
  });
});
