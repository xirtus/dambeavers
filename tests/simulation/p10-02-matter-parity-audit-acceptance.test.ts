/**
 * Headless acceptance test for P10-02 -- Matter parity audit.
 *
 * Roadmap acceptance test: "all checklist interactions have a universal
 * mechanistic implementation or documented beaver-world analogue."
 */
import { describe, expect, it } from "vitest";
import { parityRowsByDomain, PARITY_MATRIX } from "../../src/sim/parity/ParityMatrix.js";
import { buildDetailedWorld } from "../unit/parityHarness.js";
import { setGood } from "../../src/sim/economy/Good.js";
import { makeWeapon, attackForceOf } from "../../src/sim/politics/Weaponry.js";
import { spawnBeaver } from "../../src/sim/creatures/Beaver.js";
import { applyThermalTick } from "../../src/sim/creatures/BeaverNeeds.js";
import { getNeeds } from "../../src/sim/creatures/Needs.js";

describe("P10-02 -- Matter parity audit", () => {
  it("every matter-domain row is marked, and each has a mechanistic implementation or a documented analogue", () => {
    const rows = parityRowsByDomain("matter");
    expect(rows.length).toBeGreaterThan(8);
    for (const row of rows) {
      expect(["PASS", "ADAPTED", "EXCEEDED", "OUT_OF_SCOPE"]).toContain(row.verdict);
      expect(row.rationale.trim().length).toBeGreaterThan(0);
      // Mechanistic rows cite real modules; out-of-scope rows say why.
      if (row.verdict === "OUT_OF_SCOPE") expect((row.scopeReason ?? "").trim().length).toBeGreaterThan(0);
      else expect(row.evidence.length).toBeGreaterThan(0);
    }
  });

  it("material properties are the universal mechanism: the SAME property table drives weapons, thermal exposure, and fire", () => {
    const { world, materials } = buildDetailedWorld("p10-02");
    const beaver = spawnBeaver(world, { name: "A", position: { x: 3, y: 3, z: 3 } });

    // Density/hardness drive weapon force (row 103's mechanism).
    const woodClub = world.entities.create("good");
    setGood(world.components, woodClub, { goodKind: "club", materialId: "wood", massKg: 10 });
    makeWeapon(world.components, woodClub, "club", 2, 0.2);
    const stoneClub = world.entities.create("good");
    setGood(world.components, stoneClub, { goodKind: "club", materialId: "stone", massKg: 10 });
    makeWeapon(world.components, stoneClub, "club", 2, 0.2);
    const woodForce = attackForceOf(materials, world.components, woodClub);
    const stoneForce = attackForceOf(materials, world.components, stoneClub);
    expect(stoneForce).toBeGreaterThan(woodForce); // stone hardness 5 > wood 2, same geometry/mass

    // Thermal conductivity drives exposure (water vs air, row 103 again).
    const dryBefore = getNeeds(world.components, beaver)!.thermalComfort;
    applyThermalTick(world.water, materials, world.components, beaver, { x: 3, z: 3 });
    expect(getNeeds(world.components, beaver)!.thermalComfort).toBeGreaterThanOrEqual(dryBefore - 0.001); // air is mild
    world.water.setDepth(3, 3, 1.0);
    const wetBefore = getNeeds(world.components, beaver)!.thermalComfort;
    applyThermalTick(world.water, materials, world.components, beaver, { x: 3, z: 3 });
    expect(getNeeds(world.components, beaver)!.thermalComfort).toBeLessThan(wetBefore); // water's real conductivity cools fast

    // Organic origin is the real combustion driver (rows 103/233): wood
    // burns, stone does not.
    expect(materials.get("wood")!.organic).toBe(true);
    expect(materials.get("stone")!.organic).toBe(false);
  });

  it("the documented-analogue contract holds for out-of-scope rows", () => {
    const byId = new Map(PARITY_MATRIX.map((row) => [row.id, row]));
    // 230 Dissolved chemistry WAS out of scope with a written analogue
    // (water as uniform columns); Phase 11 (P11-03) delivered it, so
    // the row is now PASS with real evidence -- the honest post-Phase-11
    // state this audit's own gate discipline requires.
    expect(byId.get(230)!.verdict).toBe("PASS");
    expect(byId.get(230)!.evidence.length).toBeGreaterThan(0);
    // A still-out-of-scope row keeps the written-analogue contract.
    expect(byId.get(226)!.verdict).toBe("OUT_OF_SCOPE");
    expect((byId.get(226)!.scopeReason ?? "").length).toBeGreaterThan(0);
  });
});
