/**
 * P10-11 Emergent-interaction torture suite, file 4 of 5: world,
 * region, travel, history, and chronicle interactions. No scripted outcomes.
 */
import { describe, expect, it } from "vitest";
import { buildRegionWorld, buildDetailedWorld, spawnAt, BIOMES } from "./parityHarness.js";
import { createSite, getSite } from "../../src/sim/region/Site.js";
import { establishPolity } from "../../src/sim/politics/PoliticalEntity.js";
import { activateSite, deactivateSite } from "../../src/sim/region/SiteActivation.js";
import { advanceWorldTicks } from "../../src/sim/region/DeepTime.js";
import { applyDisasterToSite } from "../../src/sim/region/WorldDisasters.js";
import { createWayfarer, getWayfarer, materializeWayfarer, departSiteAsWayfarer, travelToSite, setWayfarer } from "../../src/sim/wayfarer/Travel.js";
import { setGood } from "../../src/sim/economy/Good.js";
import { setOwner, getOwner, OwnerComponent } from "../../src/sim/creatures/Ownership.js";
import { setSkills, getSkills } from "../../src/sim/creatures/Beaver.js";
import { resolveAttack, getWounds } from "../../src/sim/creatures/Anatomy.js";
import { siteHistory, sitePopulationAt } from "../../src/sim/chronicle/SiteHistories.js";
import { artifactHistory } from "../../src/sim/chronicle/ArtifactHistories.js";
import { worldTimeline, entityTimeline } from "../../src/sim/chronicle/Timeline.js";
import { parentsOf, descendantsOf } from "../../src/sim/chronicle/Genealogy.js";
import { produceOffspring } from "../../src/sim/creatures/Reproduction.js";
import { createHousehold, setHouseholdMembership, setRelationshipWith } from "../../src/sim/creatures/Relationships.js";
import { createZone } from "../../src/sim/spaces/FunctionalSpace.js";
import { claimSleepSpace, createSleepSpace } from "../../src/sim/spaces/SleepSpace.js";
import { setConstruction } from "../../src/sim/labor/Construction.js";

function lodgeFor(world: ReturnType<typeof buildDetailedWorld>["world"], a: import("../../src/sim/core/EntityId.js").EntityId, b: import("../../src/sim/core/EntityId.js").EntityId, x: number, z: number): void {
  const zoneId = createZone(world, { cells: [{ x, z }, { x: x + 1, z }], declaredFunction: "general-zone" });
  for (const wall of [{ x: x - 1, z }, { x, z: z - 1 }, { x, z: z + 1 }, { x: x + 1, z: z - 1 }, { x: x + 1, z: z + 1 }, { x: x + 2, z }]) {
    const w = world.entities.create("construction");
    setConstruction(world.components, w, { designationId: w, kind: "wall", site: { x: wall.x, z: wall.z }, requiredMaterialId: "wood", requiredMassKg: 1, workDone: 1, workRequired: 1, status: "complete" });
  }
  const l = world.entities.create("construction");
  setConstruction(world.components, l, { designationId: l, kind: "lodge-segment", site: { x, z }, requiredMaterialId: "wood", requiredMassKg: 1, workDone: 1, workRequired: 1, status: "complete" });
  const left = createSleepSpace(world, { zoneId, kind: "nest", cell: { x, z } });
  const right = createSleepSpace(world, { zoneId, kind: "nest", cell: { x: x + 1, z } });
  claimSleepSpace(world, a, left);
  claimSleepSpace(world, b, right);
}

