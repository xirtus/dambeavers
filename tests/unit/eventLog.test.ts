import { describe, expect, it } from "vitest";
import { EventLog, type EventId } from "../../src/sim/history/EventLog.js";
import { EntityIdRegistry } from "../../src/sim/core/EntityId.js";

const ORIGIN = { x: 0, y: 0, z: 0 };

describe("EventLog.record", () => {
  it("records an event and returns a permanent id", () => {
    const entities = new EntityIdRegistry();
    const log = new EventLog(entities);
    const beaver = entities.create("beaver");

    const id = log.record({ tick: 0, eventType: "spawned", subjectIds: [beaver], location: ORIGIN });

    expect(log.has(id)).toBe(true);
    expect(log.get(id)).toMatchObject({ tick: 0, eventType: "spawned", subjectIds: [beaver] });
  });

  it("never reuses an id across many records", () => {
    const entities = new EntityIdRegistry();
    const log = new EventLog(entities);
    const ids = new Set<EventId>();
    for (let i = 0; i < 500; i++) {
      ids.add(log.record({ tick: i, eventType: "tick-event", location: ORIGIN }));
    }
    expect(ids.size).toBe(500);
  });

  it("defaults subjectIds/objectIds to empty arrays", () => {
    const entities = new EntityIdRegistry();
    const log = new EventLog(entities);
    const id = log.record({ tick: 0, eventType: "weather-changed", location: ORIGIN });
    expect(log.get(id).subjectIds).toEqual([]);
    expect(log.get(id).objectIds).toEqual([]);
  });

  it("rejects a non-integer or negative tick", () => {
    const entities = new EntityIdRegistry();
    const log = new EventLog(entities);
    expect(() => log.record({ tick: -1, eventType: "x", location: ORIGIN })).toThrow(RangeError);
    expect(() => log.record({ tick: 1.5, eventType: "x", location: ORIGIN })).toThrow(RangeError);
  });

  it("rejects a malformed event type", () => {
    const entities = new EntityIdRegistry();
    const log = new EventLog(entities);
    expect(() => log.record({ tick: 0, eventType: "Bad Type", location: ORIGIN })).toThrow(RangeError);
    expect(() => log.record({ tick: 0, eventType: "", location: ORIGIN })).toThrow(RangeError);
  });

  it("rejects a non-integer location coordinate", () => {
    const entities = new EntityIdRegistry();
    const log = new EventLog(entities);
    expect(() => log.record({ tick: 0, eventType: "x", location: { x: 1.5, y: 0, z: 0 } })).toThrow(RangeError);
  });

  it("rejects a subject/object id unknown to the registry", () => {
    const entities = new EntityIdRegistry();
    const log = new EventLog(entities);
    const foreignRegistry = new EntityIdRegistry();
    const foreignId = foreignRegistry.create("beaver");
    expect(() => log.record({ tick: 0, eventType: "x", subjectIds: [foreignId], location: ORIGIN })).toThrow(
      RangeError,
    );
  });

  it("allows referencing a destroyed (but known) entity -- historical references must keep resolving", () => {
    const entities = new EntityIdRegistry();
    const log = new EventLog(entities);
    const beaver = entities.create("beaver");
    entities.destroy(beaver);
    expect(() => log.record({ tick: 0, eventType: "died", subjectIds: [beaver], location: ORIGIN })).not.toThrow();
  });

  it("rejects a causeEventId that was never recorded in this log", () => {
    const entities = new EntityIdRegistry();
    const log = new EventLog(entities);
    expect(() =>
      log.record({ tick: 0, eventType: "x", location: ORIGIN, causeEventId: 999 as EventId }),
    ).toThrow(RangeError);
  });

  it("accepts a valid causeEventId linking to an earlier event", () => {
    const entities = new EntityIdRegistry();
    const log = new EventLog(entities);
    const first = log.record({ tick: 0, eventType: "root", location: ORIGIN });
    const second = log.record({ tick: 1, eventType: "effect", location: ORIGIN, causeEventId: first });
    expect(log.get(second).causeEventId).toBe(first);
  });

  it("accepts a cause and effect at the identical tick (same-tick cascade)", () => {
    const entities = new EntityIdRegistry();
    const log = new EventLog(entities);
    const first = log.record({ tick: 5, eventType: "root", location: ORIGIN });
    expect(() => log.record({ tick: 5, eventType: "effect", location: ORIGIN, causeEventId: first })).not.toThrow();
  });

  it("rejects a cause recorded at a later tick than its claimed effect", () => {
    const entities = new EntityIdRegistry();
    const log = new EventLog(entities);
    const cause = log.record({ tick: 500, eventType: "cause-event", location: ORIGIN });
    expect(() =>
      log.record({ tick: 10, eventType: "effect-event", location: ORIGIN, causeEventId: cause }),
    ).toThrow(RangeError);
  });
});

