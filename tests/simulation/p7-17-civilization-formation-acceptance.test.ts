/**
 * Headless acceptance test for P7-17 -- Civilization formation.
 *
 * Roadmap acceptance test: "multiple settlements can form a durable
 * civilization with institutions and shared historical identity."
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
import { createSite } from "../../src/sim/region/Site.js";
import { spawnBeaver } from "../../src/sim/creatures/Beaver.js";
import { ensureSharedHousehold } from "../../src/sim/creatures/Household.js";
import { establishPolity, bindPolityHousehold } from "../../src/sim/politics/PoliticalEntity.js";
import { signTreaty } from "../../src/sim/politics/Diplomacy.js";
import { createOrganization, joinOrganization } from "../../src/sim/politics/Organization.js";
import { formBelief, beliefsOf, adoptBelief } from "../../src/sim/creatures/Belief.js";
import {
  canFormCivilization, formCivilization, getCivilization, civilizationSharedIdentity, civilizationMemberSites,
} from "../../src/sim/politics/Civilization.js";
import { nameOf } from "../../src/sim/creatures/Naming.js";

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
  const random = new RandomStreams(717);
  const events = new EventLog(entities);
  return {
    world: { clock, random, entities, components, grid, terrain, events, water, weather },
    regionMap: new RegionMap(16, 16),
  };
}

describe("P7-17 -- Civilization formation", () => {
  it("multiple settlements form a durable civilization with institutions and shared historical identity", () => {
    const { world, regionMap } = buildWorld();
    const siteA = createSite(world, regionMap, 2, 2, 5, 100);
    const siteB = createSite(world, regionMap, 10, 10, 5, 100);
    const siteC = createSite(world, regionMap, 2, 12, 5, 100);
    establishPolity(world, siteA);
    establishPolity(world, siteB);
    establishPolity(world, siteC);

    // Real households at two of the sites.
    const a1 = spawnBeaver(world, { name: "A1", position: { x: 3, y: 3, z: 3 } });
    const a2 = spawnBeaver(world, { name: "A2", position: { x: 3, y: 3, z: 4 } });
    const householdA = ensureSharedHousehold(world, a1, a2);
    bindPolityHousehold(world, siteA, householdA);
    const b1 = spawnBeaver(world, { name: "B1", position: { x: 11, y: 3, z: 11 } });
    const b2 = spawnBeaver(world, { name: "B2", position: { x: 11, y: 3, z: 12 } });
    const householdB = ensureSharedHousehold(world, b1, b2);
    bindPolityHousehold(world, siteB, householdB);

    // Real relations: an alliance between the two founders.
    signTreaty(world, [siteA, siteB], "alliance");

    // Without a real shared bond, formation is genuinely impossible.
    expect(canFormCivilization(world, [siteA, siteB])).toBe(false);

    // A real shared institution: one organization spanning both
    // settlements' households.
    const guildId = createOrganization(world, ["elder", "member"], world.random.stream("guild"));
    joinOrganization(world, guildId, a1, "elder");
    joinOrganization(world, guildId, b1, "member");
    expect(canFormCivilization(world, [siteA, siteB])).toBe(true);

    // Formation: a real, named, durable entity with real institutions.
    const civId = formCivilization(world, [siteA, siteB], [guildId], world.random.stream("civ-name"));
    const civ = getCivilization(world.components, civId)!;
    expect(civ.status).toBe("active");
    expect([...civ.memberSiteIds].sort()).toEqual([siteA, siteB].sort());
    expect(civ.institutionOrgIds).toEqual([guildId]);
    expect(nameOf(world, civId)).toBeTruthy();
    expect(civilizationMemberSites(world, civId).sort()).toEqual([siteA, siteB].sort());
    const founded = world.events.eventsOfType("civilization-founded")[0]!;
    expect(founded.subjectIds).toContain(siteA);
    expect(founded.subjectIds).toContain(siteB);

    // Shared historical identity: a real belief founded on a real
    // recorded event, held by both households, becomes the founding
    // identity -- and its ORIGIN event is the civilization's causal root.
    const originEventId = world.events.record({ tick: world.clock.tick, eventType: "plant-burned-out", subjectIds: [a1], location: { x: 3, y: 3, z: 3 } });
    const beliefId = formBelief(world, originEventId, householdA);
    adoptBelief(world, beliefId, householdB);
    expect(beliefsOf(world, householdA)).toContain(beliefId);
    expect(beliefsOf(world, householdB)).toContain(beliefId);
    expect(canFormCivilization(world, [siteA, siteB])).toBe(true); // still true
    const civ2Id = formCivilization(world, [siteA, siteB], [guildId], world.random.stream("civ2-name"));
    expect(civilizationSharedIdentity(world, civ2Id)).toBe(beliefId);
    const founded2 = world.events.eventsOfType("civilization-founded")[1]!;
    expect(founded2.causeEventId).toBe(originEventId);

    // Durability: the civilization survives save/reload intact.
    const restoredMaterials = new MaterialRegistry();
    registerStandardMaterials(restoredMaterials);
    const restored = restoreWorld(JSON.parse(JSON.stringify(snapshotWorld(world))), { componentTypes: ALL_COMPONENT_TYPES, materials: restoredMaterials });
    expect(getCivilization(restored.components, civId)!.status).toBe("active");
    expect(civilizationSharedIdentity(restored, civ2Id)).toBe(beliefId);
  });
});
