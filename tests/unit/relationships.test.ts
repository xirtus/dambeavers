import { describe, expect, it } from "vitest";
import { EntityIdRegistry } from "../../src/sim/core/EntityId.js";
import { ComponentStore } from "../../src/sim/core/ComponentStore.js";
import { WorldGrid } from "../../src/sim/world/WorldGrid.js";
import { TerrainField } from "../../src/sim/world/TerrainField.js";
import { SimulationClock } from "../../src/sim/core/SimulationClock.js";
import { RandomStreams } from "../../src/sim/core/Random.js";
import { EventLog } from "../../src/sim/history/EventLog.js";
import { WaterField } from "../../src/sim/hydrology/WaterField.js";
import { Weather } from "../../src/sim/weather/Weather.js";
import { MaterialRegistry } from "../../src/sim/materials/Material.js";
import type { World } from "../../src/sim/persistence/WorldSnapshot.js";
import type { EntityId } from "../../src/sim/core/EntityId.js";
import {
  setRelationships,
  getRelationships,
  relationshipWith,
  setRelationshipWith,
  assertValidRelationships,
  setHouseholdMembership,
  getHouseholdMembership,
  assertValidHouseholdMembership,
  HouseholdMembershipComponent,
  createHousehold,
  householdMembers,
  type RelationshipEdge,
} from "../../src/sim/creatures/Relationships.js";

function buildWorld(): World {
  const entities = new EntityIdRegistry();
  const components = new ComponentStore(entities);
  const grid = new WorldGrid({ sizeX: 4, sizeY: 4, sizeZ: 4 }, entities);
  const materials = new MaterialRegistry();
  const terrain = new TerrainField(grid, materials);
  const clock = new SimulationClock({ tickRateHz: 20 });
  const random = new RandomStreams(1);
  const events = new EventLog(entities);
  const water = new WaterField(grid);
  const weather = new Weather();
  return { clock, random, entities, components, grid, terrain, events, water, weather };
}

function makeEdge(withId: EntityId, overrides: Partial<RelationshipEdge> = {}): RelationshipEdge {
  return { withId, kin: "unrelated", familiarity: 0, affinity: 0, ...overrides };
}

describe("Relationships", () => {
  it("stores and retrieves edges", () => {
    const world = buildWorld();
    const a = world.entities.create("beaver");
    const b = world.entities.create("beaver");
    setRelationships(world.components, a, { edges: [makeEdge(b, { kin: "sibling", familiarity: 0.5, affinity: 0.3 })] });
    expect(getRelationships(world.components, a)).toEqual({ edges: [{ withId: b, kin: "sibling", familiarity: 0.5, affinity: 0.3 }] });
  });

  it("returns undefined for a beaver with no relationships set", () => {
    const world = buildWorld();
    const a = world.entities.create("beaver");
    expect(getRelationships(world.components, a)).toBeUndefined();
  });

  it("rejects familiarity outside [0, 1]", () => {
    const world = buildWorld();
    const a = world.entities.create("beaver");
    const b = world.entities.create("beaver");
    expect(() => setRelationships(world.components, a, { edges: [makeEdge(b, { familiarity: -0.1 })] })).toThrow(RangeError);
    expect(() => setRelationships(world.components, a, { edges: [makeEdge(b, { familiarity: 1.1 })] })).toThrow(RangeError);
  });

  it("rejects affinity outside [-1, 1]", () => {
    const world = buildWorld();
    const a = world.entities.create("beaver");
    const b = world.entities.create("beaver");
    expect(() => setRelationships(world.components, a, { edges: [makeEdge(b, { affinity: -1.1 })] })).toThrow(RangeError);
    expect(() => setRelationships(world.components, a, { edges: [makeEdge(b, { affinity: 1.1 })] })).toThrow(RangeError);
  });

  it("rejects duplicate edges to the same withId", () => {
    const world = buildWorld();
    const a = world.entities.create("beaver");
    const b = world.entities.create("beaver");
    expect(() => setRelationships(world.components, a, { edges: [makeEdge(b), makeEdge(b)] })).toThrow(RangeError);
  });

  it("REGRESSION (P2-11): rejects invalid kin values at the relationship read/write boundary", () => {
    const world = buildWorld();
    const a = world.entities.create("beaver");
    const b = world.entities.create("beaver");
    expect(() => setRelationships(world.components, a, { edges: [makeEdge(b, { kin: "rommate" as never })] })).toThrow(RangeError);
  });

  it("assertValidRelationships accepts a well-formed value directly", () => {
    expect(() => assertValidRelationships({ edges: [makeEdge(1 as EntityId), makeEdge(2 as EntityId)] })).not.toThrow();
  });

  describe("relationshipWith / setRelationshipWith", () => {
    it("returns undefined for a stranger (never met), distinct from a zero-valued edge", () => {
      const world = buildWorld();
      const a = world.entities.create("beaver");
      const b = world.entities.create("beaver");
      expect(relationshipWith(world.components, a, b)).toBeUndefined();
      setRelationshipWith(world.components, a, makeEdge(b, { familiarity: 0, affinity: 0 }));
      expect(relationshipWith(world.components, a, b)).toEqual({ withId: b, kin: "unrelated", familiarity: 0, affinity: 0 });
    });

    it("upserts rather than accumulating duplicates", () => {
      const world = buildWorld();
      const a = world.entities.create("beaver");
      const b = world.entities.create("beaver");
      setRelationshipWith(world.components, a, makeEdge(b, { familiarity: 0.2 }));
      setRelationshipWith(world.components, a, makeEdge(b, { familiarity: 0.9, kin: "mate" }));
      const relationships = getRelationships(world.components, a)!;
      expect(relationships.edges).toHaveLength(1);
      expect(relationships.edges[0]).toEqual({ withId: b, kin: "mate", familiarity: 0.9, affinity: 0 });
    });

    it("preserves edges to OTHER beavers when upserting one", () => {
      const world = buildWorld();
      const a = world.entities.create("beaver");
      const b = world.entities.create("beaver");
      const c = world.entities.create("beaver");
      setRelationshipWith(world.components, a, makeEdge(b, { familiarity: 0.5 }));
      setRelationshipWith(world.components, a, makeEdge(c, { familiarity: 0.1 }));
      const relationships = getRelationships(world.components, a)!;
      expect(relationships.edges).toHaveLength(2);
    });

    it("relationships are directed -- setting A's edge to B does not create B's edge to A", () => {
      const world = buildWorld();
      const a = world.entities.create("beaver");
      const b = world.entities.create("beaver");
      setRelationshipWith(world.components, a, makeEdge(b, { affinity: 0.7 }));
      expect(relationshipWith(world.components, a, b)?.affinity).toBe(0.7);
      expect(relationshipWith(world.components, b, a)).toBeUndefined();
    });
  });
});

