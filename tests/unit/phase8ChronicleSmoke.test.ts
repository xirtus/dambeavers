/**
 * Phase 8 consolidated smoke test -- Chronicle end-to-end.
 *
 * One world is made to actually LIVE (real sites, polities, claims, a
 * real war with a real cession, a real migration, a real birth, a real
 * death, a real artifact with a real theft case), and every Chronicle
 * query then runs against it -- with cross-consistency checks between
 * the views (a war's events appear in the war query, both sites'
 * histories, the causal view, and every participant's cross-references).
 */
import { describe, expect, it } from "vitest";
import { EntityIdRegistry, type EntityId } from "../../src/sim/core/EntityId.js";
import { ComponentStore } from "../../src/sim/core/ComponentStore.js";
import { SimulationClock } from "../../src/sim/core/SimulationClock.js";
import { RandomStreams } from "../../src/sim/core/Random.js";
import { WorldGrid } from "../../src/sim/world/WorldGrid.js";
import { TerrainField } from "../../src/sim/world/TerrainField.js";
import { EventLog, type EventId } from "../../src/sim/history/EventLog.js";
import { MaterialRegistry } from "../../src/sim/materials/Material.js";
import { registerStandardMaterials } from "../../src/sim/materials/standardMaterials.js";
import { WaterField } from "../../src/sim/hydrology/WaterField.js";
import { Weather } from "../../src/sim/weather/Weather.js";
import type { World } from "../../src/sim/persistence/WorldSnapshot.js";
import { snapshotWorld, restoreWorld } from "../../src/sim/persistence/WorldSnapshot.js";
import { ALL_COMPONENT_TYPES } from "../../src/sim/persistence/AllComponentTypes.js";
import { RegionMap } from "../../src/sim/region/RegionMap.js";
import { createSite, getSite } from "../../src/sim/region/Site.js";
import { applyDisasterToSite } from "../../src/sim/region/WorldDisasters.js";
import { advanceWorldTicks } from "../../src/sim/region/DeepTime.js";
import { establishPolity, bindPolityHousehold } from "../../src/sim/politics/PoliticalEntity.js";
import { claimTerritory } from "../../src/sim/politics/Territory.js";
import { declareWar, endWar } from "../../src/sim/politics/War.js";
import { planMigrations, tickMigrationGroups } from "../../src/sim/politics/Migration.js";
import { spawnBeaver } from "../../src/sim/creatures/Beaver.js";
import { ensureSharedHousehold } from "../../src/sim/creatures/Household.js";
import { setRelationshipWith } from "../../src/sim/creatures/Relationships.js";
import { produceOffspring } from "../../src/sim/creatures/Reproduction.js";
import { createZone } from "../../src/sim/spaces/FunctionalSpace.js";
import { claimSleepSpace, createSleepSpace } from "../../src/sim/spaces/SleepSpace.js";
import { setConstruction } from "../../src/sim/labor/Construction.js";
import { die } from "../../src/sim/creatures/Mortality.js";
import { bequeathEstate, setOwner } from "../../src/sim/creatures/Ownership.js";
import { setGood } from "../../src/sim/economy/Good.js";
import { createArtwork } from "../../src/sim/creatures/Art.js";
import { RecipeRegistry, registerStandardRecipes } from "../../src/sim/economy/Recipe.js";
import { barterExchange } from "../../src/sim/politics/Market.js";
import { fileAccusation, renderJudgment, applyPunishment } from "../../src/sim/politics/Justice.js";
import { isProhibited } from "../../src/sim/creatures/Law.js";
import { nameEntity } from "../../src/sim/creatures/Naming.js";
import { queryPerson, querySite, queryWar, queryCausalLinks, queryObject } from "../../src/sim/chronicle/Chronicle.js";
import { worldTimeline, entityTimeline, timelineWindow } from "../../src/sim/chronicle/Timeline.js";
import { figurePage } from "../../src/sim/chronicle/FigurePages.js";
import { siteHistory, sitePopulationAt } from "../../src/sim/chronicle/SiteHistories.js";
import { artifactHistory } from "../../src/sim/chronicle/ArtifactHistories.js";
import { parentsOf, familyLineage } from "../../src/sim/chronicle/Genealogy.js";
import { politicalMapAt, claimantsAt, sitesAt } from "../../src/sim/chronicle/MapsThroughTime.js";
import { causalHistoryOf } from "../../src/sim/chronicle/CausalHistory.js";
import { summarizeWar, summarizeLife, summarizeSite } from "../../src/sim/chronicle/ProseSummaries.js";
import { findAllRecords } from "../../src/sim/chronicle/Search.js";

