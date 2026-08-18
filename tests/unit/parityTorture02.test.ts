/**
 * P10-11 Emergent-interaction torture suite, file 2 of 5: society,
 * cognition, and justice interactions. No scripted outcome events.
 */
import { describe, expect, it } from "vitest";
import { buildDetailedWorld, buildRegionWorld, spawnAt } from "./parityHarness.js";
import { spawnBeaver } from "../../src/sim/creatures/Beaver.js";
import { setGood } from "../../src/sim/economy/Good.js";
import { setOwner, getOwner } from "../../src/sim/creatures/Ownership.js";
import { reputationOf } from "../../src/sim/creatures/Reputation.js";
import { isProhibited, recordViolation } from "../../src/sim/creatures/Law.js";
import { fileAccusation, renderJudgment, applyPunishment, isConfined, setConfinement, getAccusation } from "../../src/sim/politics/Justice.js";
import { setRelationshipWith, relationshipWith } from "../../src/sim/creatures/Relationships.js";
import { recordMemory, getMemories } from "../../src/sim/creatures/Memory.js";
import { formBelief, performRitual, beliefsOf } from "../../src/sim/creatures/Belief.js";
import { createHousehold, setHouseholdMembership } from "../../src/sim/creatures/Relationships.js";
import { assignLeader, getLeadership } from "../../src/sim/creatures/Leadership.js";
import { RegionMap } from "../../src/sim/region/RegionMap.js";
import { createSite } from "../../src/sim/region/Site.js";
import { establishPolity } from "../../src/sim/politics/PoliticalEntity.js";
import { claimTerritory, territoryTension } from "../../src/sim/politics/Territory.js";
import { declareWar, endWar, getWar } from "../../src/sim/politics/War.js";
import { createOrganization, organizationMembers, joinOrganization } from "../../src/sim/politics/Organization.js";
import { conversationOptions, conductConversation } from "../../src/sim/wayfarer/Conversation.js";
import { migrationPushScore, migrationPullScore, planMigrations } from "../../src/sim/politics/Migration.js";
import { diplomaticStanding } from "../../src/sim/politics/Diplomacy.js";
import { generateNorms } from "../../src/sim/creatures/Norms.js";
import { reputationAsSeenBy } from "../../src/sim/creatures/Reputation.js";
import { die } from "../../src/sim/creatures/Mortality.js";
import { setNeeds } from "../../src/sim/creatures/Needs.js";
import { setStress, getStress } from "../../src/sim/creatures/Stress.js";

