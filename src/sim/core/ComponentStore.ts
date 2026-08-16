import type { EntityId, EntityIdRegistry } from "./EntityId.js";

/**
 * A typed token identifying one component family (Transform, Physical,
 * Needs, ...). Deliberately carries no schema/validation logic itself —
 * this file is the generic composition mechanism; concrete component
 * shapes belong to the features that define them (P0-05 Transform, P0-07
 * Physical/Material, P1-05 Creature/Needs, ...), not to this foundation.
 *
 * Component identity is the token object's reference, not its `name`
 * string: two `defineComponent` calls with the same name produce distinct,
 * non-interfering component types (this is intentional — see
 * ComponentStore's class doc comment — and `getDebugState().duplicateNames`
 * exists specifically to surface it when it happens by accident).
 *
 * Value contract (relied on by ComponentStore.toSnapshot(), P0-06): a component value
 * should be JSON-plain — primitives, arrays, and plain objects, optionally
 * containing `EntityId` values (which round-trip fine as plain numbers).
 * No functions, `Map`/`Set`, class instances with methods, or circular
 * references. Not enforced at runtime (would tax every `set()` call for a
 * purely load-time concern); treat it as a hard convention.
 */
export interface ComponentType<T> {
  readonly name: string;
  /** Type-only marker: never assigned, exists so TypeScript carries `T` through for inference at call sites. */
  readonly _phantom?: T;
}

export function defineComponent<T>(name: string): ComponentType<T> {
  return Object.freeze({ name });
}

const COMPONENT_STORE_SNAPSHOT_VERSION = 1;

/**
 * Flattened as one entry per (entity, component type) pair rather than
 * grouped by type: simpler to validate entry-by-entry on restore, and the
 * total entry count is what actually matters for size, not the grouping.
 * `value` is whatever the component's `set()` call stored -- see
 * `ComponentType`'s doc comment for the JSON-plain value contract this
 * relies on. `EntityId` values nested inside a component's own value (e.g.
 * "this beaver carries item #42") are plain numbers and round-trip with no
 * special handling, which is how cross-entity references survive a
 * save/reload automatically.
 */
export interface ComponentStoreSnapshot {
  version: number;
  entries: Array<{ typeName: string; id: EntityId; value: unknown }>;
}

export interface ComponentStoreDebugState {
  /** Distinct entities carrying at least one component. */
  entityCount: number;
  /** Includes types now fully emptied (every holder removed/destroyed) — a component type table is never torn down once created, since the number of distinct component TYPES is small and fixed by the game's systems, unlike entity count. A `count: 0` row is not a bug. */
  componentTypeCount: number;
  componentCounts: Array<{ name: string; count: number }>;
  /** Component type names currently backed by more than one distinct token (see ComponentType's doc comment) — almost always an accidental duplicate `defineComponent` call rather than an intentional one. Empty in the healthy case. */
  duplicateNames: string[];
}

type AnyComponentType = ComponentType<unknown>;

/**
 * Data-oriented component storage: one sparse `Map<EntityId, value>` table
 * per component type (a column store), rather than an object-per-entity
 * row. Entities are composed by attaching whichever component types are
 * appropriate to them — no inheritance hierarchy, no fixed entity classes.
 *
 * Assumes exactly one canonical `EntityIdRegistry` per world/session: it
 * subscribes to that registry's `onDestroy` to automatically clear all of
 * a destroyed entity's components, so component data can never silently
 * outlive the identity it's attached to (the seam flagged when P0-02 was
 * reviewed). Passing ids from a *different* registry instance is not
 * validated against and is a caller error.
 *
 * Lifecycle note: that subscription is a live closure held by the
 * registry for as long as this store exists. A `ComponentStore` that is
 * discarded without calling `dispose()` leaks — the registry keeps calling
 * into a store nothing references anymore, pinning its tables (and every
 * component value in them) alive. Long-lived code should construct one
 * store per registry for the registry's lifetime; short-lived/test code
 * that discards stores repeatedly against one registry must call
 * `dispose()`. `EntityIdRegistry.getDebugState().destroyListenerCount` is
 * the way to notice this going wrong.
 *
 * Multi-call transitions (e.g. remove Creature, remove Needs, set Corpse
 * to represent a death) are not atomic/transactional — there is no
 * batch-apply primitive here. That's a non-issue today (single-threaded,
 * nothing yields between statements, this class fires no change-observer
 * callbacks), but if a reactive/observer layer is ever added on top, an
 * observer firing mid-sequence could see a causally-nonsensical
 * intermediate state. Worth remembering before P1-16 (injury/death) leans
 * on sequences like this at higher stakes.
 */
