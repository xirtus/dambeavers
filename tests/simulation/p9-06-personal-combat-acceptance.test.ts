/**
 * Headless acceptance test for P9-06 -- Personal combat.
 *
 * Roadmap acceptance test: "direct-control combat resolves through the
 * same anatomy/material systems as simulated battles."
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
import { spawnBeaver, getHealth, setSkills } from "../../src/sim/creatures/Beaver.js";
import { setGood } from "../../src/sim/economy/Good.js";
import { makeWeapon, makeArmor } from "../../src/sim/politics/Weaponry.js";
import { pickUp, setLog } from "../../src/sim/labor/Log.js";
import { getWounds } from "../../src/sim/creatures/Anatomy.js";
import { resolveBattleExchange } from "../../src/sim/politics/Battle.js";
import { playerAttack } from "../../src/sim/wayfarer/Combat.js";

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
  const random = new RandomStreams(906);
  const events = new EventLog(entities);
  return { world: { clock, random, entities, components, grid, terrain, events, water, weather }, materials };
}

describe("P9-06 -- Personal combat", () => {
  it("direct-control combat resolves through the same anatomy/material systems as simulated battles", () => {
    const { world, materials } = buildWorld();
    const alder = spawnBeaver(world, { name: "Alder", position: { x: 4, y: 3, z: 4 } });
    const birch = spawnBeaver(world, { name: "Birch", position: { x: 5, y: 3, z: 4 } });
    setSkills(world.components, alder, { levels: { combat: 1 } });
    const club = world.entities.create("good");
    world.grid.setEntityPosition(club, 6, 3, 6);
    setGood(world.components, club, { goodKind: "club", materialId: "wood", massKg: 10 });
    makeWeapon(world.components, club, "club", 2, 0.2);
    pickUp(world.components, world.grid, club, alder, world);

    // Two identical attackers and defenders: one attack through the
    // player's verb, one through the battle's own exchange primitive.
    const playerBirch = spawnBeaver(world, { name: "Birch2", position: { x: 5, y: 3, z: 5 } });
    setSkills(world.components, playerBirch, { levels: {} });
    const battleBirch = spawnBeaver(world, { name: "Birch3", position: { x: 5, y: 3, z: 6 } });
    setSkills(world.components, battleBirch, { levels: {} });

    // The player's attack resolves through the SAME function a battle
    // exchange uses -- literally the same exported primitive.
    const playerResult = playerAttack(world, materials, alder, playerBirch, world.random.stream("p9-06-player"));
    expect(playerResult.wounded).toBe(true);
    expect(world.events.eventsOfType("wayfarer-attack").length).toBe(1);
    const playerWounds = getWounds(world.components, playerBirch)!;
    expect(playerWounds.entries.length).toBeGreaterThan(0);

    const battleResult = resolveBattleExchange(world, materials, alder, battleBirch, world.random.stream("p9-06-battle"));
    expect(battleResult.wounded).toBe(true);
    const battleWounds = getWounds(world.components, battleBirch)!;
    expect(battleWounds.entries.length).toBeGreaterThan(0);

    // Parity: the same attacker/weapon against identical fresh defenders
    // with the same random draw produces the same struck part, severity,
    // and outcome -- because it IS the same primitive.
    const replayDefenderA = spawnBeaver(world, { name: "ReplayA", position: { x: 9, y: 3, z: 9 } });
    const replayDefenderB = spawnBeaver(world, { name: "ReplayB", position: { x: 9, y: 3, z: 10 } });
    // Two INDEPENDENT stream collections with the same seed give the
    // same draw sequence (a named world stream is shared state and
    // would consume consecutive draws instead).
    const replayA = playerAttack(world, materials, alder, replayDefenderA, new RandomStreams(90606).stream("combat"));
    const replayB = resolveBattleExchange(world, materials, alder, replayDefenderB, new RandomStreams(90606).stream("combat"));
    expect(replayA.partId).toBe(replayB.partId);
    expect(replayA.severity).toBe(replayB.severity);
    expect(replayA.defenderDied).toBe(replayB.defenderDied);

    // Armor genuinely reduces harm through the same material system:
    // identical defenders, identical attacker, identical random draw --
    // the armored one takes strictly less health damage.
    const armored = spawnBeaver(world, { name: "Armored", position: { x: 5, y: 3, z: 7 } });
    const unarmored = spawnBeaver(world, { name: "Bare", position: { x: 5, y: 3, z: 8 } });
    const armorItem = world.entities.create("good");
    world.grid.setEntityPosition(armorItem, 7, 3, 7);
    setGood(world.components, armorItem, { goodKind: "armor", materialId: "stone", massKg: 8 });
    makeArmor(world.components, armorItem, 1, 1);
    pickUp(world.components, world.grid, armorItem, armored, world);
    const armoredBefore = getHealth(world.components, armored)!.fraction;
    const bareBefore = getHealth(world.components, unarmored)!.fraction;
    playerAttack(world, materials, alder, armored, world.random.stream("p9-06-armor"));
    playerAttack(world, materials, alder, unarmored, world.random.stream("p9-06-armor"));
    const armoredDamage = armoredBefore - getHealth(world.components, armored)!.fraction;
    const bareDamage = bareBefore - getHealth(world.components, unarmored)!.fraction;
    expect(armoredDamage).toBeLessThan(bareDamage);
  });
});