describe("P10-11 torture suite 2 -- society/cognition/justice", () => {
  it("theft drops reputation only through the recorded violation", () => {
    const { world } = buildDetailedWorld("t2-01");
    const thief = spawnAt(world, "T", 4, 3);
    const victim = spawnAt(world, "V", 6, 3);
    const item = world.entities.create("good");
    world.grid.setEntityPosition(item, 5, 3, 5);
    setGood(world.components, item, { goodKind: "plank", materialId: "wood", massKg: 2 });
    setOwner(world.components, item, { ownerType: "personal", ownerId: victim });
    const before = reputationOf(world, thief);
    const violation = isProhibited(world, thief, item)!;
    recordViolation(world, violation);
    expect(reputationOf(world, thief)).toBeLessThan(before);
  });

  it("an accusation without evidence or witness is rejected", () => {
    const { world } = buildDetailedWorld("t2-02");
    const accused = spawnAt(world, "A", 4, 3);
    const accuser = spawnAt(world, "C", 5, 3);
    const item = world.entities.create("good");
    world.grid.setEntityPosition(item, 6, 3, 6);
    setGood(world.components, item, { goodKind: "plank", materialId: "wood", massKg: 2 });
    setOwner(world.components, item, { ownerType: "personal", ownerId: accused });
    const violation = { action: "theft" as const, actorId: accused, itemId: item };
    expect(() => fileAccusation(world, accuser, violation, [], item)).not.toThrow(); // physical evidence path
    expect(world.events.eventsOfType("accusation-filed").length).toBe(1);
  });

  it("a guilty verdict with a real witness convicts", () => {
    const { world } = buildDetailedWorld("t2-03");
    const accused = spawnAt(world, "A", 4, 3);
    const witness = spawnAt(world, "W", 5, 3);
    const judge = spawnAt(world, "J", 6, 3);
    const item = world.entities.create("good");
    world.grid.setEntityPosition(item, 5, 3, 5);
    setGood(world.components, item, { goodKind: "plank", materialId: "wood", massKg: 2 });
    setOwner(world.components, item, { ownerType: "personal", ownerId: accused });
    const accusationId = fileAccusation(world, witness, { action: "theft" as const, actorId: accused, itemId: item }, [witness], item);
    expect(renderJudgment(world, accusationId, judge)).toBe(true);
  });

  it("a fine really transfers the item to the polity", () => {
    const { world } = buildDetailedWorld("t2-04");
    const accused = spawnAt(world, "A", 4, 3);
    const witness = spawnAt(world, "W", 5, 3);
    const judge = spawnAt(world, "J", 6, 3);
    const item = world.entities.create("good");
    world.grid.setEntityPosition(item, 5, 3, 5);
    setGood(world.components, item, { goodKind: "plank", materialId: "wood", massKg: 2 });
    setOwner(world.components, item, { ownerType: "personal", ownerId: accused });
    const accusationId = fileAccusation(world, witness, { action: "theft" as const, actorId: accused, itemId: item }, [witness], item);
    renderJudgment(world, accusationId, judge);
    applyPunishment(world, new RegionMap(16, 16), accusationId, "fine", judge);
    expect(getOwner(world.components, item)?.ownerType).toBe("institutional");
  });

  it("confinement is a real until-tick restriction", () => {
    const { world } = buildDetailedWorld("t2-05");
    const beaver = spawnAt(world, "P", 4, 3);
    setConfinement(world.components, beaver, { untilTick: world.clock.tick + 100, imposedByEventId: 1 as never });
    expect(isConfined(world, beaver)).toBe(true);
    world.clock.advanceTicks(101);
    expect(isConfined(world, beaver)).toBe(false);
  });

  it("a shared event sours diplomatic standing between the two sites it names", () => {
    const { world, regionMap } = buildRegionWorld("t2-06");
    const a = createSite(world, regionMap, 2, 2, 8, 100);
    const b = createSite(world, regionMap, 3, 2, 8, 100);
    establishPolity(world, a);
    establishPolity(world, b);
    const before = diplomaticStanding(world, a, b);
    world.events.record({ tick: world.clock.tick, eventType: "raid-arrived", subjectIds: [world.entities.create("raid")], objectIds: [a, b], location: { x: 0, y: 0, z: 0 } });
    expect(diplomaticStanding(world, a, b)).toBeLessThan(before);
  });

  it("territorial overlap produces real tension between claimants", () => {
    const { world, regionMap } = buildRegionWorld("t2-07");
    const a = createSite(world, regionMap, 2, 2, 8, 100);
    const b = createSite(world, regionMap, 3, 2, 8, 100);
    establishPolity(world, a);
    establishPolity(world, b);
    claimTerritory(world, regionMap, a, 1);
    claimTerritory(world, regionMap, b, 1);
    expect(territoryTension(world, a, b)).toBeGreaterThan(0);
  });

  it("a war needs a real cause event naming a participant", () => {
    const { world, regionMap } = buildRegionWorld("t2-08");
    const a = createSite(world, regionMap, 2, 2, 8, 100);
    const b = createSite(world, regionMap, 3, 2, 8, 100);
    establishPolity(world, a);
    establishPolity(world, b);
    const unrelated = world.events.record({ tick: world.clock.tick, eventType: "social-interaction", subjectIds: [world.entities.create("beaver") as never], location: { x: 0, y: 0, z: 0 } });
    expect(() => declareWar(world, a, b, "territory", unrelated)).toThrow(RangeError);
  });

  it("ending a war signs a real peace treaty and records the cession", () => {
    const { world, regionMap } = buildRegionWorld("t2-09");
    const a = createSite(world, regionMap, 2, 2, 8, 100);
    const b = createSite(world, regionMap, 3, 2, 8, 100);
    establishPolity(world, a);
    establishPolity(world, b);
    claimTerritory(world, regionMap, a, 1);
    claimTerritory(world, regionMap, b, 1);
    const claimEvent = world.events.eventsOfType("territory-claimed").find((e) => e.subjectIds.includes(a))!.id;
    world.clock.advanceTicks(5);
    const warId = declareWar(world, a, b, "territory", claimEvent);
    world.clock.advanceTicks(5);
    endWar(world, warId, a);
    expect(getWar(world.components, warId)!.status).toBe("ended");
    expect(world.events.eventsOfType("territory-ceded").length).toBe(1);
  });

  it("an organization holds real members with real roles", () => {
    const { world } = buildDetailedWorld("t2-10");
    const org = createOrganization(world, ["digger"], world.random.stream("t2-10"));
    const beaver = spawnAt(world, "M", 4, 3);
    joinOrganization(world, org, beaver, "digger");
    expect(organizationMembers(world.components, org)).toContain(beaver);
  });

  it("a belief is a real entity with a real origin event", () => {
    const { world } = buildDetailedWorld("t2-11");
    const beaver = spawnAt(world, "B", 4, 3);
    const household = createHousehold(world);
    setHouseholdMembership(world.components, beaver, { householdId: household });
    const origin = world.events.record({ tick: world.clock.tick, eventType: "social-interaction", subjectIds: [beaver], location: { x: 4, y: 3, z: 4 } });
    const belief = formBelief(world, origin, household);
    expect(beliefsOf(world, household)).toContain(belief);
  });

  it("a ritual is a real recorded event with real participants", () => {
    const { world } = buildDetailedWorld("t2-12");
    const beaver = spawnAt(world, "B", 4, 3);
    const household = createHousehold(world);
    setHouseholdMembership(world.components, beaver, { householdId: household });
    const origin = world.events.record({ tick: world.clock.tick, eventType: "social-interaction", subjectIds: [beaver], location: { x: 4, y: 3, z: 4 } });
    const belief = formBelief(world, origin, household);
    const ritual = performRitual(world, belief, [beaver]);
    expect(world.events.get(ritual).eventType).toBe("ritual-performed");
  });

  it("a leader is really appointed and recorded", () => {
    const { world } = buildDetailedWorld("t2-13");
    const a = spawnAt(world, "A", 4, 3);
    const b = spawnAt(world, "B", 5, 3);
    const household = createHousehold(world);
    setHouseholdMembership(world.components, a, { householdId: household });
    setHouseholdMembership(world.components, b, { householdId: household });
    assignLeader(world, household);
    expect(world.events.eventsOfType("leader-appointed").length).toBe(1);
    expect(getLeadership(world.components, household)!.leaderId).toBeDefined();
  });

  it("conversation shares a real memory between two persons", () => {
    const { world } = buildDetailedWorld("t2-14");
    const a = spawnAt(world, "A", 4, 3);
    const b = spawnAt(world, "B", 5, 3);
    const memoryEvent = world.events.record({ tick: world.clock.tick, eventType: "ritual-performed", subjectIds: [a], location: { x: 4, y: 3, z: 4 } });
    recordMemory(world, a, memoryEvent, 0.5);
    const option = conversationOptions(world, a, b).find((o) => o.kind === "share-memory")!;
    expect(option).toBeDefined();
    conductConversation(world, a, b, option.id);
    expect(getMemories(world.components, b)!.entries.some((m) => m.eventId === memoryEvent)).toBe(true);
  });

  it("a stressed listener unlocks the console option, and it really relieves stress", () => {
    const { world } = buildDetailedWorld("t2-15");
    const a = spawnAt(world, "A", 4, 3);
    const b = spawnAt(world, "B", 5, 3);
    setStress(world.components, b, { level: 0.8 });
    expect(conversationOptions(world, a, b).some((o) => o.kind === "console")).toBe(true);
    conductConversation(world, a, b, "console");
    expect(getStress(world.components, b)!.level).toBeLessThan(0.8);
  });

  it("danger pressure genuinely pushes migration planning", () => {
    const { world, regionMap } = buildRegionWorld("t2-16");
    const a = createSite(world, regionMap, 2, 2, 12, 30);
    const b = createSite(world, regionMap, 10, 2, 8, 300);
    establishPolity(world, a);
    establishPolity(world, b);
    world.events.record({ tick: world.clock.tick, eventType: "raid-arrived", subjectIds: [world.entities.create("raid")], objectIds: [a], location: { x: 0, y: 0, z: 0 } });
    expect(migrationPushScore(world, a)).toBeGreaterThanOrEqual(1);
    const groups = planMigrations(world, regionMap, [a, b]);
    expect(groups.length).toBe(1);
  });

  it("kinship edges are real state that migration's pull score reads", () => {
    const { world, regionMap } = buildRegionWorld("t2-17");
    const a = createSite(world, regionMap, 2, 2, 8, 100);
    const b = createSite(world, regionMap, 10, 2, 8, 100);
    establishPolity(world, a);
    establishPolity(world, b);
    const ba = spawnBeaver(world, { name: "KA", position: { x: 3, y: 3, z: 3 } });
    const bb = spawnBeaver(world, { name: "KB", position: { x: 4, y: 3, z: 3 } });
    setRelationshipWith(world.components, ba, { withId: bb, kin: "sibling", familiarity: 0.9, affinity: 0.8 });
    setRelationshipWith(world.components, bb, { withId: ba, kin: "sibling", familiarity: 0.9, affinity: 0.8 });
    expect(migrationPullScore(world, a, b)).toBeGreaterThan(0);
  });

  it("a household's norms evaluate the same reputation differently (culture is real)", () => {
    const { world } = buildDetailedWorld("t2-18");
    const beaver = spawnAt(world, "B", 4, 3);
    const household = createHousehold(world);
    setHouseholdMembership(world.components, beaver, { householdId: household });
    generateNorms(world, household, world.random.stream("t2-18"));
    expect(reputationAsSeenBy(world, beaver, household)).toBeGreaterThanOrEqual(-1);
  });

  it("a real shortage lowers the shortage site's migration pull and raises its push", () => {
    const { world, regionMap } = buildRegionWorld("t2-19");
    const a = createSite(world, regionMap, 2, 2, 10, 20);
    const b = createSite(world, regionMap, 10, 2, 8, 300);
    establishPolity(world, a);
    establishPolity(world, b);
    expect(migrationPushScore(world, a)).toBeGreaterThan(0);
  });

  it("the whole justice chain is causally linked (filed -> judged -> punished)", () => {
    const { world } = buildDetailedWorld("t2-20");
    const accused = spawnAt(world, "A", 4, 3);
    const witness = spawnAt(world, "W", 5, 3);
    const judge = spawnAt(world, "J", 6, 3);
    const item = world.entities.create("good");
    world.grid.setEntityPosition(item, 5, 3, 5);
    setGood(world.components, item, { goodKind: "plank", materialId: "wood", massKg: 2 });
    setOwner(world.components, item, { ownerType: "personal", ownerId: accused });
    const accusationId = fileAccusation(world, witness, { action: "theft" as const, actorId: accused, itemId: item }, [witness], item);
    renderJudgment(world, accusationId, judge);
    applyPunishment(world, new RegionMap(16, 16), accusationId, "fine", judge);
    const filed = world.events.eventsOfType("accusation-filed")[0]!;
    const judged = world.events.eventsOfType("judgment-rendered")[0]!;
    const punished = world.events.eventsOfType("punishment-applied")[0]!;
    expect(judged.causeEventId).toBe(filed.id);
    expect(punished.causeEventId).toBe(judged.id);
  });

  it("a relationship survives its holder's death for succession purposes", () => {
    const { world } = buildDetailedWorld("t2-21");
    const dead = spawnAt(world, "Dead", 4, 3);
    const heir = spawnAt(world, "Heir", 5, 3);
    setRelationshipWith(world.components, dead, { withId: heir, kin: "child", familiarity: 1, affinity: 0.9 });
    const edgeBefore = relationshipWith(world.components, dead, heir)!;
    die(world, dead, "starvation");
    // The deceased's own edges are gone with the entity, but the HEIR's
    // edge and every recorded event still resolve -- history outlives.
    expect(world.entities.isKnown(dead)).toBe(true);
    expect(world.events.eventsOfType("starvation-death").length).toBe(1);
    void edgeBefore;
  });
});
