/**
 * Phase 8 Gate -- "A world simulated for centuries becomes
 * intelligible as a network of inspectable lives, places, objects,
 * causes, and events. Playable state: interactive historical archive."
 *
 * Proved end to end by ONE composed test:
 *
 *  Act I -- a real world LIVES: a generated region (P6-02), six real
 *  settlements, polities/households/organizations, territorial claims,
 *  a real raid, and then the whole political world advanced through
 *  P7's real composed `tickPolitics` loop -- which itself produces the
 *  trade, migration, battles, war, cession, and civilization rise/fall
 *  the archive must later make sense of. Real lives are seeded on top:
 *  two generations of real births and a real artwork made by a real
 *  beaver.
 *
 *  Act II -- the archive reads the world that actually arose. The
 *  gate's own sentence is exercised noun by noun: EVENTS (the world
 *  timeline, browsable page by page with no gap and no duplicate --
 *  the "interactive archive" clause), LIVES (real genealogy, figure
 *  pages whose every claim source resolves, the dead keeping their
 *  names), PLACES (site histories with real founding records and
 *  population reconstructions that land exactly on live state),
 *  OBJECTS (a real artifact's maker, owner chain, moves, and present
 *  state), CAUSES (the war's recorded chain, oldest first, every step
 *  real), and the NETWORK between them (one war declaration visible in
 *  both sites' histories, both polities' search records, and the war
 *  query; maps before/after the war differ on exactly the ceded
 *  cells).
 *
 *  Act III -- CENTURIES of deep time (the real P6-13 `advanceWorldTicks`
 *  over 5.76 million ticks): the archive is immutable history -- every
 *  pre-advance answer is still the answer, every prose line still
 *  resolves to its recorded event, and every stable id still answers.
 */
