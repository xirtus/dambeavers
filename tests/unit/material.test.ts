import { describe, expect, it } from "vitest";
import {
  MaterialRegistry,
  floatsIn,
  hydraulicResistance,
  massOf,
  movementCostMultiplier,
  type MaterialDefinition,
} from "../../src/sim/materials/Material.js";

function baseMaterial(overrides: Partial<MaterialDefinition> = {}): MaterialDefinition {
  return {
    id: "test-material",
    displayName: "Test Material",
    density: 500,
    hardness: 1,
    strength: 1,
    friction: 0.3,
    permeability: 0.5,
    buoyancy: 1,
    thermalConductivity: 0.2,
    organic: false,
    decayResistance: 0.5,
    ...overrides,
  };
}

describe("MaterialRegistry.define validation", () => {
  it("accepts a valid definition", () => {
    const registry = new MaterialRegistry();
    expect(() => registry.define(baseMaterial())).not.toThrow();
  });

  it("rejects a non-kebab-case id", () => {
    const registry = new MaterialRegistry();
    expect(() => registry.define(baseMaterial({ id: "Test Material" }))).toThrow(RangeError);
    expect(() => registry.define(baseMaterial({ id: "" }))).toThrow(RangeError);
  });

  it("rejects an empty displayName", () => {
    const registry = new MaterialRegistry();
    expect(() => registry.define(baseMaterial({ displayName: "" }))).toThrow(RangeError);
  });

  it("rejects non-positive or non-finite density", () => {
    const registry = new MaterialRegistry();
    expect(() => registry.define(baseMaterial({ density: 0 }))).toThrow(RangeError);
    expect(() => registry.define(baseMaterial({ density: -5 }))).toThrow(RangeError);
    expect(() => registry.define(baseMaterial({ density: Number.NaN }))).toThrow(RangeError);
    expect(() => registry.define(baseMaterial({ density: Number.POSITIVE_INFINITY }))).toThrow(RangeError);
  });

  it("rejects negative hardness/strength/buoyancy/thermalConductivity", () => {
    const registry = new MaterialRegistry();
    expect(() => registry.define(baseMaterial({ hardness: -1 }))).toThrow(RangeError);
    expect(() => registry.define(baseMaterial({ strength: -1 }))).toThrow(RangeError);
    expect(() => registry.define(baseMaterial({ buoyancy: -1 }))).toThrow(RangeError);
    expect(() => registry.define(baseMaterial({ thermalConductivity: -1 }))).toThrow(RangeError);
  });

  it("rejects friction/permeability/decayResistance outside [0, 1]", () => {
    const registry = new MaterialRegistry();
    expect(() => registry.define(baseMaterial({ friction: -0.1 }))).toThrow(RangeError);
    expect(() => registry.define(baseMaterial({ friction: 1.1 }))).toThrow(RangeError);
    expect(() => registry.define(baseMaterial({ permeability: 1.5 }))).toThrow(RangeError);
    expect(() => registry.define(baseMaterial({ decayResistance: -0.5 }))).toThrow(RangeError);
  });

  it("rejects redefining an id that is already registered", () => {
    const registry = new MaterialRegistry();
    registry.define(baseMaterial());
    expect(() => registry.define(baseMaterial())).toThrow(RangeError);
  });
});

describe("MaterialRegistry lookup", () => {
  it("retrieves a defined material by id", () => {
    const registry = new MaterialRegistry();
    registry.define(baseMaterial({ id: "mud" }));
    expect(registry.get("mud").displayName).toBe("Test Material");
    expect(registry.has("mud")).toBe(true);
  });

  it("throws for an unknown id", () => {
    const registry = new MaterialRegistry();
    expect(() => registry.get("nonexistent")).toThrow(RangeError);
    expect(registry.has("nonexistent")).toBe(false);
  });

  it("returns a frozen definition that can't be mutated after registration", () => {
    const registry = new MaterialRegistry();
    registry.define(baseMaterial({ id: "mud" }));
    const mud = registry.get("mud");
    expect(() => {
      (mud as { density: number }).density = 99999;
    }).toThrow();
    expect(registry.get("mud").density).toBe(500);
  });

  it("lists all defined materials and reports debug state", () => {
    const registry = new MaterialRegistry();
    registry.define(baseMaterial({ id: "a" }));
    registry.define(baseMaterial({ id: "b" }));
    expect(registry.all().map((m) => m.id).sort()).toEqual(["a", "b"]);
    expect(registry.getDebugState()).toEqual({ materialCount: 2, ids: ["a", "b"] });
  });
});

describe("Derived behavior functions are pure functions of properties", () => {
  it("floatsIn depends only on density vs the given fluid density", () => {
    const light = baseMaterial({ density: 500 });
    const heavy = baseMaterial({ density: 1500 });
    expect(floatsIn(light, 1000)).toBe(true);
    expect(floatsIn(heavy, 1000)).toBe(false);
  });

  it("hydraulicResistance is the complement of permeability", () => {
    expect(hydraulicResistance(baseMaterial({ permeability: 0 }))).toBe(1);
    expect(hydraulicResistance(baseMaterial({ permeability: 1 }))).toBe(0);
    expect(hydraulicResistance(baseMaterial({ permeability: 0.3 }))).toBeCloseTo(0.7, 10);
  });

  it("movementCostMultiplier increases monotonically with friction", () => {
    const low = movementCostMultiplier(baseMaterial({ friction: 0 }));
    const high = movementCostMultiplier(baseMaterial({ friction: 1 }));
    expect(low).toBe(1);
    expect(high).toBe(2);
    expect(high).toBeGreaterThan(low);
  });

  it("massOf multiplies density by volume in cubic meters", () => {
    const wood = baseMaterial({ density: 600 });
    expect(massOf(wood, 0.05)).toBeCloseTo(30, 10); // half a log's worth
    expect(massOf(wood, 0)).toBe(0);
  });

  it("changing only a material's properties (not writing new code) changes every derived behavior", () => {
    // This is the acceptance test's core claim in miniature: one material
    // "recipe" (same id semantics, different property values) drives
    // different results through the exact same formulas.
    const mudA = baseMaterial({ id: "mud-a", density: 900, permeability: 0.8, friction: 0.9 });
    const mudB = baseMaterial({ id: "mud-b", density: 1900, permeability: 0.1, friction: 0.1 });

    expect(floatsIn(mudA, 1000)).toBe(true);
    expect(floatsIn(mudB, 1000)).toBe(false);
    expect(hydraulicResistance(mudA)).toBeLessThan(hydraulicResistance(mudB));
    expect(movementCostMultiplier(mudA)).toBeGreaterThan(movementCostMultiplier(mudB));
  });
});
