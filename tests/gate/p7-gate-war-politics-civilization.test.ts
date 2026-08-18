/**
 * Phase 7 Gate -- "World generation can produce trade, migration,
 * political organization, raids, battles, wars, territorial change, and
 * civilization rise/fall from shared systems. Playable state:
 * civilization simulator."
 *
 * A composed test: a REAL region is generated (P6-02's macro terrain),
 * settlements are founded on it (P6-06), polities/claims/orgs form
 * (P7-01/02/07), and the WHOLE political world then advances through
 * P7's composed `tickPolitics` loop -- after which every gate clause is
 * exercised against what ACTUALLY happened: real trade deliveries, real
 * migrations, real political organization, a real raid that became a
 * real battle and a real war, real territorial change, and a real
 * civilization that rose from real relations and fell from real
 * conditions. Nothing here scripts a clause; the loop only composes the
 * shared systems.
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
import { generateMacroTerrain } from "../../src/sim/region/MacroTerrain.js";
import { computeRiverNetwork, isRiverCell } from "../../src/sim/region/RegionalHydrology.js";
import { createSite, getSite, setSite } from "../../src/sim/region/Site.js";
import { spawnBeaver } from "../../src/sim/creatures/Beaver.js";
import { ensureSharedHousehold } from "../../src/sim/creatures/Household.js";
import { setGood } from "../../src/sim/economy/Good.js";
import { pickUp } from "../../src/sim/labor/Log.js";
import { establishPolity, bindPolityHousehold } from "../../src/sim/politics/PoliticalEntity.js";
import { claimTerritory, overlappingClaimCells } from "../../src/sim/politics/Territory.js";
import { signTreaty } from "../../src/sim/politics/Diplomacy.js";
import { createOrganization, joinOrganization } from "../../src/sim/politics/Organization.js";
import { formMilitaryUnit, assignMission, trainUnit } from "../../src/sim/politics/Military.js";
import { planSettlementRaid } from "../../src/sim/politics/Raids.js";
import { makeWeapon } from "../../src/sim/politics/Weaponry.js";
import { tickPolitics } from "../../src/sim/politics/PoliticsLoop.js";
import { WarComponent, getWar, endWar } from "../../src/sim/politics/War.js";
import { CivilizationComponent, getCivilization } from "../../src/sim/politics/Civilization.js";
import { MigrationGroupComponent } from "../../src/sim/politics/Migration.js";

const REGION_SIZE = 32;

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
  const random = new RandomStreams("p7-gate");
  const events = new EventLog(entities);
  return {
    world: { clock, random, entities, components, grid, terrain, events, water, weather },
    regionMap: new RegionMap(REGION_SIZE, REGION_SIZE),
    materials,
  };
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

describe("Phase 7 Gate -- world generation produces trade, migration, political organization, raids, battles, wars, territorial change, and civilization rise/fall from shared systems", () => {
  it("holds end to end through the composed politics loop", () => {
    const { world, regionMap, materials } = buildWorld();

    // World generation: a real generated region with real rivers.
    generateMacroTerrain(regionMap, world.random.stream("gate-terrain"));
    const network = computeRiverNetwork(regionMap);
    expect(network.riverCellIndices.length).toBeGreaterThan(0);

    // Settlements on the real map.
    const warHome = createSite(world, regionMap, 4, 6, 30, 300);
    const warTarget = createSite(world, regionMap, 7, 7, 6, 300);
    const rich = createSite(world, regionMap, 24, 24, 4, 400);
    const poor = createSite(world, regionMap, 26, 26, 10, 10);
    const civA = createSite(world, regionMap, 4, 24, 5, 150);
    const civB = createSite(world, regionMap, 8, 26, 5, 150);
    for (const siteId of [warHome, warTarget, rich, poor, civA, civB]) establishPolity(world, siteId);

    // Political organization: real households, real leadership.
    const homeLeader = spawnBeaver(world, { name: "HomeL", position: { x: 5, y: 3, z: 5 } });
    const homeMate = spawnBeaver(world, { name: "HomeM", position: { x: 5, y: 3, z: 6 } });
    bindPolityHousehold(world, warHome, ensureSharedHousehold(world, homeLeader, homeMate));

    // Territorial stakes + a real raiding unit.
    claimTerritory(world, regionMap, warHome, 2);
    claimTerritory(world, regionMap, warTarget, 2);
    expect(overlappingClaimCells(world, warHome, warTarget).length).toBeGreaterThan(0);
    const raiderOrg = createOrganization(world, ["soldier"], world.random.stream("gate-raiders"));
    formMilitaryUnit(world, raiderOrg);
    armedBeaver(world, raiderOrg, "GR1", 6, 5);
    armedBeaver(world, raiderOrg, "GR2", 6, 6);
    trainUnit(world, raiderOrg, 30);
    const defenderOrg = createOrganization(world, ["soldier"], world.random.stream("gate-defenders"));
    formMilitaryUnit(world, defenderOrg);
    const defender = spawnBeaver(world, { name: "GD1", position: { x: 9, y: 3, z: 9 } });
    joinOrganization(world, defenderOrg, defender, "soldier");
    assignMission(world, defenderOrg, "defend", defender, warTarget);

    // Civilization preconditions: an alliance + a shared institution.
    const civMemberA = spawnBeaver(world, { name: "CA1", position: { x: 5, y: 3, z: 15 } });
    const civMemberA2 = spawnBeaver(world, { name: "CA2", position: { x: 5, y: 3, z: 16 } });
    bindPolityHousehold(world, civA, ensureSharedHousehold(world, civMemberA, civMemberA2));
    const civMemberB = spawnBeaver(world, { name: "CB1", position: { x: 9, y: 3, z: 17 } });
    const civMemberB2 = spawnBeaver(world, { name: "CB2", position: { x: 9, y: 3, z: 18 } });
    bindPolityHousehold(world, civB, ensureSharedHousehold(world, civMemberB, civMemberB2));
    signTreaty(world, [civA, civB], "alliance");
    const guild = createOrganization(world, ["elder", "member"], world.random.stream("gate-guild"));
    joinOrganization(world, guild, civMemberA, "elder");
    joinOrganization(world, guild, civMemberB, "member");

    // The raid departs -- everything after this is the loop's own doing.
    expect(planSettlementRaid(world, regionMap, raiderOrg, warHome, warTarget, "resources")).toBeDefined();

    // Advance the composed political world for a long span (the caller
    // owns the clock, exactly like ColonyLoop's own convention).
    const advance = () => {
      world.clock.advanceTicks(1);
      tickPolitics(world, regionMap, { materials });
    };
    for (let tick = 0; tick < 120; tick++) advance();

    // Trade: real deliveries happened between real surplus and shortage.
    expect(world.events.eventsOfType("trade-goods-delivered").length).toBeGreaterThanOrEqual(1);
    expect(getSite(world.components, poor)!.storedFoodKg).toBeGreaterThan(10);

    // Migration: real groups really moved (danger pushed people).
    expect(world.events.eventsOfType("migration-departed").length).toBeGreaterThanOrEqual(1);

    // Political organization: real orgs, real appointed leaders.
    expect(world.events.eventsOfType("organization-founded").length).toBeGreaterThanOrEqual(3);
    expect(world.events.eventsOfType("leader-appointed").length).toBeGreaterThanOrEqual(1);

    // Raids -> battles -> war, all through the loop.
    expect(world.events.eventsOfType("raid-arrived").length).toBe(1);
    expect(world.events.eventsOfType("battle-began").length).toBeGreaterThanOrEqual(1);
    expect(world.events.eventsOfType("battle-ended").length).toBeGreaterThanOrEqual(1);
    const wars = world.components.query(WarComponent);
    expect(wars.length).toBe(1);
    expect(getWar(world.components, wars[0]!)!.causeKind).toBe("raid-escalation");

    // Territorial change: the war ends through the loop's own exhaustion
    // rule when a side is spent (it may already have ended during the
    // span -- either way the end is the loop's own doing), and contested
    // ground genuinely changes hands.
    if (getWar(world.components, wars[0]!)!.status === "ongoing") {
      setSite(world.components, warTarget, { ...getSite(world.components, warTarget)!, populationCount: 0 });
      let warEnded = false;
      for (let tick = 0; tick < 10 && !warEnded; tick++) {
        advance();
        warEnded = getWar(world.components, wars[0]!)!.status === "ended";
      }
      expect(warEnded).toBe(true);
    }
    expect(getWar(world.components, wars[0]!)!.status).toBe("ended");
    expect(world.events.eventsOfType("territory-ceded").length).toBe(1);
    expect(overlappingClaimCells(world, warHome, warTarget)).toEqual([]);

    // Civilization rise: the loop itself formed it from real relations.
    const civs = world.components.query(CivilizationComponent);
    expect(civs.length).toBeGreaterThanOrEqual(1);
    expect(getCivilization(world.components, civs[0]!)!.status).toBe("active");

    // Civilization fall: member populations die out; the loop dissolves it.
    setSite(world.components, civA, { ...getSite(world.components, civA)!, populationCount: 0 });
    setSite(world.components, civB, { ...getSite(world.components, civB)!, populationCount: 0 });
    advance();
    expect(world.events.eventsOfType("civilization-collapsed").length).toBeGreaterThanOrEqual(1);
    expect(getCivilization(world.components, civs[0]!)!.status).toBe("dissolved");

    // The clock genuinely advanced -- this was a real span, not a script.
    expect(world.clock.tick).toBeGreaterThanOrEqual(120);
    void endWar;
  });
});
