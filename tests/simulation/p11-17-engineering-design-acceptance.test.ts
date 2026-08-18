/**
 * Headless acceptance test for P11-17 -- Engineering design knowledge.
 *
 * Roadmap acceptance test:
 *   "structures can embody design concepts and builders can copy,
 *   modify, improve, or forget them."
 *
 * A design is recorded from a REALLY built structure (its pattern is
 * the entity's own real component set), held through the same
 * TechKnowledge ledger as recipes, copyable by a different household
 * that learned it (a real derived design with real lineage), mutable
 * (a modification derives, never edits), and forgettable (a household
 * that did not maintain it loses it from its own ledger).
 */
import { describe, expect, it } from "vitest";
import { buildDetailedWorld } from "../unit/parityHarness.js";
import { createHousehold } from "../../src/sim/creatures/Relationships.js";
import { setConstruction } from "../../src/sim/labor/Construction.js";
import { applyDamSegment } from "../../src/sim/hydrology/Dam.js";
import { recordDesign, copyDesign, modifyDesign, forgetDesign, designsOf, knowsDesign, getDesign } from "../../src/sim/structures/DesignKnowledge.js";

describe("P11-17 engineering design acceptance", () => {
  it("a design recorded from a real build can be copied, modified, and forgotten", () => {
    const { world } = buildDetailedWorld("p11-17");
    const builderHousehold = createHousehold(world);
    const learnerHousehold = createHousehold(world);

    // Really build a dam segment (the structure the design embodies).
    const construction = world.entities.create("construction");
    world.grid.setEntityPosition(construction, 6, 3, 6);
    setConstruction(world.components, construction, {
      designationId: construction,
      kind: "dam-segment",
      site: { x: 6, z: 6 },
      requiredMaterialId: "wood",
      requiredMassKg: 1,
      workDone: 1,
      workRequired: 1,
      status: "complete",
    });
    const damSegmentId = applyDamSegment(world, construction);

    // The design is recorded from the REAL structure's own component
    // set -- not an authored blueprint.
    const designId = recordDesign(world, damSegmentId, builderHousehold);
    const design = getDesign(world.components, designId)!;
    expect(design.pattern.componentKinds.length).toBeGreaterThan(0);
    expect(design.pattern.componentKinds).toContain("dam-segment");
    expect(knowsDesign(world, builderHousehold, designId)).toBe(true);

    // A different household that learned it gets a real COPY with real
    // lineage.
    const copyId = copyDesign(world, designId, learnerHousehold);
    const copy = getDesign(world.components, copyId)!;
    expect(copy.derivedFromDesignId).toBe(designId);
    expect(knowsDesign(world, learnerHousehold, copyId)).toBe(true);
    expect(designsOf(world, learnerHousehold)).toContain(copyId);

    // Modification derives: the parent is untouched, the child's
    // pattern changed.
    const modifiedId = modifyDesign(world, copyId, { widthX: 4 });
    const modified = getDesign(world.components, modifiedId)!;
    expect(modified.derivedFromDesignId).toBe(copyId);
    expect(modified.pattern.widthX).toBe(4);
    expect(getDesign(world.components, copyId)!.pattern.widthX).toBeUndefined();

    // Forgetting is real: a household that did not maintain it loses it
    // from its own ledger -- the design entity itself persists.
    forgetDesign(world, learnerHousehold, copyId);
    expect(knowsDesign(world, learnerHousehold, copyId)).toBe(false);
    expect(world.entities.isLive(copyId)).toBe(true);
    // The builder still holds their original.
    expect(knowsDesign(world, builderHousehold, designId)).toBe(true);
  });

  it("a design cannot be recorded from something that was never built", () => {
    const { world } = buildDetailedWorld("p11-17b");
    const household = createHousehold(world);
    const bogusId = 987654 as Parameters<typeof recordDesign>[1];
    expect(() => recordDesign(world, bogusId, household)).toThrow();
    // A live entity with no components carries no structural pattern.
    const bare = world.entities.create("food");
    expect(() => recordDesign(world, bare, household)).toThrow();
  });
});