describe("EventLog.traceBack", () => {
  it("walks a chain of five dependent events backward from outcome to originating action", () => {
    const entities = new EntityIdRegistry();
    const log = new EventLog(entities);
    const beaver = entities.create("beaver");

    const felled = log.record({ tick: 0, eventType: "tree-felled", subjectIds: [beaver], location: ORIGIN });
    const created = log.record({ tick: 1, eventType: "log-created", location: ORIGIN, causeEventId: felled });
    const hauled = log.record({ tick: 2, eventType: "log-hauled", location: ORIGIN, causeEventId: created });
    const placed = log.record({ tick: 3, eventType: "log-placed", location: ORIGIN, causeEventId: hauled });
    const flooded = log.record({ tick: 4, eventType: "water-rose", location: ORIGIN, causeEventId: placed });

    const chain = log.traceBack(flooded);
    expect(chain.map((e) => e.id)).toEqual([flooded, placed, hauled, created, felled]);
    expect(chain.map((e) => e.eventType)).toEqual([
      "water-rose",
      "log-placed",
      "log-hauled",
      "log-created",
      "tree-felled",
    ]);
  });

  it("returns a single-element chain for a root event with no cause", () => {
    const entities = new EntityIdRegistry();
    const log = new EventLog(entities);
    const id = log.record({ tick: 0, eventType: "root", location: ORIGIN });
    expect(log.traceBack(id).map((e) => e.id)).toEqual([id]);
  });

  it("throws for an unknown event id", () => {
    const entities = new EntityIdRegistry();
    const log = new EventLog(entities);
    expect(() => log.traceBack(999 as EventId)).toThrow(RangeError);
  });
});

describe("EventLog debug observability", () => {
  it("reports event counts by type", () => {
    const entities = new EntityIdRegistry();
    const log = new EventLog(entities);
    log.record({ tick: 0, eventType: "a", location: ORIGIN });
    log.record({ tick: 1, eventType: "a", location: ORIGIN });
    log.record({ tick: 2, eventType: "b", location: ORIGIN });

    const state = log.getDebugState();
    expect(state.eventCount).toBe(3);
    expect(state.eventTypeCounts).toEqual([
      { eventType: "a", count: 2 },
      { eventType: "b", count: 1 },
    ]);
  });
});

describe("EventLog.eventsInvolving", () => {
  it("finds events where the entity is a subject", () => {
    const entities = new EntityIdRegistry();
    const log = new EventLog(entities);
    const beaver = entities.create("beaver");
    const other = entities.create("beaver");
    const e1 = log.record({ tick: 0, eventType: "spawned", subjectIds: [beaver], location: ORIGIN });
    log.record({ tick: 1, eventType: "spawned", subjectIds: [other], location: ORIGIN });

    expect(log.eventsInvolving(beaver).map((e) => e.id)).toEqual([e1]);
  });

  it("finds events where the entity is an object", () => {
    const entities = new EntityIdRegistry();
    const log = new EventLog(entities);
    const beaver = entities.create("beaver");
    const tree = entities.create("tree");
    const e1 = log.record({ tick: 0, eventType: "tree-felled", subjectIds: [beaver], objectIds: [tree], location: ORIGIN });

    expect(log.eventsInvolving(tree).map((e) => e.id)).toEqual([e1]);
  });

  it("returns events oldest first, and includes an entity appearing in multiple events", () => {
    const entities = new EntityIdRegistry();
    const log = new EventLog(entities);
    const beaver = entities.create("beaver");
    const e1 = log.record({ tick: 0, eventType: "spawned", subjectIds: [beaver], location: ORIGIN });
    const e2 = log.record({ tick: 5, eventType: "moved", subjectIds: [beaver], location: ORIGIN });

    expect(log.eventsInvolving(beaver).map((e) => e.id)).toEqual([e1, e2]);
  });

  it("returns an empty array for an entity that appears in no event", () => {
    const entities = new EntityIdRegistry();
    const log = new EventLog(entities);
    const beaver = entities.create("beaver");
    expect(log.eventsInvolving(beaver)).toEqual([]);
  });
});

