/**
 * Headless acceptance test for P10-01 -- World parity audit.
 *
 * Roadmap acceptance test: "every world-domain parity row is marked
 * PASS, ADAPTED, EXCEEDED, or intentionally OUT_OF_SCOPE with written
 * rationale."
 */
import { describe, expect, it } from "vitest";
import { parityRowsByDomain, PARITY_MATRIX } from "../../src/sim/parity/ParityMatrix.js";
import { buildRegionWorld } from "../unit/parityHarness.js";
import { createSite, getSite } from "../../src/sim/region/Site.js";
import { activateSite } from "../../src/sim/region/SiteActivation.js";
import { advanceWorldTicks } from "../../src/sim/region/DeepTime.js";

describe("P10-01 -- World parity audit", () => {
  it("every world-domain parity row is marked with a valid verdict and written rationale", () => {
    const rows = parityRowsByDomain("world");
    expect(rows.length).toBeGreaterThan(20);
    const validVerdicts = new Set(["PASS", "ADAPTED", "EXCEEDED", "OUT_OF_SCOPE"]);
    for (const row of rows) {
      expect(validVerdicts.has(row.verdict), `row ${row.id} verdict`).toBe(true);
      expect(row.rationale.trim().length, `row ${row.id} rationale`).toBeGreaterThan(0);
      if (row.verdict === "OUT_OF_SCOPE") expect((row.scopeReason ?? "").trim().length, `row ${row.id} scope`).toBeGreaterThan(0);
      else expect(row.evidence.length, `row ${row.id} evidence`).toBeGreaterThan(0);
    }
  });

  it("flagship world rows are backed by real, behaviorally-proven mechanisms", () => {
    const byId = new Map(PARITY_MATRIX.map((row) => [row.id, row]));
    // 009 Towns & Settlements: generation -> site -> activation consistency.
    const { world, materials, regionMap } = buildRegionWorld("p10-01");
    const siteId = createSite(world, regionMap, 2, 2, 5, 100);
    const activated = activateSite(siteId, materials, world);
    expect(activated.world.entities.liveIdsOfKind("beaver").length).toBe(5); // exactly the summary population
    expect(byId.get(9)!.verdict).toBe("PASS");

    // 047 Historical data abstraction: deep time advances an INACTIVE
    // site's own LOD (the compressed-but-real abstraction).
    const deepSiteId = createSite(world, regionMap, 10, 10, 5, 100);
    const before = getSite(world.components, deepSiteId)!.storedFoodKg;
    const tickBefore = world.clock.tick;
    advanceWorldTicks(world, 100 * 48_000, () => "forest", { forest: 1.0, wetland: 0.7, grassland: 0.5, desert: 0.1, tundra: 0.1, mountain: 0.1 });
    expect(world.clock.tick).toBe(tickBefore + 100 * 48_000);
    const after = getSite(world.components, deepSiteId)!;
    expect(after.storedFoodKg).not.toBe(before); // the LOD genuinely advanced it
    expect(byId.get(47)!.verdict).toBe("PASS");
    expect(byId.get(47)!.evidence).toContain("src/sim/region/OffscreenLOD.ts");
  });
});
