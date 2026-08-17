import { describe, expect, it } from "vitest";
import { ALL_COMPONENT_TYPES } from "../../src/sim/persistence/AllComponentTypes.js";

describe("ALL_COMPONENT_TYPES", () => {
  it("contains exactly one entry per real component type defined anywhere in src/sim (55 today)", () => {
    // A real, load-bearing count -- not a rubber-stamp assertion. If this
    // ever drifts from the actual number of `defineComponent<T>(...)`
    // call sites in `src/sim` (excluding this file's own doc comment and
    // `ComponentStore.ts`'s own generic definition), either a new
    // component type was added without registering it here (a real gap
    // P1-21's "full watershed" save would silently miss), or this
    // constant is stale.
    expect(ALL_COMPONENT_TYPES.size).toBe(55);
  });

  it("every key matches the ComponentType's own `.name`", () => {
    for (const [key, type] of ALL_COMPONENT_TYPES) {
      expect(type.name).toBe(key);
    }
  });

  it("has no duplicate ComponentType instances registered under different keys", () => {
    const seen = new Set(ALL_COMPONENT_TYPES.values());
    expect(seen.size).toBe(ALL_COMPONENT_TYPES.size);
  });

  it("includes every subsystem the roadmap's own P1-21 'Preserve:' list names", () => {
    // jobs, reservations, inventories, constructions, plants,
    // relationships -- terrain/water/flow-relevant state/time-weather are
    // NOT ComponentStore entries (they're `World`'s own grid-shaped
    // singleton subsystems, P1-21's other half); "seven beavers"/"needs"
    // are the identity/needs component types below.
    const expectedKeys = [
      "job",
      "reservation",
      "required-tool",
      "tool",
      "labor-preferences",
      "inventory",
      "construction",
      "plant",
      "food-producer",
      "food-spoilage",
      "relationships",
      "parentage",
      "reproductive-state",
      "life-stage",
      "social-state",
      "traits",
      "stockpile",
      "refuse",
      "zone",
      "sleep-space",
      "sleep-claim",
      "burial-progress",
      "grave",
      "needs",
      "identity",
    ];
    for (const key of expectedKeys) {
      expect(ALL_COMPONENT_TYPES.has(key)).toBe(true);
    }
  });
});
