/**
 * Headless acceptance test for P0-03 — Universal component/state model.
 *
 * Roadmap acceptance test (DAMN_BEAVERS_MASTER_ROADMAP.md, P0-03):
 *   "a log, beaver, tree, wall, fish, and corpse can coexist in the same
 *   world while sharing only the components appropriate to them."
 *
 * The component shapes used here are intentionally minimal test-local
 * stand-ins (a real Transform/Creature/Plant/Structure/Physical component
 * set belongs to the features that actually need them -- P0-05, P0-07,
 * P1-05, P0-10). This test exists to prove the composition MECHANISM is
 * general, not to pre-design those future systems' data.
 *
 * "Corpse" is deliberately not spawned as its own kind: a corpse is what a
 * beaver becomes when it dies, so the test drives that transition by
 * removing the beaver's living-creature components and attaching a corpse
 * component -- exercising dynamic composition change over an entity's
 * life, not just static assignment at creation, per AGENTS.md 1.1 (systems,
 * not scripted outcomes: death changes state, it doesn't swap the entity).
 */
import { describe, expect, it } from "vitest";
import { ComponentStore, defineComponent } from "../../src/sim/core/ComponentStore.js";
import { EntityIdRegistry, type EntityId } from "../../src/sim/core/EntityId.js";

interface Transform {
  x: number;
  y: number;
  z: number;
}
interface Physical {
  massKg: number;
}
interface Creature {
  species: string;
}
interface Needs {
  hunger: number;
}
interface Plant {
  growthStage: number;
}
interface Structure {
  integrity: number;
}
interface Corpse {
  diedAtTick: number;
}

const Transform = defineComponent<Transform>("transform");
const Physical = defineComponent<Physical>("physical");
const Creature = defineComponent<Creature>("creature");
const Needs = defineComponent<Needs>("needs");
const Plant = defineComponent<Plant>("plant");
const Structure = defineComponent<Structure>("structure");
const Corpse = defineComponent<Corpse>("corpse");

describe("P0-03 acceptance: heterogeneous entities coexist sharing only appropriate components", () => {
  it("lets a log, beaver, tree, wall, and fish coexist with disjoint-as-appropriate component sets", () => {
    const registry = new EntityIdRegistry();
    const store = new ComponentStore(registry);

    const log = registry.create("log");
    store.set(log, Transform, { x: 1, y: 0, z: 1 });
    store.set(log, Physical, { massKg: 40 });

    const beaver = registry.create("beaver");
    store.set(beaver, Transform, { x: 2, y: 0, z: 2 });
    store.set(beaver, Creature, { species: "castor-fabricatus" });
    store.set(beaver, Needs, { hunger: 0.2 });

    const tree = registry.create("tree");
    store.set(tree, Transform, { x: 3, y: 0, z: 3 });
    store.set(tree, Plant, { growthStage: 4 });

    const wall = registry.create("wall");
    store.set(wall, Transform, { x: 4, y: 0, z: 4 });
    store.set(wall, Structure, { integrity: 1 });

    const fish = registry.create("fish");
    store.set(fish, Transform, { x: 5, y: 0, z: 5 });
    store.set(fish, Creature, { species: "salmo-castorum" });

    // All five share Transform -- the one component appropriate to every physical thing.
    expect(store.query(Transform).sort()).toEqual([log, beaver, tree, wall, fish].sort());

    // Only creatures have Creature; only the beaver additionally has Needs.
    expect(store.query(Creature).sort()).toEqual([beaver, fish].sort());
    expect(store.query(Needs)).toEqual([beaver]);

    // Only the log has Physical (a haulable inert object); the wall does not.
    expect(store.query(Physical)).toEqual([log]);

    // Only the tree has Plant; only the wall has Structure.
    expect(store.query(Plant)).toEqual([tree]);
    expect(store.query(Structure)).toEqual([wall]);

    // Cross-kind component sets never leak: a tree is never a creature, a
    // wall never has needs, a fish never has plant growth.
    expect(store.has(tree, Creature)).toBe(false);
    expect(store.has(wall, Needs)).toBe(false);
    expect(store.has(fish, Plant)).toBe(false);
  });

  it("turns a beaver into a corpse via component transition, not entity replacement", () => {
    const registry = new EntityIdRegistry();
    const store = new ComponentStore(registry);

    const beaver = registry.create("beaver");
    store.set(beaver, Transform, { x: 0, y: 0, z: 0 });
    store.set(beaver, Creature, { species: "castor-fabricatus" });
    store.set(beaver, Needs, { hunger: 0.9 });

    expect(store.query(Creature)).toEqual([beaver]);

    // Death: the living-creature components are removed and a corpse
    // component is attached to the SAME entity id -- its identity, and its
    // Transform (where the body lies), survive the transition unchanged.
    store.remove(beaver, Creature);
    store.remove(beaver, Needs);
    store.set(beaver, Corpse, { diedAtTick: 4200 });

    expect(store.has(beaver, Creature)).toBe(false);
    expect(store.has(beaver, Needs)).toBe(false);
    expect(store.get(beaver, Corpse)).toEqual({ diedAtTick: 4200 });
    expect(store.get(beaver, Transform)).toEqual({ x: 0, y: 0, z: 0 });
    expect(store.query(Creature)).toEqual([]);
    expect(store.query(Corpse)).toEqual([beaver]);
    expect(registry.isLive(beaver)).toBe(true); // the corpse is still a world object, not deleted
    expect(registry.kindOf(beaver)).toBe("beaver"); // stable identity: it is still entity "beaver" #N, now bearing a Corpse component
  });

  it("removes a destroyed entity's components entirely while five others remain untouched", () => {
    const registry = new EntityIdRegistry();
    const store = new ComponentStore(registry);
    const ids: Record<string, EntityId> = {
      log: registry.create("log"),
      beaver: registry.create("beaver"),
      tree: registry.create("tree"),
      wall: registry.create("wall"),
      fish: registry.create("fish"),
    };
    for (const id of Object.values(ids)) {
      store.set(id, Transform, { x: 0, y: 0, z: 0 });
    }
    store.set(ids["log"]!, Physical, { massKg: 40 });

    registry.destroy(ids["log"]!);

    expect(store.typesOf(ids["log"]!)).toEqual([]);
    expect(store.query(Physical)).toEqual([]);
    // Everything else, unaffected.
    expect(
      store.query(Transform).sort(),
    ).toEqual([ids["beaver"]!, ids["tree"]!, ids["wall"]!, ids["fish"]!].sort());
  });
});
