/**
 * Headless acceptance test for P11-05 -- Dynamic river morphology.
 *
 * Roadmap acceptance test:
 *   "long-term erosion/deposition can shift a channel enough to
 *   invalidate old infrastructure."
 *
 * A water wheel sits on a real flowing channel (a real depth gradient,
 * P3-11's own power formula). One bank is genuinely saturated (the
 * P11-01 seepage field), making it softer (`bankHardnessFactor`); over
 * deep-time spans the channel eats into the soft bank and deposits on
 * the far side (P11-01's channel migration), the water re-levels
 * northward, and the wheel's power output -- derived live from the two
 * columns it spans -- demonstrably breaks. The wheel is never touched
 * or moved by the test: only the river changed.
 */
import { describe, expect, it } from "vitest";
import { buildDetailedWorld } from "../unit/parityHarness.js";
import { createWaterWheel, waterWheelPowerOutput, getWaterWheel } from "../../src/sim/mechanics/WaterPower.js";
import { SeepageField, advanceWatershedSpan } from "../../src/sim/hydrology/Watershed.js";

describe("P11-05 dynamic river morphology acceptance", () => {
  it("long-term channel migration invalidates water-dependent infrastructure without touching it", () => {
    const { world, materials } = buildDetailedWorld("p11-05");
    // A real flowing channel along z=10 with a downstream gradient:
    // deep upstream, shallow downstream -- the wheel's power is real.
    for (let x = 6; x <= 13; x++) {
      world.water.setDepth(x, 10, x <= 10 ? 2.0 : 1.0);
    }
    // Infrastructure placed ON the channel, spanning the gradient.
    const wheel = createWaterWheel(world, { x: 10, z: 10 }, { x: 11, z: 10 });
    const initialPower = waterWheelPowerOutput(world.water, getWaterWheel(world.components, wheel)!);
    expect(initialPower).toBeGreaterThan(0);

    // The north bank is saturated (soft); the south bank is dry (hard).
    // This asymmetry is the real driver of sideways migration.
    const seepage = new SeepageField(world.grid.dims.sizeX, world.grid.dims.sizeZ);
    for (let x = 6; x <= 13; x++) {
      seepage.setSaturation(x, 9, 1.0);
    }
    // A persistent inflow keeps the channel flowing (a rain-fed river,
    // not a stagnant pond that would simply level out).
    const inflow = { x: 6, z: 10, volumePerTick: 0.0005 };
    const outflow = { x: 13, z: 10, volumePerTick: 0.0005 };

    // Decades of watershed advance. The channel eats into the soft
    // north bank, deposits on the south, and the water follows the new
    // course.
    let finalPower = initialPower;
    let depthAtWheel = world.water.depthAt(10, 10);
    let depthInBank = world.water.depthAt(10, 9);
    for (let span = 0; span < 12; span++) {
      advanceWatershedSpan(world, materials, world.random.stream(`p11-05-${span}`), 300_000, seepage, 30, { inflow: [inflow], outflow: [outflow] });
      finalPower = waterWheelPowerOutput(world.water, getWaterWheel(world.components, wheel)!);
      depthAtWheel = world.water.depthAt(10, 10);
      depthInBank = world.water.depthAt(10, 9);
      if (depthInBank > 0 && finalPower < initialPower) break;
    }

    // The channel genuinely moved: the previously-dry saturated bank is
    // now wet (the river migrated into it)...
    expect(depthInBank).toBeGreaterThan(0);
    // ...and the infrastructure's water-dependent behavior demonstrably
    // broke -- power collapsed from its real initial output, purely
    // because the river left.
    expect(finalPower).toBeLessThan(initialPower);
    expect(depthAtWheel).toBeLessThan(1);
  });
});
