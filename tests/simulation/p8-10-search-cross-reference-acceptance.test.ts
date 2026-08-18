/**
 * Headless acceptance test for P8-10 -- Search and cross-reference.
 *
 * Roadmap acceptance test: "a player can find every historical record
 * involving a selected beaver, artifact, site, or organization."
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
import { establishPolity } from "../../src/sim/politics/PoliticalEntity.js";
import { claimTerritory } from "../../src/sim/politics/Territory.js";
import { declareWar } from "../../src/sim/politics/War.js";
import { createOrganization } from "../../src/sim/politics/Organization.js";
import { spawnBeaver } from "../../src/sim/creatures/Beaver.js";
import { setGood } from "../../src/sim/economy/Good.js";
import { setOwner, bequeathEstate } from "../../src/sim/creatures/Ownership.js";
import { die } from "../../src/sim/creatures/Mortality.js";
import { fileAccusation } from "../../src/sim/politics/Justice.js";
import { isProhibited } from "../../src/sim/creatures/Law.js";
import { barterExchange } from "../../src/sim/politics/Market.js";
import { findAllRecords, crossReferenceIndex, type CrossReference } from "../../src/sim/chronicle/Search.js";

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
  const random = new RandomStreams(810);
  const events = new EventLog(entities);
  return {
    world: { clock, random, entities, components, grid, terrain, events, water, weather },
    regionMap: new RegionMap(16, 16),
  };
}

/** Independent ground truth: every event naming the target as subject/object. */
function expectCoversAllEventRecords(world: World, targetId: EntityId, records: CrossReference[]): void {
  const expected = new Set<string>();
  for (const event of world.events.all()) {
    if (event.subjectIds.includes(targetId) || event.objectIds.includes(targetId)) expected.add(`${event.id}`);
  }
  const actual = new Set(records.filter((r) => r.role === "subject" || r.role === "object").map((r) => String(r.eventId)));
  for (const key of expected) expect(actual.has(key), `event ${key} naming the target must be found`).toBe(true);
  // No duplicates, chronological.
  for (let i = 1; i < records.length; i++) {
    expect(records[i - 1]!.tick <= records[i]!.tick || (records[i - 1]!.tick === records[i]!.tick && records[i - 1]!.eventId <= records[i]!.eventId)).toBe(true);
  }
}

