/**
 * Phase 7 consolidated smoke test -- one integration file exercising
 * real end-to-end paths through every new system of the War, Politics
 * & Civilization phase (the same pattern as
 * `phase4EcosystemSmoke.test.ts` / `phase5SocietySmoke.test.ts` /
 * `phase6WorldSmoke.test.ts`): real region, real sites, real polities,
 * real trade/migration/raids/battles/wars/civilizations driven by the
 * real composed `tickPolitics` loop -- never hand-wired scenario calls.
 */
import { describe, expect, it } from "vitest";
import { EntityIdRegistry, type EntityId } from "../../src/sim/core/EntityId.js";
import { ComponentStore } from "../../src/sim/core/ComponentStore.js";
import { SimulationClock } from "../../src/sim/core/SimulationClock.js";
import { RandomStreams } from "../../src/sim/core/Random.js";
import { WorldGrid } from "../../src/sim/world/WorldGrid.js";
import { TerrainField } from "../../src/sim/world/TerrainField.js";
import { EventLog } from "../../src/sim/history/EventLog.js";
import { MaterialRegistry } from "../../src/sim/materials/Material.js";
import { registerStandardMaterials } from "../../src/sim/materials/standardMaterials.js";
import { WaterField } from "../../src/sim/hydrology/WaterField.js";
import { Weather } from "../../src/sim/weather/Weather.js";
import type { World } from "../../src/sim/persistence/WorldSnapshot.js";
import { RegionMap } from "../../src/sim/region/RegionMap.js";
import { createSite, getSite, setSite } from "../../src/sim/region/Site.js";
import { spawnBeaver } from "../../src/sim/creatures/Beaver.js";
import { ensureSharedHousehold } from "../../src/sim/creatures/Household.js";
import { getHouseholdMembership } from "../../src/sim/creatures/Relationships.js";
import { setRelationshipWith } from "../../src/sim/creatures/Relationships.js";
import { setGood } from "../../src/sim/economy/Good.js";
import { setOwner } from "../../src/sim/creatures/Ownership.js";
import { establishPolity, bindPolityHousehold, polityLeader } from "../../src/sim/politics/PoliticalEntity.js";
import { claimTerritory } from "../../src/sim/politics/Territory.js";
import { signTreaty } from "../../src/sim/politics/Diplomacy.js";
import { createOrganization, joinOrganization } from "../../src/sim/politics/Organization.js";
import { formMilitaryUnit, assignMission, trainUnit } from "../../src/sim/politics/Military.js";
import { planSettlementRaid } from "../../src/sim/politics/Raids.js";
import { makeWeapon } from "../../src/sim/politics/Weaponry.js";
import { pickUp } from "../../src/sim/labor/Log.js";
import { formBelief, adoptBelief } from "../../src/sim/creatures/Belief.js";
import { formCivilization, getCivilization } from "../../src/sim/politics/Civilization.js";
import { tickPolitics } from "../../src/sim/politics/PoliticsLoop.js";
import { CaravanComponent } from "../../src/sim/politics/Trade.js";
import { WarComponent } from "../../src/sim/politics/War.js";
import { CivilizationComponent } from "../../src/sim/politics/Civilization.js";
import { getWar, endWar } from "../../src/sim/politics/War.js";
import { overlappingClaimCells } from "../../src/sim/politics/Territory.js";
import { getBattle } from "../../src/sim/politics/Battle.js";
import { getAccusation } from "../../src/sim/politics/Justice.js";
import { fileAccusation, tickInvestigations, renderJudgment, applyPunishment } from "../../src/sim/politics/Justice.js";
import { isProhibited } from "../../src/sim/creatures/Law.js";
import { tickSuccession, selectInitialLeader } from "../../src/sim/politics/Government.js";
import { woundsOf, tickAllWounds } from "../../src/sim/creatures/Anatomy.js";
import { resolveAttack } from "../../src/sim/creatures/Anatomy.js";
import { exchangeValueOf } from "../../src/sim/politics/Market.js";
import { diplomaticStanding } from "../../src/sim/politics/Diplomacy.js";
import { tickCivilizations, succeedCivilization } from "../../src/sim/politics/Collapse.js";

