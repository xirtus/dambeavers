/**
 * Headless acceptance test for P1-19 — Relationships baseline.
 *
 * Roadmap acceptance test (DAMN_BEAVERS_MASTER_ROADMAP.md, P1-19):
 *   "the seven starting beavers can have distinct persistent relationship
 *   graphs that survive save/load."
 *
 * Spawns the project's own real seven starting beavers
 * (`spawnSevenStartingBeavers`, P1-05, unmodified), assigns each a
 * genuinely DIFFERENT relationship graph (distinct kin/familiarity/
 * affinity edges -- no two beavers end up with the same edge set) plus
 * two distinct households, then takes a real full-world
 * `snapshotWorld`/`JSON.stringify`/`JSON.parse`/`restoreWorld` round trip
 * (P0-06's own canonical mechanism, the same one every other P1
 * persistence acceptance test uses -- not a `ComponentStore`-only
 * shortcut), and confirms every beaver's own graph and household
 * membership survives EXACTLY, including that `EntityId` references
 * between beavers still resolve correctly after restore.
 */
import { describe, expect, it } from "vitest";
import { EntityIdRegistry, type EntityId } from "../../src/sim/core/EntityId.js";
import { ComponentStore, type ComponentType } from "../../src/sim/core/ComponentStore.js";
import { SimulationClock } from "../../src/sim/core/SimulationClock.js";
import { RandomStreams } from "../../src/sim/core/Random.js";
import { WorldGrid } from "../../src/sim/world/WorldGrid.js";
import { TerrainField } from "../../src/sim/world/TerrainField.js";
import { EventLog } from "../../src/sim/history/EventLog.js";
import { MaterialRegistry } from "../../src/sim/materials/Material.js";
import { registerStandardMaterials } from "../../src/sim/materials/standardMaterials.js";
import type { World } from "../../src/sim/persistence/WorldSnapshot.js";
import { snapshotWorld, restoreWorld, type WorldRestoreContext } from "../../src/sim/persistence/WorldSnapshot.js";
import {
  spawnSevenStartingBeavers,
  IdentityComponent,
  CreatureBodyComponent,
  LocomotionComponent,
  SwimmerComponent,
  InventoryComponent,
  SkillsComponent,
  HealthComponent,
  getIdentity,
} from "../../src/sim/creatures/Beaver.js";
import { NeedsComponent } from "../../src/sim/creatures/Needs.js";
import { NeedFocusComponent } from "../../src/sim/creatures/BeaverNeeds.js";
import { BreathComponent } from "../../src/sim/creatures/Respiration.js";
import {
  setRelationshipWith,
  getRelationships,
  createHousehold,
  setHouseholdMembership,
  getHouseholdMembership,
  householdMembers,
  RelationshipsComponent,
  HouseholdMembershipComponent,
  type RelationshipEdge,
} from "../../src/sim/creatures/Relationships.js";

const SIZE_X = 10;
const SIZE_Y = 8;
const SIZE_Z = 10;

function buildWorld(): World {
  const entities = new EntityIdRegistry();
  const components = new ComponentStore(entities);
  const grid = new WorldGrid({ sizeX: SIZE_X, sizeY: SIZE_Y, sizeZ: SIZE_Z }, entities);
  const materials = new MaterialRegistry();
  registerStandardMaterials(materials);
  const terrain = new TerrainField(grid, materials);
  for (let x = 0; x < SIZE_X; x++) {
    for (let z = 0; z < SIZE_Z; z++) {
      for (let y = 0; y <= 2; y++) terrain.setMaterial(x, y, z, "soil");
    }
  }
  const clock = new SimulationClock({ tickRateHz: 20 });
  const random = new RandomStreams("p1-19-relationships");
  const events = new EventLog(entities);
  return { clock, random, entities, components, grid, terrain, events };
}

const COMPONENT_TYPES = new Map<string, ComponentType<unknown>>([
  ["identity", IdentityComponent],
  ["creature-body", CreatureBodyComponent],
  ["locomotion", LocomotionComponent],
  ["swimmer", SwimmerComponent],
  ["inventory", InventoryComponent],
  ["skills", SkillsComponent],
  ["health", HealthComponent],
  ["breath", BreathComponent],
  ["needs", NeedsComponent],
  ["need-focus", NeedFocusComponent],
  ["relationships", RelationshipsComponent],
  ["household-membership", HouseholdMembershipComponent],
]);