interface Fixture {
  world: World;
  regionMap: RegionMap;
  materials: MaterialRegistry;
  recipes: RecipeRegistry;
  siteA: EntityId;
  siteB: EntityId;
  warId: EntityId;
  alder: EntityId;
  birch: EntityId;
  child: EntityId;
  artifact: EntityId;
}

function buildFixture(): Fixture {
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
  const random = new RandomStreams(8901);
  const events = new EventLog(entities);
  const world: World = { clock, random, entities, components, grid, terrain, events, water, weather };
  const regionMap = new RegionMap(16, 16);
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) regionMap.setElevation(x, z, 0);

  // Two real settlements, one short on food.
  const siteA = createSite(world, regionMap, 2, 2, 12, 40);
  const siteB = createSite(world, regionMap, 3, 2, 8, 200);
  establishPolity(world, siteA);
  establishPolity(world, siteB);
  nameEntity(world, siteA, "site", world.random.stream("smoke-a"));
  nameEntity(world, siteB, "site", world.random.stream("smoke-b"));

  // Real inhabitants and a real birth.
  const alder = spawnBeaver(world, { name: "Alder", position: { x: 4, y: 3, z: 4 } });
  const birch = spawnBeaver(world, { name: "Birch", position: { x: 4, y: 3, z: 5 } });
  const household = ensureSharedHousehold(world, alder, birch);
  bindPolityHousehold(world, siteA, household);
  setRelationshipWith(world.components, alder, { withId: birch, kin: "mate", familiarity: 1, affinity: 0.9 });
  setRelationshipWith(world.components, birch, { withId: alder, kin: "mate", familiarity: 1, affinity: 0.9 });
  // A real enclosed lodge room (walls + lodge-segment), the P2-11 pattern.
  const zoneId = createZone(world, { cells: [{ x: 4, z: 4 }, { x: 5, z: 4 }], declaredFunction: "general-zone" });
  for (const wall of [{ x: 3, z: 4 }, { x: 4, z: 3 }, { x: 4, z: 5 }, { x: 5, z: 3 }, { x: 5, z: 5 }, { x: 6, z: 4 }]) {
    const wallId = world.entities.create("construction");
    setConstruction(world.components, wallId, { designationId: wallId, kind: "wall", site: { x: wall.x, z: wall.z }, requiredMaterialId: "wood", requiredMassKg: 1, workDone: 1, workRequired: 1, status: "complete" });
  }
  const lodge = world.entities.create("construction");
  setConstruction(world.components, lodge, { designationId: lodge, kind: "lodge-segment", site: { x: 4, z: 4 }, requiredMaterialId: "wood", requiredMassKg: 1, workDone: 1, workRequired: 1, status: "complete" });
  const spaceA = createSleepSpace(world, { zoneId, kind: "nest", cell: { x: 4, z: 4 } });
  const spaceB = createSleepSpace(world, { zoneId, kind: "nest", cell: { x: 5, z: 4 } });
  claimSleepSpace(world, alder, spaceA);
  claimSleepSpace(world, birch, spaceB);
  const child = produceOffspring(world, alder, birch, { birthIntervalTicks: 0 }).offspringId;

  // Real territorial conflict: overlapping claims, a real war, a real cession.
  claimTerritory(world, regionMap, siteA, 1);
  claimTerritory(world, regionMap, siteB, 1);
  const claimEvent = world.events.eventsOfType("territory-claimed").find((e) => e.subjectIds.includes(siteA))!.id;
  world.clock.advanceTicks(10);
  const warId = declareWar(world, siteA, siteB, "territory", claimEvent);
  world.clock.advanceTicks(10);
  endWar(world, warId, siteA);

  // A real danger-driven migration out of the pressured site.
  world.clock.advanceTicks(10);
  world.events.record({
    tick: world.clock.tick,
    eventType: "raid-arrived",
    subjectIds: [world.entities.create("raid")],
    objectIds: [siteA],
    location: { x: 0, y: 0, z: 0 },
  });
  planMigrations(world, regionMap, [siteA, siteB]);
  for (let i = 0; i < 20; i++) {
    world.clock.advanceTicks(1);
    tickMigrationGroups(world, regionMap);
  }

  // A real disaster.
  world.clock.advanceTicks(10);
  applyDisasterToSite(world, siteB, { kind: "drought", regionX: 3, regionZ: 2, severity: 0.6 });

  // A real artifact: made, bartered, owned, lost, stolen, recovered by law.
  const artifact = createArtwork(world, materials, recipes.get("carve-trinket")!, 4, { kind: "beaver", id: alder }, alder, { x: 6, y: 3, z: 6 });
  const plank = world.entities.create("good");
  world.grid.setEntityPosition(plank, 12, 3, 12);
  setGood(world.components, plank, { goodKind: "plank", materialId: "wood", massKg: 5 });
  setOwner(world.components, plank, { ownerType: "institutional", ownerId: siteB });
  world.clock.advanceTicks(10);
  setOwner(world.components, artifact, { ownerType: "institutional", ownerId: siteA });
  barterExchange(world, artifact, plank, siteA, siteB, 6, 6);
  setOwner(world.components, artifact, { ownerType: "personal", ownerId: alder });
  world.clock.advanceTicks(10);
  die(world, alder, "starvation");
  bequeathEstate(world, alder);
  setOwner(world.components, artifact, { ownerType: "personal", ownerId: birch });
  const violation = isProhibited(world, birch, artifact) ?? { action: "theft" as const, actorId: birch, itemId: artifact };
  world.clock.advanceTicks(10);
  const accusationId = fileAccusation(world, child, violation, [], artifact);
  renderJudgment(world, accusationId, child);
  applyPunishment(world, regionMap, accusationId, "fine", siteB);

  return { world, regionMap, materials, recipes, siteA, siteB, warId, alder, birch, child, artifact };
}

