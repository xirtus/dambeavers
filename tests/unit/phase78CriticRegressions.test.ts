/**
 * Regression tests for the seven defects the independent Phase 7+8
 * critic review found and fixed (2026-08-17). Each test fails on the
 * pre-fix code:
 *
 *  1. `War.endWar` crashed when a loser's claim was FULLY contested
 *     (the rewritten claim hit `assertValidTerritoryClaim`'s former
 *     non-empty rule) -- a crash reachable from the composed
 *     `tickPolitics` loop.
 *  2. Equipment issuance bypassed the real pickup machinery: `equipUnit`
 *     spliced org assets into inventories with no `Held`, so a later
 *     drop/death crashed ("not currently held"); `handleFighterDeath`
 *     stripped org items into a Held-by-dead limbo.
 *  3. `Provenance.recordItemMove` pickups never named their carrier in
 *     the event's participants (the dedupe compared the new carrier to
 *     ITSELF for cell-origin moves).
 *  4. `Collapse.collapseConditionsOf` searched for the precipitating
 *     death event in a place it could never appear (`objectIds` of
 *     death events), so collapse events always chained to the
 *     civilization's founding instead of the real recorded precipitant.
 *  5. Inheritance-form succession read the dead leader's OWN
 *     relationship edges (destroyed with them) -- kin could never
 *     inherit, silently falling back to highest-skill.
 *  6. `planMigrations` charged a war-cession to the WINNER (present in
 *     objectIds) as "displacement", contradicting its own push-score
 *     rule (subject-only).
 *  7. `FigurePages` cited an `identity` component that does not exist
 *     for unnamed beavers, and left the Reputation/Historical
 *     significance claims with EMPTY source lists for beavers with no
 *     recorded deeds -- every claim must carry resolving sources.
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
import { claimTerritory, overlappingClaimCells, getTerritoryClaim, claimsOfSite, claimedCellsOfSite } from "../../src/sim/politics/Territory.js";
import { declareWar, endWar, getWar } from "../../src/sim/politics/War.js";
import { spawnBeaver, getInventory, IdentityComponent } from "../../src/sim/creatures/Beaver.js";
import { createOrganization, joinOrganization } from "../../src/sim/politics/Organization.js";
import { formMilitaryUnit, equipUnit } from "../../src/sim/politics/Military.js";
import { setOwner } from "../../src/sim/creatures/Ownership.js";
import { setGood } from "../../src/sim/economy/Good.js";
import { makeWeapon, makeArmor } from "../../src/sim/politics/Weaponry.js";
import { getHeld, pickUp } from "../../src/sim/labor/Log.js";
import { die } from "../../src/sim/creatures/Mortality.js";
import { signTreaty } from "../../src/sim/politics/Diplomacy.js";
import { tickCivilizations } from "../../src/sim/politics/Collapse.js";
import { formCivilization, getCivilization } from "../../src/sim/politics/Civilization.js";
import { establishPolity, getPoliticalEntity, setPoliticalEntity } from "../../src/sim/politics/PoliticalEntity.js";
import { setLeadership } from "../../src/sim/creatures/Leadership.js";
import { setRelationshipWith, setHouseholdMembership } from "../../src/sim/creatures/Relationships.js";
import { practiceSkill } from "../../src/sim/creatures/SkillProgression.js";
import { tickSuccession } from "../../src/sim/politics/Government.js";
import { planMigrations } from "../../src/sim/politics/Migration.js";
import { getMigrationGroup } from "../../src/sim/politics/Migration.js";
import { ALL_COMPONENT_TYPES } from "../../src/sim/persistence/AllComponentTypes.js";
import { politicalMapAt, claimantsAt } from "../../src/sim/chronicle/MapsThroughTime.js";
import { entityTimeline } from "../../src/sim/chronicle/Timeline.js";
import { figurePage } from "../../src/sim/chronicle/FigurePages.js";

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
  const random = new RandomStreams(717);
  const events = new EventLog(entities);
  return {
    world: { clock, random, entities, components, grid, terrain, events, water, weather },
    regionMap: new RegionMap(16, 16),
    materials,
  };
}

describe("Phase 7+8 critic regressions (2026-08-17)", () => {
  it("1. endWar survives a fully-contested loser claim -- the claim persists empty, territory still changes hands, and maps through time still reconstruct", () => {
    const { world, regionMap } = buildWorld();
    const siteA = createSite(world, regionMap, 4, 4, 5, 100);
    const siteB = createSite(world, regionMap, 5, 4, 5, 100);
    const loserClaim = claimTerritory(world, regionMap, siteA, 0); // single cell
    claimTerritory(world, regionMap, siteB, 2); // covers it entirely
    expect(overlappingClaimCells(world, siteA, siteB).length).toBe(1);

    const warTick = world.clock.tick;
    world.events.record({ tick: warTick, eventType: "raid-looted", subjectIds: [siteA], objectIds: [siteB], location: { x: 0, y: 0, z: 0 } });
    const causeEvent = world.events.eventsOfType("raid-looted")[0]!.id;
    const warId = declareWar(world, siteA, siteB, "territory", causeEvent);
    world.clock.advanceTicks(1); // the war ends a tick AFTER the pre-war map snapshot

    expect(() => endWar(world, warId, siteB)).not.toThrow(); // pre-fix: RangeError "non-empty"

    // The loser's claim persists (history is never deleted) but claims nothing now.
    const claim = getTerritoryClaim(world.components, loserClaim)!;
    expect(claimsOfSite(world, siteA)).toContain(loserClaim);
    expect(claim.regionXs.length).toBe(0);
    expect(claimedCellsOfSite(world, siteA).length).toBe(0);
    expect(claimedCellsOfSite(world, siteB).length).toBeGreaterThan(0);
    expect(getWar(world.components, warId)!.status).toBe("ended");
    expect(getWar(world.components, warId)!.outcome!.cededCellCount).toBe(1);

    // Maps through time: the ceded cell was the loser's BEFORE the war
    // and the winner's after -- the empty current shape plus the
    // recorded cession reconstructs the past exactly.
    expect(claimantsAt(world, regionMap, 4, 4, warTick)).toEqual([siteA, siteB]);
    expect(claimantsAt(world, regionMap, 4, 4, world.clock.tick)).toEqual([siteB]);
    expect(politicalMapAt(world, regionMap, warTick).some((cell) => cell.regionX === 4 && cell.regionZ === 4)).toBe(true);
  });

  it("2. issued equipment is real Held state; a fighter's org gear drops at their death and is re-issuable without any crash", () => {
    const { world, regionMap } = buildWorld();
    createSite(world, regionMap, 4, 4, 5, 100);
    const org = createOrganization(world, ["soldier"], world.random.stream("org-equip"));
    formMilitaryUnit(world, org);

    const spear = world.entities.create("good");
    setGood(world.components, spear, { goodKind: "spear", materialId: "wood", massKg: 2, quality: 1 });
    makeWeapon(world.components, spear, "spear", 1.5, 0.4);
    const armor = world.entities.create("good");
    setGood(world.components, armor, { goodKind: "armor", materialId: "stone", massKg: 3, quality: 1 });
    makeArmor(world.components, armor, 1, 2);
    setOwner(world.components, spear, { ownerType: "institutional", ownerId: org });
    setOwner(world.components, armor, { ownerType: "institutional", ownerId: org });

    const fighterA = spawnBeaver(world, { name: "FA", position: { x: 4, y: 3, z: 4 } });
    const fighterB = spawnBeaver(world, { name: "FB", position: { x: 5, y: 3, z: 5 } });
    joinOrganization(world, org, fighterA, "soldier");
    joinOrganization(world, org, fighterB, "soldier");
    equipUnit(world, org);

    // Each asset is issued to exactly ONE member, through real Held state.
    const holders = [fighterA, fighterB].filter((id) => getInventory(world.components, id)!.itemIds.includes(spear) || getInventory(world.components, id)!.itemIds.includes(armor));
    expect(holders.length).toBe(2); // gear spreads, one item each
    const spearHolder = [fighterA, fighterB].find((id) => getInventory(world.components, id)!.itemIds.includes(spear))!;
    expect(getHeld(world.components, spear)).toEqual({ by: spearHolder }); // pre-fix: Held missing entirely

    // The carrier dies: the org gear physically drops with them (Held
    // cleared), stays org-owned, and is re-issuable.
    die(world, spearHolder, "trauma");
    expect(getHeld(world.components, spear)).toBeUndefined(); // pre-fix (battle path): Held by the dead holder
    expect(world.grid.positionOf(spear)).toBeDefined();

    // Re-issue and kill the new carrier: no crash anywhere in the drop path.
    const fighterC = spawnBeaver(world, { name: "FC", position: { x: 6, y: 3, z: 6 } });
    joinOrganization(world, org, fighterC, "soldier");
    equipUnit(world, org);
    const reissuedHolder = getHeld(world.components, spear)!.by;
    expect([fighterB, fighterC]).toContain(reissuedHolder);
    expect(getInventory(world.components, reissuedHolder)!.itemIds).toContain(spear);
    expect(() => die(world, reissuedHolder, "trauma")).not.toThrow(); // pre-fix: "not currently held" RangeError
  });

  it("3. a pickup's item-moved event names its carrier -- entity timelines and search see pickups", () => {
    const { world } = buildWorld();
    const beaver = spawnBeaver(world, { name: "PB", position: { x: 5, y: 3, z: 5 } });
    const item = world.entities.create("log");
    world.grid.setEntityPosition(item, 6, 3, 6);
    pickUp(world.components, world.grid, item, beaver, world);
    const move = world.events.eventsOfType("item-moved")[0]!;
    expect(move.objectIds).toContain(beaver); // pre-fix: []
    expect(entityTimeline(world, beaver)).toContain(move);
  });

  it("4. a civilization's collapse chains to the real recorded precipitant, not its own founding", () => {
    const { world, regionMap } = buildWorld();
    const siteA = createSite(world, regionMap, 4, 4, 5, 100);
    const siteB = createSite(world, regionMap, 7, 4, 5, 100);
    const org = createOrganization(world, ["founder"], world.random.stream("org-civ"));
    const beaverA = spawnBeaver(world, { name: "CA", position: { x: 4, y: 3, z: 4 } });
    const beaverB = spawnBeaver(world, { name: "CB", position: { x: 7, y: 3, z: 7 } });
    joinOrganization(world, org, beaverA, "founder");
    joinOrganization(world, org, beaverB, "founder");
    const hhA = world.entities.create("household");
    const hhB = world.entities.create("household");
    setHouseholdMembership(world.components, beaverA, { householdId: hhA });
    setHouseholdMembership(world.components, beaverB, { householdId: hhB });
    establishPolity(world, siteA);
    establishPolity(world, siteB);
    setPoliticalEntity(world.components, siteA, { ...getPoliticalEntity(world.components, siteA)!, householdId: hhA });
    setPoliticalEntity(world.components, siteB, { ...getPoliticalEntity(world.components, siteB)!, householdId: hhB });
    signTreaty(world, [siteA, siteB], "alliance");
    const civId = formCivilization(world, [siteA, siteB], [org], world.random.stream("civ"));

    // The real emptying: both sites lose their last inhabitants through
    // a recorded exodus (the population-loss record that NAMES the site).
    world.events.record({
      tick: world.clock.tick, eventType: "migration-departed", subjectIds: [beaverB],
      objectIds: [siteA, siteB], location: { x: 0, y: 0, z: 0 }, data: { populationCount: 1 },
    });
    world.events.record({
      tick: world.clock.tick, eventType: "migration-departed", subjectIds: [beaverA],
      objectIds: [siteB, siteA], location: { x: 0, y: 0, z: 0 }, data: { populationCount: 1 },
    });
    const sA = getSite(world.components, siteA)!;
    setSite(world.components, siteA, { ...sA, populationCount: 0 });
    const sB = getSite(world.components, siteB)!;
    setSite(world.components, siteB, { ...sB, populationCount: 0 });

    const collapsed = tickCivilizations(world);
    expect(collapsed).toContain(civId);
    expect(getCivilization(world.components, civId)!.status).toBe("dissolved");
    const collapseEvent = world.events.eventsOfType("civilization-collapsed")[0]!;
    const cause = world.events.get(collapseEvent.causeEventId!);
    expect(cause.eventType).toBe("migration-departed"); // pre-fix: "civilization-founded"
  });

  it("5. inheritance-form succession reads the dead leader's kin edges from the surviving side", () => {
    const { world, regionMap } = buildWorld();
    const site = createSite(world, regionMap, 4, 4, 5, 100);
    const parent = spawnBeaver(world, { name: "P", position: { x: 4, y: 3, z: 4 } });
    const child = spawnBeaver(world, { name: "C", position: { x: 5, y: 3, z: 5 } });
    const stranger = spawnBeaver(world, { name: "S", position: { x: 6, y: 3, z: 6 } });
    // Real kin edges on both sides (exactly as Reproduction records them).
    setRelationshipWith(world.components, parent, { withId: child, kin: "child", familiarity: 1, affinity: 0.6 });
    setRelationshipWith(world.components, child, { withId: parent, kin: "parent", familiarity: 1, affinity: 0.6 });
    // The stranger is strictly more skilled, so the skill fallback would pick them.
    practiceSkill(world.components, stranger, "woodcutting", 50);

    const householdId = world.entities.create("household");
    setHouseholdMembership(world.components, child, { householdId });
    setHouseholdMembership(world.components, stranger, { householdId });
    establishPolity(world, site);
    const entity = getPoliticalEntity(world.components, site)!;
    setPoliticalEntity(world.components, site, { ...entity, governmentFormId: "lineage", householdId });
    const s = getSite(world.components, site)!;
    setSite(world.components, site, { ...s, householdId });
    const appointmentEvent = world.events.record({ tick: world.clock.tick, eventType: "leader-appointed", subjectIds: [parent], objectIds: [householdId], location: { x: 4, y: 3, z: 4 } });
    setLeadership(world.components, householdId, { leaderId: parent, sinceTick: world.clock.tick, lastAppointmentEventId: appointmentEvent! });
    setPoliticalEntity(world.components, site, { ...getPoliticalEntity(world.components, site)!, leaderId: parent });

    // The parent leader dies; the lineage form must find their kin.
    die(world, parent, "trauma");
    const successor = tickSuccession(world, site);
    expect(successor).toBe(child); // pre-fix: stranger via the skill fallback
  });

  it("7. every figure-page claim carries sources that genuinely resolve -- even for unnamed, deedless beavers", () => {
    const { world, regionMap } = buildWorld();
    createSite(world, regionMap, 4, 4, 5, 100);
    // A beaver with no name and no recorded deeds: the page's Identity,
    // Reputation, and Historical-significance claims must still carry
    // RESOLVING sources (registry-backed), never a component that does
    // not exist and never an empty list.
    // spawnBeaver always attaches an Identity; strip it to make the
    // genuinely-unnamed case the FigurePages fix addressed (a known
    // beaver with NO identity component at all).
    const nobody = spawnBeaver(world, { name: "Nobody", position: { x: 4, y: 3, z: 4 } });
    world.components.remove(nobody, IdentityComponent);
    const page = figurePage(world, nobody);
    for (const claim of page.claims) {
      expect(claim.sources.length).toBeGreaterThan(0); // pre-fix: Reputation/significance/history claims could be []
      for (const source of claim.sources) {
        if (source.kind === "event") expect(world.events.has(source.eventId)).toBe(true);
        else if (source.kind === "component") {
          const type = ALL_COMPONENT_TYPES.get(source.componentType);
          expect(type).toBeDefined();
          expect(world.components.has(source.entityId, type!)).toBe(true); // pre-fix: identity cited for an unnamed beaver with no such component
        }
      }
    }
  });

  it("6. a war's WINNER is never branded 'displacement' by the cession they won", () => {
    const { world, regionMap } = buildWorld();
    const siteA = createSite(world, regionMap, 4, 4, 5, 100);
    const siteB = createSite(world, regionMap, 5, 4, 5, 100);
    claimTerritory(world, regionMap, siteA, 0);
    claimTerritory(world, regionMap, siteB, 2);
    world.events.record({ tick: world.clock.tick, eventType: "raid-looted", subjectIds: [siteA], objectIds: [siteB], location: { x: 0, y: 0, z: 0 } });
    const warId = declareWar(world, siteA, siteB, "territory", world.events.eventsOfType("raid-looted")[0]!.id);
    endWar(world, warId, siteB); // siteA loses; siteB wins

    // siteB now also has a hostile push event (raid-looted names it) so
    // a migration plans; its reason must be danger, NOT displacement
    // (the cession naming it as the winner is not its displacement).
    world.clock.advanceTicks(1);
    planMigrations(world, regionMap, [siteA, siteB]);
    for (const groupId of world.components.query(getMigrationGroupMarker())) {
      const group = getMigrationGroup(world.components, groupId);
      if (group?.originSiteId === siteB) {
        expect(group.reason).not.toBe("displacement"); // pre-fix: could be "displacement" from the cession they won
      }
    }
  });
});

import { MigrationGroupComponent } from "../../src/sim/politics/Migration.js";
function getMigrationGroupMarker() { return MigrationGroupComponent; }
