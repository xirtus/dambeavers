/**
 * Headless acceptance test for P11-15 -- Environmental acoustics and signals.
 *
 * Roadmap acceptance test:
 *   "a signal's reach depends on source, distance, obstruction, and
 *   environment instead of global awareness."
 *
 * Sound propagates along the real straight line between two surface
 * elevations: distance costs reach, a wall rising into the line blocks
 * hard, and water dampens -- one formula, no per-listener flags. The
 * creature-AI consumer is a real alarm call that raises real stress in
 * every beaver who can genuinely hear it and in NOBODY else.
 */
import { describe, expect, it } from "vitest";
import { buildDetailedWorld, spawnAt } from "../unit/parityHarness.js";
import { signalAttenuation, audibleAt, audibleBeavers, propagateAlarmCall } from "../../src/sim/world/Acoustics.js";
import { getStress } from "../../src/sim/creatures/Stress.js";

describe("P11-15 environmental acoustics acceptance", () => {
  it("an identical signal reaches a nearby unobstructed listener but not one behind a wall or beyond range", () => {
    const { world } = buildDetailedWorld("p11-15");
    const source = { x: 5, z: 5 };

    // A nearby unobstructed listener: pure air attenuation.
    const near = { x: 7, z: 5 };
    const nearSample = signalAttenuation(world.grid, world.water, source, near);
    expect(nearSample.solidCells).toBe(0);
    expect(audibleAt(world.grid, world.water, source, near, 3)).toBe(true);

    // A listener beyond range: the same physics, more distance.
    const far = { x: 18, z: 18 };
    expect(audibleAt(world.grid, world.water, source, far, 3)).toBe(false);
    expect(audibleAt(world.grid, world.water, source, near, 3)).toBe(true);

    // A wall between source and listener: the terrain genuinely rises
    // into the sound line and blocks it. The SAME signal strength that
    // reached the listener before the wall no longer does after it --
    // the literal acceptance sentence.
    const wallListener = { x: 13, z: 5 };
    const strength = 8;
    expect(audibleAt(world.grid, world.water, source, wallListener, strength)).toBe(true); // reachable without the wall
    for (let x = 9; x <= 12; x++) {
      world.terrain.setMaterial(x, 3, 5, "stone"); // a real wall rising well into the sound line
      world.terrain.setMaterial(x, 4, 5, "stone");
      world.terrain.setMaterial(x, 5, 5, "stone");
    }
    const wallSample = signalAttenuation(world.grid, world.water, source, wallListener);
    expect(wallSample.solidCells).toBeGreaterThan(0);
    expect(wallSample.attenuation).toBeGreaterThan(nearSample.attenuation);
    expect(audibleAt(world.grid, world.water, source, wallListener, strength)).toBe(false); // the identical signal, now blocked
  });

  it("water genuinely dampens -- a submerged path costs more than open air", () => {
    const { world } = buildDetailedWorld("p11-15b");
    const source = { x: 5, z: 5 };
    const listener = { x: 8, z: 5 };
    // Flood the path: the middle cells are submerged.
    for (let x = 5; x <= 8; x++) world.water.setDepth(x, 5, 0.4);
    const wet = signalAttenuation(world.grid, world.water, source, listener);
    world.water.setDepth(6, 5, 0);
    world.water.setDepth(7, 5, 0);
    const dry = signalAttenuation(world.grid, world.water, source, listener);
    expect(wet.submergedCells).toBeGreaterThan(dry.submergedCells);
    expect(wet.attenuation).toBeGreaterThan(dry.attenuation);
  });

  it("an alarm call raises real stress only in beavers who can genuinely hear it", () => {
    const { world } = buildDetailedWorld("p11-15c");
    const shouter = spawnAt(world, "Shouter", 5, 5);
    const near = spawnAt(world, "Near", 6, 5);
    const distant = spawnAt(world, "Distant", 17, 5);

    expect(getStress(world.components, near)?.level ?? 0).toBe(0);
    expect(getStress(world.components, distant)?.level ?? 0).toBe(0);

    const heard = propagateAlarmCall(world, shouter, 3);

    expect(heard).toContain(near);
    expect(heard).not.toContain(distant); // out of range: no global awareness
    expect(getStress(world.components, near)!.level).toBeGreaterThan(0);
    expect(getStress(world.components, distant)?.level ?? 0).toBe(0);

    // The reach query agrees with the propagation (same physics).
    expect(audibleBeavers(world, { x: 5, z: 5 }, 3)).toEqual(expect.arrayContaining([near, shouter]));
  });
});
