/**
 * Open string tag for what an entity fundamentally is ("beaver", "tree",
 * "log", "dam-segment", ...). Deliberately not a fixed enum: P0-03's
 * component/state model and later systems must be able to introduce new
 * kinds without editing this foundational file. Constrained to lowercase
 * kebab-case so "beaver" and "Beaver" can never silently become disjoint
 * kind buckets across the many call sites that will eventually type kind
 * strings by hand.
 */
export type EntityKind = string;

const KIND_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

function assertValidKind(kind: EntityKind): void {
  if (!KIND_PATTERN.test(kind)) {
    throw new RangeError(
      `entity kind must be non-empty lowercase kebab-case (e.g. "beaver", "dam-segment"), got ${JSON.stringify(kind)}`,
    );
  }
}

/**
 * Globally unique, permanent identity for a simulation entity. A branded
 * number, not an object: cheap as a Map/Set key, trivially
 * JSON-serializable, and comparable with plain `===`. The brand is a
 * compile-time-only marker (erased at runtime) so a raw number can't be
 * passed where an EntityId is expected without an explicit cast.
 *
 * Use this only as a lookup *key* into side structures (Maps, or a future
 * sparse-id→dense-slot index), not as a direct dense array index: ids are
 * never reused and are retained forever once allocated (see
 * EntityIdRegistry), so the id space only grows across a session and does
 * not track live population. A component store that needs array-backed
 * density should keep its own id→slot indirection layer rather than
 * indexing by raw EntityId.
 *
 * Scope: this identity system is for entities AGENTS.md §1.3 calls
 * "important persistent entities" (beavers, trees, items, constructions,
 * ...), not disposable per-tick simulation bookkeeping — ids are retained
 * forever specifically so history/event references keep resolving, which
 * makes this the wrong tool for high-churn ephemeral markers.
 */
export type EntityId = number & { readonly __entityIdBrand: unique symbol };

export interface EntityIdRegistryDebugState {
  liveCount: number;
  /** Includes destroyed entities: their identity remains valid history forever. */
  totalAllocatedCount: number;
  nextValue: number;
  /** Live onDestroy subscriptions. A count that only ever grows across a session (never returning toward 0) usually means something is constructing subscribers (e.g. ComponentStore instances) without calling their dispose()/unsubscribe -- a closure/memory leak. */
  destroyListenerCount: number;
}

interface SnapshotEntity {
  id: EntityId;
  kind: EntityKind;
  live: boolean;
}

const SNAPSHOT_FORMAT_VERSION = 1;

export interface EntityIdRegistrySnapshot {
  /** Format version of this snapshot shape, independent of the eventual P0-06 save-file version. */
  version: number;
  nextValue: number;
  entities: SnapshotEntity[];
}

export type DestroyListener = (id: EntityId, kind: EntityKind) => void;
export type Unsubscribe = () => void;

/**
 * Owns entity identity: allocation, kind lookup, and live/destroyed status.
 * Does not own component data (P0-03) or timestamps/causal history (P0-08)
 * — those layer on top, keyed by the IDs this registry issues. P0-03
 * should drive component cleanup off `onDestroy`/`isLive` rather than
 * duplicating lifecycle tracking, so the two can't drift out of sync.
 *
 * Collision safety: `nextValue` only ever increases and is never reset from
 * a destroy(), so no two `create()` calls across the lifetime of a registry
 * (including across save/reload) can ever produce the same id, regardless
 * of how much create/destroy churn happens in between. `fromSnapshot`
 * validates that a loaded snapshot cannot violate this (see its comment).
 */
export class EntityIdRegistry {
  private nextValue = 1;
  private readonly kindById = new Map<EntityId, EntityKind>();
  private readonly liveIds = new Set<EntityId>();
  private readonly destroyListeners: DestroyListener[] = [];

  create(kind: EntityKind): EntityId {
    assertValidKind(kind);
    const id = this.nextValue as EntityId;
    this.nextValue++;
    this.kindById.set(id, kind);
    this.liveIds.add(id);
    return id;
  }

  /** Retires an entity. Its id and kind remain permanently queryable — history/event references must keep resolving after death. */
  destroy(id: EntityId): void {
    this.assertKnown(id);
    if (!this.liveIds.has(id)) {
      throw new RangeError(`entity id ${id} is already destroyed`);
    }
    this.liveIds.delete(id);
    const kind = this.kindById.get(id)!;
    for (const listener of this.destroyListeners) listener(id, kind);
  }

