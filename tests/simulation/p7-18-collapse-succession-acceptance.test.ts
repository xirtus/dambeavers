/**
 * Headless acceptance test for P7-18 -- Collapse and succession.
 *
 * Roadmap acceptance test: "civilizations can fragment, disappear, or
 * be replaced while their sites, artifacts, descendants, and history
 * persist."
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
import { setGood } from "../../src/sim/economy/Good.js";
import { setOwner, getOwner } from "../../src/sim/creatures/Ownership.js";
import { establishPolity, bindPolityHousehold } from "../../src/sim/politics/PoliticalEntity.js";
import { signTreaty } from "../../src/sim/politics/Diplomacy.js";
import { createOrganization, joinOrganization } from "../../src/sim/politics/Organization.js";
import { formBelief, adoptBelief } from "../../src/sim/creatures/Belief.js";
import { formCivilization, getCivilization } from "../../src/sim/politics/Civilization.js";
import { tickCivilizations, collapseConditionsOf, succeedCivilization, civilizationLegacy } from "../../src/sim/politics/Collapse.js";

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
  const random = new RandomStreams(718);
  const events = new EventLog(entities);
  return {
    world: { clock, random, entities, components, grid, terrain, events, water, weather },
    regionMap: new RegionMap(16, 16),
  };
}

describe("P7-18 -- Collapse and succession", () => {
  it("civilizations can fragment, disappear, or be replaced while their sites, artifacts, descendants, and history persist", () => {
    const { world, regionMap } = buildWorld();
    const siteA = createSite(world, regionMap, 2, 2, 6, 100);
    const siteB = createSite(world, regionMap, 10, 10, 6, 100);
    const siteC = createSite(world, regionMap, 2, 12, 6, 100); // survivor site
    establishPolity(world, siteA);
    establishPolity(world, siteB);
    establishPolity(world, siteC);

    const a1 = spawnBeaver(world, { name: "A1", position: { x: 3, y: 3, z: 3 } });
    const a2 = spawnBeaver(world, { name: "A2", position: { x: 3, y: 3, z: 4 } });
    const householdA = ensureSharedHousehold(world, a1, a2);
    bindPolityHousehold(world, siteA, householdA);
    const b1 = spawnBeaver(world, { name: "B1", position: { x: 11, y: 3, z: 11 } });
    const b2 = spawnBeaver(world, { name: "B2", position: { x: 11, y: 3, z: 12 } });
    const householdB = ensureSharedHousehold(world, b1, b2);
    bindPolityHousehold(world, siteB, householdB);

    signTreaty(world, [siteA, siteB], "alliance");
    const guildId = createOrganization(world, ["elder", "member"], world.random.stream("guild"));
    joinOrganization(world, guildId, a1, "elder");
    joinOrganization(world, guildId, b1, "member");

    // A founding belief (shared historical identity) and a real artifact
    // (an institutionally-owned good) both predate the collapse.
    const originEventId = world.events.record({ tick: world.clock.tick, eventType: "plant-burned-out", subjectIds: [a1], location: { x: 3, y: 3, z: 3 } });
    const beliefId = formBelief(world, originEventId, householdA);
    adoptBelief(world, beliefId, householdB);
    const artifact = world.entities.create("good");
    setGood(world.components, artifact, { goodKind: "stone-block", materialId: "stone", massKg: 4 });
    setOwner(world.components, artifact, { ownerType: "institutional", ownerId: guildId });

    const civId = formCivilization(world, [siteA, siteB], [guildId], world.random.stream("civ-name"));
    expect(getCivilization(world.components, civId)!.status).toBe("active");

    // Catastrophe: both member sites' populations die out -- the real
    // collapse condition.
    setSite(world.components, siteA, { ...getSite(world.components, siteA)!, populationCount: 0 });
    setSite(world.components, siteB, { ...getSite(world.components, siteB)!, populationCount: 0 });
    const conditions = collapseConditionsOf(world, civId);
    expect(conditions.collapsed).toBe(true);

    // Collapse: the civilization dissolves -- recorded, never erased.
    const collapsed = tickCivilizations(world);
    expect(collapsed).toContain(civId);
    expect(getCivilization(world.components, civId)!.status).toBe("dissolved");
    const collapseEvent = world.events.eventsOfType("civilization-collapsed")[0]!;
    expect(collapseEvent.objectIds).toContain(civId);

    // Sites persist (real entities with real state -- emptied, but there).
    expect(getSite(world.components, siteA)!.populationCount).toBe(0);
    expect(getSite(world.components, siteB)).toBeDefined();
    // Artifacts persist with their real owners.
    expect(world.entities.isKnown(artifact)).toBe(true);
    expect(getOwner(world.components, artifact)).toEqual({ ownerType: "institutional", ownerId: guildId });
    // Descendants persist: the founders' households' members still exist
    // as entities (a1/a2 survived at the survivor site's scale).
    expect(world.entities.isKnown(a1)).toBe(true);
    expect(world.entities.isKnown(a2)).toBe(true);
    // History persists: the founding, the collapse, everything before.
    expect(world.events.eventsOfType("civilization-founded").length).toBe(1);
    expect(world.events.eventsOfType("civilization-collapsed").length).toBe(1);
    const legacy = civilizationLegacy(world, civId);
    expect(legacy.siteIds.sort()).toEqual([siteA, siteB].sort());
    expect(legacy.assetGoodIds).toContain(artifact);
    expect(legacy.beliefIds).toContain(beliefId);

    // Replacement: a successor civilization rises over the survivor site,
    // inheriting the collapsed civilization's real beliefs and
    // institutions, with the collapse event as its real causal root.
    const c1 = spawnBeaver(world, { name: "C1", position: { x: 3, y: 3, z: 13 } });
    const c2 = spawnBeaver(world, { name: "C2", position: { x: 3, y: 3, z: 14 } });
    const householdC = ensureSharedHousehold(world, c1, c2);
    bindPolityHousehold(world, siteC, householdC);
    signTreaty(world, [siteC, siteA], "alliance");
    signTreaty(world, [siteC, siteB], "alliance");
    joinOrganization(world, guildId, c1, "member");
    const successorId = succeedCivilization(world, civId, [siteC, siteA], world.random.stream("successor-name"));
    expect(getCivilization(world.components, successorId)!.status).toBe("active");
    expect(getCivilization(world.components, successorId)!.successorOfId).toBe(civId);
    const successionEvent = world.events.eventsOfType("civilization-succeeded")[0]!;
    expect(successionEvent.causeEventId).toBe(collapseEvent.id);
    expect(successionEvent.objectIds).toContain(civId);
  });
});