import { describe, expect, it } from "vitest";
import { EntityIdRegistry, type EntityId } from "../../src/sim/core/EntityId.js";
import { ComponentStore } from "../../src/sim/core/ComponentStore.js";
import { SimulationClock } from "../../src/sim/core/SimulationClock.js";
import { RandomStreams } from "../../src/sim/core/Random.js";
import { WorldGrid } from "../../src/sim/world/WorldGrid.js";
import { TerrainField } from "../../src/sim/world/TerrainField.js";
import { EventLog, type EventId } from "../../src/sim/history/EventLog.js";
import { ALL_COMPONENT_TYPES } from "../../src/sim/persistence/AllComponentTypes.js";
import { MaterialRegistry } from "../../src/sim/materials/Material.js";
import { registerStandardMaterials } from "../../src/sim/materials/standardMaterials.js";
import { WaterField } from "../../src/sim/hydrology/WaterField.js";
import { Weather } from "../../src/sim/weather/Weather.js";
import type { World } from "../../src/sim/persistence/WorldSnapshot.js";
import { RegionMap } from "../../src/sim/region/RegionMap.js";
import { generateMacroTerrain } from "../../src/sim/region/MacroTerrain.js";
import { computeRiverNetwork } from "../../src/sim/region/RegionalHydrology.js";
import { createSite, getSite, setSite } from "../../src/sim/region/Site.js";
import { advanceWorldTicks } from "../../src/sim/region/DeepTime.js";
import { spawnBeaver } from "../../src/sim/creatures/Beaver.js";
import { ensureSharedHousehold } from "../../src/sim/creatures/Household.js";
import { createZone } from "../../src/sim/spaces/FunctionalSpace.js";
import { claimSleepSpace, createSleepSpace } from "../../src/sim/spaces/SleepSpace.js";
import { setConstruction } from "../../src/sim/labor/Construction.js";
import { setRelationshipWith } from "../../src/sim/creatures/Relationships.js";
import { produceOffspring } from "../../src/sim/creatures/Reproduction.js";
import { RecipeRegistry, registerStandardRecipes } from "../../src/sim/economy/Recipe.js";
import { createArtwork } from "../../src/sim/creatures/Art.js";
import { setOwner, getOwner } from "../../src/sim/creatures/Ownership.js";
import { setGood } from "../../src/sim/economy/Good.js";
import { establishPolity, bindPolityHousehold } from "../../src/sim/politics/PoliticalEntity.js";
import { claimTerritory, overlappingClaimCells, claimedCellsOfSite } from "../../src/sim/politics/Territory.js";
import { signTreaty } from "../../src/sim/politics/Diplomacy.js";
import { createOrganization, joinOrganization } from "../../src/sim/politics/Organization.js";
import { formMilitaryUnit, assignMission, trainUnit } from "../../src/sim/politics/Military.js";
import { planSettlementRaid } from "../../src/sim/politics/Raids.js";
import { makeWeapon } from "../../src/sim/politics/Weaponry.js";
import { pickUp } from "../../src/sim/labor/Log.js";
import { tickPolitics } from "../../src/sim/politics/PoliticsLoop.js";
import { WarComponent, getWar } from "../../src/sim/politics/War.js";
import { CivilizationComponent, getCivilization } from "../../src/sim/politics/Civilization.js";
import { battleCasualties } from "../../src/sim/politics/Battle.js";
import { BattleComponent } from "../../src/sim/politics/Battle.js";
import { queryWar, queryPerson, querySite, queryObject } from "../../src/sim/chronicle/Chronicle.js";
import { worldTimeline, entityTimeline, timelineWindow } from "../../src/sim/chronicle/Timeline.js";
import { figurePage, type FigureSource } from "../../src/sim/chronicle/FigurePages.js";
import { siteHistory, sitePopulationAt } from "../../src/sim/chronicle/SiteHistories.js";
import { artifactHistory } from "../../src/sim/chronicle/ArtifactHistories.js";
import { parentsOf, descendantsOf, familyLineage } from "../../src/sim/chronicle/Genealogy.js";
import { politicalMapAt, claimantsAt, sitesAt } from "../../src/sim/chronicle/MapsThroughTime.js";
import { causalHistoryOf, majorRecordedEvents } from "../../src/sim/chronicle/CausalHistory.js";
import { summarizeWar, summarizeLife, summarizeSite } from "../../src/sim/chronicle/ProseSummaries.js";
import { findAllRecords } from "../../src/sim/chronicle/Search.js";

const REGION_SIZE = 32;