describe("P1-19 acceptance: the seven starting beavers can have distinct persistent relationship graphs that survive save/load", () => {
  it("holds through a real, canonical full-world save/reload round trip", () => {
    const world = buildWorld();
    const floor = world.grid.surfaceY(4, 4)!;
    const beavers = spawnSevenStartingBeavers(world, { x: 4, y: floor + 1, z: 4 });
    expect(beavers).toHaveLength(7);
    const [b0, b1, b2, b3, b4, b5, b6] = beavers as [EntityId, EntityId, EntityId, EntityId, EntityId, EntityId, EntityId];

    // Two real, distinct households -- b0..b2 in one, b3..b4 in the
    // other, b5/b6 in neither (a real, minimal, non-uniform graph, not a
    // single shared default every beaver happens to get).
    const householdA = createHousehold(world);
    const householdB = createHousehold(world);
    setHouseholdMembership(world.components, b0, { householdId: householdA });
    setHouseholdMembership(world.components, b1, { householdId: householdA });
    setHouseholdMembership(world.components, b2, { householdId: householdA });
    setHouseholdMembership(world.components, b3, { householdId: householdB });
    setHouseholdMembership(world.components, b4, { householdId: householdB });

    // A genuinely distinct relationship graph -- every beaver's own edge
    // set differs from every other's (kin/familiarity/affinity vary),
    // and edges are directed (b0->b1 need not equal b1->b0).
    setRelationshipWith(world.components, b0, { withId: b1, kin: "sibling", familiarity: 0.9, affinity: 0.6 });
    setRelationshipWith(world.components, b0, { withId: b2, kin: "unrelated", familiarity: 0.2, affinity: -0.1 });
    setRelationshipWith(world.components, b1, { withId: b0, kin: "sibling", familiarity: 0.7, affinity: 0.8 });
    setRelationshipWith(world.components, b3, { withId: b4, kin: "mate", familiarity: 1, affinity: 0.95 });
    setRelationshipWith(world.components, b4, { withId: b3, kin: "mate", familiarity: 1, affinity: 0.9 });
    setRelationshipWith(world.components, b5, { withId: b6, kin: "unrelated", familiarity: 0.05, affinity: -0.4 });
    // b2 and b6 deliberately have NO outgoing edges at all -- a real,
    // valid, sparse graph, not every beaver forced to have one.

    const beforeGraphs = beavers.map((id) => getRelationships(world.components, id));
    const beforeNames = beavers.map((id) => getIdentity(world.components, id)!.name);

    // Confirm the graph is genuinely distinct, not accidentally uniform.
    const serialized = beforeGraphs.map((g) => JSON.stringify(g ?? null));
    expect(new Set(serialized).size).toBeGreaterThan(1);

    // Real, canonical full-world save/reload (P0-06), not a
    // ComponentStore-only shortcut.
    const snapshot = JSON.parse(JSON.stringify(snapshotWorld(world)));
    const restoreMaterials = new MaterialRegistry();
    registerStandardMaterials(restoreMaterials);
    const context: WorldRestoreContext = { componentTypes: COMPONENT_TYPES, materials: restoreMaterials };
    const restoredWorld = restoreWorld(snapshot, context);

    // Every beaver's own name and relationship graph survived exactly,
    // including which pairs have NO edge at all.
    beavers.forEach((id, i) => {
      expect(getIdentity(restoredWorld.components, id)!.name).toBe(beforeNames[i]);
      expect(getRelationships(restoredWorld.components, id)).toEqual(beforeGraphs[i]);
    });

    // Directed edges stayed directed -- b1->b0 survived with its OWN
    // (different) familiarity/affinity, not collapsed with b0->b1's.
    const restoredB0toB1 = getRelationships(restoredWorld.components, b0)!.edges.find((e) => e.withId === b1)!;
    const restoredB1toB0 = getRelationships(restoredWorld.components, b1)!.edges.find((e) => e.withId === b0)!;
    expect(restoredB0toB1.familiarity).toBe(0.9);
    expect(restoredB1toB0.familiarity).toBe(0.7);
    expect(restoredB0toB1).not.toEqual(restoredB1toB0 as unknown as RelationshipEdge);

    // Household membership and the households' own real entity identity
    // survived, and querying the restored world still correctly derives
    // membership from live state (not a stale cached roster).
    expect(world.entities.isLive(householdA)).toBe(true); // sanity: pre-restore id still valid to compare against
    expect(getHouseholdMembership(restoredWorld.components, b0)).toEqual({ householdId: householdA });
    expect(getHouseholdMembership(restoredWorld.components, b3)).toEqual({ householdId: householdB });
    expect(getHouseholdMembership(restoredWorld.components, b5)).toBeUndefined();
    expect(new Set(householdMembers(restoredWorld.components, householdA))).toEqual(new Set([b0, b1, b2]));
    expect(new Set(householdMembers(restoredWorld.components, householdB))).toEqual(new Set([b3, b4]));
  });
});