  /** Notified synchronously when an entity is destroyed, so component storage (P0-03) can clean up without duplicating lifecycle bookkeeping. */
  onDestroy(listener: DestroyListener): Unsubscribe {
    this.destroyListeners.push(listener);
    return () => {
      const index = this.destroyListeners.indexOf(listener);
      if (index !== -1) this.destroyListeners.splice(index, 1);
    };
  }

  isLive(id: EntityId): boolean {
    return this.liveIds.has(id);
  }

  /** True if this id was ever allocated by this registry, live or destroyed. */
  isKnown(id: EntityId): boolean {
    return this.kindById.has(id);
  }

  kindOf(id: EntityId): EntityKind {
    this.assertKnown(id);
    return this.kindById.get(id)!;
  }

  get liveCount(): number {
    return this.liveIds.size;
  }

  get totalAllocatedCount(): number {
    return this.kindById.size;
  }

  /** Linear scan over live entities; fine at P0-02's scale. Revisit with a kind→Set index only if profiling shows it matters (ARCHITECTURE_CONTRACT §20). */
  liveIdsOfKind(kind: EntityKind): EntityId[] {
    const result: EntityId[] = [];
    for (const id of this.liveIds) {
      if (this.kindById.get(id) === kind) result.push(id);
    }
    return result;
  }

  getDebugState(): EntityIdRegistryDebugState {
    return {
      liveCount: this.liveCount,
      totalAllocatedCount: this.totalAllocatedCount,
      nextValue: this.nextValue,
      destroyListenerCount: this.destroyListeners.length,
    };
  }

  toSnapshot(): EntityIdRegistrySnapshot {
    const entities: SnapshotEntity[] = [];
    for (const [id, kind] of this.kindById) {
      entities.push({ id, kind, live: this.liveIds.has(id) });
    }
    return { version: SNAPSHOT_FORMAT_VERSION, nextValue: this.nextValue, entities };
  }

  /**
   * Reconstructs a registry from a snapshot, validating that the snapshot
   * cannot cause a future collision. This guards against more than the
   * common case: `Number.isInteger` rejects `NaN`/`Infinity`/fractional
   * values (plain `<=` comparisons against those are always `false` and
   * would otherwise silently defeat the collision check), and the
   * entity-count-matches-nextValue check catches a truncated/edited
   * `entities` array even when `nextValue` alone looks plausible — ids are
   * allocated as a gapless sequence starting at 1, so a valid snapshot's
   * entity count must always equal `nextValue - 1` exactly.
   */
  static fromSnapshot(snapshot: EntityIdRegistrySnapshot): EntityIdRegistry {
    if (snapshot.version !== SNAPSHOT_FORMAT_VERSION) {
      throw new RangeError(
        `unsupported EntityIdRegistry snapshot version ${snapshot.version}, expected ${SNAPSHOT_FORMAT_VERSION}`,
      );
    }
    if (!Number.isInteger(snapshot.nextValue) || snapshot.nextValue < 1) {
      throw new RangeError(`corrupt snapshot: nextValue must be a positive integer, got ${snapshot.nextValue}`);
    }

    const registry = new EntityIdRegistry();
    const seen = new Set<EntityId>();
    let maxId = 0;
    for (const entry of snapshot.entities) {
      if (!Number.isInteger(entry.id) || entry.id < 1) {
        throw new RangeError(`corrupt snapshot: entity id must be a positive integer, got ${entry.id}`);
      }
      if (seen.has(entry.id)) {
        throw new RangeError(`corrupt snapshot: duplicate entity id ${entry.id}`);
      }
      assertValidKind(entry.kind);
      seen.add(entry.id);
      if (entry.id > maxId) maxId = entry.id;
      registry.kindById.set(entry.id, entry.kind);
      if (entry.live) registry.liveIds.add(entry.id);
    }
    if (snapshot.nextValue <= maxId) {
      throw new RangeError(
        `corrupt snapshot: nextValue (${snapshot.nextValue}) must exceed every stored id (max ${maxId}), or reload could reissue a live/destroyed id`,
      );
    }
    if (snapshot.entities.length !== snapshot.nextValue - 1) {
      throw new RangeError(
        `corrupt snapshot: expected ${snapshot.nextValue - 1} entities (ids are a gapless sequence from 1), got ${snapshot.entities.length}`,
      );
    }
    registry.nextValue = snapshot.nextValue;
    return registry;
  }

  private assertKnown(id: EntityId): void {
    if (!this.kindById.has(id)) {
      throw new RangeError(`unknown entity id ${id}`);
    }
  }
}