describe("Household membership", () => {
  it("creates a real, distinct household entity", () => {
    const world = buildWorld();
    const household = createHousehold(world);
    expect(world.entities.isLive(household)).toBe(true);
    expect(world.entities.kindOf(household)).toBe("household");
  });

  it("stores and retrieves membership", () => {
    const world = buildWorld();
    const household = createHousehold(world);
    const beaver = world.entities.create("beaver");
    setHouseholdMembership(world.components, beaver, { householdId: household });
    expect(getHouseholdMembership(world.components, beaver)).toEqual({ householdId: household });
  });

  it("rejects a non-positive-integer householdId", () => {
    const world = buildWorld();
    const beaver = world.entities.create("beaver");
    expect(() => setHouseholdMembership(world.components, beaver, { householdId: 0 as EntityId })).toThrow(RangeError);
    expect(() => setHouseholdMembership(world.components, beaver, { householdId: 1.5 as EntityId })).toThrow(RangeError);
  });

  it("assertValidHouseholdMembership accepts a well-formed value directly", () => {
    expect(() => assertValidHouseholdMembership({ householdId: 1 as EntityId })).not.toThrow();
  });

  describe("householdMembers", () => {
    it("finds every beaver whose membership points at this household, discovered fresh from live state", () => {
      const world = buildWorld();
      const householdA = createHousehold(world);
      const householdB = createHousehold(world);
      const a1 = world.entities.create("beaver");
      const a2 = world.entities.create("beaver");
      const b1 = world.entities.create("beaver");
      setHouseholdMembership(world.components, a1, { householdId: householdA });
      setHouseholdMembership(world.components, a2, { householdId: householdA });
      setHouseholdMembership(world.components, b1, { householdId: householdB });

      const membersA = householdMembers(world.components, householdA);
      expect(new Set(membersA)).toEqual(new Set([a1, a2]));
      expect(householdMembers(world.components, householdB)).toEqual([b1]);
    });

    it("returns an empty array for a household with no current members", () => {
      const world = buildWorld();
      const household = createHousehold(world);
      expect(householdMembers(world.components, household)).toEqual([]);
    });

    it("reflects membership changes immediately -- never a stale cached roster", () => {
      const world = buildWorld();
      const householdA = createHousehold(world);
      const householdB = createHousehold(world);
      const beaver = world.entities.create("beaver");
      setHouseholdMembership(world.components, beaver, { householdId: householdA });
      expect(householdMembers(world.components, householdA)).toEqual([beaver]);
      setHouseholdMembership(world.components, beaver, { householdId: householdB });
      expect(householdMembers(world.components, householdA)).toEqual([]);
      expect(householdMembers(world.components, householdB)).toEqual([beaver]);
    });

    it("REGRESSION (critic-found Moderate): fails loudly, not silently, on a corrupted householdId that bypassed the validating write path", () => {
      // Simulates a hand-edited/corrupted snapshot restored via
      // ComponentStore.fromSnapshot, which (like every other component in
      // this codebase) does not re-run setHouseholdMembership's own
      // validation -- writing the raw component value directly, exactly
      // the way restore does, bypassing setHouseholdMembership itself.
      const world = buildWorld();
      const beaver = world.entities.create("beaver");
      world.components.set(beaver, HouseholdMembershipComponent, { householdId: -5 as EntityId });

      // The single-entity validating read path already fails loudly.
      expect(() => getHouseholdMembership(world.components, beaver)).toThrow(RangeError);

      // householdMembers must fail exactly the same way while scanning
      // past this corrupted entity, never silently including it as if
      // -5 were a real household id it happened to match.
      expect(() => householdMembers(world.components, -5 as EntityId)).toThrow(RangeError);
    });
  });
});
