/** Regression: reproduction probes beside ceiling-height ground must not throw. */
import { describe, expect, it } from "vitest";
import { createPondScenario, stepPondScenarioSystems } from "../../src/presentation/scenario/pond-scenario.js";

describe("PlantLifecycle ceiling regression", () => {
  it("a mature forest beside top-layer plateau ground ticks without throwing", () => {
    const scenario = createPondScenario("m0-pond-test");
    scenario.world.clock.onTick(() => stepPondScenarioSystems(scenario));
    expect(() => scenario.world.clock.advanceTicks(200)).not.toThrow();
  });
});
