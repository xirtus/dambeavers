/**
 * Headless acceptance test for P0-07 — Material definition system.
 *
 * Roadmap acceptance test (DAMN_BEAVERS_MASTER_ROADMAP.md, P0-07):
 *   "changing a material definition alters physical/systemic behavior
 *   without changing code specific to that material."
 *
 * What this file actually proves, and what it doesn't:
 *
 *  - REAL, load-bearing guarantee: `floatsIn`/`hydraulicResistance`/
 *    `movementCostMultiplier`/`massOf` are typed to take
 *    `MaterialProperties`, which structurally has no `id`/`displayName`
 *    field. `identityFieldsAreUnreachable` below is a compile-time proof
 *    of that (part of `npm run typecheck`, not just this test file) --
 *    if `MaterialProperties` ever gained an identity field, that line
 *    stops compiling. Identity-branching inside those four functions is
 *    therefore not just undiscovered, it is impossible to write.
 *  - WEAKER, source-scanning check: the tests below additionally grep for
 *    `.id ===`/`.displayName ===` across every file in
 *    `src/sim/materials/`, to catch a future consumer (this directory
 *    only, for now -- extend the glob as P0-09/P0-10/P1-09/P1-11 land)
 *    branching on a `MaterialDefinition` it was handed instead of staying
 *    inside the `MaterialProperties`-typed helpers.
 *  - NOT covered by anything here: value-based special-casing, e.g.
 *    `if (material.density === 600) { ... }`. That is the same
 *    scripted-outcome smell (ARCHITECTURE_CONTRACT §7) wearing a
 *    different disguise, and no automated check in this file can rule it
 *    out -- it remains a code-review concern for every PR touching this
 *    directory or its future consumers.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  MaterialRegistry,
  floatsIn,
  hydraulicResistance,
  movementCostMultiplier,
  type MaterialProperties,
  type MaterialDefinition,
} from "../../src/sim/materials/Material.js";
import { registerStandardMaterials } from "../../src/sim/materials/standardMaterials.js";

// Compile-time proof: fails `tsc --noEmit` if MaterialProperties ever grows
// an `id` or `displayName` field, which would make identity-branching
// possible inside functions typed to take only MaterialProperties.
type HasIdentityField = "id" extends keyof MaterialProperties
  ? true
  : "displayName" extends keyof MaterialProperties
    ? true
    : false;
const identityFieldsAreUnreachable: HasIdentityField extends false ? true : never = true;
void identityFieldsAreUnreachable;

function makeMaterial(overrides: Partial<MaterialDefinition>): MaterialDefinition {
  return {
    id: "sample",
    displayName: "Sample",
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

describe("P0-07 acceptance: behavior code contains no material-specific branching", () => {
  it("Material.ts's behavior-function section never references a material id/name literal", () => {
    const materialSourcePath = fileURLToPath(new URL("../../src/sim/materials/Material.ts", import.meta.url));
    const source = readFileSync(materialSourcePath, "utf8");

    // Only inspect the behavior-function section (after the class), so the
    // registry's own generic validation code (which legitimately has no
    // material names either) doesn't dilute the check.
    const behaviorSection = source.slice(source.indexOf("// --- Generic derived behavior"));

    for (const knownId of ["water", "air", "soil", "clay", "sand", "stone", "wood", "bark", "leaves"]) {
      expect(behaviorSection).not.toContain(`"${knownId}"`);
      expect(behaviorSection).not.toContain(`'${knownId}'`);
    }
    expect(behaviorSection).not.toMatch(/\bswitch\s*\(/);
    expect(behaviorSection).not.toMatch(/\.id\s*===/);
    expect(behaviorSection).not.toMatch(/\.displayName\s*===/);
  });

  it("no file in src/sim/materials/ branches on a material's identity (.id === / .displayName ===)", () => {
    // Wider than the check above: this one covers standardMaterials.ts and
    // any other file later added to this directory. It does NOT flag
    // `id: "wood"` (a legitimate data-definition property), only actual
    // comparison/branching patterns.
    const dirPath = fileURLToPath(new URL("../../src/sim/materials/", import.meta.url));
    const files = readdirSync(dirPath).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const source = readFileSync(join(dirPath, file), "utf8");
      expect(source, `${file} contains .id === branching`).not.toMatch(/\.id\s*===/);
      expect(source, `${file} contains .displayName === branching`).not.toMatch(/\.displayName\s*===/);
    }
  });
});

describe("P0-07 acceptance: changing a material definition changes behavior via data alone", () => {
  it("redefining the SAME conceptual material with different properties flips every derived outcome", () => {
    // Two registries, standing in for "before" and "after" changing one
    // material's definition (a game designer tuning a materials.json, not
    // a code change) -- same id, same behavior functions, different data.
    const before = new MaterialRegistry();
    before.define(
      makeMaterial({ id: "experimental-wood", density: 400, permeability: 0.2, friction: 0.8 }),
    );

    const after = new MaterialRegistry();
    after.define(
      makeMaterial({ id: "experimental-wood", density: 1400, permeability: 0.9, friction: 0.1 }),
    );

    const woodBefore = before.get("experimental-wood");
    const woodAfter = after.get("experimental-wood");

    expect(floatsIn(woodBefore, 1000)).toBe(true);
    expect(floatsIn(woodAfter, 1000)).toBe(false);

    expect(hydraulicResistance(woodBefore)).toBeGreaterThan(hydraulicResistance(woodAfter));
    expect(movementCostMultiplier(woodBefore)).toBeGreaterThan(movementCostMultiplier(woodAfter));
  });

  it("the real standard material set demonstrates the same pattern across genuinely different substances", () => {
    const registry = new MaterialRegistry();
    registerStandardMaterials(registry);

    const wood = registry.get("wood");
    const stone = registry.get("stone");
    const water = registry.get("water");

    // A beaver-built dam: the SAME hydraulicResistance() function applied
    // to different delivered materials gives physically sensible,
    // data-driven obstruction differences -- exactly what P1-11 (dam
    // structure/hydraulic interaction) will need, without this file
    // knowing anything about dams.
    expect(hydraulicResistance(registry.get("clay"))).toBeGreaterThan(hydraulicResistance(registry.get("sand")));

    // A log (wood) floats and displaces water; stone used for the same
    // structure would not.
    expect(floatsIn(wood, water.density)).toBe(true);
    expect(floatsIn(stone, water.density)).toBe(false);
  });
});
