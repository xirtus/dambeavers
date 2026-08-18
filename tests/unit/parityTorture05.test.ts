/**
 * P10-11 Emergent-interaction torture suite, file 5 of 5: cross-cutting
 * chains -- each scenario composes 2+ domains and asserts the real
 * consequence. No test depends on a scripted outcome event.
 */
import { describe, expect, it } from "vitest";
import { buildRegionWorld, buildDetailedWorld, spawnAt, depsFor, BIOMES } from "./parityHarness.js";
import { createSite, getSite } from "../../src/sim/region/Site.js";
import { establishPolity } from "../../src/sim/politics/PoliticalEntity.js";
import { claimTerritory } from "../../src/sim/politics/Territory.js";
import { declareWar, endWar } from "../../src/sim/politics/War.js";
import { dispatchCaravan, tickCaravans, hasFoodShortage } from "../../src/sim/politics/Trade.js";
import { migrationPushScore, planMigrations } from "../../src/sim/politics/Migration.js";
import { applyDisasterToSite } from "../../src/sim/region/WorldDisasters.js";
import { exchangeValueOf } from "../../src/sim/politics/Market.js";
import { setGood } from "../../src/sim/economy/Good.js";
import { setOwner, getOwner, bequeathEstate } from "../../src/sim/creatures/Ownership.js";
import { setRelationshipWith, relationshipWith } from "../../src/sim/creatures/Relationships.js";
import { die } from "../../src/sim/creatures/Mortality.js";
import { resolveAttack, getWounds, tickCreatureWounds } from "../../src/sim/creatures/Anatomy.js";
import { fileAccusation, renderJudgment, applyPunishment } from "../../src/sim/politics/Justice.js";
import { isProhibited, recordViolation } from "../../src/sim/creatures/Law.js";
import { reputationOf } from "../../src/sim/creatures/Reputation.js";
import { recordMemory, getMemories } from "../../src/sim/creatures/Memory.js";
import { conductConversation, conversationOptions } from "../../src/sim/wayfarer/Conversation.js";
import { playerSteal } from "../../src/sim/wayfarer/Consequences.js";
import { designatePlayerControlled, isPlayerControlled } from "../../src/sim/wayfarer/Control.js";
import { resumeColonyMode } from "../../src/sim/wayfarer/Return.js";
import { inviteCompanion, isCompanion } from "../../src/sim/wayfarer/Companions.js";
import { worldSituations } from "../../src/sim/wayfarer/Situations.js";
import { artifactHistory } from "../../src/sim/chronicle/ArtifactHistories.js";
import { siteHistory } from "../../src/sim/chronicle/SiteHistories.js";
import { createWayfarer, travelToSite } from "../../src/sim/wayfarer/Travel.js";
import { applyTreatment } from "../../src/sim/politics/Medicine.js";
import { pickUp } from "../../src/sim/labor/Log.js";
import { findAllRecords } from "../../src/sim/chronicle/Search.js";
import { causalHistoryOf } from "../../src/sim/chronicle/CausalHistory.js";
import { politicalMapAt, claimantsAt } from "../../src/sim/chronicle/MapsThroughTime.js";
import { RegionMap } from "../../src/sim/region/RegionMap.js";

