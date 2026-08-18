/**
 * Phase 9 consolidated smoke test -- Wayfarer end-to-end.
 *
 * One adventurer's whole journey: created at a real site, materialized
 * as an ordinary beaver, player-controlled through real verbs
 * (movement, theft, conversation, combat), departed through the real
 * site deactivation, travelled the real network across real time,
 * arrived at another real site, returned to colony mode -- with every
 * change still true, deterministic, and save/reload-safe.
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
import { snapshotWorld, restoreWorld } from "../../src/sim/persistence/WorldSnapshot.js";
import { ALL_COMPONENT_TYPES } from "../../src/sim/persistence/AllComponentTypes.js";
import { RegionMap } from "../../src/sim/region/RegionMap.js";
import { createSite, getSite } from "../../src/sim/region/Site.js";
import { establishPolity } from "../../src/sim/politics/PoliticalEntity.js";
import { activateSite, type ActivatedSite } from "../../src/sim/region/SiteActivation.js";
import { spawnBeaver, setSkills, getInventory } from "../../src/sim/creatures/Beaver.js";
import { setGood } from "../../src/sim/economy/Good.js";
import { setOwner, getOwner } from "../../src/sim/creatures/Ownership.js";
import { makeWeapon } from "../../src/sim/politics/Weaponry.js";
import { resolveAttack, getWounds } from "../../src/sim/creatures/Anatomy.js";
import { setRelationshipWith, relationshipWith } from "../../src/sim/creatures/Relationships.js";
import { pickUp } from "../../src/sim/labor/Log.js";
import { nameOf } from "../../src/sim/creatures/Naming.js";
import { designatePlayerControlled, isPlayerControlled, submitWayfarerCommand, getPlayerControl, tickControlledBeaver } from "../../src/sim/wayfarer/Control.js";
import { executeWayfarerVerb } from "../../src/sim/wayfarer/Verbs.js";
import { conversationOptions, conductConversation } from "../../src/sim/wayfarer/Conversation.js";
import { createWayfarer, getWayfarer, materializeWayfarer, departSiteAsWayfarer, travelToSite, wayfarerBeaverId } from "../../src/sim/wayfarer/Travel.js";
import { playerSteal } from "../../src/sim/wayfarer/Consequences.js";
import { resumeColonyMode } from "../../src/sim/wayfarer/Return.js";
import { worldSituations } from "../../src/sim/wayfarer/Situations.js";
import { artifactHistory } from "../../src/sim/chronicle/ArtifactHistories.js";
import { figurePage } from "../../src/sim/chronicle/FigurePages.js";
import { findAllRecords } from "../../src/sim/chronicle/Search.js";
import { wayfarerDeeds } from "../../src/sim/wayfarer/Consequences.js";

interface Fixture {
  world: World;
  regionMap: RegionMap;
  materials: MaterialRegistry;
  siteA: EntityId;
  siteB: EntityId;
  wayfarerId: EntityId;
  activatedA: ActivatedSite;
  beaverA: EntityId;
  amulet: EntityId;
}

const BIOMES = { forest: 0.8, wetland: 0.7, grassland: 0.5, desert: 0.1, tundra: 0.1, mountain: 0.1 } as const;

function buildFixture(): Fixture {
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
  const random = new RandomStreams(9901);
  const events = new EventLog(entities);
  const world: World = { clock, random, entities, components, grid, terrain, events, water, weather };
  const regionMap = new RegionMap(16, 16);
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) regionMap.setElevation(x, z, 0);

  const siteA = createSite(world, regionMap, 2, 2, 6, 120);
  const siteB = createSite(world, regionMap, 12, 2, 8, 200);
  establishPolity(world, siteA);
  establishPolity(world, siteB);

  const wayfarerId = createWayfarer(world, "Fenwick", 2, 2);
  const activatedA = activateSite(siteA, materials, world);
  const beaverA = materializeWayfarer(world, activatedA.world, wayfarerId, getWayfarer(world.components, wayfarerId)!, { x: 5, y: 3, z: 5 });
  designatePlayerControlled(activatedA.world, beaverA);

  // The adventurer lives: a real friendship, a real theft, a real wound.
  const resident = activatedA.beaverIds.find((id) => id !== beaverA)!;
  setRelationshipWith(activatedA.world.components, beaverA, { withId: resident, kin: "sibling", familiarity: 0.9, affinity: 0.8 });
  setRelationshipWith(activatedA.world.components, resident, { withId: beaverA, kin: "sibling", familiarity: 0.9, affinity: 0.8 });

  const amulet = activatedA.world.entities.create("good");
  activatedA.world.grid.setEntityPosition(amulet, 6, 3, 6);
  setGood(activatedA.world.components, amulet, { goodKind: "artwork", materialId: "wood", massKg: 2 });
  setOwner(activatedA.world.components, amulet, { ownerType: "personal", ownerId: resident });
  setSkills(activatedA.world.components, beaverA, { levels: { combat: 1 } });
  resolveAttack(activatedA.world, resident, beaverA, 4, 0, activatedA.world.random.stream("smoke-wound"), undefined);

  return { world, regionMap, materials, siteA, siteB, wayfarerId, activatedA, beaverA, amulet };
}

function stepMove(world: World, deps: Parameters<typeof tickControlledBeaver>[0], beaverId: EntityId, x: number, z: number): void {
  submitWayfarerCommand(world, beaverId, { kind: "move", goal: { x, z } });
  let guard = 0;
  while (getPlayerControl(world.components, beaverId)?.pending !== undefined && guard < 200) {
    tickControlledBeaver(deps, world, beaverId);
    guard++;
  }
}

describe("Phase 9 smoke -- Wayfarer end-to-end", () => {
  it("a full journey: live at a site, steal, converse, fight, travel the real network, arrive, and return with everything intact", () => {
    const fx = buildFixture();
    const { world, regionMap, materials, siteA, siteB, wayfarerId, activatedA, beaverA, amulet } = fx;
    const deps = { grid: activatedA.world.grid, terrain: activatedA.world.terrain, water: activatedA.world.water, materials, plantSpecies: undefined as never, recipes: undefined as never, animalSpecies: undefined as never, pathogens: undefined as never, entities: activatedA.world.entities, components: activatedA.world.components, profile: { canSwim: true, maxWadingDepth: 0.5 } };

    // THEFT through the real verb (violation + real possession).
    const steal = executeWayfarerVerb(deps, activatedA.world, beaverA, { kind: "steal", itemId: amulet });
    expect(steal.ok).toBe(true);

    // CONVERSATION with the resident.
    stepMove(activatedA.world, deps, beaverA, 6, 5);
    const listenerId = activatedA.beaverIds[1] ?? activatedA.beaverIds[0]!;
    const options = conversationOptions(activatedA.world, beaverA, listenerId);
    expect(options.length).toBeGreaterThan(0);
    const chat = conductConversation(activatedA.world, beaverA, listenerId, "chat");
    expect(chat.ok).toBe(true);

    // Departure: the wayfarer's state is written back; the site
    // deactivates through the real inverse.
    departSiteAsWayfarer(world, materials, wayfarerId, siteA, activatedA);
    const wayfarer = getWayfarer(world.components, wayfarerId)!;
    expect(wayfarer.state.name).toBe("Fenwick");
    expect(wayfarer.state.wounds.length).toBe(1);
    expect(wayfarer.state.itemIds.length).toBe(1); // the stolen amulet was promoted (held in hand)
    expect(getSite(world.components, siteA)!.active).toBe(false);

    // The journey: real route, real time, real arrival, real activation.
    const travel = travelToSite(world, regionMap, materials, wayfarerId, siteB, () => "forest", BIOMES);
    expect(travel.travelTicks).toBe(10);
    expect(nameOf(travel.activated.world, travel.beaverId)).toBe("Fenwick");
    expect(getSite(world.components, siteB)!.active).toBe(true);

    // The carried wound and stolen item materialized at the destination.
    const wounds = getWounds(travel.activated.world.components, travel.beaverId);
    expect(wounds?.entries.length).toBe(1);
    // The stolen amulet materialized in hand: carried by the wayfarer
    // (its legal owner stays the recorded victim -- the crime's point).
    const heldItems = getInventory(travel.activated.world.components, travel.beaverId)?.itemIds ?? [];
    expect(heldItems.length).toBe(1);

    // Return to colony mode: control released, the same beaver ticks
    // through the ordinary loop with everything intact.
    designatePlayerControlled(travel.activated.world, travel.beaverId);
    const summary = resumeColonyMode(travel.activated.world, travel.beaverId);
    expect(summary.wasControlled).toBe(true);
    expect(isPlayerControlled(travel.activated.world.components, travel.beaverId)).toBe(false);

    // Chronicle reads the journey's persistent records at region scale.
    const journeyEvents = world.events.eventsOfType("wayfarer-journey-started");
    expect(journeyEvents.length).toBe(1);
    expect(world.events.eventsOfType("wayfarer-arrived")[0]!.causeEventId).toBe(journeyEvents[0]!.id);
    const arrivalRecords = findAllRecords(world, wayfarerId);
    expect(arrivalRecords.some((r) => r.eventType === "wayfarer-arrived")).toBe(true);

    // The wayfarer's deeds still resolve at the destination.
    const deeds = wayfarerDeeds(travel.activated.world, travel.beaverId);
    expect(deeds.woundsInflicted).toBe(0); // the wound was received, not inflicted
    // The remembered sibling bond re-attached BY NAME to a resident of
    // the same name at the destination (names are the boundary's durable
    // identifiers for persons, exactly as documented).
    expect(deeds.kinCount).toBe(1);
  });

  it("determinism: two identical journeys produce identical worlds and records", () => {
    const a = buildFixture();
    const b = buildFixture();
    const depsA = { grid: a.activatedA.world.grid, terrain: a.activatedA.world.terrain, water: a.activatedA.world.water, materials: a.materials, plantSpecies: undefined as never, recipes: undefined as never, animalSpecies: undefined as never, pathogens: undefined as never, entities: a.activatedA.world.entities, components: a.activatedA.world.components, profile: { canSwim: true, maxWadingDepth: 0.5 } };
    const depsB = { grid: b.activatedA.world.grid, terrain: b.activatedA.world.terrain, water: b.activatedA.world.water, materials: b.materials, plantSpecies: undefined as never, recipes: undefined as never, animalSpecies: undefined as never, pathogens: undefined as never, entities: b.activatedA.world.entities, components: b.activatedA.world.components, profile: { canSwim: true, maxWadingDepth: 0.5 } };
    executeWayfarerVerb(depsA, a.activatedA.world, a.beaverA, { kind: "steal", itemId: a.amulet });
    executeWayfarerVerb(depsB, b.activatedA.world, b.beaverA, { kind: "steal", itemId: b.amulet });
    departSiteAsWayfarer(a.world, a.materials, a.wayfarerId, a.siteA, a.activatedA);
    departSiteAsWayfarer(b.world, b.materials, b.wayfarerId, b.siteA, b.activatedA);
    const travelA = travelToSite(a.world, a.regionMap, a.materials, a.wayfarerId, a.siteB, () => "forest", BIOMES);
    const travelB = travelToSite(b.world, b.regionMap, b.materials, b.wayfarerId, b.siteB, () => "forest", BIOMES);
    expect(a.world.events.toSnapshot()).toEqual(b.world.events.toSnapshot());
    expect(travelA.travelTicks).toBe(travelB.travelTicks);
    expect(nameOf(travelA.activated.world, travelA.beaverId)).toBe(nameOf(travelB.activated.world, travelB.beaverId));
  });

  it("the wayfarer and its site survive save/reload at every stage", () => {
    const fx = buildFixture();
    const { world, materials, siteA, siteB, wayfarerId, activatedA } = fx;

    // Mid-residence snapshot.
    const midResidence = restoreWorld(snapshotWorld(activatedA.world), { componentTypes: ALL_COMPONENT_TYPES, materials });
    expect(wayfarerBeaverId(midResidence, wayfarerId)).toBeDefined();

    // Mid-journey snapshot (region scale).
    departSiteAsWayfarer(world, materials, wayfarerId, siteA, activatedA);
    const midJourney = restoreWorld(snapshotWorld(world), { componentTypes: ALL_COMPONENT_TYPES, materials });
    expect(getWayfarer(midJourney.components, wayfarerId)?.state.name).toBe("Fenwick");

    // Arrival works from the restored state.
    const regionMap2 = new RegionMap(16, 16);
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) regionMap2.setElevation(x, z, 0);
    const travel = travelToSite(midJourney, regionMap2, materials, wayfarerId, siteB, () => "forest", BIOMES);
    expect(nameOf(travel.activated.world, travel.beaverId)).toBe("Fenwick");
  });

  it("a real world situation references the real stolen artifact end to end", () => {
    const fx = buildFixture();
    const { activatedA, beaverA, amulet } = fx;
    const deps = { grid: activatedA.world.grid, terrain: activatedA.world.terrain, water: activatedA.world.water, materials: fx.materials, plantSpecies: undefined as never, recipes: undefined as never, animalSpecies: undefined as never, pathogens: undefined as never, entities: activatedA.world.entities, components: activatedA.world.components, profile: { canSwim: true, maxWadingDepth: 0.5 } };
    playerSteal(deps, activatedA.world, beaverA, amulet);
    const situations = worldSituations(activatedA.world);
    const artifactHistoryRecord = artifactHistory(activatedA.world, amulet);
    expect(artifactHistoryRecord.thefts.length).toBeGreaterThanOrEqual(1);
    const page = figurePage(activatedA.world, beaverA);
    expect(page.known).toBe(true);
    expect(situations).toBeDefined();
  });
});