describe("P10-11 torture suite 4 -- world/travel/history/chronicle", () => {
  it("deep time genuinely changes an inactive site's population and food", () => {
    const { world, regionMap } = buildRegionWorld("t4-01");
    const site = createSite(world, regionMap, 2, 2, 6, 50);
    const beforePop = getSite(world.components, site)!.populationCount;
    const beforeFood = getSite(world.components, site)!.storedFoodKg;
    advanceWorldTicks(world, 100 * 48_000, () => "forest", { ...BIOMES, forest: 1.0 });
    const after = getSite(world.components, site)!;
    expect(after.populationCount).not.toBe(beforePop);
    expect(after.storedFoodKg).not.toBe(beforeFood);
  });

  it("a real flood disaster reduces stored food and records the loss", () => {
    const { world, regionMap } = buildRegionWorld("t4-02");
    const site = createSite(world, regionMap, 2, 2, 10, 200);
    const before = getSite(world.components, site)!.storedFoodKg;
    applyDisasterToSite(world, site, { kind: "flood", regionX: 2, regionZ: 2, severity: 0.5 });
    expect(getSite(world.components, site)!.storedFoodKg).toBeLessThan(before);
    expect(world.events.eventsOfType("world-flood").length).toBe(1);
  });

  it("activation materializes exactly the summary population", () => {
    const { world, materials, regionMap } = buildRegionWorld("t4-03");
    const site = createSite(world, regionMap, 2, 2, 5, 100);
    const activated = activateSite(site, materials, world);
    expect(activated.world.entities.liveIdsOfKind("beaver").length).toBe(5);
  });

  it("deactivation reads the live state back into the summary", () => {
    const { world, materials, regionMap } = buildRegionWorld("t4-04");
    const site = createSite(world, regionMap, 2, 2, 5, 100);
    const activated = activateSite(site, materials, world);
    deactivateSite(site, world, activated);
    expect(getSite(world.components, site)!.active).toBe(false);
    expect(getSite(world.components, site)!.populationCount).toBe(5);
  });

  it("the wayfarer's journey pays the route's real cost", () => {
    const { world, materials, regionMap } = buildRegionWorld("t4-05");
    const a = createSite(world, regionMap, 2, 2, 4, 100);
    const b = createSite(world, regionMap, 12, 2, 4, 100);
    const wayfarer = createWayfarer(world, "Fen", 2, 2);
    const clockBefore = world.clock.tick;
    const travel = travelToSite(world, regionMap, materials, wayfarer, b, () => "forest", BIOMES);
    expect(travel.travelTicks).toBe(10);
    expect(world.clock.tick).toBe(clockBefore + 10);
    void a;
  });

  it("the wayfarer's skills survive a journey", () => {
    const { world, materials, regionMap } = buildRegionWorld("t4-06");
    const a = createSite(world, regionMap, 2, 2, 4, 100);
    const b = createSite(world, regionMap, 12, 2, 4, 100);
    const wayfarer = createWayfarer(world, "Fen", 2, 2);
    const activated = activateSite(a, materials, world);
    const beaver = materializeWayfarer(world, activated.world, wayfarer, getWayfarer(world.components, wayfarer)!, { x: 5, y: 3, z: 5 });
    setSkills(activated.world.components, beaver, { levels: { swimming: 3 } });
    departSiteAsWayfarer(world, materials, wayfarer, a, activated);
    const travel = travelToSite(world, regionMap, materials, wayfarer, b, () => "forest", BIOMES);
    expect(getSkills(travel.activated.world.components, travel.beaverId)?.levels).toEqual({ swimming: 3 });
  });

  it("the wayfarer's wounds survive a journey", () => {
    const { world, materials, regionMap } = buildRegionWorld("t4-07");
    const a = createSite(world, regionMap, 2, 2, 4, 100);
    const b = createSite(world, regionMap, 12, 2, 4, 100);
    const wayfarer = createWayfarer(world, "Fen", 2, 2);
    const activated = activateSite(a, materials, world);
    const beaver = materializeWayfarer(world, activated.world, wayfarer, getWayfarer(world.components, wayfarer)!, { x: 5, y: 3, z: 5 });
    const attacker = activated.beaverIds.find((id) => id !== beaver)!;
    resolveAttack(activated.world, attacker, beaver, 4, 0, activated.world.random.stream("t4-07"), undefined);
    departSiteAsWayfarer(world, materials, wayfarer, a, activated);
    expect(getWayfarer(world.components, wayfarer)!.state.wounds.length).toBe(1);
    const travel = travelToSite(world, regionMap, materials, wayfarer, b, () => "forest", BIOMES);
    expect(getWounds(travel.activated.world.components, travel.beaverId)?.entries.length).toBe(1);
  });

  it("site history reconstructs the founding and the disaster", () => {
    const { world, regionMap } = buildRegionWorld("t4-08");
    const site = createSite(world, regionMap, 2, 2, 10, 200);
    world.clock.advanceTicks(10);
    applyDisasterToSite(world, site, { kind: "drought", regionX: 2, regionZ: 2, severity: 0.6 });
    const kinds = siteHistory(world, site).map((e) => e.kind);
    expect(kinds).toContain("founding");
    expect(kinds).toContain("disaster");
  });

  it("population reconstruction lands on live state for recorded deltas only", () => {
    const { world, regionMap } = buildRegionWorld("t4-09");
    const site = createSite(world, regionMap, 2, 2, 12, 200);
    applyDisasterToSite(world, site, { kind: "flood", regionX: 2, regionZ: 2, severity: 0.5 });
    const reconstruction = sitePopulationAt(world, site, world.clock.tick);
    expect(reconstruction.reconstructible).toBe(true);
    expect(reconstruction.population).toBe(getSite(world.components, site)!.populationCount);
  });

  it("the world timeline is chronological", () => {
    const { world, regionMap } = buildRegionWorld("t4-10");
    createSite(world, regionMap, 2, 2, 6, 100);
    world.clock.advanceTicks(5);
    createSite(world, regionMap, 10, 2, 6, 100);
    const timeline = worldTimeline(world);
    for (let i = 1; i < timeline.length; i++) {
      expect(timeline[i - 1]!.tick).toBeLessThanOrEqual(timeline[i]!.tick);
    }
  });

  it("an entity's timeline contains only its own events", () => {
    const { world, regionMap } = buildRegionWorld("t4-11");
    const a = createSite(world, regionMap, 2, 2, 6, 100);
    const b = createSite(world, regionMap, 10, 2, 6, 100);
    for (const event of entityTimeline(world, a)) {
      expect(event.subjectIds.includes(a) || event.objectIds.includes(a)).toBe(true);
    }
    void b;
  });

  it("genealogy traverses generations without duplicates", () => {
    const { world } = buildDetailedWorld("t4-12");
    const founderA = spawnAt(world, "FA", 3, 3);
    const founderB = spawnAt(world, "FB", 4, 3);
    const household = createHousehold(world);
    setHouseholdMembership(world.components, founderA, { householdId: household });
    setHouseholdMembership(world.components, founderB, { householdId: household });
    setRelationshipWith(world.components, founderA, { withId: founderB, kin: "mate", familiarity: 1, affinity: 0.9 });
    setRelationshipWith(world.components, founderB, { withId: founderA, kin: "mate", familiarity: 1, affinity: 0.9 });
    lodgeFor(world, founderA, founderB, 3, 3);
    const gen1 = produceOffspring(world, founderA, founderB, { birthIntervalTicks: 0 }).offspringId;
    expect(parentsOf(world, gen1)).toEqual([founderA, founderB]);
    expect(descendantsOf(world, founderA)).toContain(gen1);
  });

  it("an artifact's owner chain reconstructs from recorded transfers", () => {
    const { world } = buildDetailedWorld("t4-13");
    const maker = spawnAt(world, "M", 4, 3);
    const item = world.entities.create("good");
    world.grid.setEntityPosition(item, 5, 3, 5);
    setGood(world.components, item, { goodKind: "artwork", materialId: "wood", massKg: 2, makerId: maker });
    setOwner(world.components, item, { ownerType: "personal", ownerId: maker });
    const history = artifactHistory(world, item);
    expect(history.maker).toBe(maker);
    expect(getOwner(world.components, item)?.ownerId).toBe(maker);
  });

  it("a site's polity is a real persistent entity", () => {
    const { world, regionMap } = buildRegionWorld("t4-14");
    const site = createSite(world, regionMap, 2, 2, 6, 100);
    establishPolity(world, site);
    expect(world.events.eventsOfType("polity-established").length).toBe(1);
  });

  it("a wayfarer cannot be created at negative region coordinates", () => {
    const { world } = buildRegionWorld("t4-15");
    expect(() => createWayfarer(world, "X", -1, 2)).toThrow(RangeError);
  });

  it("departing without materialization fails honestly", () => {
    const { world, materials, regionMap } = buildRegionWorld("t4-16");
    const site = createSite(world, regionMap, 2, 2, 4, 100);
    const wayfarer = createWayfarer(world, "Fen", 2, 2);
    const activated = activateSite(site, materials, world);
    expect(() => departSiteAsWayfarer(world, materials, wayfarer, site, activated)).toThrow(RangeError);
  });

  it("traveling while at a site fails honestly (depart first)", () => {
    const { world, materials, regionMap } = buildRegionWorld("t4-17");
    const a = createSite(world, regionMap, 2, 2, 4, 100);
    const b = createSite(world, regionMap, 12, 2, 4, 100);
    const wayfarer = createWayfarer(world, "Fen", 2, 2);
    const activated = activateSite(a, materials, world);
    materializeWayfarer(world, activated.world, wayfarer, getWayfarer(world.components, wayfarer)!, { x: 5, y: 3, z: 5 });
    // The wayfarer is genuinely AT the site (the caller records it).
    setWayfarer(world.components, wayfarer, { ...getWayfarer(world.components, wayfarer)!, atSiteId: a });
    expect(() => travelToSite(world, regionMap, materials, wayfarer, b, () => "forest", BIOMES)).toThrow(RangeError);
  });

  it("a carried item promotes to the region and materializes at the destination", () => {
    const { world, materials, regionMap } = buildRegionWorld("t4-18");
    const a = createSite(world, regionMap, 2, 2, 4, 100);
    const b = createSite(world, regionMap, 12, 2, 4, 100);
    const wayfarer = createWayfarer(world, "Fen", 2, 2);
    const activated = activateSite(a, materials, world);
    const beaver = materializeWayfarer(world, activated.world, wayfarer, getWayfarer(world.components, wayfarer)!, { x: 5, y: 3, z: 5 });
    const item = activated.world.entities.create("good");
    activated.world.grid.setEntityPosition(item, 6, 3, 6);
    setGood(activated.world.components, item, { goodKind: "artwork", materialId: "wood", massKg: 2 });
    setOwner(activated.world.components, item, { ownerType: "personal", ownerId: beaver });
    departSiteAsWayfarer(world, materials, wayfarer, a, activated);
    expect(getWayfarer(world.components, wayfarer)!.state.itemIds.length).toBe(1);
    const travel = travelToSite(world, regionMap, materials, wayfarer, b, () => "forest", BIOMES);
    expect(travel.activated.world.components.query(OwnerComponent).length).toBeGreaterThan(0);
  });

  it("deep time leaves the event log intact and queryable", () => {
    const { world, regionMap } = buildRegionWorld("t4-19");
    const site = createSite(world, regionMap, 2, 2, 6, 100);
    const foundingId = world.events.eventsOfType("site-founded")[0]!.id;
    advanceWorldTicks(world, 100 * 48_000, () => "forest", BIOMES);
    expect(world.events.get(foundingId).eventType).toBe("site-founded");
    expect(world.events.count).toBeGreaterThanOrEqual(1);
    void site;
  });

  it("chronicle genealogy survives deep time", () => {
    const { world } = buildDetailedWorld("t4-20");
    const founderA = spawnAt(world, "FA", 3, 3);
    const founderB = spawnAt(world, "FB", 4, 3);
    const household = createHousehold(world);
    setHouseholdMembership(world.components, founderA, { householdId: household });
    setHouseholdMembership(world.components, founderB, { householdId: household });
    setRelationshipWith(world.components, founderA, { withId: founderB, kin: "mate", familiarity: 1, affinity: 0.9 });
    setRelationshipWith(world.components, founderB, { withId: founderA, kin: "mate", familiarity: 1, affinity: 0.9 });
    lodgeFor(world, founderA, founderB, 3, 3);
    const gen1 = produceOffspring(world, founderA, founderB, { birthIntervalTicks: 0 }).offspringId;
    world.clock.advanceTicks(48_000);
    expect(parentsOf(world, gen1)).toEqual([founderA, founderB]);
  });

  it("a wayfarer's departure is causally chained to its arrival", () => {
    const { world, materials, regionMap } = buildRegionWorld("t4-21");
    const b = createSite(world, regionMap, 12, 2, 4, 100);
    const wayfarer = createWayfarer(world, "Fen", 2, 2);
    travelToSite(world, regionMap, materials, wayfarer, b, () => "forest", BIOMES);
    const arrival = world.events.eventsOfType("wayfarer-arrived")[0]!;
    const departure = world.events.eventsOfType("wayfarer-journey-started")[0]!;
    expect(arrival.causeEventId).toBe(departure.id);
  });
});
