import { describe, expect, it } from "vitest";
import { ComponentStore, defineComponent, type ComponentType } from "../../src/sim/core/ComponentStore.js";
import { EntityIdRegistry, type EntityId } from "../../src/sim/core/EntityId.js";

interface Position {
  x: number;
  y: number;
}

const Position = defineComponent<Position>("position");
const Label = defineComponent<string>("label");

describe("ComponentStore basic set/get/has/remove", () => {
  it("stores and retrieves a component value", () => {
    const registry = new EntityIdRegistry();
    const store = new ComponentStore(registry);
    const id = registry.create("beaver");

    store.set(id, Position, { x: 1, y: 2 });

    expect(store.get(id, Position)).toEqual({ x: 1, y: 2 });
    expect(store.has(id, Position)).toBe(true);
  });

  it("returns undefined and false for a component never attached", () => {
    const registry = new EntityIdRegistry();
    const store = new ComponentStore(registry);
    const id = registry.create("beaver");

    expect(store.get(id, Position)).toBeUndefined();
    expect(store.has(id, Position)).toBe(false);
  });

  it("overwrites a component value on repeated set()", () => {
    const registry = new EntityIdRegistry();
    const store = new ComponentStore(registry);
    const id = registry.create("beaver");

    store.set(id, Position, { x: 1, y: 2 });
    store.set(id, Position, { x: 9, y: 9 });

    expect(store.get(id, Position)).toEqual({ x: 9, y: 9 });
  });

  it("removes a single component without affecting others", () => {
    const registry = new EntityIdRegistry();
    const store = new ComponentStore(registry);
    const id = registry.create("beaver");
    store.set(id, Position, { x: 1, y: 2 });
    store.set(id, Label, "Bucktooth");

    store.remove(id, Position);

    expect(store.has(id, Position)).toBe(false);
    expect(store.has(id, Label)).toBe(true);
  });

  it("distinguishes two component types that share a name string", () => {
    const registry = new EntityIdRegistry();
    const store = new ComponentStore(registry);
    const id = registry.create("beaver");
    const A = defineComponent<number>("dup");
    const B = defineComponent<string>("dup");

    store.set(id, A, 42);
    store.set(id, B, "forty-two");

    expect(store.get(id, A)).toBe(42);
    expect(store.get(id, B)).toBe("forty-two");
  });

  it("rejects attaching a component to a non-live entity", () => {
    const registry = new EntityIdRegistry();
    const store = new ComponentStore(registry);
    const id = registry.create("beaver");
    registry.destroy(id);

    expect(() => store.set(id, Position, { x: 0, y: 0 })).toThrow(RangeError);
  });

  it("rejects get/has/remove/typesOf for an id unknown to this store's registry", () => {
    const registry = new EntityIdRegistry();
    const store = new ComponentStore(registry);
    const foreignRegistry = new EntityIdRegistry();
    const foreignId = foreignRegistry.create("beaver"); // same numeric value space, never known to `registry`

    expect(() => store.get(foreignId, Position)).toThrow(RangeError);
    expect(() => store.has(foreignId, Position)).toThrow(RangeError);
    expect(() => store.remove(foreignId, Position)).toThrow(RangeError);
    expect(() => store.typesOf(foreignId)).toThrow(RangeError);
  });

  it("still allows read access to a destroyed (but known) entity's remaining components", () => {
    const registry = new EntityIdRegistry();
    const store = new ComponentStore(registry);
    const id = registry.create("beaver");
    store.set(id, Label, "Bucktooth");
    registry.destroy(id);

    // destroy() triggers auto-cleanup, so the label is gone -- but reading
    // a *known*, merely-dead entity must not throw the way an unknown one does.
    expect(() => store.get(id, Label)).not.toThrow();
    expect(() => store.typesOf(id)).not.toThrow();
  });
});

describe("ComponentStore.typesOf", () => {
  it("lists exactly the component types an entity carries", () => {
    const registry = new EntityIdRegistry();
    const store = new ComponentStore(registry);
    const id = registry.create("beaver");
    store.set(id, Position, { x: 0, y: 0 });
    store.set(id, Label, "Bucktooth");

    const types = store.typesOf(id).map((t) => t.name).sort();
    expect(types).toEqual(["label", "position"]);
  });

  it("returns an empty list for an entity with no components", () => {
    const registry = new EntityIdRegistry();
    const store = new ComponentStore(registry);
    const id = registry.create("beaver");
    expect(store.typesOf(id)).toEqual([]);
  });
});