export class ComponentStore {
  private readonly registry: EntityIdRegistry;
  private readonly tables = new Map<AnyComponentType, Map<EntityId, unknown>>();
  private readonly unsubscribeFromDestroy: () => void;
  private disposed = false;

  constructor(registry: EntityIdRegistry) {
    this.registry = registry;
    this.unsubscribeFromDestroy = registry.onDestroy((id) => this.removeAll(id));
  }

  set<T>(id: EntityId, type: ComponentType<T>, value: T): void {
    if (!this.registry.isLive(id)) {
      throw new RangeError(
        `cannot attach component "${type.name}" to entity id ${id}: not a live entity in this store's registry`,
      );
    }
    let table = this.tables.get(type);
    if (table === undefined) {
      table = new Map();
      this.tables.set(type, table);
    }
    table.set(id, value);
  }

  get<T>(id: EntityId, type: ComponentType<T>): T | undefined {
    this.assertKnown(id);
    return this.tables.get(type)?.get(id) as T | undefined;
  }

  has<T>(id: EntityId, type: ComponentType<T>): boolean {
    this.assertKnown(id);
    return this.tables.get(type)?.has(id) ?? false;
  }

  remove<T>(id: EntityId, type: ComponentType<T>): void {
    this.assertKnown(id);
    this.tables.get(type)?.delete(id);
  }

  /** Removes every component this entity carries. Called automatically on entity destruction; also callable directly (e.g. by tests). */
  removeAll(id: EntityId): void {
    for (const table of this.tables.values()) {
      table.delete(id);
    }
  }

  /** Component types currently attached to an entity, for debug inspection. */
  typesOf(id: EntityId): AnyComponentType[] {
    this.assertKnown(id);
    const result: AnyComponentType[] = [];
    for (const [type, table] of this.tables) {
      if (table.has(id)) result.push(type);
    }
    return result;
  }

  /**
   * Every component type this store has ever recorded at least one value
   * for (including types now fully emptied — see componentTypeCount's doc
   * comment). Lets a future serializer discover types by iterating the
   * store, without needing every ComponentType token handed in externally.
   */
  allTypes(): AnyComponentType[] {
    return [...this.tables.keys()];
  }

  /**
   * Entities carrying every one of the given component types (logical
   * AND). Requires at least one type: an empty type list is vacuously true
   * for every entity ever created, which this store has no cheap way to
   * enumerate (it only indexes entities that have >=1 component), so it's
   * rejected rather than silently returning an ambiguous answer.
   *
   * Result order is UNSPECIFIED and must not be treated as meaningful: it
   * follows whichever requested table happens to be smallest right now
   * (an incidental performance detail, not argument order or insertion
   * order), and which table is smallest can change between calls. A
   * caller that needs a stable or game-legible order (e.g. "which idle
   * beaver gets this job first") must sort the result explicitly by
   * something with actual causal meaning (id, priority, distance, ...) —
   * never rely on iteration order as an implicit tiebreak.
   *
   * Implementation scans the smallest matching table and probes the rest;
   * O(smallest table size). Revisit only if profiling shows this matters
   * at scale (ARCHITECTURE_CONTRACT §20: optimize demonstrated bottlenecks).
   */
  query(...types: AnyComponentType[]): EntityId[] {
    if (types.length === 0) {
      throw new RangeError("query() requires at least one component type");
    }
    const tables: Array<Map<EntityId, unknown>> = [];
    for (const type of types) {
      const table = this.tables.get(type);
      if (table === undefined) return []; // no entity has ever been given this component type
      tables.push(table);
    }

    let smallestIndex = 0;
    for (let i = 1; i < tables.length; i++) {
      if (tables[i]!.size < tables[smallestIndex]!.size) smallestIndex = i;
    }
    const smallest = tables[smallestIndex]!;

    const result: EntityId[] = [];
    for (const id of smallest.keys()) {
      let matchesAll = true;
      for (let i = 0; i < tables.length; i++) {
        if (i === smallestIndex) continue;
        if (!tables[i]!.has(id)) {
          matchesAll = false;
          break;
        }
      }
      if (matchesAll) result.push(id);
    }
    return result;
  }