describe("EventLog.eventsOfType", () => {
  it("finds matching events oldest first", () => {
    const entities = new EntityIdRegistry();
    const log = new EventLog(entities);
    const a = log.record({ tick: 0, eventType: "dam-segment-applied", location: ORIGIN });
    log.record({ tick: 1, eventType: "other-event", location: ORIGIN });
    const b = log.record({ tick: 2, eventType: "dam-segment-applied", location: ORIGIN });

    expect(log.eventsOfType("dam-segment-applied").map((e) => e.id)).toEqual([a, b]);
  });

  it("keeps historical type matches after involved entities are destroyed", () => {
    const entities = new EntityIdRegistry();
    const log = new EventLog(entities);
    const dam = entities.create("dam-segment");
    const event = log.record({ tick: 0, eventType: "dam-segment-applied", subjectIds: [dam], location: ORIGIN });
    entities.destroy(dam);

    expect(log.eventsOfType("dam-segment-applied").map((e) => e.id)).toEqual([event]);
  });

  it("validates the queried event type", () => {
    const entities = new EntityIdRegistry();
    const log = new EventLog(entities);
    expect(() => log.eventsOfType("Bad Type")).toThrow(RangeError);
  });
});

describe("EventLog snapshot/restore", () => {
  it("round-trips a causal chain, preserving ids and cause links", () => {
    const entities = new EntityIdRegistry();
    const log = new EventLog(entities);
    const beaver = entities.create("beaver");
    const first = log.record({ tick: 0, eventType: "spawned", subjectIds: [beaver], location: ORIGIN });
    const second = log.record({ tick: 1, eventType: "moved", subjectIds: [beaver], location: ORIGIN, causeEventId: first });

    const restoredEntities = EntityIdRegistry.fromSnapshot(entities.toSnapshot());
    const restored = EventLog.fromSnapshot(log.toSnapshot(), restoredEntities);

    expect(restored.traceBack(second).map((e) => e.id)).toEqual([second, first]);
    expect(restored.get(second).subjectIds).toEqual([beaver]);
  });

  it("restores a historical reference to an entity destroyed BEFORE the save, via fromSnapshot specifically (not just record())", () => {
    // This exercises fromSnapshot's own isKnown() check in isolation --
    // distinct from the record()-time version of the same guarantee, and
    // from the "round-trips" test above (which never destroys anything).
    const entities = new EntityIdRegistry();
    const log = new EventLog(entities);
    const beaver = entities.create("beaver");
    entities.destroy(beaver);
    const died = log.record({ tick: 3, eventType: "died", subjectIds: [beaver], location: ORIGIN });

    const restoredEntities = EntityIdRegistry.fromSnapshot(entities.toSnapshot());
    expect(restoredEntities.isLive(beaver)).toBe(false);
    expect(restoredEntities.isKnown(beaver)).toBe(true);
    const restored = EventLog.fromSnapshot(log.toSnapshot(), restoredEntities);
    expect(restored.get(died).subjectIds).toEqual([beaver]);
  });

  it("rejects a snapshot whose causeEventId points to a tick that comes after its own", () => {
    const entities = new EntityIdRegistry();
    const log = new EventLog(entities);
    const first = log.record({ tick: 5, eventType: "root", location: ORIGIN });
    const second = log.record({ tick: 6, eventType: "effect", location: ORIGIN, causeEventId: first });
    const snapshot = log.toSnapshot();
    // Hand-corrupt: make the root's own tick come after its effect's tick,
    // without touching the id ordering (id ordering is checked separately).
    const corrupt = {
      ...snapshot,
      events: snapshot.events.map((e) => (e.id === first ? { ...e, tick: 100 } : e)),
    };
    void second;
    expect(() => EventLog.fromSnapshot(corrupt, entities)).toThrow(RangeError);
  });

  it("rejects a causeEventId that is numerically later even when it appears earlier in the snapshot array (order-independent id check)", () => {
    // Isolates the `causeEventId >= event.id` guard from the separate
    // seenIds/array-order guard: builds a 2-event snapshot where the
    // LOWER id (1) claims to be caused by the HIGHER id (2), with event 2
    // placed first in the array so a purely array-position-based check
    // would not catch it.
    const entities = new EntityIdRegistry();
    const log = new EventLog(entities);
    const a = log.record({ tick: 0, eventType: "a", location: ORIGIN });
    const b = log.record({ tick: 1, eventType: "b", location: ORIGIN });
    const snapshot = log.toSnapshot();
    const eventA = snapshot.events.find((e) => e.id === a)!;
    const eventB = snapshot.events.find((e) => e.id === b)!;
    const corrupt = {
      ...snapshot,
      events: [eventB, { ...eventA, causeEventId: b }], // b appears first in the array; a (lower id) claims causeEventId b (higher id)
    };
    expect(() => EventLog.fromSnapshot(corrupt, entities)).toThrow(RangeError);
  });

  it("continuing to record after restore never collides with restored ids", () => {
    const entities = new EntityIdRegistry();
    const log = new EventLog(entities);
    const first = log.record({ tick: 0, eventType: "root", location: ORIGIN });
    const restored = EventLog.fromSnapshot(log.toSnapshot(), entities);
    const next = restored.record({ tick: 1, eventType: "next", location: ORIGIN, causeEventId: first });
    expect(next).not.toBe(first);
  });

  it("survives a real JSON.stringify/JSON.parse round trip", () => {
    const entities = new EntityIdRegistry();
    const log = new EventLog(entities);
    const beaver = entities.create("beaver");
    log.record({ tick: 5, eventType: "spawned", subjectIds: [beaver], location: { x: 1, y: 2, z: 3 } });

    const revivedEntities = EntityIdRegistry.fromSnapshot(JSON.parse(JSON.stringify(entities.toSnapshot())));
    const revived = EventLog.fromSnapshot(JSON.parse(JSON.stringify(log.toSnapshot())), revivedEntities);
    expect(revived.getDebugState().eventCount).toBe(1);
  });

  it("rejects an unsupported snapshot version", () => {
    const entities = new EntityIdRegistry();
    const log = new EventLog(entities);
    const snapshot = log.toSnapshot();
    expect(() => EventLog.fromSnapshot({ ...snapshot, version: 999 }, entities)).toThrow(RangeError);
  });

  it("rejects a snapshot referencing an unknown entity id", () => {
    const entities = new EntityIdRegistry();
    const log = new EventLog(entities);
    const beaver = entities.create("beaver");
    log.record({ tick: 0, eventType: "spawned", subjectIds: [beaver], location: ORIGIN });
    const snapshot = log.toSnapshot();

    const emptyRegistry = new EntityIdRegistry();
    expect(() => EventLog.fromSnapshot(snapshot, emptyRegistry)).toThrow(RangeError);
  });

  it("rejects a self-referencing causeEventId", () => {
    const entities = new EntityIdRegistry();
    const log = new EventLog(entities);
    const id = log.record({ tick: 0, eventType: "root", location: ORIGIN });
    const snapshot = log.toSnapshot();
    const corrupt = {
      ...snapshot,
      events: snapshot.events.map((e) => (e.id === id ? { ...e, causeEventId: id } : e)),
    };
    expect(() => EventLog.fromSnapshot(corrupt, entities)).toThrow(RangeError);
  });

  it("rejects a two-event cycle (A causes B, B causes A)", () => {
    const entities = new EntityIdRegistry();
    const log = new EventLog(entities);
    const a = log.record({ tick: 0, eventType: "a", location: ORIGIN });
    const b = log.record({ tick: 1, eventType: "b", location: ORIGIN, causeEventId: a });
    const snapshot = log.toSnapshot();
    // Hand-craft a cycle: make A's causeEventId point forward to B.
    const corrupt = {
      ...snapshot,
      events: snapshot.events.map((e) => (e.id === a ? { ...e, causeEventId: b } : e)),
    };
    expect(() => EventLog.fromSnapshot(corrupt, entities)).toThrow(RangeError);
  });

  it("rejects a duplicate event id", () => {
    const entities = new EntityIdRegistry();
    const log = new EventLog(entities);
    log.record({ tick: 0, eventType: "a", location: ORIGIN });
    const snapshot = log.toSnapshot();
    const corrupt = { ...snapshot, events: [...snapshot.events, snapshot.events[0]!], nextValue: 3 };
    expect(() => EventLog.fromSnapshot(corrupt, entities)).toThrow(RangeError);
  });

  it("rejects a non-gapless event id sequence", () => {
    const entities = new EntityIdRegistry();
    const log = new EventLog(entities);
    log.record({ tick: 0, eventType: "a", location: ORIGIN });
    const snapshot = log.toSnapshot();
    expect(() => EventLog.fromSnapshot({ ...snapshot, nextValue: 10 }, entities)).toThrow(RangeError);
  });
});