describe("ComponentStore.query", () => {
  it("requires at least one type", () => {
    const registry = new EntityIdRegistry();
    const store = new ComponentStore(registry);
    expect(() => store.query()).toThrow(RangeError);
  });

  it("returns entities matching every requested type (logical AND)", () => {
    const registry = new EntityIdRegistry();
    const store = new ComponentStore(registry);
    const both = registry.create("beaver");
    const onlyPosition = registry.create("log");
    store.set(both, Position, { x: 0, y: 0 });
    store.set(both, Label, "Bucktooth");
    store.set(onlyPosition, Position, { x: 5, y: 5 });

    expect(store.query(Position, Label)).toEqual([both]);
    expect(store.query(Position).sort()).toEqual([both, onlyPosition].sort());
  });

  it("returns an empty array for a component type nobody has ever used", () => {
    const registry = new EntityIdRegistry();
    const store = new ComponentStore(registry);
    expect(store.query(Position)).toEqual([]);
  });

  it("treats 'never used' and 'used then fully emptied' identically", () => {
    const registry = new EntityIdRegistry();
    const store = new ComponentStore(registry);
    const id = registry.create("beaver");
    store.set(id, Position, { x: 0, y: 0 });
    store.remove(id, Position); // table now exists but is empty

    expect(store.query(Position)).toEqual([]);
    expect(store.has(id, Position)).toBe(false);
  });
});

describe("ComponentStore.allTypes", () => {
  it("lists every component type the store has ever recorded a value for", () => {
    const registry = new EntityIdRegistry();
    const store = new ComponentStore(registry);
    const id = registry.create("beaver");
    store.set(id, Position, { x: 0, y: 0 });
    store.set(id, Label, "Bucktooth");
    store.remove(id, Label); // fully emptied, but still "ever used"

    const names = store.allTypes().map((t) => t.name).sort();
    expect(names).toEqual(["label", "position"]);
  });
});

describe("ComponentStore lifecycle integration with EntityIdRegistry", () => {
  it("automatically clears all components when the registry destroys an entity", () => {
    const registry = new EntityIdRegistry();
    const store = new ComponentStore(registry);
    const id = registry.create("beaver");
    store.set(id, Position, { x: 1, y: 1 });
    store.set(id, Label, "Bucktooth");

    registry.destroy(id);

    expect(store.has(id, Position)).toBe(false);
    expect(store.has(id, Label)).toBe(false);
    expect(store.typesOf(id)).toEqual([]);
    expect(store.query(Position)).toEqual([]);
  });

  it("stops auto-cleanup after dispose()", () => {
    const registry = new EntityIdRegistry();
    const store = new ComponentStore(registry);
    const id = registry.create("beaver");
    store.set(id, Position, { x: 1, y: 1 });

    store.dispose();
    registry.destroy(id);

    // dispose() unsubscribed, so the store's own removeAll must be called explicitly now.
    expect(store.has(id, Position)).toBe(true);
  });
});

describe("ComponentStore debug observability", () => {
  it("reports entity and component counts", () => {
    const registry = new EntityIdRegistry();
    const store = new ComponentStore(registry);
    const a = registry.create("beaver");
    const b = registry.create("tree");
    store.set(a, Position, { x: 0, y: 0 });
    store.set(a, Label, "Bucktooth");
    store.set(b, Position, { x: 3, y: 3 });

    const state = store.getDebugState();
    expect(state.entityCount).toBe(2);
    expect(state.componentTypeCount).toBe(2);
    expect(state.componentCounts).toEqual([
      { name: "label", count: 1 },
      { name: "position", count: 2 },
    ]);
    expect(state.duplicateNames).toEqual([]);
  });

  it("surfaces an accidental duplicate defineComponent name", () => {
    const registry = new EntityIdRegistry();
    const store = new ComponentStore(registry);
    const id = registry.create("beaver");
    const NeedsA = defineComponent<number>("needs");
    const NeedsB = defineComponent<number>("needs"); // accidental re-definition, e.g. duplicate import

    store.set(id, NeedsA, 1);
    store.set(id, NeedsB, 2);

    expect(store.getDebugState().duplicateNames).toEqual(["needs"]);
  });

  it("retains a component type's row at count 0 after every holder is removed, rather than dropping it", () => {
    const registry = new EntityIdRegistry();
    const store = new ComponentStore(registry);
    const id = registry.create("beaver");
    store.set(id, Position, { x: 0, y: 0 });
    store.remove(id, Position);

    const state = store.getDebugState();
    expect(state.componentTypeCount).toBe(1);
    expect(state.componentCounts).toEqual([{ name: "position", count: 0 }]);
  });
});

