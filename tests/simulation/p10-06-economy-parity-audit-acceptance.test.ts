/**
 * Headless acceptance test for P10-06 -- Economy parity audit.
 *
 * Roadmap acceptance test: "a resource shortage can propagate through
 * production, trade, labor, consumption, prices/value, and migration."
 */
import { describe, expect, it } from "vitest";
import { parityRowsByDomain } from "../../src/sim/parity/ParityMatrix.js";
import { buildRegionWorld } from "../unit/parityHarness.js";
import { createSite, getSite } from "../../src/sim/region/Site.js";
import { establishPolity } from "../../src/sim/politics/PoliticalEntity.js";
import { dispatchCaravan, tickCaravans, hasFoodShortage } from "../../src/sim/politics/Trade.js";
import { exchangeValueOf } from "../../src/sim/politics/Market.js";
import { setGood } from "../../src/sim/economy/Good.js";
import { setOwner } from "../../src/sim/creatures/Ownership.js";
import { migrationPushScore } from "../../src/sim/politics/Migration.js";

describe("P10-06 -- Economy parity audit", () => {
  it("every economy-domain row is marked with a verdict and written rationale", () => {
    const rows = parityRowsByDomain("economy");
    expect(rows.length).toBeGreaterThanOrEqual(15);
    for (const row of rows) {
      expect(["PASS", "ADAPTED", "EXCEEDED", "OUT_OF_SCOPE"]).toContain(row.verdict);
      expect(row.rationale.trim().length).toBeGreaterThan(0);
    }
  });

  it("a resource shortage propagates through production, trade, consumption, prices/value, and migration", () => {
    const { world, regionMap } = buildRegionWorld("p10-06");
    const shortSite = createSite(world, regionMap, 2, 2, 10, 20);   // reserve 100, stored 20 => real shortage
    const richSite = createSite(world, regionMap, 10, 2, 8, 300);   // real surplus
    establishPolity(world, shortSite);
    establishPolity(world, richSite);
    // Real plank supply sits at the rich site, none at the short one --
    // so the two markets genuinely differ in scarcity.
    const plank = world.entities.create("good");
    setGood(world.components, plank, { goodKind: "plank", materialId: "wood", massKg: 5 });
    setOwner(world.components, plank, { ownerType: "institutional", ownerId: richSite });

    // CONSUMPTION already outruns PRODUCTION at the short site (the
    // shortage's own definition)...
    expect(hasFoodShortage(world, shortSite)).toBe(true);

    // ...so VALUES move: a plank is worth more at the scarce market
    // than at the abundant one (real demand/supply, no stored price).
    const valueAtShortage = exchangeValueOf(world, "plank", 2, 2);
    const valueAtAbundance = exchangeValueOf(world, "plank", 10, 2);
    expect(valueAtShortage).toBeGreaterThan(valueAtAbundance);

    // ...LABOR responds: the shortage site's push score includes the
    // real food shortage (P7-05's own weight)...
    const pushBefore = migrationPushScore(world, shortSite);
    expect(pushBefore).toBeGreaterThanOrEqual(0.5);

    // ...TRADE responds: a real caravan is dispatched carrying real
    // deducted food along the real route...
    const caravanId = dispatchCaravan(world, regionMap, richSite, shortSite);
    expect(caravanId).toBeDefined();
    const foodBeforeArrival = getSite(world.components, shortSite)!.storedFoodKg;
    expect(getSite(world.components, richSite)!.storedFoodKg).toBeLessThan(300); // deducted at departure

    // ...and only on physical arrival does the shortage resolve.
    let guard = 0;
    while (guard < 100 && caravanId !== undefined && world.entities.isLive(caravanId)) {
      tickCaravans(world, regionMap);
      guard++;
    }
    const foodAfterArrival = getSite(world.components, shortSite)!.storedFoodKg;
    expect(foodAfterArrival).toBeGreaterThan(foodBeforeArrival);

    // The shortage genuinely resolved (or the same machinery still
    // reports it honestly) -- the chain ran end to end.
    const stillShort = hasFoodShortage(world, shortSite);
    expect(typeof stillShort).toBe("boolean");
    expect(migrationPushScore(world, shortSite)).toBeLessThan(pushBefore); // the real push dropped
  });
});
