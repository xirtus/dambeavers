/**
 * Headless acceptance test for P8-01 -- Historical query API.
 *
 * Roadmap acceptance test: "query people, sites, objects, events,
 * relationships, wars, constructions, and causal links by stable ID."
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
import { createSite } from "../../src/sim/region/Site.js";
import { spawnBeaver } from "../../src/sim/creatures/Beaver.js";
import { ensureSharedHousehold } from "../../src/sim/creatures/Household.js";
import { setRelationshipWith } from "../../src/sim/creatures/Relationships.js";
import { setGood } from "../../src/sim/economy/Good.js";
import { setOwner } from "../../src/sim/creatures/Ownership.js";
import { setConstruction } from "../../src/sim/labor/Construction.js";
import { establishPolity } from "../../src/sim/politics/PoliticalEntity.js";
import { claimTerritory } from "../../src/sim/politics/Territory.js";
import { declareWar } from "../../src/sim/politics/War.js";
import { nameEntity } from "../../src/sim/creatures/Naming.js";
import {
  queryByStableId, queryPerson, querySite, queryObject, queryEvent, queryRelationship, queryWar, queryConstruction, queryCausalLinks,
} from "../../src/sim/chronicle/Chronicle.js";

function buildWorld(): { world: World; regionMap: RegionMap } {
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
  const random = new RandomStreams(801);
  const events = new EventLog(entities);
  return {
    world: { clock, random, entities, components, grid, terrain, events, water, weather },
    regionMap: new RegionMap(16, 16),
  };
}

function expectReferencesResolve(world: World, references: Array<{ kind: string; eventId?: EventId; entityId?: EntityId }>): void {
  for (const reference of references) {
    if (reference.kind === "event") expect(world.events.has(reference.eventId as EventId)).toBe(true);
    else expect(world.entities.isKnown(reference.entityId as EntityId)).toBe(true);
  }
}

describe("P8-01 -- Historical query API", () => {
  it("queries people, sites, objects, events, relationships, wars, constructions, and causal links by stable ID", () => {
    const { world, regionMap } = buildWorld();
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) regionMap.setElevation(x, z, 0);

    // Real actors.
    const siteA = createSite(world, regionMap, 2, 2, 10, 100);
    const siteB = createSite(world, regionMap, 3, 2, 8, 100);
    establishPolity(world, siteA);
    establishPolity(world, siteB);
    const claimEvent = claimTerritory(world, regionMap, siteA, 1);
    world.clock.advanceTicks(5);
    const warId = declareWar(world, siteA, siteB, "territory", claimEvent as unknown as EventId);

    const alder = spawnBeaver(world, { name: "Alder", position: { x: 4, y: 3, z: 4 } });
    const birch = spawnBeaver(world, { name: "Birch", position: { x: 4, y: 3, z: 5 } });
    ensureSharedHousehold(world, alder, birch);
    setRelationshipWith(world.components, alder, { withId: birch, kin: "sibling", familiarity: 0.9, affinity: 0.8 });

    const itemId = world.entities.create("good");
    world.grid.setEntityPosition(itemId, 6, 3, 6);
    setGood(world.components, itemId, { goodKind: "plank", materialId: "wood", massKg: 4, makerId: alder });
    setOwner(world.components, itemId, { ownerType: "personal", ownerId: alder });

    const constructionId = world.entities.create("construction");
    setConstruction(world.components, constructionId, {
      designationId: constructionId, kind: "wall", site: { x: 5, z: 5 }, requiredMaterialId: "wood", requiredMassKg: 1, workDone: 1, workRequired: 1, status: "complete",
    });
    world.events.record({
      tick: world.clock.tick,
      eventType: "dam-segment-applied",
      subjectIds: [constructionId],
      objectIds: [constructionId],
      location: { x: 5, y: 0, z: 5 },
    });

    nameEntity(world, siteA, "site", world.random.stream("p8-01-names"));

    // Person.
    const person = queryPerson(world, alder);
    expect(person.known).toBe(true);
    expect(person.name).toBe("Alder");
    expect(person.references.length).toBeGreaterThan(0);
    expectReferencesResolve(world, person.references);

    // Site.
    const site = querySite(world, siteA);
    expect(site.known).toBe(true);
    expect(site.summary).toContain("population 10");
    expectReferencesResolve(world, site.references);

    // Object.
    const object = queryObject(world, itemId);
    expect(object.known).toBe(true);
    expect(object.summary).toContain("plank");
    expectReferencesResolve(world, object.references);

    // Event.
    const eventId = world.events.eventsOfType("war-declared")[0]!.id;
    const event = queryEvent(world, eventId);
    expect(event.known).toBe(true);
    expect(event.summary).toContain("war-declared");
    expectReferencesResolve(world, event.references);

    // Relationship.
    const relationship = queryRelationship(world, alder, birch);
    expect(relationship.known).toBe(true);
    expect(relationship.summary).toContain("sibling");
    expectReferencesResolve(world, relationship.references);

    // War.
    const war = queryWar(world, warId);
    expect(war.known).toBe(true);
    expect(war.summary).toContain("territory");
    expectReferencesResolve(world, war.references);

    // Construction.
    const construction = queryConstruction(world, constructionId);
    expect(construction.known).toBe(true);
    expectReferencesResolve(world, construction.references);

    // Causal links.
    const causal = queryCausalLinks(world, eventId);
    expect(causal.known).toBe(true);
    expect(causal.references.length).toBeGreaterThanOrEqual(2); // backward chain + forward children
    expectReferencesResolve(world, causal.references);

    // Unknown ids report honestly.
    expect(queryByStableId(world, "person", 999_999 as EntityId).known).toBe(false);
    expect(queryByStableId(world, "event", 999_999 as EventId).known).toBe(false);
    expect(queryByStableId(world, "war", 999_999 as EntityId).known).toBe(false);
    expect(() => queryByStableId(world, "nonsense" as never, 1)).toThrow(RangeError);
  });

  it("every query survives save/reload and keeps resolving by the same stable IDs", () => {
    const { world, regionMap } = buildWorld();
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) regionMap.setElevation(x, z, 0);
    const siteA = createSite(world, regionMap, 2, 2, 10, 100);
    const siteB = createSite(world, regionMap, 3, 2, 8, 100);
    establishPolity(world, siteA);
    establishPolity(world, siteB);
    const claimEvent = claimTerritory(world, regionMap, siteA, 1);
    world.clock.advanceTicks(5);
    const warId = declareWar(world, siteA, siteB, "territory", claimEvent as unknown as EventId);
    const alder = spawnBeaver(world, { name: "Alder", position: { x: 4, y: 3, z: 4 } });
    const itemId = world.entities.create("good");
    world.grid.setEntityPosition(itemId, 6, 3, 6);
    setGood(world.components, itemId, { goodKind: "plank", materialId: "wood", massKg: 4, makerId: alder });

    const warBefore = queryWar(world, warId);
    const personBefore = queryPerson(world, alder);
    const siteBefore = querySite(world, siteA);
    const objectBefore = queryObject(world, itemId);
    const eventBefore = queryEvent(world, world.events.eventsOfType("war-declared")[0]!.id);

    const materials = new MaterialRegistry();
    registerStandardMaterials(materials);
    const restoredWorld = restoreWorld(snapshotWorld(world), { componentTypes: ALL_COMPONENT_TYPES, materials });

    expect(queryWar(restoredWorld, warId)).toEqual(warBefore);
    expect(queryPerson(restoredWorld, alder)).toEqual(personBefore);
    expect(querySite(restoredWorld, siteA)).toEqual(siteBefore);
    expect(queryObject(restoredWorld, itemId)).toEqual(objectBefore);
    expect(queryEvent(restoredWorld, eventBefore.id as EventId)).toEqual(eventBefore);
    expect(queryCausalLinks(restoredWorld, eventBefore.id as EventId)).toEqual(queryCausalLinks(world, eventBefore.id as EventId));
  });
});
