import { describe, expect, it } from "vitest";
import { createWorld, applyCommands, runHeadless, type Command } from "../../src/sim/runtime/SimulationRunner.js";
import { setPlant } from "../../src/sim/ecology/Plant.js";

describe("createWorld", () => {
  it("constructs a fully-wired, empty world", () => {
    const world = createWorld({ seed: 1, dimensions: { sizeX: 4, sizeY: 4, sizeZ: 4 } });
    expect(world.clock.tick).toBe(0);
    expect(world.entities.totalAllocatedCount).toBe(0);
    expect(world.grid.dims).toEqual({ sizeX: 4, sizeY: 4, sizeZ: 4 });
    expect(world.terrain.getDebugState().filledCellCount).toBe(0);
    expect(world.events.count).toBe(0);
  });

  it("registers the standard material set so terrain can be shaped immediately", () => {
    const world = createWorld({ seed: 1, dimensions: { sizeX: 2, sizeY: 2, sizeZ: 2 } });
    world.terrain.setMaterial(0, 0, 0, "soil");
    expect(world.terrain.materialAt(0, 0, 0)).toBe("soil");
  });

  it("the same seed produces the same random draw sequence across two independently-constructed worlds", () => {
    const worldA = createWorld({ seed: "test-seed", dimensions: { sizeX: 2, sizeY: 2, sizeZ: 2 } });
    const worldB = createWorld({ seed: "test-seed", dimensions: { sizeX: 2, sizeY: 2, sizeZ: 2 } });
    const drawsA = Array.from({ length: 5 }, () => worldA.random.stream("test").nextUint32());
    const drawsB = Array.from({ length: 5 }, () => worldB.random.stream("test").nextUint32());
    expect(drawsB).toEqual(drawsA);
  });

  it("a different seed diverges", () => {
    const worldA = createWorld({ seed: "seed-a", dimensions: { sizeX: 2, sizeY: 2, sizeZ: 2 } });
    const worldB = createWorld({ seed: "seed-b", dimensions: { sizeX: 2, sizeY: 2, sizeZ: 2 } });
    expect(worldA.random.stream("test").nextUint32()).not.toBe(worldB.random.stream("test").nextUint32());
  });

  it("defaults to tickRateHz 20, and accepts a custom rate", () => {
    const defaultWorld = createWorld({ seed: 1, dimensions: { sizeX: 2, sizeY: 2, sizeZ: 2 } });
    expect(defaultWorld.clock.tickRateHz).toBe(20);
    const customWorld = createWorld({ seed: 1, dimensions: { sizeX: 2, sizeY: 2, sizeZ: 2 }, tickRateHz: 50 });
    expect(customWorld.clock.tickRateHz).toBe(50);
  });
});

describe("applyCommands", () => {
  it("applies commands in order", () => {
    const world = createWorld({ seed: 1, dimensions: { sizeX: 2, sizeY: 2, sizeZ: 2 } });
    const order: string[] = [];
    const commands: Command[] = [
      { type: "a", apply: () => order.push("a") },
      { type: "b", apply: () => order.push("b") },
      { type: "c", apply: () => order.push("c") },
    ];
    applyCommands(world, commands);
    expect(order).toEqual(["a", "b", "c"]);
  });

  it("a command can mutate world state directly", () => {
    const world = createWorld({ seed: 1, dimensions: { sizeX: 2, sizeY: 2, sizeZ: 2 } });
    const spawnBeaver: Command = {
      type: "spawn-beaver",
      apply: (w) => {
        const id = w.entities.create("beaver");
        w.grid.setEntityPosition(id, 0, 0, 0);
      },
    };
    applyCommands(world, [spawnBeaver]);
    expect(world.entities.liveIdsOfKind("beaver")).toHaveLength(1);
  });

  it("an empty command list is a no-op", () => {
    const world = createWorld({ seed: 1, dimensions: { sizeX: 2, sizeY: 2, sizeZ: 2 } });
    expect(() => applyCommands(world, [])).not.toThrow();
  });
});

