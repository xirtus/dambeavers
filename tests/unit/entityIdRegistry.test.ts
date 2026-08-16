import { describe, expect, it } from "vitest";
import { EntityIdRegistry, type EntityId } from "../../src/sim/core/EntityId.js";

describe("EntityIdRegistry allocation", () => {
  it("issues distinct, monotonically increasing ids across kinds", () => {
    const registry = new EntityIdRegistry();
    const a = registry.create("beaver");
    const b = registry.create("tree");
    const c = registry.create("beaver");
    expect(new Set([a, b, c]).size).toBe(3);
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
  });

  it("rejects an empty kind", () => {
    const registry = new EntityIdRegistry();
    expect(() => registry.create("")).toThrow(RangeError);
  });

  it("reports kind correctly per entity", () => {
    const registry = new EntityIdRegistry();
    const beaver = registry.create("beaver");
    const tree = registry.create("tree");
    expect(registry.kindOf(beaver)).toBe("beaver");
    expect(registry.kindOf(tree)).toBe("tree");
  });
});

describe("EntityIdRegistry lifecycle", () => {
  it("marks a destroyed entity as not live while keeping its identity queryable", () => {
    const registry = new EntityIdRegistry();
    const id = registry.create("beaver");
    expect(registry.isLive(id)).toBe(true);

    registry.destroy(id);

    expect(registry.isLive(id)).toBe(false);
    expect(registry.isKnown(id)).toBe(true);
    expect(registry.kindOf(id)).toBe("beaver"); // history must keep resolving after death
  });

  it("rejects destroying an unknown id", () => {
    const registry = new EntityIdRegistry();
    expect(() => registry.destroy(999 as EntityId)).toThrow(RangeError);
  });

  it("rejects destroying an already-destroyed id", () => {
    const registry = new EntityIdRegistry();
    const id = registry.create("beaver");
    registry.destroy(id);
    expect(() => registry.destroy(id)).toThrow(RangeError);
  });

  it("rejects kindOf for an unknown id", () => {
    const registry = new EntityIdRegistry();
    expect(() => registry.kindOf(999 as EntityId)).toThrow(RangeError);
  });

  it("never reissues a destroyed id, even after heavy create/destroy churn", () => {
    const registry = new EntityIdRegistry();
    const allIssued = new Set<EntityId>();
    for (let round = 0; round < 50; round++) {
      const batch: EntityId[] = [];
      for (let i = 0; i < 20; i++) {
        const id = registry.create("log");
        expect(allIssued.has(id)).toBe(false);
        allIssued.add(id);
        batch.push(id);
      }
      for (const id of batch) registry.destroy(id);
    }
    expect(allIssued.size).toBe(1000);
  });
});

describe("EntityIdRegistry queries", () => {
  it("filters live ids by kind", () => {
    const registry = new EntityIdRegistry();
    const b1 = registry.create("beaver");
    registry.create("tree");
    const b2 = registry.create("beaver");
    const b3 = registry.create("beaver");
    registry.destroy(b3);

    const liveBeavers = registry.liveIdsOfKind("beaver").sort((x, y) => x - y);
    expect(liveBeavers).toEqual([b1, b2].sort((x, y) => x - y));
  });

  it("exposes counts via debug state", () => {
    const registry = new EntityIdRegistry();
    const a = registry.create("beaver");
    registry.create("tree");
    registry.destroy(a);

    const state = registry.getDebugState();
    expect(state.liveCount).toBe(1);
    expect(state.totalAllocatedCount).toBe(2);
    expect(state.nextValue).toBe(3);
  });
});

