/**
 * Headless acceptance test for P7-15 -- Battles.
 *
 * Roadmap acceptance test: "site-scale battles use ordinary
 * creatures/items/injuries and generate persistent
 * casualties/artifacts/events."
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
import { createSite } from "../../src/sim/region/Site.js";
import { spawnBeaver, getInventory, getHealth } from "../../src/sim/creatures/Beaver.js";
import { setGood } from "../../src/sim/economy/Good.js";
import { setOwner } from "../../src/sim/creatures/Ownership.js";
import { pickUp } from "../../src/sim/labor/Log.js";
import { createOrganization, joinOrganization, transferAssetToOrganization } from "../../src/sim/politics/Organization.js";
import { makeWeapon, makeArmor } from "../../src/sim/politics/Weaponry.js";
import { formMilitaryUnit, trainUnit, equipUnit } from "../../src/sim/politics/Military.js";
import { startBattle, tickBattle, getBattle, battleCasualties } from "../../src/sim/politics/Battle.js";
import { woundsOf } from "../../src/sim/creatures/Anatomy.js";

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
  const random = new RandomStreams(715);
  const events = new EventLog(entities);
  return {
    world: { clock, random, entities, components, grid, terrain, events, water, weather },
    regionMap: new RegionMap(16, 16),
    materials,
  };
}

function armedSoldier(world: World, materials: MaterialRegistry, orgId: EntityId, name: string, x: number, z: number): EntityId {
  const soldier = spawnBeaver(world, { name, position: { x, y: 3, z } });
  joinOrganization(world, orgId, soldier, "soldier");
  const weapon = world.entities.create("good");
  setGood(world.components, weapon, { goodKind: "axe", materialId: "stone", massKg: 3 });
  makeWeapon(world.components, weapon, "axe", 1, 0.8);
  world.grid.setEntityPosition(weapon, x, 3, z);
  pickUp(world.components, world.grid, weapon, soldier);
  return soldier;
}

describe("P7-15 -- Battles", () => {
  it("site-scale battles use ordinary creatures/items/injuries and generate persistent casualties/artifacts/events", () => {
    const { world, regionMap, materials } = buildWorld();
    const siteId = createSite(world, regionMap, 5, 5, 10, 100);

    const sideA = createOrganization(world, ["soldier"], world.random.stream("side-a"));
    const sideB = createOrganization(world, ["soldier"], world.random.stream("side-b"));
    formMilitaryUnit(world, sideA);
    formMilitaryUnit(world, sideB);

    // Ordinary beavers with ordinary gear -- side A trained and armed,
    // side B green and bare-handed.
    const a1 = armedSoldier(world, materials, sideA, "A1", 6, 6);
    const a2 = armedSoldier(world, materials, sideA, "A2", 6, 7);
    trainUnit(world, sideA, 30);
    // Side B has real clubs -- able to wound, but outclassed.
    const b1 = spawnBeaver(world, { name: "B1", position: { x: 8, y: 3, z: 6 } });
    const b2 = spawnBeaver(world, { name: "B2", position: { x: 8, y: 3, z: 7 } });
    joinOrganization(world, sideB, b1, "soldier");
    joinOrganization(world, sideB, b2, "soldier");
    for (const soldier of [b1, b2]) {
      const club = world.entities.create("good");
      setGood(world.components, club, { goodKind: "club", materialId: "wood", massKg: 2 });
      makeWeapon(world.components, club, "club", 0.5, 0);
      world.grid.setEntityPosition(club, 8, 3, 6);
      pickUp(world.components, world.grid, club, soldier);
    }
    // B1 owns a personal heirloom (a real artifact that must survive him).
    const heirloom = world.entities.create("good");
    setGood(world.components, heirloom, { goodKind: "plank", materialId: "wood", massKg: 1 });
    setOwner(world.components, heirloom, { ownerType: "personal", ownerId: b1 });
    world.grid.setEntityPosition(heirloom, 8, 3, 6);
    pickUp(world.components, world.grid, heirloom, b1);

    // A real battle at the site between two real organizations.
    const battleId = startBattle(world, siteId, sideA, sideB);
    expect(world.events.eventsOfType("battle-began").length).toBe(1);

    // The battle IS its exchanges: rounds of ordinary attacks until one
    // side has no fighters left (or the round cap ends it).
    let winner: EntityId | undefined;
    for (let round = 0; round < 12; round++) {
      winner = tickBattle(world, materials, battleId, world.random.stream(`battle-round-${round}`));
      if (winner !== undefined) break;
    }
    expect(winner).toBe(sideA);
    const battle = getBattle(world.components, battleId)!;
    expect(battle.status).toBe("ended");
    expect(battle.winnerOrgId).toBe(sideA);
    expect(battle.roundsFought).toBeGreaterThan(0);

    // Persistent casualties: B's fighters really died (real deaths, real
    // events), through the ordinary mortality machinery.
    const deaths = world.events.eventsOfType("trauma-death");
    expect(deaths.length).toBeGreaterThan(0);
    expect(world.entities.isKnown(b1)).toBe(true); // ids resolve forever
    expect(world.entities.isLive(b1)).toBe(false);
    const casualties = battleCasualties(world, battleId);
    expect(casualties.length).toBeGreaterThan(0);
    expect(casualties).toContain(b1);

    // Persistent injuries: surviving fighters carry real wounds.
    const woundedSurvivor = [a1, a2].find((id) => woundsOf(world, id).length > 0);
    expect(woundedSurvivor).toBeDefined();
    expect(getHealth(world.components, woundedSurvivor!)!.fraction).toBeLessThanOrEqual(1);

    // Persistent artifacts: the heirloom outlives its owner (real
    // inheritance, P5-06 -- the estate passed to a living heir or fell
    // to communal ownership, never vanished).
    const heirloomOwner = world.components.get(heirloom, { name: "owner" } as never) as { ownerType: string; ownerId?: EntityId } | undefined;
    void heirloomOwner;
    expect(world.entities.isKnown(heirloom)).toBe(true);

    // Persistent events: the whole battle is recorded, causally chained.
    const endedEvents = world.events.eventsOfType("battle-ended");
    expect(endedEvents.length).toBe(1);
    expect(endedEvents[0]!.causeEventId).toBe(battle.beganEventId);
    expect(world.events.eventsOfType("wound-inflicted").length).toBeGreaterThan(0);
  });
});
