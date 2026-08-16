/**
 * Headless acceptance test for P0-12 — Debug inspection layer.
 *
 * Roadmap acceptance test (DAMN_BEAVERS_MASTER_ROADMAP.md, P0-12):
 *   "a developer can click a simulation entity and inspect raw
 *   authoritative state without attaching a debugger."
 *
 * "Click" resolves to an `EntityId` through a presentation-layer
 * mechanism (raycasting against rendered positions) that doesn't exist in
 * this headless-only repository -- P1-20's job, layered on top of this.
 * What P0-12 delivers, and what this test proves, is the part underneath
 * that: given an `EntityId` (the headless equivalent of "what was
 * clicked"), a plain function call returns everything authoritative about
 * it, with no debugger, breakpoint, or internal console.log needed.
 */
import { describe, expect, it } from "vitest";
import { runHeadless } from "../../src/sim/runtime/SimulationRunner.js";
import { setPlant, type Plant } from "../../src/sim/ecology/Plant.js";
import { inspectEntity, inspectCell, inspectWorld } from "../../src/sim/debug/DebugInspector.js";

describe("P0-12 acceptance: inspect raw authoritative state without attaching a debugger", () => {
  it("a developer can inspect a clicked entity's full raw state via a plain function call", () => {
    const world = runHeadless({
      seed: "p0-12-acceptance",
      dimensions: { sizeX: 5, sizeY: 5, sizeZ: 5 },
      ticks: 40,
      commands: [
        {
          type: "designate-soil",
          apply: (w) => w.terrain.setMaterial(2, 0, 2, "soil"),
        },
        {
          type: "spawn-tree",
          apply: (w) => {
            const tree = w.entities.create("tree");
            w.grid.setEntityPosition(tree, 2, 1, 2);
            const plant: Plant = { speciesId: "aspen", ageTicks: 100, health: 1 };
            setPlant(w.components, tree, plant);
            w.events.record({ tick: 0, eventType: "spawned", subjectIds: [tree], location: { x: 2, y: 1, z: 2 } });
          },
        },
      ],
    });

    // -- "click" resolves to an EntityId (the headless stand-in for a real click-to-raycast) --
    const [clickedEntity] = world.entities.liveIdsOfKind("tree");
    expect(clickedEntity).toBeDefined();

    // -- inspect it: raw authoritative state, no debugger --
    const inspection = inspectEntity(world, clickedEntity!);
    expect(inspection.kind).toBe("tree");
    expect(inspection.live).toBe(true);
    expect(inspection.position).toEqual({ x: 2, y: 1, z: 2 });
    expect(inspection.components).toEqual([{ type: "plant", value: { speciesId: "aspen", ageTicks: 100, health: 1 } }]);
    expect(inspection.events).toHaveLength(1);
    expect(inspection.events[0]!.eventType).toBe("spawned");

    // -- the underlying cell can be inspected too (terrain elevation / entity-id overlay data) --
    const cell = inspectCell(world, 2, 1, 2);
    expect(cell.entityIds).toContain(clickedEntity);
    const groundCell = inspectCell(world, 2, 0, 2);
    expect(groundCell.solid).toBe(true);
    expect(groundCell.material).toBe("soil");

    // -- and the whole world's authoritative state is inspectable, not just one entity --
    const summary = inspectWorld(world);
    expect(summary.entities.liveCount).toBeGreaterThan(0);
    expect(summary.events.eventCount).toBe(1);
    expect(summary.clock.tick).toBe(40);
  });

  it("inspecting a destroyed entity still returns its raw historical state, not an error", () => {
    const world = runHeadless({
      seed: 1,
      dimensions: { sizeX: 3, sizeY: 3, sizeZ: 3 },
      ticks: 1,
      commands: [
        {
          type: "spawn-and-destroy",
          apply: (w) => {
            const beaver = w.entities.create("beaver");
            w.events.record({ tick: 0, eventType: "died", subjectIds: [beaver], location: { x: 0, y: 0, z: 0 } });
            w.entities.destroy(beaver);
          },
        },
      ],
    });
    // The command above created exactly one entity, so its id is 1 --
    // EntityIdRegistry assigns ids as a gapless sequence from 1 (P0-02).
    const id = 1 as unknown as ReturnType<typeof world.entities.create>;
    const inspection = inspectEntity(world, id);
    expect(inspection.live).toBe(false);
    expect(inspection.kind).toBe("beaver");
    expect(inspection.events).toHaveLength(1);
  });
});