describe("EntityIdRegistry snapshot/restore", () => {
  it("round-trips kind, liveness, and future-allocation safety", () => {
    const registry = new EntityIdRegistry();
    const alive = registry.create("beaver");
    const dead = registry.create("tree");
    registry.destroy(dead);

    const restored = EntityIdRegistry.fromSnapshot(registry.toSnapshot());

    expect(restored.isLive(alive)).toBe(true);
    expect(restored.kindOf(alive)).toBe("beaver");
    expect(restored.isLive(dead)).toBe(false);
    expect(restored.isKnown(dead)).toBe(true);
    expect(restored.kindOf(dead)).toBe("tree");

    const next = restored.create("log");
    expect(next).toBeGreaterThan(dead);
    expect(next).toBeGreaterThan(alive);
  });

  it("rejects a snapshot whose nextValue would allow reissuing a stored id", () => {
    const corrupt = {
      version: 1,
      nextValue: 2,
      entities: [{ id: 5 as EntityId, kind: "beaver", live: true }],
    };
    expect(() => EntityIdRegistry.fromSnapshot(corrupt)).toThrow(RangeError);
  });

  it("rejects a snapshot with duplicate entity ids", () => {
    const corrupt = {
      version: 1,
      nextValue: 10,
      entities: [
        { id: 1 as EntityId, kind: "beaver", live: true },
        { id: 1 as EntityId, kind: "tree", live: false },
      ],
    };
    expect(() => EntityIdRegistry.fromSnapshot(corrupt)).toThrow(RangeError);
  });

  it("rejects an unsupported snapshot format version", () => {
    const corrupt = { version: 999, nextValue: 1, entities: [] };
    expect(() => EntityIdRegistry.fromSnapshot(corrupt)).toThrow(RangeError);
  });

  it("rejects a non-integer nextValue, including NaN and Infinity, which would otherwise silently defeat the collision guard", () => {
    // NaN <= x and Infinity <= x are both always false in JS, so a plain
    // `<=` comparison alone cannot catch these -- this is a regression test
    // for exactly that gap.
    for (const badNextValue of [Number.NaN, Number.POSITIVE_INFINITY, 1.5, 0, -1]) {
      const corrupt = { version: 1, nextValue: badNextValue, entities: [] };
      expect(() => EntityIdRegistry.fromSnapshot(corrupt)).toThrow(RangeError);
    }
  });

  it("rejects a snapshot whose entity count doesn't match a gapless id sequence", () => {
    // nextValue implies ids 1..4 should exist, but one was dropped --
    // nextValue alone (5) looks plausible against the remaining max id (4).
    const corrupt = {
      version: 1,
      nextValue: 5,
      entities: [
        { id: 1 as EntityId, kind: "beaver", live: true },
        { id: 2 as EntityId, kind: "beaver", live: true },
        { id: 4 as EntityId, kind: "beaver", live: true },
      ],
    };
    expect(() => EntityIdRegistry.fromSnapshot(corrupt)).toThrow(RangeError);
  });

  it("rejects a snapshot entity with a malformed kind", () => {
    const corrupt = {
      version: 1,
      nextValue: 2,
      entities: [{ id: 1 as EntityId, kind: "", live: true }],
    };
    expect(() => EntityIdRegistry.fromSnapshot(corrupt)).toThrow(RangeError);
  });
});

describe("EntityIdRegistry kind format", () => {
  it("rejects non-kebab-case kinds", () => {
    const registry = new EntityIdRegistry();
    expect(() => registry.create("")).toThrow(RangeError);
    expect(() => registry.create("Beaver")).toThrow(RangeError);
    expect(() => registry.create("beaver_lodge")).toThrow(RangeError);
    expect(() => registry.create("beaver lodge")).toThrow(RangeError);
    expect(() => registry.create("-beaver")).toThrow(RangeError);
  });

  it("accepts multi-word kebab-case kinds", () => {
    const registry = new EntityIdRegistry();
    expect(() => registry.create("dam-segment")).not.toThrow();
  });
});

describe("EntityIdRegistry onDestroy", () => {
  it("notifies listeners synchronously with the id and kind", () => {
    const registry = new EntityIdRegistry();
    const id = registry.create("beaver");
    const events: Array<[EntityId, string]> = [];
    registry.onDestroy((destroyedId, kind) => events.push([destroyedId, kind]));

    registry.destroy(id);

    expect(events).toEqual([[id, "beaver"]]);
  });

  it("stops notifying after unsubscribe", () => {
    const registry = new EntityIdRegistry();
    const a = registry.create("beaver");
    const b = registry.create("tree");
    let count = 0;
    const unsubscribe = registry.onDestroy(() => count++);

    registry.destroy(a);
    expect(count).toBe(1);

    unsubscribe();
    registry.destroy(b);
    expect(count).toBe(1);
  });
});