describe("EventLog data payloads (P8 amendment)", () => {
  it("records, snapshots, and restores a JSON-plain data payload", () => {
    const entities = new EntityIdRegistry();
    const log = new EventLog(entities);
    const beaver = entities.create("beaver");
    const id = log.record({
      tick: 1,
      eventType: "migration-departed",
      subjectIds: [beaver],
      location: ORIGIN,
      data: { populationCount: 3, reason: "danger", cells: [{ regionX: 1, regionZ: 2 }, { regionX: 3, regionZ: 4 }] },
    });
    expect(log.get(id).data).toEqual({ populationCount: 3, reason: "danger", cells: [{ regionX: 1, regionZ: 2 }, { regionX: 3, regionZ: 4 }] });

    const revived = EventLog.fromSnapshot(log.toSnapshot(), entities);
    expect(revived.get(id).data).toEqual(log.get(id).data);

    // The payload is copied, not aliased: mutating the caller's object
    // after record() does not change the log.
    const payload = { populationCount: 9 };
    const id2 = log.record({ tick: 2, eventType: "migration-arrived", subjectIds: [beaver], location: ORIGIN, data: payload });
    payload.populationCount = 999;
    expect(log.get(id2).data).toEqual({ populationCount: 9 });
  });

  it("rejects non-JSON-plain payloads loudly", () => {
    const entities = new EntityIdRegistry();
    const log = new EventLog(entities);
    const beaver = entities.create("beaver");
    expect(() => log.record({ tick: 0, eventType: "e", location: ORIGIN, data: [1, 2] as never })).toThrow(RangeError); // array root
    expect(() => log.record({ tick: 0, eventType: "e", location: ORIGIN, data: { bad: undefined } })).toThrow(RangeError);
    expect(() => log.record({ tick: 0, eventType: "e", location: ORIGIN, data: { bad: Number.NaN } })).toThrow(RangeError);
    expect(() => log.record({ tick: 0, eventType: "e", location: ORIGIN, data: { "bad key": 1 } })).toThrow(RangeError);
    expect(() => log.record({ tick: 0, eventType: "e", location: ORIGIN, data: { bad: [1, Number.POSITIVE_INFINITY] } })).toThrow(RangeError);
    expect(() => log.record({ tick: 0, eventType: "e", location: ORIGIN, data: { bad: () => 1 } as never })).toThrow(RangeError);
    // Valid payloads still record fine.
    expect(typeof log.record({ tick: 0, eventType: "e", subjectIds: [beaver], location: ORIGIN, data: { n: 0, s: "", b: false, nil: null, nested: { list: [1, "two", null] } } })).toBe("number");
  });

  it("rejects a corrupt data payload in a hand-edited snapshot", () => {
    const entities = new EntityIdRegistry();
    const log = new EventLog(entities);
    const beaver = entities.create("beaver");
    log.record({ tick: 0, eventType: "e", subjectIds: [beaver], location: ORIGIN, data: { n: 1 } });
    const snapshot = log.toSnapshot();
    const corrupted = { ...snapshot, events: snapshot.events.map((event) => ({ ...event, data: { n: Number.NaN } })) };
    expect(() => EventLog.fromSnapshot(corrupted, entities)).toThrow(RangeError);
  });

  it("events without a payload stay valid (older-style events)", () => {
    const entities = new EntityIdRegistry();
    const log = new EventLog(entities);
    const beaver = entities.create("beaver");
    log.record({ tick: 0, eventType: "plain", subjectIds: [beaver], location: ORIGIN });
    log.record({ tick: 1, eventType: "payload", subjectIds: [beaver], location: ORIGIN, data: { n: 1 } });
    const revived = EventLog.fromSnapshot(log.toSnapshot(), entities);
    const all = revived.all();
    expect(all[0]!.data).toBeUndefined();
    expect(all[1]!.data).toEqual({ n: 1 });
  });
});