describe("P8-10 -- Search and cross-reference", () => {
  it("finds every historical record involving a selected beaver, artifact, site, or organization", () => {
    const { world, regionMap } = buildWorld();
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) regionMap.setElevation(x, z, 0);

    // Actors: sites, an organization, a beaver, and an artifact.
    const siteA = createSite(world, regionMap, 2, 2, 10, 100);
    const siteB = createSite(world, regionMap, 3, 2, 10, 100);
    establishPolity(world, siteA);
    establishPolity(world, siteB);
    const org = createOrganization(world, ["watch"], world.random.stream("p8-10-org"));
    const alder = spawnBeaver(world, { name: "Alder", position: { x: 4, y: 3, z: 4 } });
    const birch = spawnBeaver(world, { name: "Birch", position: { x: 5, y: 3, z: 5 } });

    const artifact = world.entities.create("good");
    world.grid.setEntityPosition(artifact, 6, 3, 6);
    setGood(world.components, artifact, { goodKind: "plank", materialId: "wood", massKg: 4, makerId: alder });
    setOwner(world.components, artifact, { ownerType: "institutional", ownerId: siteA });

    // Real records touching each target.
    claimTerritory(world, regionMap, siteA, 1);
    const claimEvent = world.events.eventsOfType("territory-claimed").find((e) => e.subjectIds.includes(siteA))!.id;
    world.clock.advanceTicks(10);
    declareWar(world, siteA, siteB, "territory", claimEvent);
    world.clock.advanceTicks(10);

    const other = world.entities.create("good");
    world.grid.setEntityPosition(other, 12, 3, 12);
    setGood(world.components, other, { goodKind: "plank", materialId: "wood", massKg: 5 });
    setOwner(world.components, other, { ownerType: "institutional", ownerId: siteB });
    barterExchange(world, artifact, other, siteA, siteB, 6, 6); // ownership records naming both sites and the artifact

    world.clock.advanceTicks(10);
    setOwner(world.components, artifact, { ownerType: "personal", ownerId: alder });
    die(world, alder, "starvation"); // death record naming the beaver
    bequeathEstate(world, alder); // ownership-transferred naming alder as previous owner

    // Theft accusation with the artifact as real evidence.
    setOwner(world.components, artifact, { ownerType: "personal", ownerId: birch });
    const violation = isProhibited(world, birch, artifact) ?? { action: "theft" as const, actorId: birch, itemId: artifact };
    world.clock.advanceTicks(10);
    fileAccusation(world, alder, violation, [], artifact); // physical evidence path

    // BEAVER search: every record naming Alder, plus owner/evidence roles.
    const beaverRecords = findAllRecords(world, alder);
    expectCoversAllEventRecords(world, alder, beaverRecords);
    expect(beaverRecords.some((r) => r.eventType === "starvation-death")).toBe(true);
    expect(beaverRecords.some((r) => r.role === "previous-owner")).toBe(true);

    // ARTIFACT search: every record naming it, its ownership transfers
    // (it is the SUBJECT of each), and the accusation holding it as
    // evidence (the owner/search roles belong to owner targets).
    const artifactRecords = findAllRecords(world, artifact);
    expectCoversAllEventRecords(world, artifact, artifactRecords);
    expect(artifactRecords.some((r) => r.eventType === "barter-exchange")).toBe(true);
    const artifactTransfers = artifactRecords.filter((r) => r.eventType === "ownership-transferred");
    expect(artifactTransfers.length).toBeGreaterThanOrEqual(2); // barter + bequeath
    expect(artifactRecords.some((r) => r.role === "evidence")).toBe(true);

    // SITE search: founding, claims, war participation, barter.
    const siteRecords = findAllRecords(world, siteA);
    expectCoversAllEventRecords(world, siteA, siteRecords);
    expect(siteRecords.some((r) => r.eventType === "site-founded")).toBe(true);
    expect(siteRecords.some((r) => r.eventType === "war-declared" && r.role === "war-participant")).toBe(true);
    expect(siteRecords.some((r) => r.role === "previous-owner")).toBe(true);

    // ORGANIZATION search: its creation record.
    const orgRecords = findAllRecords(world, org);
    expectCoversAllEventRecords(world, org, orgRecords);
    expect(orgRecords.some((r) => r.eventType === "organization-founded")).toBe(true);

    // Batch index over all four targets.
    const index = crossReferenceIndex(world, [alder, artifact, siteA, org]);
    expect(index.get(alder)).toEqual(beaverRecords);
    expect(index.get(artifact)).toEqual(artifactRecords);
    expect(index.get(siteA)).toEqual(siteRecords);
    expect(index.get(org)).toEqual(orgRecords);

    // An id with no history yields an empty, honest result.
    expect(findAllRecords(world, 999_999 as EntityId)).toEqual([]);
  });

  it("cross-references survive save/reload", () => {
    const { world, regionMap } = buildWorld();
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) regionMap.setElevation(x, z, 0);
    const siteA = createSite(world, regionMap, 2, 2, 10, 100);
    const siteB = createSite(world, regionMap, 3, 2, 10, 100);
    establishPolity(world, siteA);
    establishPolity(world, siteB);
    claimTerritory(world, regionMap, siteA, 1);
    const claimEvent = world.events.eventsOfType("territory-claimed").find((e) => e.subjectIds.includes(siteA))!.id;
    world.clock.advanceTicks(10);
    declareWar(world, siteA, siteB, "territory", claimEvent);

    const before = findAllRecords(world, siteA);
    const materials = new MaterialRegistry();
    registerStandardMaterials(materials);
    const restored = restoreWorld(snapshotWorld(world), { componentTypes: ALL_COMPONENT_TYPES, materials });
    expect(findAllRecords(restored, siteA)).toEqual(before);
  });
});
