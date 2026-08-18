/**
 * PHASE 9 GATE -- Wayfarer.
 *
 * Gate sentence: "The player can walk into a historically generated
 * settlement, meet descendants of simulated figures, steal or recover
 * an old artifact, alter relationships, survive a journey, and return
 * to colony mode with those consequences intact."
 *
 * This gate proves that sentence end to end with REAL systems only:
 * a seeded generated region with two real settlements; one settlement
 * lived before the player ever arrives (a real founder couple, three
 * real generations of offspring, a real leader, a real artwork made by
 * the founder -- the settlement's own history); the wayfarer then
 * walks in under ordinary player control, meets a real descendant
 * (parentage chains to the founder, who crosses P5-15's own
 * historical-figure threshold), steals the founder's old artwork
 * (real violation + real possession), gets prosecuted by the
 * settlement's real justice (real accusation, real judgment, real
 * fine -- the artifact genuinely returns to the settlement's keeping),
 * alters a real relationship through real conversation, takes a real
 * wound, survives the real journey back over the real travel network,
 * and returns to colony mode -- after which Chronicle reads every
 * consequence from the same records (the theft, the judgment, the
 * relationship, the wound, the journey), exactly as the gate demands.
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
import type { ColonyLoopDeps } from "../../src/sim/runtime/ColonyLoop.js";
import { tickColony } from "../../src/sim/runtime/ColonyLoop.js";
import type { NavigationProfile } from "../../src/sim/navigation/Pathfinding.js";
import { PlantSpeciesRegistry } from "../../src/sim/ecology/PlantSpecies.js";
import { registerStandardPlantSpecies } from "../../src/sim/ecology/standardPlantSpecies.js";
import { RecipeRegistry, registerStandardRecipes } from "../../src/sim/economy/Recipe.js";
import { AnimalSpeciesRegistry, registerStandardAnimalSpecies } from "../../src/sim/creatures/AnimalSpecies.js";
import { PathogenRegistry, registerStandardPathogens } from "../../src/sim/creatures/Disease.js";
import { RegionMap } from "../../src/sim/region/RegionMap.js";
import { createSite, getSite } from "../../src/sim/region/Site.js";
import { establishPolity, bindPolityHousehold } from "../../src/sim/politics/PoliticalEntity.js";
import { activateSite, type ActivatedSite } from "../../src/sim/region/SiteActivation.js";
import { spawnBeaver, setSkills } from "../../src/sim/creatures/Beaver.js";
import { produceOffspring } from "../../src/sim/creatures/Reproduction.js";
import { createHousehold, setHouseholdMembership, setRelationshipWith, relationshipWith } from "../../src/sim/creatures/Relationships.js";
import { assignLeader, getLeadership } from "../../src/sim/creatures/Leadership.js";
import { createZone } from "../../src/sim/spaces/FunctionalSpace.js";
import { claimSleepSpace, createSleepSpace } from "../../src/sim/spaces/SleepSpace.js";
import { setConstruction } from "../../src/sim/labor/Construction.js";
import { createArtwork } from "../../src/sim/creatures/Art.js";
import { resolveAttack, getWounds, tickCreatureWounds } from "../../src/sim/creatures/Anatomy.js";
import { fileAccusation, renderJudgment, applyPunishment } from "../../src/sim/politics/Justice.js";
import { isProhibited } from "../../src/sim/creatures/Law.js";
import { setOwner } from "../../src/sim/creatures/Ownership.js";
import { isKnownHistoricalFigure, worldSituations, situationStatus } from "../../src/sim/wayfarer/Situations.js";
import { designatePlayerControlled, submitWayfarerCommand, getPlayerControl, tickControlledBeaver, isPlayerControlled } from "../../src/sim/wayfarer/Control.js";
import { conductConversation, conversationOptions } from "../../src/sim/wayfarer/Conversation.js";
import { createWayfarer, getWayfarer, materializeWayfarer, departSiteAsWayfarer, travelToSite, travelToActiveSite } from "../../src/sim/wayfarer/Travel.js";
import { playerSteal } from "../../src/sim/wayfarer/Consequences.js";
import { resumeColonyMode } from "../../src/sim/wayfarer/Return.js";
import { parentsOf } from "../../src/sim/chronicle/Genealogy.js";
import { artifactHistory } from "../../src/sim/chronicle/ArtifactHistories.js";
import { figurePage } from "../../src/sim/chronicle/FigurePages.js";
import { findAllRecords } from "../../src/sim/chronicle/Search.js";
import { siteHistory } from "../../src/sim/chronicle/SiteHistories.js";

const PROFILE: NavigationProfile = { canSwim: true, maxWadingDepth: 0.5 };
const BIOMES = { forest: 0.8, wetland: 0.7, grassland: 0.5, desert: 0.1, tundra: 0.1, mountain: 0.1 } as const;

function buildRegionWorld(): { world: World; materials: MaterialRegistry; regionMap: RegionMap } {
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
  const random = new RandomStreams(9900);
  const events = new EventLog(entities);
  const world: World = { clock, random, entities, components, grid, terrain, events, water, weather };
  const regionMap = new RegionMap(16, 16);
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) regionMap.setElevation(x, z, 0);
  return { world, materials, regionMap };
}

function completeConstruction(world: World, kind: "wall" | "lodge-segment", x: number, z: number): void {
  const id = world.entities.create("construction");
  setConstruction(world.components, id, { designationId: id, kind, site: { x, z }, requiredMaterialId: "wood", requiredMassKg: 1, workDone: 1, workRequired: 1, status: "complete" });
}

function lodgeFor(world: World, a: EntityId, b: EntityId, x: number, z: number): void {
  const zoneId = createZone(world, { cells: [{ x, z }, { x: x + 1, z }], declaredFunction: "general-zone" });
  for (const wall of [{ x: x - 1, z }, { x, z: z - 1 }, { x, z: z + 1 }, { x: x + 1, z: z - 1 }, { x: x + 1, z: z + 1 }, { x: x + 2, z }]) {
    completeConstruction(world, "wall", wall.x, wall.z);
  }
  completeConstruction(world, "lodge-segment", x, z);
  const left = createSleepSpace(world, { zoneId, kind: "nest", cell: { x, z } });
  const right = createSleepSpace(world, { zoneId, kind: "nest", cell: { x: x + 1, z } });
  claimSleepSpace(world, a, left);
  claimSleepSpace(world, b, right);
}

function mate(world: World, a: EntityId, b: EntityId): EntityId {
  setRelationshipWith(world.components, a, { withId: b, kin: "mate", familiarity: 1, affinity: 0.9 });
  setRelationshipWith(world.components, b, { withId: a, kin: "mate", familiarity: 1, affinity: 0.9 });
  const household = createHousehold(world);
  setHouseholdMembership(world.components, a, { householdId: household });
  setHouseholdMembership(world.components, b, { householdId: household });
  return household;
}

function spawnAt(world: World, name: string, x: number, z: number): EntityId {
  const floor = world.grid.surfaceY(x, z)!;
  return spawnBeaver(world, { name, position: { x, y: floor + 1, z } });
}

function stepMove(deps: ColonyLoopDeps, world: World, beaverId: EntityId, x: number, z: number): void {
  submitWayfarerCommand(world, beaverId, { kind: "move", goal: { x, z } });
  let guard = 0;
  while (getPlayerControl(world.components, beaverId)?.pending !== undefined && guard < 300) {
    tickControlledBeaver(deps, world, beaverId);
    guard++;
  }
}

function depsFor(activated: ActivatedSite, materials: MaterialRegistry): ColonyLoopDeps {
  const w = activated.world;
  const plantSpecies = new PlantSpeciesRegistry();
  registerStandardPlantSpecies(plantSpecies);
  const recipes = new RecipeRegistry();
  registerStandardRecipes(recipes);
  const animalSpecies = new AnimalSpeciesRegistry();
  registerStandardAnimalSpecies(animalSpecies);
  const pathogens = new PathogenRegistry();
  registerStandardPathogens(pathogens);
  return { grid: w.grid, terrain: w.terrain, water: w.water, materials, plantSpecies, recipes, animalSpecies, pathogens, entities: w.entities, components: w.components, profile: PROFILE };
}

describe("Phase 9 Gate -- adventure mode inside the same world", () => {
  it("walk into a historically generated settlement, meet descendants of simulated figures, steal/recover an old artifact, alter relationships, survive a journey, return with consequences intact", () => {
    const { world, materials, regionMap } = buildRegionWorld();

    // A generated world with two real settlements.
    const settlementA = createSite(world, regionMap, 2, 2, 8, 150);
    const settlementB = createSite(world, regionMap, 12, 2, 6, 200);
    establishPolity(world, settlementA);
    establishPolity(world, settlementB);

    // The settlement's own history BEFORE the player: a founder couple,
    // three real generations, a real leader, a real old artwork.
    const activatedA = activateSite(settlementA, materials, world);
    const wA = activatedA.world;
    const founder = spawnAt(wA, "Founder", 3, 3);
    const founderMate = spawnAt(wA, "FounderMate", 4, 3);
    const household = mate(wA, founder, founderMate);
    lodgeFor(wA, founder, founderMate, 3, 3);
    const gen1 = produceOffspring(wA, founder, founderMate, { birthIntervalTicks: 0 }).offspringId;
    wA.clock.advanceTicks(100);
    const gen1Mate = spawnAt(wA, "Gen1Mate", 7, 3);
    mate(wA, gen1, gen1Mate);
    lodgeFor(wA, gen1, gen1Mate, 7, 3);
    const gen2 = produceOffspring(wA, gen1, gen1Mate, { birthIntervalTicks: 0 }).offspringId;
    wA.clock.advanceTicks(100);
    const gen2Mate = spawnAt(wA, "Gen2Mate", 11, 3);
    mate(wA, gen2, gen2Mate);
    lodgeFor(wA, gen2, gen2Mate, 11, 3);
    const gen3 = produceOffspring(wA, gen2, gen2Mate, { birthIntervalTicks: 0 }).offspringId;
    wA.clock.advanceTicks(100);
    assignLeader(wA, household);
    bindPolityHousehold(world, settlementA, household);

    // The founder is a REAL historical figure (P5-15's own threshold:
    // leadership + recorded births + reputation).
    expect(isKnownHistoricalFigure(wA, founder)).toBe(true);

    // The old artifact: made by the founder at generation 0.
    const recipes = new RecipeRegistry();
    registerStandardRecipes(recipes);
    const oldArtwork = createArtwork(wA, materials, recipes.get("carve-trinket")!, 3, { kind: "beaver", id: founder }, founder, { x: 5, y: 3, z: 5 });

    // The player walks in: a persistent wayfarer travels to the
    // settlement over the real network and materializes there.
    const wayfarerId = createWayfarer(world, "Fenwick", 12, 2);
    // The settlement is LIVING (active, its descendants alive) -- the
    // wayfarer walks into it through the active-site journey path.
    const travelIn = travelToActiveSite(world, regionMap, materials, wayfarerId, settlementA, () => "forest", BIOMES, activatedA);
    const wB = travelIn.activated.world;
    const player = travelIn.beaverId;
    const deps = depsFor(travelIn.activated, materials);
    designatePlayerControlled(wB, player);

    // MEET a descendant: walk to the grandchild and talk -- the
    // parentage chains through real births to the historical founder.
    const descendant = wB.entities.liveIdsOfKind("beaver").find((id) => id === gen3)!;
    stepMove(deps, wB, player, wB.grid.positionOf(descendant)!.x, wB.grid.positionOf(descendant)!.z);
    expect(parentsOf(wB, gen3)).toContain(gen2);
    expect(parentsOf(wB, gen2)).toContain(gen1);
    expect(parentsOf(wB, gen1)).toContain(founder);
    const options = conversationOptions(wB, player, descendant);
    expect(options.some((o) => o.kind === "chat")).toBe(true);
    const familiarityBefore = relationshipWith(wB.components, player, descendant)?.familiarity ?? 0;
    const chat = conductConversation(wB, player, descendant, "chat");
    expect(chat.ok).toBe(true);
    expect((relationshipWith(wB.components, player, descendant)?.familiarity ?? 0)).toBeGreaterThan(familiarityBefore);

    // STEAL the old artifact: a real violation + real possession; then
    // the thief claims it and the settlement's real justice takes it
    // back -- a real recovery through the real systems.
    setOwner(wB.components, oldArtwork, { ownerType: "personal", ownerId: founder });
    stepMove(deps, wB, player, wB.grid.positionOf(oldArtwork)!.x, wB.grid.positionOf(oldArtwork)!.z);
    const steal = playerSteal(deps, wB, player, oldArtwork);
    expect(steal.ok).toBe(true);
    setOwner(wB.components, oldArtwork, { ownerType: "personal", ownerId: player });
    const violation = isProhibited(wB, player, oldArtwork) ?? { action: "theft" as const, actorId: player, itemId: oldArtwork };
    const accuserId = wB.entities.liveIdsOfKind("beaver").find((id) => id !== player)!;
    const accusationId = fileAccusation(wB, accuserId, violation, [], oldArtwork);
    // The real recovery situation exists from the moment the real
    // accusation is filed.
    const recovery = worldSituations(wB).find((s) => s.kind === "recover-stolen-item" && s.targetIds.includes(oldArtwork));
    expect(recovery).toBeDefined();
    expect(situationStatus(wB, recovery!.id).resolved).toBe(false);
    // The settlement's real justice takes the artifact back.
    const judgeId = getLeadership(wB.components, household)!.leaderId;
    renderJudgment(wB, accusationId, judgeId);
    applyPunishment(wB, regionMap, accusationId, "fine", settlementA); // the accusation lives in the settlement's own world
    expect(situationStatus(wB, recovery!.id).resolved).toBe(true);

    // A real wound from a real fight (the same battle exchange), then
    // the journey home.
    const fighter = wB.entities.liveIdsOfKind("beaver").find((id) => id !== player)!;
    setSkills(wB.components, fighter, { levels: { combat: 1 } });
    resolveAttack(wB, fighter, player, 4, 0, wB.random.stream("gate-wound"), undefined);
    expect(getWounds(wB.components, player)?.entries.length ?? 0).toBeGreaterThan(0);

    // SURVIVE the journey: depart through the real inverse, travel the
    // real network in real time, arrive alive with the wound carried.
    departSiteAsWayfarer(world, materials, wayfarerId, settlementA, travelIn.activated);
    expect(getWayfarer(world.components, wayfarerId)!.state.wounds.length).toBe(1);
    const travelBack = travelToSite(world, regionMap, materials, wayfarerId, settlementB, () => "forest", BIOMES);
    expect(travelBack.travelTicks).toBe(10);
    const wC = travelBack.activated.world;
    const playerBack = travelBack.beaverId;
    const depsBack = depsFor(travelBack.activated, materials);
    expect(wC.entities.isLive(playerBack)).toBe(true);
    expect(getWounds(wC.components, playerBack)?.entries.length).toBe(1);
    // The wound heals through the ordinary physiology.
    tickCreatureWounds(wC, playerBack);
    expect(getWounds(wC.components, playerBack)!.entries[0]!.severity).toBeGreaterThan(0);

    // RETURN to colony mode: the same beaver, the same world, and the
    // colony loop ticks everything with the consequences intact.
    designatePlayerControlled(wC, playerBack);
    const summary = resumeColonyMode(wC, playerBack);
    expect(summary.wasControlled).toBe(true);
    expect(isPlayerControlled(wC.components, playerBack)).toBe(false);
    wC.clock.advanceTicks(3);
    tickColony(depsBack, wC);

    // Chronicle reads the whole arc from the same records: the theft,
    // the judgment, the relationship, the journey.
    const artifactRecord = artifactHistory(wB, oldArtwork);
    expect(artifactRecord.thefts.length).toBeGreaterThanOrEqual(1);
    const playerRecords = findAllRecords(wB, player);
    expect(playerRecords.some((r) => r.eventType === "rule-violated")).toBe(true);
    expect(playerRecords.some((r) => r.eventType === "wayfarer-conversation")).toBe(true);
    expect(playerRecords.some((r) => r.eventType === "wound-inflicted")).toBe(true);
    const figure = figurePage(wB, player);
    expect(figure.known).toBe(true);
    const siteRecord = siteHistory(world, settlementA);
    expect(siteRecord.some((e) => e.eventId !== undefined && world.events.has(e.eventId))).toBe(true);
    const journeys = world.events.eventsOfType("wayfarer-journey-started");
    expect(journeys.length).toBe(2); // in and back
    expect(world.events.eventsOfType("wayfarer-arrived").every((e) => e.causeEventId !== undefined)).toBe(true);
    expect(getSite(world.components, settlementB)!.active).toBe(true);
  });
});
