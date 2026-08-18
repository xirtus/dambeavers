/**
 * Headless acceptance test for P11-03 -- Fluid composition.
 *
 * Roadmap acceptance test:
 *   "mixing two liquid volumes conserves components and downstream
 *   systems respond to resulting composition."
 *
 * Liquids are real mixtures (P3-08's `LiquidContents.composition`),
 * mixed by P3-08's own volume-weighted transfer; containers filled from
 * a water column DERIVE their composition from the column's real
 * environmental readings (P4-15 contamination, P4-14 fertility) --
 * the standard component vocabulary (water/alcohol/nutrients/silt/salt/
 * toxins/pathogens/organic matter) as named keys, never an authored
 * per-location table. The downstream response is P11-04's metabolism,
 * which this file leaves to its own acceptance test (the composition
 * contract here is what that test consumes).
 */
import { describe, expect, it } from "vitest";
import { buildDetailedWorld } from "../unit/parityHarness.js";
import {
  FLUID_COMPONENTS,
  createLiquidContainer,
  getLiquidContents,
  setLiquidContents,
  transferLiquid,
  fillContainerFromColumn,
  consumeLiquid,
} from "../../src/sim/economy/Liquid.js";

describe("P11-03 fluid composition acceptance", () => {
  it("mixing two liquid volumes conserves components exactly", () => {
    const { world } = buildDetailedWorld("p11-03");
    const a = createLiquidContainer(world, 20, { x: 3, y: 3, z: 3 });
    const b = createLiquidContainer(world, 20, { x: 4, y: 3, z: 3 });
    setLiquidContents(world.components, a, { capacityL: 20, materialId: "water", volumeL: 5, composition: { silt: 0.4 } });
    setLiquidContents(world.components, b, { capacityL: 20, materialId: "water", volumeL: 5, composition: { alcohol: 0.2 } });

    const moved = transferLiquid(world.components, a, b, 5);
    expect(moved).toBe(5);

    const mixed = getLiquidContents(world.components, b)!;
    // Volume-weighted average: (5*0 + 5*0.4)/10 for silt, (5*0.2 + 5*0)/10 for alcohol.
    expect(mixed.composition["silt"]).toBeCloseTo(0.2, 10);
    expect(mixed.composition["alcohol"]).toBeCloseTo(0.1, 10);
    // Conservation: the total component mass before and after is the
    // same -- nothing invented, nothing destroyed.
    const siltAfter = mixed.volumeL * (mixed.composition["silt"] ?? 0);
    expect(siltAfter).toBeCloseTo(5 * 0.4, 10);
    // The source genuinely emptied.
    expect(getLiquidContents(world.components, a)!.volumeL).toBe(0);
  });

  it("a container filled from a column derives composition from the column's real environmental readings", () => {
    const { world } = buildDetailedWorld("p11-03b");
    world.water.setDepth(5, 5, 2.0);
    const container = createLiquidContainer(world, 10, { x: 5, y: 3, z: 5 });

    const drawn = fillContainerFromColumn(world, container, 5, 5, 1.5, { contamination: 0.8, fertility: 0.5, salinity: 0.1 });
    expect(drawn).toBeCloseTo(1.5, 10);
    // Mass conservation: the water column lost exactly what the
    // container gained.
    expect(world.water.depthAt(5, 5)).toBeCloseTo(0.5, 10);

    const liquid = getLiquidContents(world.components, container)!;
    expect(liquid.materialId).toBe("water");
    // Real derived composition: contamination reads as silt + toxins,
    // fertility as nutrients + organic matter.
    expect(liquid.composition["silt"]).toBeCloseTo(0.8 * 0.5, 10);
    expect(liquid.composition["toxins"]).toBeCloseTo(0.8 * 0.5, 10);
    expect(liquid.composition["nutrients"]).toBeCloseTo(0.5 * 0.6, 10);
    expect(liquid.composition["organic-matter"]).toBeCloseTo(0.5 * 0.4, 10);
    expect(liquid.composition["salt"]).toBeGreaterThan(0);
  });

  it("the standard component vocabulary is the roadmap's own list", () => {
    expect([...FLUID_COMPONENTS].sort()).toEqual(
      ["alcohol", "nutrients", "organic-matter", "pathogens", "salt", "silt", "toxins"].sort(),
    );
  });

  it("consuming liquid genuinely removes it and reports the consumed portion's composition", () => {
    const { world } = buildDetailedWorld("p11-03c");
    const container = createLiquidContainer(world, 10, { x: 3, y: 3, z: 3 });
    setLiquidContents(world.components, container, { capacityL: 10, materialId: "water", volumeL: 4, composition: { alcohol: 0.25 } });
    const consumed = consumeLiquid(world.components, container, 1.5);
    expect(consumed.consumedL).toBeCloseTo(1.5, 10);
    expect(consumed.composition["alcohol"]).toBeCloseTo(0.25, 10);
    expect(getLiquidContents(world.components, container)!.volumeL).toBeCloseTo(2.5, 10);
  });
});
