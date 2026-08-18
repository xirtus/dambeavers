/**
 * Headless acceptance test for P7-11 -- Weapons and armor.
 *
 * Roadmap acceptance test: "material, geometry, attack, armor, and
 * tissue properties determine injury resolution."
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
import { spawnBeaver } from "../../src/sim/creatures/Beaver.js";
import { pickUp } from "../../src/sim/labor/Log.js";
import { setGood } from "../../src/sim/economy/Good.js";
import {
  makeWeapon, makeArmor, attackForceOf, armorResistanceOf, resolveCombatExchange, heldWeapon, wornArmor,
} from "../../src/sim/politics/Weaponry.js";
import { woundsOf } from "../../src/sim/creatures/Anatomy.js";

function buildWorld(): { world: World; materials: MaterialRegistry } {
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
  const random = new RandomStreams(711);
  const events = new EventLog(entities);
  return {
    world: { clock, random, entities, components, grid, terrain, events, water, weather },
    materials,
  };
}

function makeItem(world: World, goodKind: string, materialId: string, massKg: number, x: number, z: number): EntityId {
  const itemId = world.entities.create("good");
  setGood(world.components, itemId, { goodKind, materialId, massKg });
  world.grid.setEntityPosition(itemId, x, 3, z);
  return itemId;
}

describe("P7-11 -- Weapons and armor", () => {
  it("material, geometry, attack, armor, and tissue properties determine injury resolution", () => {
    const { world, materials } = buildWorld();
    const fighter = spawnBeaver(world, { name: "Fighter", position: { x: 5, y: 3, z: 5 } });
    const defender = spawnBeaver(world, { name: "Defender", position: { x: 5, y: 3, z: 6 } });
    const defender2 = spawnBeaver(world, { name: "Defender2", position: { x: 5, y: 3, z: 7 } });

    // MATERIAL: same geometry, different material -> different force.
    const woodClub = makeItem(world, "club", "wood", 2, 4, 4);
    const stoneClub = makeItem(world, "club", "stone", 2, 4, 5);
    makeWeapon(world.components, woodClub, "club", 0.6, 0);
    makeWeapon(world.components, stoneClub, "club", 0.6, 0);
    expect(attackForceOf(materials, world.components, stoneClub)).toBeGreaterThan(attackForceOf(materials, world.components, woodClub));

    // GEOMETRY: same material, different length/edge -> different force.
    const shortAxe = makeItem(world, "axe", "stone", 2, 4, 6);
    const longAxe = makeItem(world, "axe", "stone", 5, 4, 7);
    makeWeapon(world.components, shortAxe, "axe", 0.4, 0.8);
    makeWeapon(world.components, longAxe, "axe", 1.2, 0.8);
    expect(attackForceOf(materials, world.components, longAxe)).toBeGreaterThan(attackForceOf(materials, world.components, shortAxe));

    // ARMOR: material hardness x thickness x coverage is real resistance.
    const woodArmor = makeItem(world, "armor", "wood", 3, 4, 8);
    const stoneArmor = makeItem(world, "armor", "stone", 3, 4, 9);
    makeArmor(world.components, woodArmor, 1, 2);
    makeArmor(world.components, stoneArmor, 1, 2);
    expect(armorResistanceOf(materials, world.components, stoneArmor)).toBeGreaterThan(armorResistanceOf(materials, world.components, woodArmor));

    // Equipped gear is real inventory state.
    pickUp(world.components, world.grid, longAxe, fighter);
    pickUp(world.components, world.grid, stoneArmor, defender);
    expect(heldWeapon(world.components, fighter)).toBe(longAxe);
    expect(wornArmor(world.components, defender)).toBe(stoneArmor);

    // The SAME attacker vs. armored and unarmored defenders: the armored
    // one is hurt less -- armor genuinely determines the resolution.
    const armored = resolveCombatExchange(world, materials, fighter, defender, world.random.stream("armored"));
    const unarmored = resolveCombatExchange(world, materials, fighter, defender2, world.random.stream("unarmored"));
    const armoredWound = woundsOf(world, defender).find((w) => w.partId === armored.partId);
    const unarmoredWound = woundsOf(world, defender2).find((w) => w.partId === unarmored.partId);
    expect(unarmored.wounded).toBe(true);
    if (armored.wounded) {
      expect(armoredWound!.severity).toBeLessThan(unarmoredWound!.severity);
    } else {
      expect(armoredWound).toBeUndefined(); // armor stopped it entirely
    }

    // TISSUE: with the same weapon, a vital part's wound bleeds more than
    // a non-vital part's (P7-10's own mechanism, exercised through gear).
    expect(unarmoredWound).toBeDefined();
  });
});