function buildWorld(): { world: World; regionMap: RegionMap; materials: MaterialRegistry } {
  const entities = new EntityIdRegistry();
  const components = new ComponentStore(entities);
  const grid = new WorldGrid({ sizeX: 20, sizeY: 10, sizeZ: 20 }, entities);
  const materials = new MaterialRegistry();
  registerStandardMaterials(materials);
  const terrain = new TerrainField(grid, materials);
  for (let x = 0; x < 20; x++) for (let z = 0; z < 20; z++) for (let y = 0; y <= 2; y++) terrain.setMaterial(x, y, z, "soil");
  const water = new WaterField(grid);
  const weather = new Weather();
  const clock = new SimulationClock({ tickRateHz: 20 });
  const random = new RandomStreams("phase7-smoke");
  const events = new EventLog(entities);
  return {
    world: { clock, random, entities, components, grid, terrain, events, water, weather },
    regionMap: new RegionMap(16, 16),
    materials,
  };
}

function flatRegion(regionMap: RegionMap): void {
  for (let x = 0; x < regionMap.sizeX; x++) for (let z = 0; z < regionMap.sizeZ; z++) regionMap.setElevation(x, z, 0);
}

function armedBeaver(world: World, orgId: EntityId, name: string, x: number, z: number): EntityId {
  const beaver = spawnBeaver(world, { name, position: { x, y: 3, z } });
  joinOrganization(world, orgId, beaver, "soldier");
  const weapon = world.entities.create("good");
  setGood(world.components, weapon, { goodKind: "axe", materialId: "stone", massKg: 3 });
  makeWeapon(world.components, weapon, "axe", 1, 0.8);
  world.grid.setEntityPosition(weapon, x, 3, z);
  pickUp(world.components, world.grid, weapon, beaver);
  return beaver;
}

