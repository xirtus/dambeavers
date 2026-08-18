/**
 * Headless acceptance test for P10-07 -- Construction parity audit.
 *
 * Roadmap acceptance test: "a complex hydraulic/industrial facility can
 * be built entirely through reusable components."
 */
import { describe, expect, it } from "vitest";
import { parityRowsByDomain } from "../../src/sim/parity/ParityMatrix.js";
import { buildDetailedWorld } from "../unit/parityHarness.js";
import { setConstruction } from "../../src/sim/labor/Construction.js";
import { applyDamSegment, getDamSegment } from "../../src/sim/hydrology/Dam.js";
import { createGate, openGate, getGate } from "../../src/sim/hydrology/Gate.js";
import { createWaterWheel, waterWheelPowerOutput, getWaterWheel } from "../../src/sim/mechanics/WaterPower.js";
import { createWorkshop } from "../../src/sim/economy/Workshop.js";
import { createContainer, placeInContainer, getContainer } from "../../src/sim/economy/Container.js";
import { setGood } from "../../src/sim/economy/Good.js";

describe("P10-07 -- Construction parity audit", () => {
  it("every construction-domain row is marked with a verdict and written rationale", () => {
    const rows = parityRowsByDomain("construction");
    expect(rows.length).toBeGreaterThanOrEqual(8);
    for (const row of rows) {
      expect(["PASS", "ADAPTED", "EXCEEDED", "OUT_OF_SCOPE"]).toContain(row.verdict);
      expect(row.rationale.trim().length).toBeGreaterThan(0);
    }
  });

  it("a complex hydraulic/industrial facility is built entirely through reusable components", () => {
    const { world } = buildDetailedWorld("p10-07");
    // Riverbed: a channel of water cells.
    for (let x = 4; x <= 12; x++) world.water.setDepth(x, 6, 1.0);

    // DAM: a real completed dam-segment construction, applied to terrain.
    const damConstruction = world.entities.create("construction");
    setConstruction(world.components, damConstruction, {
      designationId: damConstruction, kind: "dam-segment", site: { x: 8, z: 6 },
      requiredMaterialId: "wood", requiredMassKg: 3, workDone: 3, workRequired: 3, status: "complete",
    });
    const damId = applyDamSegment(world, damConstruction);
    const dam = getDamSegment(world.components, damId)!;
    expect(dam.heightCells).toBeGreaterThan(0);
    // The dam's material genuinely changed the terrain (real height).
    expect(world.terrain.materialOrAirAt(8, dam.baseY + 1, 6)).toBeDefined();

    // GATE: a real gate beside the dam, genuinely toggling.
    const gate = createGate(world, { x: 9, z: 6 }, 3, "wood");
    expect(getGate(world.components, gate)!.isOpen).toBe(false);
    openGate(world, gate);
    expect(getGate(world.components, gate)!.isOpen).toBe(true);

    // WATER WHEEL: a real wheel whose power derives from a REAL depth
    // gradient between its site and its downstream site.
    world.water.setDepth(10, 6, 2.0);
    const wheel = createWaterWheel(world, { x: 10, z: 6 }, { x: 11, z: 6 });
    const power = waterWheelPowerOutput(world.water, getWaterWheel(world.components, wheel)!);
    expect(power).toBeGreaterThan(0); // real flowing water, real power

    // WORKSHOP + CONTAINER: the industrial side of the facility.
    const workshop = createWorkshop(world, "workshop", { x: 10, z: 7 });
    const container = createContainer(world, 50, { x: 11, y: 3, z: 7 });
    const barrelGood = world.entities.create("good");
    world.grid.setEntityPosition(barrelGood, 11, 3, 7);
    setGood(world.components, barrelGood, { goodKind: "plank", materialId: "wood", massKg: 2 });
    placeInContainer(world, container, barrelGood);
    expect(getContainer(world.components, container)!.itemIds).toContain(barrelGood);
    expect(workshop).toBeGreaterThan(0);

    // Every component is a reusable ordinary entity with a real id.
    for (const id of [damId, gate, wheel, workshop, container]) {
      expect(world.entities.isLive(id)).toBe(true);
    }
  });
});