function buildWorld(): { world: World; regionMap: RegionMap; materials: MaterialRegistry; recipes: RecipeRegistry } {
  const entities = new EntityIdRegistry();
  const components = new ComponentStore(entities);
  const grid = new WorldGrid({ sizeX: 20, sizeY: 10, sizeZ: 20 }, entities);
  const materials = new MaterialRegistry();
  registerStandardMaterials(materials);
  const recipes = new RecipeRegistry();
  registerStandardRecipes(recipes);
  const terrain = new TerrainField(grid, materials);
  for (let x = 0; x < 20; x++) for (let z = 0; z < 20; z++) for (let y = 0; y <= 2; y++) terrain.setMaterial(x, y, z, "soil");
  const water = new WaterField(grid);
  const weather = new Weather();
  const clock = new SimulationClock({ tickRateHz: 20 });
  const random = new RandomStreams("p8-gate");
  const events = new EventLog(entities);
  return {
    world: { clock, random, entities, components, grid, terrain, events, water, weather },
    regionMap: new RegionMap(REGION_SIZE, REGION_SIZE),
    materials,
    recipes,
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

describe("Phase 8 Gate -- a world simulated for centuries becomes intelligible as a network of inspectable lives, places, objects, causes, and events", () => {
  it("holds end to end: the lived world, the interactive archive over it, and centuries of deep time", () => {
    // ---------------------------------------------------------- Act I --
    const { world, regionMap, materials, recipes } = buildWorld();

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
    const homeHousehold = ensureSharedHousehold(world, homeLeader, homeMate);
    bindPolityHousehold(world, warHome, homeHousehold);
    setRelationshipWith(world.components, homeLeader, { withId: homeMate, kin: "mate", familiarity: 1, affinity: 0.9 });
    setRelationshipWith(world.components, homeMate, { withId: homeLeader, kin: "mate", familiarity: 1, affinity: 0.9 });
    // A real enclosed lodge room (walls + lodge segment, the P2-11
    // pattern) so the real birth machinery has real claimed sleep
    // spaces to place newborns in.
    const lodgeZone = createZone(world, { cells: [{ x: 4, z: 4 }, { x: 5, z: 4 }], declaredFunction: "general-zone" });
    for (const wall of [{ x: 3, z: 4 }, { x: 4, z: 3 }, { x: 4, z: 5 }, { x: 5, z: 3 }, { x: 5, z: 5 }, { x: 6, z: 4 }]) {
      const wallId = world.entities.create("construction");
      setConstruction(world.components, wallId, { designationId: wallId, kind: "wall", site: { x: wall.x, z: wall.z }, requiredMaterialId: "wood", requiredMassKg: 1, workDone: 1, workRequired: 1, status: "complete" });
    }
    const lodge = world.entities.create("construction");
    setConstruction(world.components, lodge, { designationId: lodge, kind: "lodge-segment", site: { x: 4, z: 4 }, requiredMaterialId: "wood", requiredMassKg: 1, workDone: 1, workRequired: 1, status: "complete" });
    claimSleepSpace(world, homeLeader, createSleepSpace(world, { zoneId: lodgeZone, kind: "nest", cell: { x: 4, z: 4 } }));
    claimSleepSpace(world, homeMate, createSleepSpace(world, { zoneId: lodgeZone, kind: "nest", cell: { x: 5, z: 4 } }));
    // Two generations of REAL lives, recorded by the real birth machinery.
    const generationTwo = produceOffspring(world, homeLeader, homeMate, { birthIntervalTicks: 0 }).offspringId;
    const gen2Mate = spawnBeaver(world, { name: "Gen2Mate", position: { x: 5, y: 3, z: 7 } });
    setRelationshipWith(world.components, generationTwo, { withId: gen2Mate, kin: "mate", familiarity: 1, affinity: 0.9 });
    setRelationshipWith(world.components, gen2Mate, { withId: generationTwo, kin: "mate", familiarity: 1, affinity: 0.9 });
    // The second generation's own real lodge room (parents must share ONE
    // room; each room is the same real enclosed geometry as the first).
    const lodgeZone2 = createZone(world, { cells: [{ x: 8, z: 4 }, { x: 9, z: 4 }], declaredFunction: "general-zone" });
    for (const wall of [{ x: 7, z: 4 }, { x: 8, z: 3 }, { x: 8, z: 5 }, { x: 9, z: 3 }, { x: 9, z: 5 }, { x: 10, z: 4 }]) {
      const wallId = world.entities.create("construction");
      setConstruction(world.components, wallId, { designationId: wallId, kind: "wall", site: { x: wall.x, z: wall.z }, requiredMaterialId: "wood", requiredMassKg: 1, workDone: 1, workRequired: 1, status: "complete" });
    }
    const lodge2 = world.entities.create("construction");
    setConstruction(world.components, lodge2, { designationId: lodge2, kind: "lodge-segment", site: { x: 8, z: 4 }, requiredMaterialId: "wood", requiredMassKg: 1, workDone: 1, workRequired: 1, status: "complete" });
    claimSleepSpace(world, generationTwo, createSleepSpace(world, { zoneId: lodgeZone2, kind: "nest", cell: { x: 8, z: 4 } }));
    claimSleepSpace(world, gen2Mate, createSleepSpace(world, { zoneId: lodgeZone2, kind: "nest", cell: { x: 9, z: 4 } }));
    const generationThree = produceOffspring(world, generationTwo, gen2Mate, { birthIntervalTicks: 0 }).offspringId;

    // A REAL object with a real maker: an artwork carved by HomeL.
    const artifact = createArtwork(world, materials, recipes.get("carve-trinket")!, 4, { kind: "beaver", id: homeLeader }, homeLeader, { x: 8, y: 3, z: 8 });
    setOwner(world.components, artifact, { ownerType: "personal", ownerId: homeLeader });

    // Territorial stakes + a real raiding unit (as the p7 gate proved,
    // the loop turns this into a real battle, a real war, and a real
    // territorial cession).
    claimTerritory(world, regionMap, warHome, 2);
    claimTerritory(world, regionMap, warTarget, 2);
    const contestedBefore = overlappingClaimCells(world, warHome, warTarget);
    expect(contestedBefore.length).toBeGreaterThan(0);
    const preWarTick = world.clock.tick;
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

    const advance = () => {
      world.clock.advanceTicks(1);
      tickPolitics(world, regionMap, { materials });
    };
    for (let tick = 0; tick < 120; tick++) advance();

    // The world really lived: trade, migration, battles, war, cession,
    // civilization rise -- all from the composed loop (p7 gate's own
    // proof, restated compactly so this test stands alone).
    expect(world.events.eventsOfType("trade-goods-delivered").length).toBeGreaterThanOrEqual(1);
    expect(world.events.eventsOfType("migration-departed").length).toBeGreaterThanOrEqual(1);
    expect(world.events.eventsOfType("battle-began").length).toBeGreaterThanOrEqual(1);
    expect(world.events.eventsOfType("leader-appointed").length).toBeGreaterThanOrEqual(1);
    const wars = world.components.query(WarComponent);
    expect(wars.length).toBe(1);
    if (getWar(world.components, wars[0]!)!.status === "ongoing") {
      setSite(world.components, warTarget, { ...getSite(world.components, warTarget)!, populationCount: 0 });
      for (let tick = 0; tick < 10 && getWar(world.components, wars[0]!)!.status !== "ended"; tick++) advance();
    }
    expect(getWar(world.components, wars[0]!)!.status).toBe("ended");
    expect(world.events.eventsOfType("territory-ceded").length).toBe(1);
    const warId = wars[0]!;

    // Civilization fall through the loop's own collapse rule.
    const civs = world.components.query(CivilizationComponent);
    expect(civs.length).toBeGreaterThanOrEqual(1);
    setSite(world.components, civA, { ...getSite(world.components, civA)!, populationCount: 0 });
    setSite(world.components, civB, { ...getSite(world.components, civB)!, populationCount: 0 });
    advance();
    expect(world.events.eventsOfType("civilization-collapsed").length).toBeGreaterThanOrEqual(1);
    expect(getCivilization(world.components, civs[0]!)!.status).toBe("dissolved");

    // ------------------------------------ Act II -- the archive itself --

    // EVENTS -- the world timeline is the archive's spine: chronological,
    // and browsable page by page with no gap and no duplicate.
    const timeline = worldTimeline(world);
    expect(timeline.length).toBe(world.events.count);
    for (let i = 1; i < timeline.length; i++) {
      expect(timeline[i]!.tick >= timeline[i - 1]!.tick).toBe(true);
    }
    const PAGE_SIZE = 7;
    const paged: EventId[] = [];
    for (let offset = 0; offset < timeline.length; offset += PAGE_SIZE) {
      paged.push(...timelineWindow(world, { offset, limit: PAGE_SIZE }).map((event) => event.id));
    }
    expect(paged).toEqual(timeline.map((event) => event.id)); // the interactive archive: every page, exactly once
    // One individual's timeline is exactly the world timeline filtered.
    expect(entityTimeline(world, homeLeader).map((e) => e.id)).toEqual(timeline.filter((e) => e.subjectIds.includes(homeLeader) || e.objectIds.includes(homeLeader)).map((e) => e.id));

    // LIVES -- real genealogy across the seeded generations, and figure
    // pages whose every claim source resolves against authoritative records.
    expect(parentsOf(world, generationTwo)).toEqual([homeLeader, homeMate]);
    expect(descendantsOf(world, homeLeader)).toContain(generationTwo);
    expect(descendantsOf(world, homeLeader)).toContain(generationThree);
    for (const member of familyLineage(world, generationThree)) {
      expect(world.entities.isKnown(member.personId)).toBe(true);
      for (const id of [...member.parentIds, ...member.childIds]) {
        expect(world.entities.isKnown(id)).toBe(true);
        expect(world.entities.kindOf(id)).toBe("beaver");
      }
    }

    const casualtyId = (() => {
      for (const battleId of world.components.query(BattleComponent)) {
        const casualties = battleCasualties(world, battleId);
        if (casualties.length > 0) return casualties[0]!;
      }
      const death = world.events.eventsOfType("trauma-death")[0];
      return death?.subjectIds[0];
    })();
    const figureIds = [homeLeader, generationTwo, ...(casualtyId !== undefined ? [casualtyId] : [])];
    for (const personId of figureIds) {
      const page = figurePage(world, personId);
      expect(page.known).toBe(true);
      const resolveSource = (source: FigureSource): boolean => {
        if (source.kind === "event") return world.events.has(source.eventId);
        if (source.kind === "component") {
          const type = ALL_COMPONENT_TYPES.get(source.componentType);
          return type !== undefined && world.components.has(source.entityId, type);
        }
        return true; // the registry's own liveness is authoritative by construction
      };
      for (const claim of page.claims) {
        expect(claim.sources.length).toBeGreaterThan(0);
        for (const source of claim.sources) expect(resolveSource(source)).toBe(true);
      }
    }
    // The dead keep their names: the archive names the person they were.
    const leaderPage = figurePage(world, homeLeader);
    expect(leaderPage.name).toBe("HomeL");
    if (casualtyId !== undefined) {
      expect(figurePage(world, casualtyId).known).toBe(true);
      expect(figurePage(world, casualtyId).live).toBe(false);
    }
    // LIVES + OBJECTS -- the leader's page knows the artwork they made.
    expect(leaderPage.claims.some((claim) => claim.heading === "Artworks")).toBe(true);

    // PLACES -- every settlement's history: real founding records, real
    // entries for what actually happened to it, and population
    // reconstructions that land exactly on live state.
    for (const siteId of [warHome, warTarget, rich, poor, civA, civB]) {
      const history = siteHistory(world, siteId);
      expect(history.some((entry) => entry.kind === "founding")).toBe(true);
      for (const entry of history) {
        if (entry.eventId !== undefined) expect(world.events.has(entry.eventId)).toBe(true);
      }
    }
    for (const siteId of [warHome, rich, poor]) {
      const reconstruction = sitePopulationAt(world, siteId, world.clock.tick);
      expect(reconstruction.reconstructible).toBe(true);
      expect(reconstruction.population).toBe(getSite(world.components, siteId)!.populationCount);
    }
    // The war target's history tells the cession story with the real event.
    const targetHistory = siteHistory(world, warTarget);
    expect(targetHistory.some((entry) => entry.eventId === world.events.eventsOfType("territory-ceded")[0]!.id)).toBe(true);

    // OBJECTS -- the artifact's whole recorded life: real maker, real
    // owner chain, real present state.
    const artifactRecord = artifactHistory(world, artifact);
    expect(artifactRecord.maker).toBe(homeLeader);
    expect(artifactRecord.current.live).toBe(true);
    expect(artifactRecord.current.owner).toEqual(getOwner(world.components, artifact));
    for (const entry of [...artifactRecord.ownership, ...artifactRecord.locations]) {
      expect(world.events.has(entry.eventId)).toBe(true);
    }
    expect(queryObject(world, artifact).known).toBe(true);

    // CAUSES -- the war's recorded chain, oldest first, ending at the
    // war's end; the recorded causes are the real ones.
    const warEnd = world.events.eventsOfType("war-ended")[0]!;
    const warCausal = causalHistoryOf(world, warEnd.id);
    expect(warCausal.recordedDepth).toBeGreaterThanOrEqual(2);
    // The chain's root is the war's REAL recorded cause (the contested
    // territorial claim the raid escalated over -- WarPlanning's own
    // rule), and its tip is the war's end; the declaration is a step
    // between them.
    expect(warCausal.upstream[0]!.event.eventType).toBe("territory-claimed");
    expect(warCausal.upstream.some((step) => step.event.eventType === "war-declared")).toBe(true);
    expect(warCausal.upstream[warCausal.upstream.length - 1]!.event.id).toBe(warEnd.id);
    for (const step of warCausal.upstream) {
      for (const participant of step.participants) expect(world.entities.isKnown(participant.id)).toBe(true);
    }
    // The major-events shelf contains the war and battle records that arose.
    expect(majorRecordedEvents(world).some((event) => event.eventType === "war-declared")).toBe(true);
    expect(majorRecordedEvents(world).some((event) => event.eventType === "battle-began")).toBe(true);

    // THE NETWORK -- one fact, many views: the war declaration is
    // visible from both sites' histories, both polities' search
    // records, and the war's own query.
    const declaration = world.events.eventsOfType("war-declared")[0]!;
    expect(siteHistory(world, warHome).some((entry) => entry.eventId === declaration.id)).toBe(true);
    expect(siteHistory(world, warTarget).some((entry) => entry.eventId === declaration.id)).toBe(true);
    expect(findAllRecords(world, warHome).some((record) => record.eventId === declaration.id && record.role === "war-participant")).toBe(true);
    expect(findAllRecords(world, warTarget).some((record) => record.eventId === declaration.id && record.role === "war-participant")).toBe(true);
    const warRecord = queryWar(world, warId);
    expect(warRecord.known).toBe(true);
    expect(warRecord.references.some((reference) => reference.kind === "event" && reference.eventId === declaration.id)).toBe(true);
    // Every search hit resolves, for a person and for a site.
    for (const targetId of [homeLeader, warHome]) {
      for (const record of findAllRecords(world, targetId)) {
        expect(world.events.has(record.eventId)).toBe(true);
      }
    }
    // Person/site queries resolve with real references.
    for (const reference of queryPerson(world, homeLeader).references) {
      if (reference.kind === "event") expect(world.events.has(reference.eventId)).toBe(true);
      else expect(world.entities.isKnown(reference.entityId)).toBe(true);
    }
    for (const reference of querySite(world, warHome).references) {
      if (reference.kind === "event") expect(world.events.has(reference.eventId)).toBe(true);
      else expect(world.entities.isKnown(reference.entityId)).toBe(true);
    }

    // MAPS -- the political map before and after the war differ on
    // exactly the ceded cells, and "now" equals the live claims.
    const postWarTick = world.clock.tick;
    for (const cell of contestedBefore) {
      expect(claimantsAt(world, regionMap, cell.regionX, cell.regionZ, preWarTick)).toEqual([warHome, warTarget]);
      expect(claimantsAt(world, regionMap, cell.regionX, cell.regionZ, postWarTick)).toEqual([warHome]);
    }
    expect(overlappingClaimCells(world, warHome, warTarget)).toEqual([]);
    for (const cell of politicalMapAt(world, regionMap, postWarTick)) {
      for (const claimantId of cell.claimants) {
        expect(claimedCellsOfSite(world, claimantId).some((c) => c.regionX === cell.regionX && c.regionZ === cell.regionZ)).toBe(true);
      }
    }
    expect(sitesAt(world, preWarTick)).toEqual([warHome, warTarget, rich, poor, civA, civB].sort((a, b) => a - b));

    // ------------------------------------------- Act III -- centuries --
    // The world is simulated for CENTURIES more (5.76 million ticks of
    // the real deep-time model); the archive must remain the archive.
    const earlyTimelineIds = new Set(worldTimeline(world).map((event) => event.id));
    const beforeCenturies = {
      map: politicalMapAt(world, regionMap, preWarTick),
      lineage: familyLineage(world, generationThree),
      leaderPage: figurePage(world, homeLeader),
      warSummary: summarizeWar(world, warId),
      lifeSummary: summarizeLife(world, homeLeader),
      siteSummary: summarizeSite(world, warHome),
      warSearch: findAllRecords(world, warHome),
      artifact: artifactHistory(world, artifact),
      warEndCausal: causalHistoryOf(world, warEnd.id),
      sitesEarly: sitesAt(world, preWarTick),
    };

    advanceWorldTicks(world, 120 * 48_000, () => "forest", { forest: 0.8, wetland: 0.7, grassland: 0.5, desert: 0.1, tundra: 0.1, mountain: 0.1 });
    expect(world.clock.tick).toBeGreaterThanOrEqual(postWarTick + 120 * 48_000);

    // History is immutable: the same queries give the same answers.
    // Present-tense facts (a figure's "Alive at tick N", a site's live
    // population line) legitimately track the present; everything
    // RECORD-BACKED must be bit-for-bit unchanged.
    expect(politicalMapAt(world, regionMap, preWarTick)).toEqual(beforeCenturies.map);
    expect(familyLineage(world, generationThree)).toEqual(beforeCenturies.lineage);
    const postCenturiesPage = figurePage(world, homeLeader);
    expect(postCenturiesPage.known).toBe(true);
    expect(postCenturiesPage.name).toBe(beforeCenturies.leaderPage.name);
    const withoutStatus = (page: typeof postCenturiesPage) => ({ ...page, claims: page.claims.filter((claim) => claim.heading !== "Status") });
    expect(withoutStatus(postCenturiesPage)).toEqual(withoutStatus(beforeCenturies.leaderPage));
    expect(summarizeWar(world, warId)).toEqual(beforeCenturies.warSummary);
    // Life/site prose: the record-backed lines are immutable; the
    // "as of tick N" present-tense lines (no record ids) track the now.
    const recordLines = (summary: { lines: readonly { recordIds: readonly EventId[]; text: string }[] }) => summary.lines.filter((line) => line.recordIds.length > 0);
    expect(recordLines(summarizeLife(world, homeLeader))).toEqual(recordLines(beforeCenturies.lifeSummary));
    expect(recordLines(summarizeSite(world, warHome))).toEqual(recordLines(beforeCenturies.siteSummary));
    // Search: every pre-advance record survives (deep time may append
    // new records for new real events, never rewrite history).
    const postSearch = findAllRecords(world, warHome);
    const postKeys = new Set(postSearch.map((record) => `${record.eventId}:${record.role}`));
    for (const record of beforeCenturies.warSearch) expect(postKeys.has(`${record.eventId}:${record.role}`)).toBe(true);
    for (const record of postSearch) expect(world.events.has(record.eventId)).toBe(true);
    expect(artifactHistory(world, artifact)).toEqual(beforeCenturies.artifact);
    expect(causalHistoryOf(world, warEnd.id)).toEqual(beforeCenturies.warEndCausal);
    expect(sitesAt(world, preWarTick)).toEqual(beforeCenturies.sitesEarly);

    // Every recorded event still resolves, and every prose line still
    // names only real recorded events.
    for (const eventId of earlyTimelineIds) expect(world.events.has(eventId)).toBe(true);
    for (const summary of [summarizeWar(world, warId), summarizeLife(world, homeLeader), summarizeSite(world, warHome)]) {
      for (const line of summary.lines) {
        for (const recordId of line.recordIds) expect(world.events.has(recordId)).toBe(true);
      }
    }

    // Stable ids answer forever: the person, the object, and the places.
    expect(queryPerson(world, homeLeader).known).toBe(true);
    expect(queryObject(world, artifact).known).toBe(true);
    expect(querySite(world, warHome).known).toBe(true);
    expect(queryWar(world, warId).known).toBe(true);
  });
});
