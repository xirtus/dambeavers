import { describe, expect, it } from "vitest";
import {
  PlantSpeciesRegistry,
  growthFraction,
  trunkVolumeM3,
  type PlantSpeciesDefinition,
} from "../../src/sim/ecology/PlantSpecies.js";

const ASPEN: PlantSpeciesDefinition = {
  id: "aspen",
  displayName: "Aspen",
  woodMaterialId: "wood",
  matureTrunkVolumeM3: 0.3,
  matureAgeTicks: 20_000,
  moisturePreference: 0.2,
};

describe("PlantSpeciesRegistry", () => {
  it("defines and retrieves a species", () => {
    const registry = new PlantSpeciesRegistry();
    registry.define(ASPEN);
    expect(registry.get("aspen")).toEqual(ASPEN);
    expect(registry.has("aspen")).toBe(true);
  });

  it("rejects a duplicate species id", () => {
    const registry = new PlantSpeciesRegistry();
    registry.define(ASPEN);
    expect(() => registry.define(ASPEN)).toThrow(RangeError);
  });

  it("rejects an unknown species id on get", () => {
    const registry = new PlantSpeciesRegistry();
    expect(() => registry.get("nonexistent")).toThrow(RangeError);
  });

  it("rejects a malformed species id", () => {
    const registry = new PlantSpeciesRegistry();
    expect(() => registry.define({ ...ASPEN, id: "Bad Id" })).toThrow(RangeError);
  });

  it("rejects a non-positive matureTrunkVolumeM3", () => {
    const registry = new PlantSpeciesRegistry();
    expect(() => registry.define({ ...ASPEN, matureTrunkVolumeM3: 0 })).toThrow(RangeError);
    expect(() => registry.define({ ...ASPEN, matureTrunkVolumeM3: -1 })).toThrow(RangeError);
  });

  it("rejects a non-integer or non-positive matureAgeTicks", () => {
    const registry = new PlantSpeciesRegistry();
    expect(() => registry.define({ ...ASPEN, matureAgeTicks: 0 })).toThrow(RangeError);
    expect(() => registry.define({ ...ASPEN, matureAgeTicks: 1.5 })).toThrow(RangeError);
  });

  it("reports debug state", () => {
    const registry = new PlantSpeciesRegistry();
    registry.define(ASPEN);
    expect(registry.getDebugState()).toEqual({ speciesCount: 1, ids: ["aspen"] });
  });
});

describe("growthFraction", () => {
  it("is 0 at age 0 and 1 at full maturity", () => {
    expect(growthFraction(ASPEN, 0)).toBe(0);
    expect(growthFraction(ASPEN, 20_000)).toBe(1);
  });

  it("is linear in age below maturity", () => {
    expect(growthFraction(ASPEN, 10_000)).toBeCloseTo(0.5, 10);
  });

  it("caps at 1 past maturity, never exceeding it", () => {
    expect(growthFraction(ASPEN, 999_999)).toBe(1);
  });

  it("rejects a negative or non-integer age", () => {
    expect(() => growthFraction(ASPEN, -1)).toThrow(RangeError);
    expect(() => growthFraction(ASPEN, 1.5)).toThrow(RangeError);
  });
});

describe("trunkVolumeM3", () => {
  it("scales linearly with growth", () => {
    expect(trunkVolumeM3(ASPEN, 10_000)).toBeCloseTo(0.15, 10);
    expect(trunkVolumeM3(ASPEN, 20_000)).toBeCloseTo(0.3, 10);
  });

  it("changes purely from species data, not code, when a species is redefined with different numbers", () => {
    const biggerAspen = { ...ASPEN, matureTrunkVolumeM3: 3.0 };
    expect(trunkVolumeM3(biggerAspen, 20_000)).toBeCloseTo(3.0, 10);
    expect(trunkVolumeM3(ASPEN, 20_000)).toBeCloseTo(0.3, 10); // original untouched
  });
});
