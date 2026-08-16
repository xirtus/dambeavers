/**
 * Headless acceptance test for P0-02 — Stable entity identity.
 *
 * Roadmap acceptance test (DAMN_BEAVERS_MASTER_ROADMAP.md, P0-02):
 *   "create 10,000 entities, save, reload, destroy 5,000, create 5,000
 *   more, and verify no surviving entity changes identity and no ID
 *   collision occurs."
 */
import { describe, expect, it } from "vitest";
import { EntityIdRegistry, type EntityId, type EntityKind } from "../../src/sim/core/EntityId.js";

const KINDS: EntityKind[] = ["beaver", "tree", "log", "stone", "fish"];

describe("P0-02 acceptance: identity survives create/save/reload/destroy/create churn", () => {
  it("keeps every surviving entity's identity stable and every new id collision-free", () => {
    const registry = new EntityIdRegistry();

    // 1. Create 10,000 entities.
    const createdKindById = new Map<EntityId, EntityKind>();
    for (let i = 0; i < 10_000; i++) {
      const kind = KINDS[i % KINDS.length]!;
      const id = registry.create(kind);
      createdKindById.set(id, kind);
    }
    expect(createdKindById.size).toBe(10_000);

    // 2. Save, reload -- a fresh registry reconstructed purely from the
    // serialized snapshot, exercising the identity system's own persistence
    // contract (not the full P0-06 save schema, which doesn't exist yet).
    const snapshot = registry.toSnapshot();
    const reloaded = EntityIdRegistry.fromSnapshot(snapshot);

    for (const [id, kind] of createdKindById) {
      expect(reloaded.isLive(id)).toBe(true);
      expect(reloaded.kindOf(id)).toBe(kind);
    }

    // 3. Destroy 5,000 of the original entities post-reload.
    const allIds = [...createdKindById.keys()];
    const destroyed = new Set(allIds.slice(0, 5_000));
    const survivors = allIds.slice(5_000);
    for (const id of destroyed) reloaded.destroy(id);

    // 4. Create 5,000 more entities on the reloaded registry.
    const newlyCreated: EntityId[] = [];
    for (let i = 0; i < 5_000; i++) {
      newlyCreated.push(reloaded.create(KINDS[i % KINDS.length]!));
    }

    // Surviving entities: identity (id + kind) unchanged, still live.
    for (const id of survivors) {
      expect(reloaded.isLive(id)).toBe(true);
      expect(reloaded.kindOf(id)).toBe(createdKindById.get(id));
    }

    // Destroyed entities: no longer live, but identity/kind still resolvable (history).
    for (const id of destroyed) {
      expect(reloaded.isLive(id)).toBe(false);
      expect(reloaded.kindOf(id)).toBe(createdKindById.get(id));
    }

    // No ID collision anywhere across the entire lineage: original 10,000
    // (5,000 survivors + 5,000 destroyed) plus 5,000 newly created.
    const everyId = [...survivors, ...destroyed, ...newlyCreated];
    expect(new Set(everyId).size).toBe(everyId.length);
    expect(everyId.length).toBe(15_000);

    // Final live population: 5,000 survivors + 5,000 new = 10,000.
    expect(reloaded.liveCount).toBe(10_000);
  });
});
