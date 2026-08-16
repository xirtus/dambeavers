/**
 * Headless acceptance test for P0-11 — Headless simulation runner.
 *
 * Roadmap acceptance test (DAMN_BEAVERS_MASTER_ROADMAP.md, P0-11):
 *   "CI can load a seed, inject commands, simulate N ticks, and assert
 *   world state."
 *
 * This file itself demonstrates the property: it imports nothing from any
 * renderer/UI/presentation code (none exists in this repository), runs
 * under plain `vitest`/Node, and asserts purely on simulation state
 * returned by `runHeadless` -- exactly the "CI can load a seed..." claim,
 * exercised for real rather than described.
 */
import { describe, expect, it } from "vitest";
import { runHeadless, type Command } from "../../src/sim/runtime/SimulationRunner.js";
import { getPlant, setPlant } from "../../src/sim/ecology/Plant.js";
import type { EntityId } from "../../src/sim/core/EntityId.js";

describe("P0-11 acceptance: load a seed, inject commands, simulate N ticks, assert world state", () => {
  it("runs a deterministic headless simulation and asserts on the resulting world", () => {
    let beaverId: EntityId | undefined;
    const commands: Command[] = [
      {
        type: "designate-soil",
        apply: (world) => {
          world.terrain.setMaterial(1, 0, 1, "soil");
        },
      },
      {
        type: "spawn-beaver",
        apply: (world) => {
          const id = world.entities.create("beaver");
          world.grid.setEntityPosition(id, 1, 1, 1);
          beaverId = id;
        },
      },
      {
        type: "spawn-tree",
        apply: (world) => {
          const id = world.entities.create("tree");
          world.grid.setEntityPosition(id, 2, 1, 1);
          setPlant(world.components, id, { speciesId: "not-yet-a-real-species", ageTicks: 0, health: 1 });
        },
      },
    ];

    const world = runHeadless({
      seed: "p0-11-acceptance",
      dimensions: { sizeX: 5, sizeY: 5, sizeZ: 5 },
      ticks: 100,
      commands,
    });

    // -- N ticks actually simulated --
    expect(world.clock.tick).toBe(100);

    // -- injected commands actually changed world state --
    expect(world.terrain.materialAt(1, 0, 1)).toBe("soil");
    expect(beaverId).toBeDefined();
    expect(world.entities.isLive(beaverId!)).toBe(true);
    expect(world.grid.positionOf(beaverId!)).toEqual({ x: 1, y: 1, z: 1 });
    const [tree] = world.entities.liveIdsOfKind("tree");
    expect(tree).toBeDefined();
    expect(getPlant(world.components, tree!)).toMatchObject({ ageTicks: 0 });

    // -- world is genuinely still live/mutable after the run, not frozen --
    const newEntity = world.entities.create("log");
    expect(world.entities.isLive(newEntity)).toBe(true);
  });

  it("the exact same seed and command sequence reproduce bit-for-bit identical world state", () => {
    const buildCommands = (): Command[] => [
      {
        type: "spawn-several",
        apply: (world) => {
          for (let i = 0; i < 5; i++) {
            const id = world.entities.create("beaver");
            world.grid.setEntityPosition(id, i, 0, 0);
          }
        },
      },
      {
        type: "draw-randomness",
        apply: (world) => {
          world.random.stream("spawn-placement").nextUint32();
          world.random.stream("spawn-placement").nextUint32();
        },
      },
    ];

    const runOptions = {
      seed: "reproducibility-check",
      dimensions: { sizeX: 6, sizeY: 2, sizeZ: 2 } as const,
      ticks: 200,
    };
    const worldA = runHeadless({ ...runOptions, commands: buildCommands() });
    const worldB = runHeadless({ ...runOptions, commands: buildCommands() });

    expect(worldB.clock.tick).toBe(worldA.clock.tick);
    expect(worldB.entities.getDebugState()).toEqual(worldA.entities.getDebugState());
    expect(worldB.grid.getDebugState()).toEqual(worldA.grid.getDebugState());
    expect(worldB.random.stream("spawn-placement").getDebugState()).toEqual(
      worldA.random.stream("spawn-placement").getDebugState(),
    );
    for (const id of worldA.entities.liveIdsOfKind("beaver")) {
      expect(worldB.entities.isLive(id)).toBe(true);
      expect(worldB.grid.positionOf(id)).toEqual(worldA.grid.positionOf(id));
    }
  });

  it("a different seed provably diverges", () => {
    const commands: Command[] = [
      {
        type: "draw",
        apply: (world) => {
          world.random.stream("x").nextUint32();
        },
      },
    ];
    const worldA = runHeadless({ seed: "seed-one", dimensions: { sizeX: 2, sizeY: 2, sizeZ: 2 }, ticks: 10, commands });
    const worldB = runHeadless({ seed: "seed-two", dimensions: { sizeX: 2, sizeY: 2, sizeZ: 2 }, ticks: 10, commands });
    expect(worldA.random.stream("x").getDebugState().state).not.toEqual(worldB.random.stream("x").getDebugState().state);
  });
});
