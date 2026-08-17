/**
 * Headless acceptance test for P5-06 -- Ownership.
 *
 * Roadmap acceptance test: "items/rooms can be personally, household,
 * institutional, or communally owned."
 *
 * `Owner` is a generic component over any item/room entity kind with all
 * four ownership forms. `bequeathEstate` is the real inheritance
 * consumer: a deceased beaver's personal items transfer to the closest
 * living heir, or become communal when no heir exists -- an estate never
 * silently vanishes.
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
import { setRelationshipWith } from "../../src/sim/creatures/Relationships.js";
import { ensureSharedHousehold } from "../../src/sim/creatures/Household.js";
import { setOwner, getOwner, isOwnedBy, bequeathEstate } from "../../src/sim/creatures/Ownership.js";

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
  const random = new RandomStreams(506);
  const events = new EventLog(entities);
  return { clock, random, entities, components, grid, terrain, events, water, weather };
}

function spawn(world: World, name: string, x: number, z: number): EntityId {
  return spawnBeaver(world, { name, position: { x, y: 3, z } });
}

describe("P5-06 -- Ownership", () => {
  it("items can be personally, household, institutionally, or communally owned, and estates are bequeathed", () => {
    const world = buildWorld();
    const owner = spawn(world, "Owner", 7, 7);
    const heir = spawn(world, "Heir", 7, 8);

    // All four ownership forms on real entities.
    const personalItem = world.entities.create("good");
    setOwner(world.components, personalItem, { ownerType: "personal", ownerId: owner });
    const householdItem = world.entities.create("good");
    const householdId = ensureSharedHousehold(world, owner, heir);
    setOwner(world.components, householdItem, { ownerType: "household", ownerId: householdId });
    const institutionalItem = world.entities.create("zone");
    setOwner(world.components, institutionalItem, { ownerType: "institutional", ownerId: householdId });
    const communalItem = world.entities.create("good");
    setOwner(world.components, communalItem, { ownerType: "communal" });

    expect(getOwner(world.components, personalItem)!.ownerType).toBe("personal");
    expect(getOwner(world.components, householdItem)!.ownerType).toBe("household");
    expect(getOwner(world.components, institutionalItem)!.ownerType).toBe("institutional");
    expect(getOwner(world.components, communalItem)!.ownerType).toBe("communal");
    expect(isOwnedBy(world.components, personalItem, owner)).toBe(true);
    expect(isOwnedBy(world.components, personalItem, heir)).toBe(false);

    // Bequest: the deceased's personal items transfer to the closest living
    // heir (their mate), never silently vanishing.
    setRelationshipWith(world.components, owner, { withId: heir, kin: "mate", familiarity: 1, affinity: 0.9 });
    setRelationshipWith(world.components, heir, { withId: owner, kin: "mate", familiarity: 1, affinity: 0.9 });
    const transferred = bequeathEstate(world, owner);
    expect(transferred).toContain(personalItem);
    expect(getOwner(world.components, personalItem)).toEqual({ ownerType: "personal", ownerId: heir });

    // No heir: the estate becomes communal -- an honest outcome, still real.
    const loneOwner = spawn(world, "Lone", 9, 9);
    const loneItem = world.entities.create("good");
    setOwner(world.components, loneItem, { ownerType: "personal", ownerId: loneOwner });
    bequeathEstate(world, loneOwner);
    expect(getOwner(world.components, loneItem)!.ownerType).toBe("communal");
  });
});