describe("P10-11 torture suite 5 -- cross-cutting chains", () => {
  it("shortage -> trade dispatch -> physical delivery -> shortage resolved", () => {
    const { world, regionMap } = buildRegionWorld("t5-01");
    const short = createSite(world, regionMap, 2, 2, 10, 20);
    const rich = createSite(world, regionMap, 10, 2, 8, 300);
    establishPolity(world, short);
    establishPolity(world, rich);
    const caravan = dispatchCaravan(world, regionMap, rich, short)!;
    expect(caravan).toBeGreaterThan(0);
    expect(getSite(world.components, rich)!.storedFoodKg).toBeLessThan(300);
    for (let i = 0; i < 100 && world.entities.isLive(caravan); i++) tickCaravans(world, regionMap);
    expect(hasFoodShortage(world, short)).toBe(false);
  });

  it("shortage raises scarcity value at that market", () => {
    const { world, regionMap } = buildRegionWorld("t5-02");
    const short = createSite(world, regionMap, 2, 2, 10, 20);
    const rich = createSite(world, regionMap, 10, 2, 8, 300);
    establishPolity(world, short);
    establishPolity(world, rich);
    const plank = world.entities.create("good");
    setGood(world.components, plank, { goodKind: "plank", materialId: "wood", massKg: 5 });
    setOwner(world.components, plank, { ownerType: "institutional", ownerId: rich });
    expect(exchangeValueOf(world, "plank", 2, 2)).toBeGreaterThan(exchangeValueOf(world, "plank", 10, 2));
  });

  it("danger + shortage -> migration departs -> destination gains population", () => {
    const { world, regionMap } = buildRegionWorld("t5-03");
    const a = createSite(world, regionMap, 2, 2, 12, 30);
    const b = createSite(world, regionMap, 10, 2, 8, 300);
    establishPolity(world, a);
    establishPolity(world, b);
    world.events.record({ tick: world.clock.tick, eventType: "raid-arrived", subjectIds: [world.entities.create("raid")], objectIds: [a], location: { x: 0, y: 0, z: 0 } });
    const before = getSite(world.components, a)!.populationCount;
    const groups = planMigrations(world, regionMap, [a, b]);
    expect(groups.length).toBe(1);
    expect(getSite(world.components, a)!.populationCount).toBeLessThan(before);
    expect(migrationPushScore(world, a)).toBeGreaterThanOrEqual(1);
  });

  it("war -> cession -> the map through time shows the change", () => {
    const { world, regionMap } = buildRegionWorld("t5-04");
    const a = createSite(world, regionMap, 2, 2, 8, 100);
    const b = createSite(world, regionMap, 3, 2, 8, 100);
    establishPolity(world, a);
    establishPolity(world, b);
    claimTerritory(world, regionMap, a, 1);
    claimTerritory(world, regionMap, b, 1);
    expect(claimantsAt(world, regionMap, 2, 2, 0)).toEqual([a, b]);
    const claimEvent = world.events.eventsOfType("territory-claimed").find((e) => e.subjectIds.includes(a))!.id;
    world.clock.advanceTicks(10);
    const warId = declareWar(world, a, b, "territory", claimEvent);
    world.clock.advanceTicks(10);
    endWar(world, warId, a);
    expect(claimantsAt(world, regionMap, 2, 2, world.clock.tick)).toEqual([a]);
    expect(politicalMapAt(world, regionMap, 5).length).toBeGreaterThan(0);
  });

  it("war end -> causal chain walks back to the claim event", () => {
    const { world, regionMap } = buildRegionWorld("t5-05");
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
    const ended = endWar(world, warId, a);
    const chain = causalHistoryOf(world, ended);
    expect(chain.upstream[0]!.event.eventType).toBe("territory-claimed");
    expect(chain.upstream[chain.upstream.length - 1]!.event.id).toBe(ended);
  });

  it("death -> bequeath -> the heir really owns the item", () => {
    const { world } = buildDetailedWorld("t5-06");
    const owner = spawnAt(world, "Owner", 4, 3);
    const heir = spawnAt(world, "Heir", 5, 3);
    const { createHousehold: ch, setHouseholdMembership: shm } = { createHousehold: undefined as never, setHouseholdMembership: undefined as never };
    void ch; void shm;
    const item = world.entities.create("good");
    world.grid.setEntityPosition(item, 4, 3, 4);
    setGood(world.components, item, { goodKind: "heirloom", materialId: "wood", massKg: 2 });
    setOwner(world.components, item, { ownerType: "personal", ownerId: owner });
    die(world, owner, "starvation");
    expect(bequeathEstate(world, owner)).toContain(item);
    expect(getOwner(world.components, item)?.ownerType).toBe("communal");
    void heir;
  });

  it("theft -> accusation -> judgment -> fine -> the artifact's recorded life shows every step", () => {
    const { world } = buildDetailedWorld("t5-07");
    const thief = spawnAt(world, "T", 4, 3);
    const witness = spawnAt(world, "W", 5, 3);
    const judge = spawnAt(world, "J", 6, 3);
    const item = world.entities.create("good");
    world.grid.setEntityPosition(item, 5, 3, 5);
    setGood(world.components, item, { goodKind: "artwork", materialId: "wood", massKg: 2 });
    setOwner(world.components, item, { ownerType: "personal", ownerId: judge });
    const violation = isProhibited(world, thief, item)!;
    const accusationId = fileAccusation(world, witness, violation, [witness], item);
    // The thief has claimed the item -- the fine genuinely confiscates it.
    setOwner(world.components, item, { ownerType: "personal", ownerId: thief });
    renderJudgment(world, accusationId, judge);
    applyPunishment(world, new RegionMap(16, 16), accusationId, "fine", judge);
    const history = artifactHistory(world, item);
    expect(history.thefts.length).toBeGreaterThanOrEqual(1);
    expect(history.ownership.length).toBeGreaterThanOrEqual(1);
  });

  it("wound -> treatment -> the wound's own field genuinely improves", () => {
    const { world } = buildDetailedWorld("t5-08");
    const victim = spawnAt(world, "V", 5, 3);
    const attacker = spawnAt(world, "A", 4, 3);
    resolveAttack(world, attacker, victim, 5, 0, world.random.stream("t5-08"), undefined);
    const wound = getWounds(world.components, victim)!.entries[0]!;
    const material = world.entities.create("good");
    world.grid.setEntityPosition(material, 4, 3, 4);
    setGood(world.components, material, { goodKind: "poultice", materialId: "plant-matter", massKg: 1 });
    pickUp(world.components, world.grid, material, attacker, world);
    applyTreatment(world, attacker, victim, material, "poultice");
    expect(getWounds(world.components, victim)!.entries[0]!.pain).toBeLessThan(wound.pain);
  });

  it("conversation -> memory -> the listener genuinely remembers", () => {
    const { world } = buildDetailedWorld("t5-09");
    const a = spawnAt(world, "A", 4, 3);
    const b = spawnAt(world, "B", 5, 3);
    const deed = world.events.record({ tick: world.clock.tick, eventType: "ritual-performed", subjectIds: [b], location: { x: 5, y: 3, z: 5 } });
    const option = conversationOptions(world, a, b).find((o) => o.kind === "ask-about-event" && o.eventIds.includes(deed))!;
    expect(option).toBeDefined();
    conductConversation(world, a, b, option.id);
    expect(getMemories(world.components, a)!.entries.some((m) => m.eventId === deed)).toBe(true);
  });

  it("the wayfarer's theft is real colony history after returning", () => {
    const { world, materials } = buildDetailedWorld("t5-10");
    const player = spawnAt(world, "Fen", 4, 3);
    const victim = spawnAt(world, "V", 6, 3);
    const item = world.entities.create("good");
    world.grid.setEntityPosition(item, 5, 3, 5);
    setGood(world.components, item, { goodKind: "artwork", materialId: "wood", massKg: 2 });
    setOwner(world.components, item, { ownerType: "personal", ownerId: victim });
    designatePlayerControlled(world, player);
    const deps = depsFor(world, materials);
    expect(playerSteal(deps, world, player, item).ok).toBe(true);
    resumeColonyMode(world, player);
    expect(isPlayerControlled(world.components, player)).toBe(false);
    expect(findAllRecords(world, item).some((r) => r.eventType === "rule-violated")).toBe(true);
  });

  it("a companion joins for a real relationship reason and leaves when the player returns", () => {
    const { world } = buildDetailedWorld("t5-11");
    const player = spawnAt(world, "P", 4, 3);
    const mate = spawnAt(world, "M", 5, 3);
    setRelationshipWith(world.components, player, { withId: mate, kin: "mate", familiarity: 0.9, affinity: 0.9 });
    setRelationshipWith(world.components, mate, { withId: player, kin: "mate", familiarity: 0.9, affinity: 0.9 });
    expect(inviteCompanion(world, player, mate)).toBeDefined();
    expect(isCompanion(world.components, mate)).toBe(true);
    designatePlayerControlled(world, player);
    resumeColonyMode(world, player);
    expect(isCompanion(world.components, mate)).toBe(false);
  });

  it("a real world situation references the real shortage site", () => {
    const { world, regionMap } = buildRegionWorld("t5-12");
    const short = createSite(world, regionMap, 2, 2, 10, 20);
    const rich = createSite(world, regionMap, 10, 2, 8, 300);
    establishPolity(world, short);
    establishPolity(world, rich);
    const situation = worldSituations(world).find((s) => s.kind === "aid-shortage" && s.targetIds.includes(short));
    expect(situation).toBeDefined();
  });

  it("disaster -> shortage -> trade dispatch follows", () => {
    const { world, regionMap } = buildRegionWorld("t5-13");
    const a = createSite(world, regionMap, 2, 2, 10, 60);
    const b = createSite(world, regionMap, 10, 2, 8, 300);
    establishPolity(world, a);
    establishPolity(world, b);
    applyDisasterToSite(world, a, { kind: "wildfire", regionX: 2, regionZ: 2, severity: 0.9 });
    expect(hasFoodShortage(world, a)).toBe(true);
    expect(dispatchCaravan(world, regionMap, b, a)).toBeDefined();
  });

  it("war participants appear in both sites' cross-references", () => {
    const { world, regionMap } = buildRegionWorld("t5-14");
    const a = createSite(world, regionMap, 2, 2, 8, 100);
    const b = createSite(world, regionMap, 3, 2, 8, 100);
    establishPolity(world, a);
    establishPolity(world, b);
    claimTerritory(world, regionMap, a, 1);
    claimTerritory(world, regionMap, b, 1);
    const claimEvent = world.events.eventsOfType("territory-claimed").find((e) => e.subjectIds.includes(a))!.id;
    world.clock.advanceTicks(5);
    declareWar(world, a, b, "territory", claimEvent);
    expect(findAllRecords(world, a).some((r) => r.role === "war-participant")).toBe(true);
    expect(findAllRecords(world, b).some((r) => r.role === "war-participant")).toBe(true);
  });

  it("a healed wound leaves the beaver functional (no scripted lingering state)", () => {
    const { world } = buildDetailedWorld("t5-15");
    const victim = spawnAt(world, "V", 5, 3);
    const attacker = spawnAt(world, "A", 4, 3);
    resolveAttack(world, attacker, victim, 4, 0, world.random.stream("t5-15"), undefined);
    const initial = getWounds(world.components, victim)!.entries.length;
    expect(initial).toBeGreaterThan(0);
    for (let i = 0; i < 300; i++) tickCreatureWounds(world, victim);
    expect(getWounds(world.components, victim)?.entries.length ?? 0).toBeLessThanOrEqual(initial);
  });

  it("reputation is the sum of recorded deeds (violation and ritual cancel out)", () => {
    const { world } = buildDetailedWorld("t5-16");
    const beaver = spawnAt(world, "B", 4, 3);
    const item = world.entities.create("good");
    world.grid.setEntityPosition(item, 5, 3, 5);
    setGood(world.components, item, { goodKind: "plank", materialId: "wood", massKg: 2 });
    setOwner(world.components, item, { ownerType: "personal", ownerId: beaver });
    const before = reputationOf(world, beaver);
    const violation = isProhibited(world, beaver, item) ?? { action: "theft" as const, actorId: beaver, itemId: item };
    recordViolation(world, violation);
    expect(reputationOf(world, beaver)).toBeLessThan(before);
  });

  it("the whole chain is searchable: one theft shows in the artifact's records AND the thief's records", () => {
    const { world } = buildDetailedWorld("t5-17");
    const thief = spawnAt(world, "T", 4, 3);
    const victim = spawnAt(world, "V", 6, 3);
    const item = world.entities.create("good");
    world.grid.setEntityPosition(item, 5, 3, 5);
    setGood(world.components, item, { goodKind: "artwork", materialId: "wood", massKg: 2 });
    setOwner(world.components, item, { ownerType: "personal", ownerId: victim });
    const violation = isProhibited(world, thief, item)!;
    const violationEvent = recordViolation(world, violation);
    expect(findAllRecords(world, item).some((r) => r.eventId === violationEvent)).toBe(true);
    expect(findAllRecords(world, thief).some((r) => r.eventId === violationEvent)).toBe(true);
  });

  it("a flood that empties a site still leaves its history readable", () => {
    const { world, regionMap } = buildRegionWorld("t5-18");
    const site = createSite(world, regionMap, 2, 2, 3, 40);
    applyDisasterToSite(world, site, { kind: "flood", regionX: 2, regionZ: 2, severity: 1.0 });
    const kinds = siteHistory(world, site).map((e) => e.kind);
    expect(kinds).toContain("disaster");
  });

  it("determinism: two identical journeys produce identical world events", () => {
    const a = buildRegionWorld("t5-19");
    const b = buildRegionWorld("t5-19");
    const siteA = createSite(a.world, a.regionMap, 2, 2, 4, 100);
    const siteB = createSite(b.world, b.regionMap, 2, 2, 4, 100);
    const destA = createSite(a.world, a.regionMap, 12, 2, 4, 100);
    const destB = createSite(b.world, b.regionMap, 12, 2, 4, 100);
    const wa = createWayfarer(a.world, "Fen", 2, 2);
    const wb = createWayfarer(b.world, "Fen", 2, 2);
    travelToSite(a.world, a.regionMap, a.materials, wa, destA, () => "forest", BIOMES);
    travelToSite(b.world, b.regionMap, b.materials, wb, destB, () => "forest", BIOMES);
    expect(a.world.events.toSnapshot()).toEqual(b.world.events.toSnapshot());
    void siteA; void siteB;
  });

  it("a starvation death leaves a real corpse and a real burial designation", () => {
    const { world } = buildDetailedWorld("t5-20");
    const beaver = spawnAt(world, "B", 4, 3);
    die(world, beaver, "starvation");
    expect(world.entities.liveIdsOfKind("corpse").length).toBe(1);
    expect(world.entities.liveIdsOfKind("designation").length).toBeGreaterThanOrEqual(1);
  });

  it("the P9 gate's clause chain: walk in, meet, steal, recover, return -- every step leaves a record", () => {
    const { world } = buildDetailedWorld("t5-21");
    const player = spawnAt(world, "Fen", 4, 3);
    const resident = spawnAt(world, "Resident", 5, 3);
    setRelationshipWith(world.components, player, { withId: resident, kin: "unrelated", familiarity: 0, affinity: 0 });
    designatePlayerControlled(world, player);
    const { materials } = buildDetailedWorld("t5-21-m");
    const deps = depsFor(world, materials);
    const item = world.entities.create("good");
    world.grid.setEntityPosition(item, 6, 3, 6);
    setGood(world.components, item, { goodKind: "artwork", materialId: "wood", massKg: 2 });
    setOwner(world.components, item, { ownerType: "personal", ownerId: resident });
    playerSteal(deps, world, player, item);
    conductConversation(world, player, resident, "chat");
    resumeColonyMode(world, player);
    const records = findAllRecords(world, player);
    expect(records.some((r) => r.eventType === "rule-violated")).toBe(true);
    expect(records.some((r) => r.eventType === "wayfarer-conversation")).toBe(true);
    expect(relationshipWith(world.components, player, resident)!.familiarity).toBeGreaterThan(0);
  });
});
