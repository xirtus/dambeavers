/**
 * Headless acceptance test for P11-18 -- Cultural landscape transformation.
 *
 * Roadmap acceptance test:
 *   "centuries of settlements leave physical and ecological signatures
 *   visible to later inhabitants."
 *
 * The signatures are inspectable facts, not subjective impressions:
 * settlements (real founded events), terrain reshaping (real recorded
 * watershed spans with their applied event counts), abandoned
 * structures (the per-site records), ruin encounters (real events), and
 * the live ecological mosaic -- all queryable by a later population
 * through one history query, every signature citing a real event or a
 * live fact.
 */
import { describe, expect, it } from "vitest";
import { buildRegionWorld, buildDetailedWorld } from "../unit/parityHarness.js";
import { createSite } from "../../src/sim/region/Site.js";
import { activateSite, deactivateSite } from "../../src/sim/region/SiteActivation.js";
import { advanceWorldTicks } from "../../src/sim/region/DeepTime.js";
import { setConstruction } from "../../src/sim/labor/Construction.js";
import { SeepageField, advanceWatershedSpan } from "../../src/sim/hydrology/Watershed.js";
import { landscapeHistorySince, terrainReshapingSignatures, currentMosaicSignature } from "../../src/sim/chronicle/LandscapeHistory.js";
import { BIOMES } from "../unit/parityHarness.js";

describe("P11-18 cultural landscape acceptance", () => {
  it("centuries of settlements leave inspectable physical and ecological signatures", () => {
    // A detailed world whose terrain is genuinely reshaped over spans.
    const { world: detailed, materials } = buildDetailedWorld("p11-18-detail");
    const seepage = new SeepageField(detailed.grid.dims.sizeX, detailed.grid.dims.sizeZ);
    for (let x = 3; x <= 14; x++) detailed.terrain.excavate(x, 2, 8);
    detailed.water.setDepth(4, 8, 1.5);
    for (let span = 0; span < 3; span++) {
      advanceWatershedSpan(detailed, materials, detailed.random.stream(`p11-18-${span}`), 50_000, seepage, 30, {
        inflow: [{ x: 4, z: 8, volumePerTick: 0.002 }],
        outflow: [{ x: 14, z: 8, volumePerTick: 0.002 }],
      });
    }

    // Several settlements across a region, one of which abandons
    // structures.
    const { world: region, materials: regionMaterials, regionMap } = buildRegionWorld("p11-18");
    for (const [x, z] of [[2, 2], [5, 5], [9, 3]] as const) {
      createSite(region, regionMap, x, z, 3, 50);
    }
    const siteId = region.entities.liveIdsOfKind("site")[0]!;
    const activated = activateSite(siteId, regionMaterials, region);
    const construction = activated.world.entities.create("construction");
    activated.world.grid.setEntityPosition(construction, 8, 3, 8);
    setConstruction(activated.world.components, construction, {
      designationId: construction,
      kind: "dam-segment",
      site: { x: 8, z: 8 },
      requiredMaterialId: "wood",
      requiredMassKg: 1,
      workDone: 1,
      workRequired: 1,
      status: "complete",
    });
    deactivateSite(siteId, region, activated);
    advanceWorldTicks(region, 1_000_000, () => "forest", BIOMES);

    // A LATER POPULATION queries the landscape history -- every
    // signature is a real event or live fact.
    const history = landscapeHistorySince(region, 0);
    expect(history.length).toBeGreaterThanOrEqual(4); // 3 settlements + abandoned structures
    const kinds = new Set(history.map((s) => s.kind));
    expect(kinds).toContain("settlement");
    expect(kinds).toContain("abandoned-structures");

    // Terrain reshaping is recorded, queryable history (not a side
    // effect nobody can see).
    const reshaping = terrainReshapingSignatures(detailed);
    expect(reshaping.length).toBe(3);
    for (const signature of reshaping) {
      expect(signature.eventIds.length).toBe(1);
      expect(detailed.events.get(signature.eventIds[0]!).eventType).toBe("watershed-advanced");
    }
    // Every span genuinely changed terrain (the data says so).
    const totalTerrainEvents = reshaping.reduce((sum, s) => {
      const event = detailed.events.get(s.eventIds[0]!);
      const data = event.data as { terrainEvents?: number } | undefined;
      return sum + (data?.terrainEvents ?? 0);
    }, 0);
    expect(totalTerrainEvents).toBeGreaterThan(0);

    // The ecological side: the live mosaic is queryable by the later
    // population, and the reshaped world has real wet columns.
    const mosaic = currentMosaicSignature(detailed, () => 0.7);
    expect(mosaic.kind).toBe("mosaic-state");
    expect(mosaic.description).toMatch(/open-water/);
  });

  it("every signature in the history cites only real recorded events", () => {
    const { world, materials, regionMap } = buildRegionWorld("p11-18b");
    createSite(world, regionMap, 4, 4, 2, 30);
    const history = landscapeHistorySince(world, 0);
    for (const signature of history) {
      for (const eventId of signature.eventIds) {
        expect(world.events.get(eventId).eventType).toBeDefined();
      }
    }
    void materials;
  });
});