describe("ComponentStore snapshot/restore", () => {
  it("round-trips component values, keyed back to the right entity", () => {
    const registry = new EntityIdRegistry();
    const store = new ComponentStore(registry);
    const a = registry.create("beaver");
    const b = registry.create("tree");
    store.set(a, Position, { x: 1, y: 2 });
    store.set(a, Label, "Bucktooth");
    store.set(b, Position, { x: 5, y: 5 });

    const restoredRegistry = EntityIdRegistry.fromSnapshot(registry.toSnapshot());
    const restored = ComponentStore.fromSnapshot(
      store.toSnapshot(),
      restoredRegistry,
      new Map<string, ComponentType<unknown>>([
        ["position", Position],
        ["label", Label],
      ]),
    );

    expect(restored.get(a, Position)).toEqual({ x: 1, y: 2 });
    expect(restored.get(a, Label)).toBe("Bucktooth");
    expect(restored.get(b, Position)).toEqual({ x: 5, y: 5 });
    expect(restored.has(b, Label)).toBe(false);
  });

  it("preserves an EntityId reference nested inside a component value", () => {
    interface Carries {
      itemId: number;
    }
    const CarriesComponent = defineComponent<Carries>("carries");
    const registry = new EntityIdRegistry();
    const store = new ComponentStore(registry);
    const beaver = registry.create("beaver");
    const log = registry.create("log");
    store.set(beaver, CarriesComponent, { itemId: log });

    const restoredRegistry = EntityIdRegistry.fromSnapshot(registry.toSnapshot());
    const restored = ComponentStore.fromSnapshot(
      store.toSnapshot(),
      restoredRegistry,
      new Map([["carries", CarriesComponent]]),
    );

    const carried = restored.get(beaver, CarriesComponent)!;
    expect(carried.itemId).toBe(log);
    const restoredItemId = carried.itemId as unknown as EntityId;
    expect(restoredRegistry.isLive(restoredItemId)).toBe(true);
    expect(restoredRegistry.kindOf(restoredItemId)).toBe("log");
  });

  it("survives a real JSON.stringify/JSON.parse round trip", () => {
    const registry = new EntityIdRegistry();
    const store = new ComponentStore(registry);
    const id = registry.create("beaver");
    store.set(id, Position, { x: 3, y: 4 });

    const revived = JSON.parse(JSON.stringify(store.toSnapshot()));
    const restoredRegistry = EntityIdRegistry.fromSnapshot(JSON.parse(JSON.stringify(registry.toSnapshot())));
    const restored = ComponentStore.fromSnapshot(revived, restoredRegistry, new Map([["position", Position]]));
    expect(restored.get(id, Position)).toEqual({ x: 3, y: 4 });
  });

  it("refuses to snapshot while a type name is backed by two distinct tokens", () => {
    const registry = new EntityIdRegistry();
    const store = new ComponentStore(registry);
    const id = registry.create("beaver");
    const A = defineComponent<number>("ambiguous");
    const B = defineComponent<number>("ambiguous");
    store.set(id, A, 1);
    store.set(id, B, 2);

    expect(() => store.toSnapshot()).toThrow(RangeError);
  });

  it("rejects an unsupported snapshot version", () => {
    const registry = new EntityIdRegistry();
    const store = new ComponentStore(registry);
    const snapshot = store.toSnapshot();
    expect(() =>
      ComponentStore.fromSnapshot({ ...snapshot, version: 999 }, registry, new Map()),
    ).toThrow(RangeError);
  });

  it("rejects a snapshot referencing an unknown component type name", () => {
    const registry = new EntityIdRegistry();
    const store = new ComponentStore(registry);
    const id = registry.create("beaver");
    store.set(id, Position, { x: 0, y: 0 });
    const snapshot = store.toSnapshot();

    expect(() => ComponentStore.fromSnapshot(snapshot, registry, new Map())).toThrow(RangeError);
  });

  it("rejects a snapshot referencing an entity id that is not live in the target registry", () => {
    const registry = new EntityIdRegistry();
    const store = new ComponentStore(registry);
    const id = registry.create("beaver");
    store.set(id, Position, { x: 0, y: 0 });
    const snapshot = store.toSnapshot();

    const emptyRegistry = new EntityIdRegistry(); // never created any entity, id 1 is unknown
    expect(() => ComponentStore.fromSnapshot(snapshot, emptyRegistry, new Map([["position", Position]]))).toThrow(
      RangeError,
    );
  });

  it("rejects a snapshot with a duplicate (typeName, id) entry", () => {
    const registry = new EntityIdRegistry();
    const store = new ComponentStore(registry);
    const id = registry.create("beaver");
    store.set(id, Position, { x: 0, y: 0 });
    const snapshot = store.toSnapshot();
    const corrupt = { ...snapshot, entries: [...snapshot.entries, snapshot.entries[0]!] };

    expect(() =>
      ComponentStore.fromSnapshot(corrupt, registry, new Map([["position", Position]])),
    ).toThrow(RangeError);
  });
});

describe("ComponentStore / EntityIdRegistry leak observability", () => {
  it("grows the registry's destroyListenerCount for each undisposed store, and stops growing once disposed", () => {
    const registry = new EntityIdRegistry();
    expect(registry.getDebugState().destroyListenerCount).toBe(0);

    const leaked = new ComponentStore(registry);
    void leaked;
    expect(registry.getDebugState().destroyListenerCount).toBe(1);

    const disposed = new ComponentStore(registry);
    expect(registry.getDebugState().destroyListenerCount).toBe(2);
    disposed.dispose();
    expect(registry.getDebugState().destroyListenerCount).toBe(1);
  });
});