describe("runHeadless", () => {
  it("constructs a world, applies commands, and advances exactly N ticks", () => {
    const world = runHeadless({
      seed: 42,
      dimensions: { sizeX: 3, sizeY: 3, sizeZ: 3 },
      ticks: 10,
      commands: [
        {
          type: "spawn-tree",
          apply: (w) => {
            w.entities.create("tree");
          },
        },
      ],
    });
    expect(world.clock.tick).toBe(10);
    expect(world.entities.liveIdsOfKind("tree")).toHaveLength(1);
  });

  it("works with no commands", () => {
    const world = runHeadless({ seed: 1, dimensions: { sizeX: 2, sizeY: 2, sizeZ: 2 }, ticks: 5 });
    expect(world.clock.tick).toBe(5);
  });

  it("applies commands BEFORE ticking, not after -- a command observes tick 0, not the post-run tick count", () => {
    let tickSeenByCommand: number | undefined;
    runHeadless({
      seed: 1,
      dimensions: { sizeX: 2, sizeY: 2, sizeZ: 2 },
      ticks: 25,
      commands: [
        {
          type: "observe-tick",
          apply: (w) => {
            tickSeenByCommand = w.clock.tick;
          },
        },
      ],
    });
    expect(tickSeenByCommand).toBe(0);
  });

  it("validates ticks before constructing the world or running any command -- fails fast", () => {
    let commandRan = false;
    expect(() =>
      runHeadless({
        seed: 1,
        dimensions: { sizeX: 2, sizeY: 2, sizeZ: 2 },
        ticks: -1,
        commands: [{ type: "should-not-run", apply: () => (commandRan = true) }],
      }),
    ).toThrow(RangeError);
    expect(commandRan).toBe(false);
  });

  it("ticks happen even though the clock starts paused (headless mode bypasses pause -- see advanceTicks)", () => {
    const world = runHeadless({ seed: 1, dimensions: { sizeX: 2, sizeY: 2, sizeZ: 2 }, ticks: 3 });
    expect(world.clock.tick).toBe(3);
  });

  it("the same seed, same commands, and same tick count produce bit-for-bit identical results", () => {
    const commandsFor = (): Command[] => [
      {
        type: "spawn-and-draw",
        apply: (w) => {
          w.entities.create("beaver");
          w.random.stream("job-selection").nextUint32();
        },
      },
    ];
    const runA = runHeadless({ seed: "determinism-check", dimensions: { sizeX: 3, sizeY: 3, sizeZ: 3 }, ticks: 50, commands: commandsFor() });
    const runB = runHeadless({ seed: "determinism-check", dimensions: { sizeX: 3, sizeY: 3, sizeZ: 3 }, ticks: 50, commands: commandsFor() });

    expect(runB.clock.tick).toBe(runA.clock.tick);
    expect(runB.entities.getDebugState()).toEqual(runA.entities.getDebugState());
    expect(runB.random.stream("job-selection").getDebugState()).toEqual(runA.random.stream("job-selection").getDebugState());
  });

  it("determinism holds for ComponentStore, EventLog, and TerrainField too, not just entities/random", () => {
    const commandsFor = (): Command[] => [
      {
        type: "full-state-touch",
        apply: (w) => {
          const tree = w.entities.create("tree");
          setPlant(w.components, tree, { speciesId: "aspen", ageTicks: 500, health: 0.8 });
          w.terrain.setMaterial(1, 0, 1, "soil");
          w.events.record({ tick: 0, eventType: "spawned", subjectIds: [tree], location: { x: 1, y: 1, z: 1 } });
        },
      },
    ];
    const options = { seed: "full-state-determinism", dimensions: { sizeX: 3, sizeY: 3, sizeZ: 3 } as const, ticks: 30 };
    const runA = runHeadless({ ...options, commands: commandsFor() });
    const runB = runHeadless({ ...options, commands: commandsFor() });

    expect(runB.components.toSnapshot()).toEqual(runA.components.toSnapshot());
    expect(runB.events.toSnapshot()).toEqual(runA.events.toSnapshot());
    expect(runB.terrain.toSnapshot()).toEqual(runA.terrain.toSnapshot());
  });

  it("rejects a negative tick count (propagated from SimulationClock.advanceTicks)", () => {
    expect(() => runHeadless({ seed: 1, dimensions: { sizeX: 2, sizeY: 2, sizeZ: 2 }, ticks: -1 })).toThrow(
      RangeError,
    );
  });
});
