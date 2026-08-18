/**
 * Headless acceptance test for P10-10 -- History/civilization parity audit.
 *
 * Roadmap acceptance test: "a 1,000-year world produces coherent
 * inspectable chains linking present entities to past events."
 */
import { describe, expect, it } from "vitest";
import { parityRowsByDomain } from "../../src/sim/parity/ParityMatrix.js";
import { buildRegionWorld } from "../unit/parityHarness.js";
import { createSite, getSite } from "../../src/sim/region/Site.js";
import { establishPolity } from "../../src/sim/politics/PoliticalEntity.js";
import { claimTerritory } from "../../src/sim/politics/Territory.js";
import { declareWar, endWar } from "../../src/sim/politics/War.js";
import { advanceWorldTicks } from "../../src/sim/region/DeepTime.js";
import { createWayfarer } from "../../src/sim/wayfarer/Travel.js";
import { setGood } from "../../src/sim/economy/Good.js";
import { setOwner } from "../../src/sim/creatures/Ownership.js";
import { setRelationshipWith } from "../../src/sim/creatures/Relationships.js";
import { siteHistory } from "../../src/sim/chronicle/SiteHistories.js";
import { causalHistoryOf } from "../../src/sim/chronicle/CausalHistory.js";
import { artifactHistory } from "../../src/sim/chronicle/ArtifactHistories.js";
import { findAllRecords } from "../../src/sim/chronicle/Search.js";

const MILLENNIUM_TICKS = 1000 * 48_000; // 48,000 ticks per simulated year (P6-13's own convention)

describe("P10-10 -- History/civilization parity audit", () => {
  it("every history-domain row is marked with a verdict and written rationale", () => {
    const rows = parityRowsByDomain("history");
    expect(rows.length).toBeGreaterThanOrEqual(20);
    for (const row of rows) {
      expect(["PASS", "ADAPTED", "EXCEEDED", "OUT_OF_SCOPE"]).toContain(row.verdict);
      expect(row.rationale.trim().length).toBeGreaterThan(0);
    }
  });

  it("a 1,000-year world produces coherent inspectable chains linking present entities to past events", () => {
    const { world, regionMap } = buildRegionWorld("p10-10");

    // The world's PAST: two settlements, a real war, a real artifact
    // with a real maker/owner, a real wayfarer, a real journey.
    const siteA = createSite(world, regionMap, 2, 2, 8, 120);
    const siteB = createSite(world, regionMap, 3, 2, 8, 120);
    establishPolity(world, siteA);
    establishPolity(world, siteB);
    claimTerritory(world, regionMap, siteA, 1);
    claimTerritory(world, regionMap, siteB, 1);
    const claimEvent = world.events.eventsOfType("territory-claimed").find((e) => e.subjectIds.includes(siteA))!.id;
    world.clock.advanceTicks(10);
    const warId = declareWar(world, siteA, siteB, "territory", claimEvent);
    world.clock.advanceTicks(10);
    const warEndedEvent = endWar(world, warId, siteA);
    const artifact = world.entities.create("good");
    setGood(world.components, artifact, { goodKind: "artwork", materialId: "wood", massKg: 2, makerId: siteA });
    setOwner(world.components, artifact, { ownerType: "institutional", ownerId: siteA });
    const wayfarerId = createWayfarer(world, "Fenwick", 12, 2);
    world.events.record({
      tick: world.clock.tick,
      eventType: "wayfarer-journey-started",
      subjectIds: [wayfarerId],
      objectIds: [siteA],
      location: { x: 0, y: 0, z: 0 },
    });

    const tickBefore = world.clock.tick;
    const foodBefore = getSite(world.components, siteA)!.storedFoodKg;

    // A THOUSAND YEARS of real deep time.
    advanceWorldTicks(world, MILLENNIUM_TICKS, () => "forest", { forest: 0.8, wetland: 0.7, grassland: 0.5, desert: 0.1, tundra: 0.1, mountain: 0.1 });
    expect(world.clock.tick).toBe(tickBefore + MILLENNIUM_TICKS);
    expect(getSite(world.components, siteA)!.storedFoodKg).not.toBe(foodBefore); // the world genuinely lived

    // Present entities still link to their past events -- coherent,
    // inspectable chains:
    // 1. The SITE links to its founding through its recorded history.
    const history = siteHistory(world, siteA);
    expect(history.some((entry) => entry.kind === "founding" && entry.eventId !== undefined && world.events.has(entry.eventId))).toBe(true);

    // 2. The WAR's full causal chain still resolves.
    const warView = causalHistoryOf(world, warEndedEvent);
    expect(warView.upstream.length).toBe(3);
    expect(warView.upstream[0]!.event.eventType).toBe("territory-claimed");

    // 3. The ARTIFACT links to its maker and recorded owner.
    const artifactRecord = artifactHistory(world, artifact);
    expect(artifactRecord.maker).toBe(siteA);
    expect(artifactRecord.current.owner?.ownerId).toBe(siteA);

    // 4. The WAYFARER's records still resolve (the journey event).
    expect(findAllRecords(world, wayfarerId).some((r) => r.eventType === "wayfarer-journey-started")).toBe(true);

    // 5. The war entity itself persists with its real outcome.
    const warRecords = findAllRecords(world, siteA).filter((r) => r.role === "war-participant");
    expect(warRecords.length).toBeGreaterThanOrEqual(2); // declaration + end
  });
});
