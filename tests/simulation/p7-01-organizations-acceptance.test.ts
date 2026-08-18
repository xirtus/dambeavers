/**
 * Headless acceptance test for P7-01 -- Organizations.
 *
 * Roadmap acceptance test: "individuals can belong to persistent groups
 * with roles and shared assets."
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
import { setOwner, getOwner } from "../../src/sim/creatures/Ownership.js";
import { setGood } from "../../src/sim/economy/Good.js";
import {
  createOrganization, joinOrganization, setMemberRole, leaveOrganization,
  organizationMembers, memberRole, organizationAssets, transferAssetToOrganization, getOrganization,
} from "../../src/sim/politics/Organization.js";

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
  const random = new RandomStreams(701);
  const events = new EventLog(entities);
  return { clock, random, entities, components, grid, terrain, events, water, weather };
}

function spawn(world: World, name: string, x: number, z: number): EntityId {
  return spawnBeaver(world, { name, position: { x, y: 3, z } });
}

describe("P7-01 -- Organizations", () => {
  it("individuals belong to a persistent group with roles and shared assets", () => {
    const world = buildWorld();
    const alder = spawn(world, "Alder", 5, 5);
    const birch = spawn(world, "Birch", 5, 6);
    const willow = spawn(world, "Willow", 5, 7);

    // A real, permanent organization with data-defined roles.
    const orgId = createOrganization(world, ["leader", "member"], world.random.stream("org-names"), "test guild");
    expect(getOrganization(world.components, orgId)!.roleIds).toEqual(["leader", "member"]);
    expect(world.entities.kindOf(orgId)).toBe("organization");
    expect(world.events.eventsOfType("organization-founded").some((e) => e.subjectIds.includes(orgId))).toBe(true);

    // Individuals belong, with real roles (undeclared roles are rejected).
    joinOrganization(world, orgId, alder, "leader");
    joinOrganization(world, orgId, birch, "member");
    expect(() => joinOrganization(world, orgId, willow, "captain")).toThrow(RangeError);
    expect(organizationMembers(world.components, orgId).sort()).toEqual([alder, birch].sort());
    expect(memberRole(world.components, orgId, alder)).toBe("leader");
    setMemberRole(world, orgId, birch, "leader");
    expect(memberRole(world.components, orgId, birch)).toBe("leader");
    leaveOrganization(world.components, orgId, birch);
    expect(organizationMembers(world.components, orgId)).toEqual([alder]);

    // Shared assets: real goods institutionally owned by the org entity.
    const sharedItem = world.entities.create("good");
    setGood(world.components, sharedItem, { goodKind: "plank", materialId: "wood", massKg: 4 });
    setOwner(world.components, sharedItem, { ownerType: "communal" });
    transferAssetToOrganization(world, orgId, sharedItem);
    expect(organizationAssets(world, orgId)).toEqual([sharedItem]);
    expect(getOwner(world.components, sharedItem)).toEqual({ ownerType: "institutional", ownerId: orgId });

    // Persistence: the group, its members' roles, and its assets survive
    // a full save/reload.
    const restoredMaterials = new MaterialRegistry();
    registerStandardMaterials(restoredMaterials);
    const restored = restoreWorld(JSON.parse(JSON.stringify(snapshotWorld(world))), { componentTypes: ALL_COMPONENT_TYPES, materials: restoredMaterials });
    expect(organizationMembers(restored.components, orgId)).toEqual([alder]);
    expect(memberRole(restored.components, orgId, alder)).toBe("leader");
    expect(organizationAssets(restored, orgId)).toEqual([sharedItem]);
    expect(getOwner(restored.components, sharedItem)).toEqual({ ownerType: "institutional", ownerId: orgId });
  });
});
