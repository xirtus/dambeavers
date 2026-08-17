/**
 * Headless acceptance test for P5-12 -- Rules/law baseline.
 *
 * Roadmap acceptance test: "prohibited behavior can be recognized from
 * rule + action facts rather than bespoke crime events."
 *
 * Theft is recognized purely from the rule plus real ACTION FACTS -- the
 * actor, the item, and the item's real Owner component -- with no
 * bespoke "TheftEvent" a labor driver must remember to fire. A violation
 * is recorded as a real historical event when it happens.
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
import { setOwner } from "../../src/sim/creatures/Ownership.js";
import { isProhibited, recordViolation } from "../../src/sim/creatures/Law.js";

function buildWorld(): World {
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
  const random = new RandomStreams(512);
  const events = new EventLog(entities);
  return { clock, random, entities, components, grid, terrain, events, water, weather };
}

function spawn(world: World, name: string, x: number, z: number): EntityId {
  return spawnBeaver(world, { name, position: { x, y: 3, z } });
}

describe("P5-12 -- Rules/law baseline", () => {
  it("prohibited behavior is recognized from the rule plus real action facts, not bespoke events", () => {
    const world = buildWorld();
    const owner = spawn(world, "Owner", 13, 13);
    const thief = spawn(world, "Thief", 13, 14);

    // Real action facts: a personally-owned item, a different actor taking it.
    const ownedItem = world.entities.create("good");
    setOwner(world.components, ownedItem, { ownerType: "personal", ownerId: owner });

    // The actor's own item: no violation -- the rule reads the real Owner state.
    expect(isProhibited(world, owner, ownedItem)).toBeUndefined();
    // An unowned item: no violation either.
    const unownedItem = world.entities.create("good");
    expect(isProhibited(world, thief, unownedItem)).toBeUndefined();
    // Someone else's personally-owned item: theft, recognized from facts alone.
    const violation = isProhibited(world, thief, ownedItem);
    expect(violation).toEqual({ action: "theft", actorId: thief, itemId: ownedItem });

    // The violation is recorded as a real historical event -- the fact
    // later systems (reputation, enforcement) react to.
    const violationEventId = recordViolation(world, violation!);
    const violationEvent = world.events.get(violationEventId);
    expect(violationEvent.eventType).toBe("rule-violated");
    expect(violationEvent.subjectIds).toEqual([thief]);
    expect(violationEvent.objectIds).toEqual([ownedItem]);
  });
});
