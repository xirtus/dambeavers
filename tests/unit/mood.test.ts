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
import { setNeeds } from "../../src/sim/creatures/Needs.js";
import { SocialStateComponent, setWorldSocialState } from "../../src/sim/creatures/SocialInteraction.js";
import { TraitsComponent, getTraits, setWorldTraits, BASELINE_TRAITS } from "../../src/sim/creatures/Traits.js";
import { setRelationshipWith } from "../../src/sim/creatures/Relationships.js";
import { MOURNED_EVENT_TYPE } from "../../src/sim/creatures/Mourning.js";
import { deriveMood, MOOD_RECENT_EVENT_WINDOW_TICKS } from "../../src/sim/creatures/Mood.js";

function buildWorld(): World {
  const entities = new EntityIdRegistry();
  const components = new ComponentStore(entities);
  const grid = new WorldGrid({ sizeX: 10, sizeY: 8, sizeZ: 10 }, entities);
  const materials = new MaterialRegistry();
  registerStandardMaterials(materials);
  const terrain = new TerrainField(grid, materials);
  for (let x = 0; x < 10; x++) {
    for (let z = 0; z < 10; z++) terrain.setMaterial(x, 2, z, "soil");
  }
  const water = new WaterField(grid);
  const weather = new Weather();
  const clock = new SimulationClock({ tickRateHz: 20 });
  const random = new RandomStreams(9);
  const events = new EventLog(entities);
  return { clock, random, entities, components, grid, terrain, events, water, weather };
}

function spawnAt(world: World, name: string, x: number, z: number): EntityId {
  const floor = world.grid.surfaceY(x, z)!;
  return spawnBeaver(world, { name, position: { x, y: floor + 1, z } });
}

const MID_NEEDS = { hunger: 0.5, thirst: 0.5, fatigue: 0.5, thermalComfort: 0.5 };
const SATISFIED_NEEDS = { hunger: 0, thirst: 0, fatigue: 0, thermalComfort: 1 };
const DEPRIVED_NEEDS = { hunger: 1, thirst: 1, fatigue: 1, thermalComfort: 0 };

