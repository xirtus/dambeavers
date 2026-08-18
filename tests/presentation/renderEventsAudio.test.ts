/**
 * §26 projection coverage: every event type the live colony loop can
 * record surfaces in render frames with its verbatim EventLog type as
 * `sourceType` and a mapped coarse kind — the generative score's hearing
 * is tested against the REAL projector over the REAL scenario world, not
 * a mock. Unmapped future history falls to "generic" but never vanishes.
 */
import { describe, expect, it } from "vitest";
import { createPondScenario } from "../../src/presentation/scenario/pond-scenario.js";
import { RenderProjector } from "../../src/presentation/projection/render-projection.js";
import type { RenderEventKind } from "../../src/presentation/contracts/render-events.js";

/** Every type the pond scenario's colony loop (ColonyLoop.ts) may record, per the systems' own record() calls. */
const COLONY_LOOP_EVENT_TYPES = [
  "tree-felled",
  "dam-segment-applied",
  "bridge-segment-applied",
  "drowning-death",
  "starvation-death",
  "exposure-death",
  "trauma-death",
  "disease-death",
  "offspring-born",
  "life-stage-changed",
  "plant-died",
  "plant-ignited",
  "plant-burned-out",
  "food-produced",
  "food-spoiled",
  "food-decayed",
  "social-interaction",
  "infection-contracted",
  "beaver-fight",
  "beaver-argument",
  "gate-opened",
  "gate-closed",
  "item-moved",
] as const;

const EXPECTED_KINDS: Readonly<Record<string, RenderEventKind>> = {
  "tree-felled": "tree-felled",
  "dam-segment-applied": "dam-segment-applied",
  "bridge-segment-applied": "construction-complete",
  "drowning-death": "death",
  "starvation-death": "death",
  "exposure-death": "death",
  "trauma-death": "death",
  "disease-death": "death",
  "offspring-born": "birth",
  "life-stage-changed": "life-stage",
  "plant-died": "plant-died",
  "plant-ignited": "fire",
  "plant-burned-out": "fire",
  "food-produced": "food",
  "food-spoiled": "food",
  "food-decayed": "food",
  "social-interaction": "social",
  "infection-contracted": "infection",
  "beaver-fight": "fight",
  "beaver-argument": "fight",
  "gate-opened": "gate",
  "gate-closed": "gate",
  "item-moved": "item-moved",
};

describe("render event projection for the score (§26)", () => {
  it("projects every colony-loop event type with verbatim sourceType and its mapped kind", () => {
    const scenario = createPondScenario("audio-projection-test");
    const world = scenario.world;
    const beaver = scenario.beavers[0]!;
    const position = world.grid.positionOf(beaver);
    expect(position).toBeDefined();
    const recorded = [...COLONY_LOOP_EVENT_TYPES, "meteor-struck"]; // the last one: honest generic fallback
    for (const type of recorded) {
      world.events.record({ tick: world.clock.tick, eventType: type, subjectIds: [beaver], location: position! });
    }
    const projector = new RenderProjector(world, { plantSpecies: scenario.plantSpecies });
    const frame = projector.buildFrame(world);
    const bySource = new Map(frame.events.map((e) => [e.sourceType, e]));
    for (const type of COLONY_LOOP_EVENT_TYPES) {
      const projected = bySource.get(type);
      expect(projected, `${type} must surface`).toBeDefined();
      expect(projected!.kind).toBe(EXPECTED_KINDS[type]);
      expect(projected!.entityIds).toContain(beaver as number);
      expect(projected!.location).toEqual(position);
    }
    expect(bySource.get("meteor-struck")!.kind).toBe("generic");
  });

  it("the 3D layer's particle hooks keep their original kinds", () => {
    // applyEventEffects branches on "tree-felled" | "dam-segment-applied" | "construction-complete" — pinned here so the audio amendment can never quietly break visuals.
    expect(EXPECTED_KINDS["tree-felled"]).toBe("tree-felled");
    expect(EXPECTED_KINDS["dam-segment-applied"]).toBe("dam-segment-applied");
    expect(EXPECTED_KINDS["bridge-segment-applied"]).toBe("construction-complete");
  });
});