  /**
   * O(total component instances across all types) — union every table's
   * keys plus a duplicate-name scan. Fine for an on-demand debug UI (P0-12,
   * click-to-inspect); do not call this from a per-tick hot path once
   * entity/component counts grow into the thousands.
   */
  getDebugState(): ComponentStoreDebugState {
    const entityIds = new Set<EntityId>();
    const componentCounts: Array<{ name: string; count: number }> = [];
    const tokensByName = new Map<string, Set<AnyComponentType>>();
    for (const [type, table] of this.tables) {
      componentCounts.push({ name: type.name, count: table.size });
      for (const id of table.keys()) entityIds.add(id);
      let tokens = tokensByName.get(type.name);
      if (tokens === undefined) {
        tokens = new Set();
        tokensByName.set(type.name, tokens);
      }
      tokens.add(type);
    }
    componentCounts.sort((a, b) => a.name.localeCompare(b.name));
    const duplicateNames = [...tokensByName.entries()]
      .filter(([, tokens]) => tokens.size > 1)
      .map(([name]) => name)
      .sort();
    return {
      entityCount: entityIds.size,
      componentTypeCount: this.tables.size,
      componentCounts,
      duplicateNames,
    };
  }

  /**
   * Serializes every component value this store holds, keyed by component
   * type NAME (not the `ComponentType` object -- object identity can't
   * survive JSON). Refuses to serialize while any name is backed by more
   * than one distinct token (`getDebugState().duplicateNames`): that
   * situation is already documented as an accidental-collision bug, not a
   * supported configuration, and restoring by name would otherwise
   * silently merge or misattribute the two tokens' data with no error.
   */
  toSnapshot(): ComponentStoreSnapshot {
    const duplicateNames = this.getDebugState().duplicateNames;
    if (duplicateNames.length > 0) {
      throw new RangeError(
        `cannot snapshot: component type name(s) ${duplicateNames.join(", ")} are backed by more than one distinct token (see ComponentType's doc comment) -- restoring by name would be ambiguous`,
      );
    }
    const entries: ComponentStoreSnapshot["entries"] = [];
    for (const [type, table] of this.tables) {
      for (const [id, value] of table) {
        entries.push({ typeName: type.name, id, value });
      }
    }
    return { version: COMPONENT_STORE_SNAPSHOT_VERSION, entries };
  }

  /**
   * Reconstructs a store against `registry`. `componentTypesByName` maps
   * every component type name the snapshot might reference back to its
   * live `ComponentType` token -- this store has no way to know those
   * tokens itself (they're defined by whichever feature module called
   * `defineComponent`, deliberately outside this generic foundation's
   * scope), so the caller (typically a world-level loader that imports
   * every feature's component definitions) must supply them.
   */
  static fromSnapshot(
    snapshot: ComponentStoreSnapshot,
    registry: EntityIdRegistry,
    componentTypesByName: ReadonlyMap<string, AnyComponentType>,
  ): ComponentStore {
    if (snapshot.version !== COMPONENT_STORE_SNAPSHOT_VERSION) {
      throw new RangeError(
        `unsupported ComponentStore snapshot version ${snapshot.version}, expected ${COMPONENT_STORE_SNAPSHOT_VERSION}`,
      );
    }
    const store = new ComponentStore(registry);
    for (const entry of snapshot.entries) {
      const type = componentTypesByName.get(entry.typeName);
      if (type === undefined) {
        throw new RangeError(
          `corrupt snapshot: unknown component type "${entry.typeName}" (not present in componentTypesByName)`,
        );
      }
      if (!registry.isLive(entry.id)) {
        throw new RangeError(
          `corrupt snapshot: component "${entry.typeName}" references entity id ${entry.id}, which is not live in the provided registry`,
        );
      }
      let table = store.tables.get(type);
      if (table === undefined) {
        table = new Map();
        store.tables.set(type, table);
      }
      if (table.has(entry.id)) {
        throw new RangeError(`corrupt snapshot: duplicate entry for component "${entry.typeName}" on entity id ${entry.id}`);
      }
      table.set(entry.id, entry.value);
    }
    return store;
  }

  /** Stops auto-cleanup on entity destruction. Only needed when discarding a store while its registry stays alive (e.g. test isolation). */
  dispose(): void {
    if (this.disposed) return;
    this.unsubscribeFromDestroy();
    this.disposed = true;
  }

  private assertKnown(id: EntityId): void {
    if (!this.registry.isKnown(id)) {
      throw new RangeError(`entity id ${id} is not known to this store's registry`);
    }
  }
}