describe("Mood", () => {
  it("throws for an entity that is not a live beaver", () => {
    const world = buildWorld();
    const beaver = spawnAt(world, "Alder", 3, 3);
    world.entities.destroy(beaver);
    expect(() => deriveMood(world, beaver)).toThrow(RangeError);
  });

  it("rejects a corrupted restored SocialState with a lastInteractionTick from the future", () => {
    const world = buildWorld();
    const beaver = spawnAt(world, "Alder", 3, 3);
    setWorldTraits(world, beaver, { sociability: 1, resilience: 0, assignedTick: 0 });
    world.components.set(beaver, SocialStateComponent, { socialNeed: 0.5, lastInteractionTick: world.clock.tick + 1 });
    expect(() => deriveMood(world, beaver)).toThrow(RangeError);
  });

  it("rejects a corrupted Traits value on plain (non-world-aware) read", () => {
    const world = buildWorld();
    const beaver = spawnAt(world, "Alder", 3, 3);
    world.components.set(beaver, TraitsComponent, { sociability: 1.5, resilience: 0.5, assignedTick: 0 });
    expect(() => getTraits(world.components, beaver)).toThrow(RangeError);
  });

  it("falls back to neutral baseline traits when a beaver has none assigned", () => {
    const world = buildWorld();
    const beaver = spawnAt(world, "Alder", 3, 3);
    setNeeds(world.components, beaver, MID_NEEDS);
    const breakdown = deriveMood(world, beaver);
    expect(breakdown.traits).toEqual(BASELINE_TRAITS);
    expect(breakdown.mood).toBe(0);
  });

  it("needs contribution is positive when satisfied, negative when deprived, and 0 with no Needs component at all", () => {
    const world = buildWorld();
    const satisfied = spawnAt(world, "Satisfied", 2, 2);
    const deprived = spawnAt(world, "Deprived", 3, 2);
    // A bare beaver-kind entity, deliberately NOT created via `spawnBeaver`
    // (which always attaches baseline `Needs`) -- the only way to exercise
    // the "entity has no Needs component at all" fallback path.
    const noNeeds = world.entities.create("beaver");
    setWorldTraits(world, satisfied, { sociability: 0, resilience: 0, assignedTick: 0 });
    setWorldTraits(world, deprived, { sociability: 0, resilience: 0, assignedTick: 0 });
    setWorldTraits(world, noNeeds, { sociability: 0, resilience: 0, assignedTick: 0 });
    setNeeds(world.components, satisfied, SATISFIED_NEEDS);
    setNeeds(world.components, deprived, DEPRIVED_NEEDS);

    expect(deriveMood(world, satisfied).needsContribution).toBeGreaterThan(0);
    expect(deriveMood(world, deprived).needsContribution).toBeLessThan(0);
    expect(deriveMood(world, noNeeds).needsContribution).toBe(0);
  });

  it("resilience damps the magnitude of the needs contribution without flipping its sign", () => {
    const world = buildWorld();
    const brittle = spawnAt(world, "Brittle", 2, 2);
    const resilient = spawnAt(world, "Resilient", 3, 2);
    setNeeds(world.components, brittle, DEPRIVED_NEEDS);
    setNeeds(world.components, resilient, DEPRIVED_NEEDS);
    setWorldTraits(world, brittle, { sociability: 0, resilience: 0, assignedTick: 0 });
    setWorldTraits(world, resilient, { sociability: 0, resilience: 1, assignedTick: 0 });

    const brittleMood = deriveMood(world, brittle);
    const resilientMood = deriveMood(world, resilient);
    expect(brittleMood.needsContribution).toBeLessThan(0);
    expect(resilientMood.needsContribution).toBeLessThan(0);
    expect(Math.abs(resilientMood.needsContribution)).toBeLessThan(Math.abs(brittleMood.needsContribution));
  });

  it("social contribution reflects loneliness vs. recent connection, scaled by sociability, and is 0 with no SocialState", () => {
    const world = buildWorld();
    const lonely = spawnAt(world, "Lonely", 2, 2);
    const connected = spawnAt(world, "Connected", 3, 2);
    const noSocial = spawnAt(world, "NoSocial", 4, 2);
    for (const id of [lonely, connected, noSocial]) setWorldTraits(world, id, { sociability: 1, resilience: 0, assignedTick: 0 });
    setWorldSocialState(world, lonely, { socialNeed: 1 });
    setWorldSocialState(world, connected, { socialNeed: 0 });

    expect(deriveMood(world, lonely).socialContribution).toBeLessThan(0);
    expect(deriveMood(world, connected).socialContribution).toBeGreaterThan(0);
    expect(deriveMood(world, noSocial).socialContribution).toBe(0);
  });

  it("a beaver with 0 sociability barely reacts to loneliness even at maximum social need", () => {
    const world = buildWorld();
    const beaver = spawnAt(world, "Stoic", 2, 2);
    setWorldTraits(world, beaver, { sociability: 0, resilience: 0, assignedTick: 0 });
    setWorldSocialState(world, beaver, { socialNeed: 1 });
    expect(deriveMood(world, beaver).socialContribution).toBe(0);
  });

  it("only a known, recent event contributes; unrecognized event types and stale events contribute 0", () => {
    const world = buildWorld();
    const beaver = spawnAt(world, "Alder", 3, 3);
    const other = spawnAt(world, "Birch", 4, 3);
    setWorldTraits(world, beaver, { sociability: 1, resilience: 0, assignedTick: 0 });

    // An event of a type Mood.ts doesn't track.
    world.events.record({ tick: 0, eventType: "tree-felled", subjectIds: [beaver], objectIds: [], location: { x: 3, y: 3, z: 3 } });
    expect(deriveMood(world, beaver).eventContribution).toBe(0);

    // A recognized event type, but this beaver isn't a subject/object of it.
    world.events.record({ tick: 0, eventType: "social-interaction", subjectIds: [other], objectIds: [], location: { x: 4, y: 3, z: 3 } });
    expect(deriveMood(world, beaver).eventContribution).toBe(0);

    // A recognized event this beaver genuinely participated in -- positive.
    world.events.record({
      tick: 0,
      eventType: "social-interaction",
      subjectIds: [beaver, other],
      objectIds: [],
      location: { x: 3, y: 3, z: 3 },
    });
    expect(deriveMood(world, beaver).eventContribution).toBeGreaterThan(0);

    // Advance well past the recency window -- the same event no longer counts.
    world.clock.advanceTicks(MOOD_RECENT_EVENT_WINDOW_TICKS + 1);
    expect(deriveMood(world, beaver).eventContribution).toBe(0);
  });

  it("two beavers who are subjects of the SAME recorded event react differently by trait alone", () => {
    const world = buildWorld();
    const sociable = spawnAt(world, "Sociable", 2, 2);
    const aloof = spawnAt(world, "Aloof", 3, 2);
    setWorldTraits(world, sociable, { sociability: 0.8, resilience: 0.2, assignedTick: 0 });
    setWorldTraits(world, aloof, { sociability: 0.2, resilience: 0.2, assignedTick: 0 });

    const eventId = world.events.record({
      tick: 0,
      eventType: "social-interaction",
      subjectIds: [sociable, aloof],
      objectIds: [],
      location: { x: 2, y: 3, z: 2 },
    });
    expect(world.events.get(eventId).subjectIds).toEqual([sociable, aloof]); // one shared event

    const sociableMood = deriveMood(world, sociable);
    const aloofMood = deriveMood(world, aloof);
    expect(sociableMood.eventContribution).toBeGreaterThan(aloofMood.eventContribution);
    expect(sociableMood.mood).toBeGreaterThan(aloofMood.mood);
  });

  it("mood is clamped to [-1, 1]", () => {
    const world = buildWorld();
    const beaver = spawnAt(world, "Extreme", 3, 3);
    setWorldTraits(world, beaver, { sociability: 1, resilience: 0, assignedTick: 0 });
    setNeeds(world.components, beaver, SATISFIED_NEEDS);
    setWorldSocialState(world, beaver, { socialNeed: 0 });
    for (let i = 0; i < 5; i++) {
      world.events.record({
        tick: 0,
        eventType: "social-interaction",
        subjectIds: [beaver],
        objectIds: [],
        location: { x: 3, y: 3, z: 3 },
      });
    }
    expect(deriveMood(world, beaver).mood).toBe(1);
  });

  it("grief from a \"beaver-mourned\" event is relationship-sensitive -- a closer relationship hurts more from the SAME event", () => {
    const world = buildWorld();
    const mate = spawnAt(world, "Mate", 2, 2);
    const acquaintance = spawnAt(world, "Acquaintance", 3, 2);
    const deceased = spawnAt(world, "Deceased", 4, 2);
    // Identical traits -- the control. Only the relationship differs.
    setWorldTraits(world, mate, { sociability: 1, resilience: 0, assignedTick: 0 });
    setWorldTraits(world, acquaintance, { sociability: 1, resilience: 0, assignedTick: 0 });
    setRelationshipWith(world.components, mate, { withId: deceased, kin: "mate", familiarity: 0.9, affinity: 0.8 });
    setRelationshipWith(world.components, acquaintance, { withId: deceased, kin: "unrelated", familiarity: 0.1, affinity: 0 });

    // ONE shared event, both beavers as subjects, same eventId.
    world.events.record({
      tick: 0,
      eventType: MOURNED_EVENT_TYPE,
      subjectIds: [mate, acquaintance],
      objectIds: [deceased],
      location: { x: 4, y: 3, z: 2 },
    });

    const mateMood = deriveMood(world, mate);
    const acquaintanceMood = deriveMood(world, acquaintance);
    expect(mateMood.eventContribution).toBeLessThan(0); // grief is a real, negative contribution
    expect(acquaintanceMood.eventContribution).toBeLessThan(0);
    expect(mateMood.eventContribution).toBeLessThan(acquaintanceMood.eventContribution); // the mate hurts more
    expect(mateMood.mood).toBeLessThan(acquaintanceMood.mood);
  });

  it("a beaver named as a mourning subject with no actual relationship edge to the deceased contributes 0 grief (defensive, corrupted-data path)", () => {
    const world = buildWorld();
    const beaver = spawnAt(world, "NoRelationship", 2, 2);
    const deceased = spawnAt(world, "Deceased", 3, 2);
    setWorldTraits(world, beaver, { sociability: 1, resilience: 0, assignedTick: 0 });
    // No relationship edge set at all -- a hand-corrupted event naming a
    // non-mourner as a subject anyway.
    world.events.record({
      tick: 0,
      eventType: MOURNED_EVENT_TYPE,
      subjectIds: [beaver],
      objectIds: [deceased],
      location: { x: 3, y: 3, z: 2 },
    });
    expect(deriveMood(world, beaver).eventContribution).toBe(0);
  });

  it("a \"beaver-mourned\" event with no objectIds contributes 0 grief (defensive, corrupted-data path)", () => {
    const world = buildWorld();
    const beaver = spawnAt(world, "Mourner", 2, 2);
    setWorldTraits(world, beaver, { sociability: 1, resilience: 0, assignedTick: 0 });
    world.events.record({ tick: 0, eventType: MOURNED_EVENT_TYPE, subjectIds: [beaver], objectIds: [], location: { x: 2, y: 3, z: 2 } });
    expect(deriveMood(world, beaver).eventContribution).toBe(0);
  });
});
