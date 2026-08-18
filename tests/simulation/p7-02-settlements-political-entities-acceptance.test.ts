/**
 * Headless acceptance test for P7-02 -- Settlements as political entities.
 *
 * Roadmap acceptance test: "a settlement has leadership, population,
 * territory claims, resources, and diplomatic identity."
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
import { spawnBeaver } from "../../src/sim/creatures/Beaver.js";
import { ensureSharedHousehold } from "../../src/sim/creatures/Household.js";
import { setOwner } from "../../src/sim/creatures/Ownership.js";
import { setGood } from "../../src/sim/economy/Good.js";
import {
  establishPolity, getPoliticalEntity, polityPopulation, polityResources,
  polityTerritory, polityDiplomaticIdentity, polityName, polityLeader,
  bindPolityHousehold,
} from "../../src/sim/politics/PoliticalEntity.js";
import { claimTerritory } from "../../src/sim/politics/Territory.js";
import { selectInitialLeader } from "../../src/sim/politics/Government.js";

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
  const random = new RandomStreams(702);
  const events = new EventLog(entities);
  return {
    world: { clock, random, entities, components, grid, terrain, events, water, weather },
    regionMap: new RegionMap(16, 16),
  };
}

describe("P7-02 -- Settlements as political entities", () => {
  it("a settlement has leadership, population, territory claims, resources, and diplomatic identity", () => {
    const { world, regionMap } = buildWorld();

    const siteA = createSite(world, regionMap, 3, 4, 8, 120);
    const siteB = createSite(world, regionMap, 10, 11, 5, 40);
    establishPolity(world, siteA);
    establishPolity(world, siteB);

    // Leadership: real members, a real household, a real appointed leader.
    const alder = spawnBeaver(world, { name: "Alder", position: { x: 5, y: 3, z: 5 } });
    const birch = spawnBeaver(world, { name: "Birch", position: { x: 5, y: 3, z: 6 } });
    const householdId = ensureSharedHousehold(world, alder, birch);
    bindPolityHousehold(world, siteA, householdId);
    expect(getPoliticalEntity(world.components, siteA)!.householdId).toBe(householdId);
    expect(getSite(world.components, siteA)!.householdId).toBe(householdId);
    expect(selectInitialLeader(world, siteA)).toBeDefined();
    expect(polityLeader(world, siteA)).toBeDefined();

    // Population: the site's own real count.
    expect(polityPopulation(world, siteA)).toBe(8);

    // Territory claims: real claim entities over real region cells.
    const claimId = claimTerritory(world, regionMap, siteA, 1);
    expect(getPoliticalEntity(world.components, siteA)!.territoryClaimIds).toEqual([claimId]);
    expect(polityTerritory(world, siteA).length).toBe(9); // 3x3 radius-1 block

    // Resources: stored food + institutionally-owned goods.
    const ownedGood = world.entities.create("good");
    setGood(world.components, ownedGood, { goodKind: "plank", materialId: "wood", massKg: 5 });
    setOwner(world.components, ownedGood, { ownerType: "institutional", ownerId: siteA });
    const resources = polityResources(world, siteA);
    expect(resources.storedFoodKg).toBe(120);
    expect(resources.goodIds).toContain(ownedGood);
    expect(resources.goodMassKg).toBeCloseTo(5);

    // Diplomatic identity: a name plus real standings toward every other polity.
    expect(polityName(world, siteA)).toBeTruthy();
    const identity = polityDiplomaticIdentity(world, siteA);
    expect(identity.map((row) => row.targetSiteId)).toEqual([siteB]);

    // Persistence: the whole political entity survives save/reload.
    const restoredMaterials = new MaterialRegistry();
    registerStandardMaterials(restoredMaterials);
    const restored = restoreWorld(JSON.parse(JSON.stringify(snapshotWorld(world))), { componentTypes: ALL_COMPONENT_TYPES, materials: restoredMaterials });
    expect(getPoliticalEntity(restored.components, siteA)!.householdId).toBe(householdId);
    expect(polityPopulation(restored, siteA)).toBe(8);
    expect(polityResources(restored, siteA).storedFoodKg).toBe(120);
  });
});
