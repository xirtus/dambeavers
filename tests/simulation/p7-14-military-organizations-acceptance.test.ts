/**
 * Headless acceptance test for P7-14 -- Military organizations.
 *
 * Roadmap acceptance test: "units can train, equip, organize, and
 * receive mission objectives without separate combat-only creature
 * models."
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
import { spawnBeaver, getInventory } from "../../src/sim/creatures/Beaver.js";
import { setGood } from "../../src/sim/economy/Good.js";
import { createOrganization, joinOrganization, transferAssetToOrganization, organizationMembers } from "../../src/sim/politics/Organization.js";
import { makeWeapon, makeArmor } from "../../src/sim/politics/Weaponry.js";
import {
  formMilitaryUnit, trainUnit, equipUnit, assignMission, unitStrength, getMilitaryUnit, clearMission,
} from "../../src/sim/politics/Military.js";
import { skillLevel } from "../../src/sim/creatures/SkillProgression.js";

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
  const random = new RandomStreams(714);
  const events = new EventLog(entities);
  return {
    world: { clock, random, entities, components, grid, terrain, events, water, weather },
    regionMap: new RegionMap(16, 16),
    materials,
  };
}

describe("P7-14 -- Military organizations", () => {
  it("units train, equip, organize, and receive objectives without separate combat-only creature models", () => {
    const { world, regionMap, materials } = buildWorld();
    const homeSite = createSite(world, regionMap, 3, 3, 5, 100);
    const targetSite = createSite(world, regionMap, 10, 10, 5, 100);

    // The unit IS an ordinary organization of ordinary beavers -- the
    // very same entities, no combat-only creature model anywhere.
    const unitId = createOrganization(world, ["commander", "soldier"], world.random.stream("unit-name"));
    formMilitaryUnit(world, unitId);
    const commander = spawnBeaver(world, { name: "Commander", position: { x: 4, y: 3, z: 4 } });
    const soldierA = spawnBeaver(world, { name: "SoldierA", position: { x: 4, y: 3, z: 5 } });
    const soldierB = spawnBeaver(world, { name: "SoldierB", position: { x: 4, y: 3, z: 6 } });
    joinOrganization(world, unitId, commander, "commander");
    joinOrganization(world, unitId, soldierA, "soldier");
    joinOrganization(world, unitId, soldierB, "soldier");
    expect(organizationMembers(world.components, unitId).sort()).toEqual([commander, soldierA, soldierB].sort());

    // Training practices the same real skill system as every other labor.
    expect(skillLevel(world.components, soldierA, "combat")).toBe(0);
    trainUnit(world, unitId, 5);
    expect(skillLevel(world.components, soldierA, "combat")).toBeGreaterThan(0);
    expect(getMilitaryUnit(world.components, unitId)!.trainedTick).toBeDefined();
    expect(unitStrength(world, materials, unitId)).toBeGreaterThan(3);

    // Equipping issues the organization's own shared assets into member
    // inventories -- real items, still institutionally owned.
    const weapon = world.entities.create("good");
    setGood(world.components, weapon, { goodKind: "axe", materialId: "stone", massKg: 3 });
    makeWeapon(world.components, weapon, "axe", 1, 0.8);
    const armor = world.entities.create("good");
    setGood(world.components, armor, { goodKind: "armor", materialId: "stone", massKg: 3 });
    makeArmor(world.components, armor, 1, 2);
    transferAssetToOrganization(world, unitId, weapon);
    transferAssetToOrganization(world, unitId, armor);
    equipUnit(world, unitId);
    const equipped = [soldierA, soldierB].filter((id) => {
      const inventory = getInventory(world.components, id)!;
      return inventory.itemIds.includes(weapon) || inventory.itemIds.includes(armor);
    });
    expect(equipped.length).toBeGreaterThan(0);
    expect(unitStrength(world, materials, unitId)).toBeGreaterThan(3);

    // Objectives are real, recorded data assignments from a real commander.
    assignMission(world, unitId, "raid", commander, targetSite);
    const mission = getMilitaryUnit(world.components, unitId)!.objective!;
    expect(mission.kind).toBe("raid");
    expect(mission.targetSiteId).toBe(targetSite);
    expect(world.events.eventsOfType("mission-assigned").length).toBe(1);
    expect(world.events.eventsOfType("mission-assigned")[0]!.subjectIds).toContain(unitId);

    clearMission(world, unitId);
    expect(getMilitaryUnit(world.components, unitId)!.objective).toBeUndefined();
  });
});
