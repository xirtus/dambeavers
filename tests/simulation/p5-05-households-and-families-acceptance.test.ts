/**
 * Headless acceptance test for P5-05 -- Households and families.
 *
 * Roadmap acceptance test: "kinship and partnership create persistent
 * household groupings and inheritance hooks."
 *
 * A partnership between two beavers with no shared household forms one
 * automatically (or merges two existing ones) -- the real automatic
 * formation trigger P1-19 deliberately deferred. Household membership is
 * persistent through save/reload, and the inheritance hook orders live
 * members by real relationship closeness (mate/child first).
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
import { spawnBeaver } from "../../src/sim/creatures/Beaver.js";
import { getHouseholdMembership, setRelationshipWith, householdMembers } from "../../src/sim/creatures/Relationships.js";
import { ensureSharedHousehold, inheritingHouseholdMembers } from "../../src/sim/creatures/Household.js";

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
  const random = new RandomStreams(505);
  const events = new EventLog(entities);
  return { clock, random, entities, components, grid, terrain, events, water, weather };
}

function spawn(world: World, name: string, x: number, z: number): EntityId {
  return spawnBeaver(world, { name, position: { x, y: 3, z } });
}

describe("P5-05 -- Households and families", () => {
  it("partnership forms a persistent household, and the inheritance hook orders real heirs", () => {
    const world = buildWorld();
    const a = spawn(world, "ParentA", 6, 6);
    const b = spawn(world, "ParentB", 6, 7);
    expect(getHouseholdMembership(world.components, a)).toBeUndefined();
    expect(getHouseholdMembership(world.components, b)).toBeUndefined();

    const householdId = ensureSharedHousehold(world, a, b);
    expect(getHouseholdMembership(world.components, a)!.householdId).toBe(householdId);
    expect(getHouseholdMembership(world.components, b)!.householdId).toBe(householdId);

    // Merging: a third beaver with their OWN household joins -- the two
    // groups merge into one persistent grouping rather than two rivals.
    const c = spawn(world, "C", 8, 8);
    const d = spawn(world, "D", 8, 9);
    const otherHouseholdId = ensureSharedHousehold(world, c, d);
    ensureSharedHousehold(world, a, c);
    expect(getHouseholdMembership(world.components, a)!.householdId).toBe(getHouseholdMembership(world.components, c)!.householdId);
    expect(householdMembers(world.components, otherHouseholdId)).toHaveLength(0); // the merged-away grouping is emptied

    // Kinship: the inheritance hook orders live members by real closeness.
    setRelationshipWith(world.components, a, { withId: b, kin: "mate", familiarity: 1, affinity: 0.9 });
    setRelationshipWith(world.components, a, { withId: c, kin: "unrelated", familiarity: 0.4, affinity: 0.1 });
    const heirs = inheritingHouseholdMembers(world, a);
    expect(heirs).toContain(b);
    expect(heirs[0]).toBe(b); // the mate is the closest heir

    // Persistence: the household grouping survives full-world save/reload.
    const restoredMaterials = new MaterialRegistry();
    registerStandardMaterials(restoredMaterials);
    const restored = restoreWorld(JSON.parse(JSON.stringify(snapshotWorld(world))), { componentTypes: ALL_COMPONENT_TYPES, materials: restoredMaterials });
    expect(getHouseholdMembership(restored.components, a)).toEqual(getHouseholdMembership(world.components, a));
    expect(getHouseholdMembership(restored.components, b)!.householdId).toBe(getHouseholdMembership(world.components, a)!.householdId);
  });
});
