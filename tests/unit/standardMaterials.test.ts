import { describe, expect, it } from "vitest";
import { MaterialRegistry, floatsIn } from "../../src/sim/materials/Material.js";
import { STANDARD_MATERIALS, registerStandardMaterials } from "../../src/sim/materials/standardMaterials.js";

const EXPECTED_IDS = [
  "water",
  "air",
  "soil",
  "clay",
  "sand",
  "stone",
  "wood",
  "bark",
  "leaves",
  "plant-matter",
];

describe("standard materials", () => {
  it("registers all roadmap-required materials without validation errors", () => {
    const registry = new MaterialRegistry();
    expect(() => registerStandardMaterials(registry)).not.toThrow();
    for (const id of EXPECTED_IDS) {
      expect(registry.has(id)).toBe(true);
    }
    expect(registry.getDebugState().materialCount).toBe(EXPECTED_IDS.length);
  });

  it("defines exactly the roadmap-listed materials, no more, no fewer", () => {
    expect(STANDARD_MATERIALS.map((m) => m.id).sort()).toEqual([...EXPECTED_IDS].sort());
  });

  it("wood and bark float in water; stone and sand sink", () => {
    const registry = new MaterialRegistry();
    registerStandardMaterials(registry);
    const water = registry.get("water");
    expect(floatsIn(registry.get("wood"), water.density)).toBe(true);
    expect(floatsIn(registry.get("bark"), water.density)).toBe(true);
    expect(floatsIn(registry.get("stone"), water.density)).toBe(false);
    expect(floatsIn(registry.get("sand"), water.density)).toBe(false);
  });

  it("clay is far less permeable than sand (dam-core vs. drainage material)", () => {
    const registry = new MaterialRegistry();
    registerStandardMaterials(registry);
    expect(registry.get("clay").permeability).toBeLessThan(registry.get("sand").permeability);
  });
});