describe("Phase 8 smoke -- Chronicle end-to-end", () => {
  it("every query runs over a world that actually lived, and the views agree with each other", () => {
    const fx = buildFixture();
    const { world, regionMap, siteA, siteB, warId, alder, birch, child, artifact } = fx;

    // Timeline: world scale down to one individual, always chronological.
    const timeline = worldTimeline(world);
    expect(timeline.length).toBe(world.events.count);
    expect(entityTimeline(world, alder).length).toBeGreaterThan(0);
    for (const event of timeline) {
      expect(entityTimeline(world, event.subjectIds[0] ?? event.objectIds[0]!).some((e) => e.id === event.id)).toBe(true);
    }

    // The war shows up consistently in EVERY view.
    const warRecord = queryWar(world, warId);
    expect(warRecord.known).toBe(true);
    const declarationEvent = world.events.eventsOfType("war-declared")[0]!;
    expect(warRecord.references.some((r) => r.kind === "event" && r.eventId === declarationEvent.id)).toBe(true);
    expect(siteHistory(world, siteA).some((e) => e.eventId === declarationEvent.id)).toBe(true);
    expect(siteHistory(world, siteB).some((e) => e.eventId === declarationEvent.id)).toBe(true);
    expect(findAllRecords(world, siteA).some((r) => r.eventId === declarationEvent.id && r.role === "war-participant")).toBe(true);
    expect(findAllRecords(world, siteB).some((r) => r.eventId === declarationEvent.id && r.role === "war-participant")).toBe(true);

    // The causal view chains the war end to its recorded causes.
    const warEnd = world.events.eventsOfType("war-ended")[0]!;
    const causal = causalHistoryOf(world, warEnd.id);
    expect(causal.recordedDepth).toBeGreaterThanOrEqual(2);
    expect(causal.upstream[0]!.event.eventType).toBe("territory-claimed");
    expect(causal.upstream[causal.upstream.length - 1]!.event.id).toBe(warEnd.id);
    const links = queryCausalLinks(world, warEnd.id);
    expect(links.references.length).toBeGreaterThanOrEqual(3);

    // Maps: the cession is visible across time, and "now" equals live claims.
    expect(claimantsAt(world, regionMap, 2, 2, 5)).toEqual([siteA, siteB]);
    expect(claimantsAt(world, regionMap, 2, 2, world.clock.tick)).toEqual([siteA]);
    // At "now" the map agrees with the live claim entities themselves.
    const liveCellsA = new Set(world.components.query(ALL_COMPONENT_TYPES.get("territory-claim")!)
      .flatMap((claimId) => {
        const claim = world.components.get(claimId, ALL_COMPONENT_TYPES.get("territory-claim")!) as { ownerSiteId?: EntityId; regionXs?: number[]; regionZs?: number[] } | undefined;
        if (claim === undefined || claim.ownerSiteId !== siteA) return [];
        return (claim.regionXs ?? []).map((x, i) => `${x},${claim.regionZs![i]}`);
      }));
    for (const cell of politicalMapAt(world, regionMap, world.clock.tick)) {
      if (cell.claimants.includes(siteA)) expect(liveCellsA.has(`${cell.regionX},${cell.regionZ}`)).toBe(true);
    }

    // Sites listed at historical dates.
    expect(sitesAt(world, 0)).toEqual([siteA, siteB]);

    // Genealogy of the real birth.
    expect(parentsOf(world, child)).toEqual([alder, birch]);
    const lineage = familyLineage(world, child);
    for (const member of lineage) {
      for (const id of [member.personId, ...member.parentIds, ...member.childIds]) {
        expect(world.entities.isKnown(id)).toBe(true);
        expect(world.entities.kindOf(id)).toBe("beaver");
      }
    }

    // The dead founder keeps their name and a full figure page.
    const alderPage = figurePage(world, alder);
    expect(alderPage.known).toBe(true);
    expect(alderPage.name).toBe("Alder");
    expect(alderPage.live).toBe(false);
    expect(alderPage.claims.some((c) => c.heading === "Death")).toBe(true);

    // The artifact's full life is visible.
    const artifactRecord = artifactHistory(world, artifact);
    expect(artifactRecord.maker).toBe(alder);
    expect(artifactRecord.ownership.length).toBeGreaterThanOrEqual(3);
    expect(artifactRecord.thefts.length).toBe(1);
    expect(artifactRecord.losses.length).toBeGreaterThanOrEqual(1);
    expect(queryObject(world, artifact).known).toBe(true);

    // Population reconstruction: recorded deltas only -- equals live now.
    const reconstruction = sitePopulationAt(world, siteA, world.clock.tick);
    expect(reconstruction.reconstructible).toBe(true);
    expect(reconstruction.population).toBe(getSite(world.components, siteA)!.populationCount);

    // Prose: traceable and honest.
    const warProse = summarizeWar(world, warId);
    for (const line of warProse.lines) for (const id of line.recordIds) expect(world.events.has(id)).toBe(true);
    const lifeProse = summarizeLife(world, alder);
    expect(lifeProse.lines.map((l) => l.text).join(" ")).toContain("Alder");
    const siteProse = summarizeSite(world, siteA);
    expect(siteProse.lines.some((l) => l.text.includes("war"))).toBe(true);

    // Person/site queries resolve with real references.
    expect(queryPerson(world, alder).known).toBe(true);
    expect(querySite(world, siteA).known).toBe(true);
    expect(querySite(world, siteB).summary).toContain("population");
  });

  it("determinism: two identical lived worlds produce identical chronicle output", () => {
    const a = buildFixture();
    const b = buildFixture();
    expect(worldTimeline(a.world)).toEqual(worldTimeline(b.world));
    expect(siteHistory(a.world, a.siteA)).toEqual(siteHistory(b.world, b.siteA));
    expect(artifactHistory(a.world, a.artifact)).toEqual(artifactHistory(b.world, b.artifact));
    expect(summarizeWar(a.world, a.warId)).toEqual(summarizeWar(b.world, b.warId));
    expect(summarizeLife(a.world, a.alder)).toEqual(summarizeLife(b.world, b.alder));
    expect(findAllRecords(a.world, a.siteB)).toEqual(findAllRecords(b.world, b.siteB));
    expect(politicalMapAt(a.world, a.regionMap, 7)).toEqual(politicalMapAt(b.world, b.regionMap, 7));
  });

  it("every chronicle query survives save/reload bit for bit", () => {
    const fx = buildFixture();
    const { world, regionMap, materials, siteA, siteB, warId, alder, artifact, child } = fx;
    const snapshot = snapshotWorld(world);
    const restored = restoreWorld(snapshot, { componentTypes: ALL_COMPONENT_TYPES, materials });
    const regionMap2 = new RegionMap(16, 16);
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) regionMap2.setElevation(x, z, 0);

    expect(worldTimeline(restored)).toEqual(worldTimeline(world));
    expect(timelineWindow(restored, { entityId: alder })).toEqual(timelineWindow(world, { entityId: alder }));
    expect(figurePage(restored, alder)).toEqual(figurePage(world, alder));
    expect(siteHistory(restored, siteA)).toEqual(siteHistory(world, siteA));
    expect(sitePopulationAt(restored, siteA, world.clock.tick)).toEqual(sitePopulationAt(world, siteA, world.clock.tick));
    expect(artifactHistory(restored, artifact)).toEqual(artifactHistory(world, artifact));
    expect(familyLineage(restored, child)).toEqual(familyLineage(world, child));
    expect(politicalMapAt(restored, regionMap2, 7)).toEqual(politicalMapAt(world, regionMap, 7));
    expect(causalHistoryOf(restored, world.events.eventsOfType("war-ended")[0]!.id)).toEqual(causalHistoryOf(world, world.events.eventsOfType("war-ended")[0]!.id));
    expect(summarizeWar(restored, warId)).toEqual(summarizeWar(world, warId));
    expect(findAllRecords(restored, siteB)).toEqual(findAllRecords(world, siteB));
    expect(queryWar(restored, warId)).toEqual(queryWar(world, warId));
  });

  it("chronicle reads survive centuries of deep time with no broken references", () => {
    const fx = buildFixture();
    const { world, regionMap, siteA, siteB, warId, alder, artifact, child } = fx;
    const beforeWar = summarizeWar(world, warId);
    const beforeLineage = familyLineage(world, child);
    const earlyMap = politicalMapAt(world, regionMap, 7);

    advanceWorldTicks(world, 100 * 48_000, () => "forest", { forest: 0.8, wetland: 0.7, grassland: 0.5, desert: 0.1, tundra: 0.1, mountain: 0.1 });

    // History is immutable: the same queries give the same answers.
    expect(summarizeWar(world, warId)).toEqual(beforeWar);
    expect(familyLineage(world, child)).toEqual(beforeLineage);
    expect(politicalMapAt(world, regionMap, 7)).toEqual(earlyMap);
    expect(artifactHistory(world, artifact).maker).toBe(alder);
    expect(figurePage(world, alder).known).toBe(true);
    expect(querySite(world, siteA).known).toBe(true);
    expect(querySite(world, siteB).known).toBe(true);
    for (const id of [alder, artifact, child, siteA, siteB]) {
      expect(world.entities.isKnown(id)).toBe(true);
    }
  });
});