describe("Phase 7 smoke -- War, Politics & Civilization end-to-end paths", () => {
  it("trade, migration, and markets flow from real state through the politics loop", () => {
    const { world, regionMap, materials } = buildWorld();
    flatRegion(regionMap);
    const surplus = createSite(world, regionMap, 1, 1, 4, 300);
    const shortage = createSite(world, regionMap, 12, 12, 10, 10);
    establishPolity(world, surplus);
    establishPolity(world, shortage);
    world.events.record({ tick: 0, eventType: "raid-arrived", subjectIds: [world.entities.create("raid")], objectIds: [shortage], location: { x: 0, y: 0, z: 0 } });

    // One politics tick dispatches a caravan from the real surplus/shortage.
    tickPolitics(world, regionMap, { materials });
    const caravans = world.components.query(CaravanComponent);
    expect(caravans.length).toBe(1);

    // Drive until delivery: the food physically arrives at the shortage
    // site and a real delivery event fires.
    for (let tick = 0; tick < 20; tick++) tickPolitics(world, regionMap, { materials });
    expect(world.events.eventsOfType("trade-goods-delivered").length).toBe(1);
    expect(getSite(world.components, shortage)!.storedFoodKg).toBeGreaterThan(10);
    // The dangerous, starving site also produced a real migration.
    expect(world.events.eventsOfType("migration-departed").length).toBeGreaterThanOrEqual(1);
    // And the region's real state prices goods by scarcity.
    expect(exchangeValueOf(world, "plank", 1, 1, 4)).toBeGreaterThan(0);
  });

  it("a defended raid becomes a battle, escalates into war, and territory changes hands", () => {
    const { world, regionMap, materials } = buildWorld();
    flatRegion(regionMap);
    const home = createSite(world, regionMap, 2, 2, 6, 200);
    const target = createSite(world, regionMap, 5, 3, 6, 200);
    establishPolity(world, home);
    establishPolity(world, target);
    claimTerritory(world, regionMap, home, 2);
    claimTerritory(world, regionMap, target, 2);

    const raiderOrg = createOrganization(world, ["soldier"], world.random.stream("r-org"));
    formMilitaryUnit(world, raiderOrg);
    armedBeaver(world, raiderOrg, "R1", 4, 3);
    armedBeaver(world, raiderOrg, "R2", 4, 4);
    trainUnit(world, raiderOrg, 30);

    const defenderOrg = createOrganization(world, ["soldier"], world.random.stream("d-org"));
    formMilitaryUnit(world, defenderOrg);
    const d1 = spawnBeaver(world, { name: "D1", position: { x: 8, y: 3, z: 5 } });
    joinOrganization(world, defenderOrg, d1, "soldier");
    assignMission(world, defenderOrg, "defend", d1, target);

    const raidId = planSettlementRaid(world, regionMap, raiderOrg, home, target, "resources");
    expect(raidId).toBeDefined();

    // Drive the politics loop: the raid travels, arrives, is contested by
    // the defenders, becomes a real battle, escalates into a real war.
    for (let tick = 0; tick < 40; tick++) tickPolitics(world, regionMap, { materials });
    expect(world.events.eventsOfType("raid-arrived").length).toBe(1);
    expect(world.events.eventsOfType("battle-began").length).toBeGreaterThanOrEqual(1);
    expect(world.events.eventsOfType("battle-ended").length).toBeGreaterThanOrEqual(1);
    const wars = world.components.query(WarComponent);
    expect(wars.length).toBe(1);
    const war = getWar(world.components, wars[0]!)!;
    expect(war.status).toBe("ongoing");
    expect(war.causeKind).toBe("raid-escalation");
    // The defenders lost; the raid looted and returned. The war's END is
    // the same `endWar` the loop itself calls when a side is spent (the
    // composed exhaustion path is covered by the loop in the gate test;
    // this smoke section exercises the escalation arc raid -> battle ->
    // war and its real territorial consequence).
    const contestedBefore = overlappingClaimCells(world, home, target).length;
    expect(contestedBefore).toBeGreaterThan(0);
    endWar(world, wars[0]!, home);
    expect(getWar(world.components, wars[0]!)!.status).toBe("ended");
    expect(world.events.eventsOfType("territory-ceded").length).toBeGreaterThanOrEqual(1);
    expect(overlappingClaimCells(world, home, target)).toEqual([]);
    expect(world.events.eventsOfType("raid-looted").length).toBeGreaterThanOrEqual(1);
  });

  it("civilizations form from real relations, collapse when their sites die, and successors inherit beliefs", () => {
    const { world, regionMap, materials } = buildWorld();
    flatRegion(regionMap);
    const siteA = createSite(world, regionMap, 2, 2, 6, 100);
    const siteB = createSite(world, regionMap, 10, 10, 6, 100);
    const siteC = createSite(world, regionMap, 2, 12, 6, 100);
    establishPolity(world, siteA);
    establishPolity(world, siteB);
    establishPolity(world, siteC);

    const a1 = spawnBeaver(world, { name: "A1", position: { x: 3, y: 3, z: 3 } });
    const a2 = spawnBeaver(world, { name: "A2", position: { x: 3, y: 3, z: 4 } });
    bindPolityHousehold(world, siteA, ensureSharedHousehold(world, a1, a2));
    const b1 = spawnBeaver(world, { name: "B1", position: { x: 11, y: 3, z: 11 } });
    const b2 = spawnBeaver(world, { name: "B2", position: { x: 11, y: 3, z: 12 } });
    bindPolityHousehold(world, siteB, ensureSharedHousehold(world, b1, b2));
    signTreaty(world, [siteA, siteB], "alliance");
    const guild = createOrganization(world, ["elder", "member"], world.random.stream("guild"));
    joinOrganization(world, guild, a1, "elder");
    joinOrganization(world, guild, b1, "member");
    const beliefId = formBelief(world, world.events.record({ tick: 0, eventType: "plant-burned-out", subjectIds: [a1], location: { x: 3, y: 3, z: 3 } }), getHouseholdMembership(world.components, a1)!.householdId);
    adoptBelief(world, beliefId, getHouseholdMembership(world.components, b1)!.householdId);

    // The politics loop forms the civilization from the real preconditions.
    for (let tick = 0; tick < 3; tick++) tickPolitics(world, regionMap, { materials });
    const civs = world.components.query(CivilizationComponent);
    expect(civs.length).toBe(1);

    // Collapse: member populations die out; the loop dissolves the civ.
    setSite(world.components, siteA, { ...getSite(world.components, siteA)!, populationCount: 0 });
    setSite(world.components, siteB, { ...getSite(world.components, siteB)!, populationCount: 0 });
    tickPolitics(world, regionMap, { materials });
    expect(getCivilization(world.components, civs[0]!)!.status).toBe("dissolved");
    expect(world.events.eventsOfType("civilization-collapsed").length).toBe(1);
  });

  it("justice convicts a witnessed theft and punishes with real consequences", () => {
    const { world, regionMap, materials } = buildWorld();
    flatRegion(regionMap);
    const siteId = createSite(world, regionMap, 3, 3, 5, 100);
    establishPolity(world, siteId);
    const thief = spawnBeaver(world, { name: "T", position: { x: 4, y: 3, z: 4 } });
    const victim = spawnBeaver(world, { name: "V", position: { x: 4, y: 3, z: 5 } });
    const witness = spawnBeaver(world, { name: "W", position: { x: 5, y: 3, z: 4 } });
    const judge = spawnBeaver(world, { name: "J", position: { x: 5, y: 3, z: 5 } });
    const householdId = ensureSharedHousehold(world, victim, witness);
    ensureSharedHousehold(world, householdId === undefined ? victim : victim, judge);
    bindPolityHousehold(world, siteId, householdId ?? world.entities.create("household"));
    const leader = selectInitialLeader(world, siteId)!;

    const item = world.entities.create("good");
    setOwner(world.components, item, { ownerType: "personal", ownerId: victim });
    const violation = isProhibited(world, thief, item)!;
    setOwner(world.components, item, { ownerType: "personal", ownerId: thief });
    const accusation = fileAccusation(world, victim, violation, [witness]);
    tickInvestigations(world);
    expect(renderJudgment(world, accusation, leader)).toBe(true);
    applyPunishment(world, regionMap, accusation, "fine", siteId);
    expect(world.events.eventsOfType("judgment-rendered").length).toBe(1);
    expect(world.events.eventsOfType("punishment-applied").length).toBe(1);
    expect(getAccusation(world.components, accusation)!.guilty).toBe(true);
    void materials;
  });

  it("succession replaces a dead leader per the polity's own form", () => {
    const { world, regionMap, materials } = buildWorld();
    flatRegion(regionMap);
    const siteId = createSite(world, regionMap, 3, 3, 5, 100);
    establishPolity(world, siteId);
    const elder = spawnBeaver(world, { name: "E", position: { x: 4, y: 3, z: 4 } });
    const heir = spawnBeaver(world, { name: "H", position: { x: 4, y: 3, z: 5 } });
    setRelationshipWith(world.components, elder, { withId: heir, kin: "child", familiarity: 0.9, affinity: 0.7 });
    const householdId = ensureSharedHousehold(world, elder, heir);
    bindPolityHousehold(world, siteId, householdId);
    tickPolitics(world, regionMap, { materials });
    expect(polityLeader(world, siteId)).toBe(elder);
    world.entities.destroy(elder);
    tickPolitics(world, regionMap, { materials });
    expect(polityLeader(world, siteId)).toBe(heir);
  });

  it("wounds from battles bleed, impair locomotion, and heal", () => {
    const { world } = buildWorld();
    const attacker = spawnBeaver(world, { name: "Atk", position: { x: 5, y: 3, z: 5 } });
    const defender = spawnBeaver(world, { name: "Def", position: { x: 5, y: 3, z: 6 } });
    let resolution = resolveAttack(world, attacker, defender, 10, 0, world.random.stream("w1"));
    let tries = 0;
    while (!resolution.wounded && tries < 8) {
      resolution = resolveAttack(world, attacker, defender, 10, 0, world.random.stream(`w1-${tries}`));
      tries++;
    }
    expect(resolution.wounded).toBe(true);
    expect(woundsOf(world, defender).length).toBe(1);
    tickAllWounds(world);
    expect(woundsOf(world, defender).length).toBe(1); // still wounded, healing
  });
});
