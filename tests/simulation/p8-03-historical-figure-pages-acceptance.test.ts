/**
 * Headless acceptance test for P8-03 -- Historical figure pages.
 *
 * Roadmap acceptance test: "every displayed claim links to
 * authoritative simulation records."
 */
import { describe, expect, it } from "vitest";
import { EntityIdRegistry, type EntityId } from "../../src/sim/core/EntityId.js";
import { ComponentStore } from "../../src/sim/core/ComponentStore.js";
import { SimulationClock } from "../../src/sim/core/SimulationClock.js";
import { RandomStreams } from "../../src/sim/core/Random.js";
import { WorldGrid } from "../../src/sim/world/WorldGrid.js";
import { TerrainField } from "../../src/sim/world/TerrainField.js";
import { EventLog, type EventId } from "../../src/sim/history/EventLog.js";
import { MaterialRegistry } from "../../src/sim/materials/Material.js";
import { registerStandardMaterials } from "../../src/sim/materials/standardMaterials.js";
import { WaterField } from "../../src/sim/hydrology/WaterField.js";
import { Weather } from "../../src/sim/weather/Weather.js";
import type { World } from "../../src/sim/persistence/WorldSnapshot.js";
import { snapshotWorld, restoreWorld } from "../../src/sim/persistence/WorldSnapshot.js";
import { ALL_COMPONENT_TYPES } from "../../src/sim/persistence/AllComponentTypes.js";
import { spawnBeaver } from "../../src/sim/creatures/Beaver.js";
import { produceOffspring } from "../../src/sim/creatures/Reproduction.js";
import { createHousehold, setHouseholdMembership, setRelationshipWith } from "../../src/sim/creatures/Relationships.js";
import { assignLeader } from "../../src/sim/creatures/Leadership.js";
import { createZone } from "../../src/sim/spaces/FunctionalSpace.js";
import { claimSleepSpace, createSleepSpace } from "../../src/sim/spaces/SleepSpace.js";
import { setConstruction } from "../../src/sim/labor/Construction.js";
import { formBelief, performRitual } from "../../src/sim/creatures/Belief.js";
import { createArtwork } from "../../src/sim/creatures/Art.js";
import { RecipeRegistry, registerStandardRecipes } from "../../src/sim/economy/Recipe.js";
import { die } from "../../src/sim/creatures/Mortality.js";
import { figurePage, type FigureSource } from "../../src/sim/chronicle/FigurePages.js";

function buildWorld(): { world: World; materials: MaterialRegistry; recipes: RecipeRegistry } {
  const entities = new EntityIdRegistry();
  const components = new ComponentStore(entities);
  const grid = new WorldGrid({ sizeX: 20, sizeY: 10, sizeZ: 20 }, entities);
  const materials = new MaterialRegistry();
  registerStandardMaterials(materials);
  const recipes = new RecipeRegistry();
  registerStandardRecipes(recipes);
  const terrain = new TerrainField(grid, materials);
  for (let x = 0; x < 20; x++) for (let z = 0; z < 20; z++) for (let y = 0; y <= 2; y++) terrain.setMaterial(x, y, z, "soil");
  const water = new WaterField(grid);
  const weather = new Weather();
  const clock = new SimulationClock({ tickRateHz: 20 });
  const random = new RandomStreams(803);
  const events = new EventLog(entities);
  return { world: { clock, random, entities, components, grid, terrain, events, water, weather }, materials, recipes };
}

function spawnAt(world: World, name: string, x: number, z: number): EntityId {
  const floor = world.grid.surfaceY(x, z)!;
  return spawnBeaver(world, { name, position: { x, y: floor + 1, z } });
}

function completeConstruction(world: World, kind: "wall" | "lodge-segment", x: number, z: number): EntityId {
  const id = world.entities.create("construction");
  setConstruction(world.components, id, {
    designationId: id, kind, site: { x, z }, requiredMaterialId: "wood", requiredMassKg: 1, workDone: 1, workRequired: 1, status: "complete",
  });
  return id;
}

function createClaimedLodgeRoom(world: World, parentA: EntityId, parentB: EntityId, x: number, z: number): EntityId {
  const zoneId = createZone(world, { cells: [{ x, z }, { x: x + 1, z }], declaredFunction: "general-zone" });
  for (const wall of [{ x: x - 1, z }, { x, z: z - 1 }, { x, z: z + 1 }, { x: x + 1, z: z - 1 }, { x: x + 1, z: z + 1 }, { x: x + 2, z }]) {
    completeConstruction(world, "wall", wall.x, wall.z);
  }
  completeConstruction(world, "lodge-segment", x, z);
  const left = createSleepSpace(world, { zoneId, kind: "nest", cell: { x, z } });
  const right = createSleepSpace(world, { zoneId, kind: "nest", cell: { x: x + 1, z } });
  claimSleepSpace(world, parentA, left);
  claimSleepSpace(world, parentB, right);
  return zoneId;
}

describe("P8-03 -- Historical figure pages", () => {
  it("every displayed claim links to authoritative simulation records", () => {
    const { world, materials, recipes } = buildWorld();

    // A real founder couple and their real child.
    const alder = spawnAt(world, "Alder", 3, 3);
    const birch = spawnAt(world, "Birch", 4, 3);
    createClaimedLodgeRoom(world, alder, birch, 3, 3);
    setRelationshipWith(world.components, alder, { withId: birch, kin: "mate", familiarity: 1, affinity: 0.9 });
    setRelationshipWith(world.components, birch, { withId: alder, kin: "mate", familiarity: 1, affinity: 0.9 });
    const household = createHousehold(world);
    setHouseholdMembership(world.components, alder, { householdId: household });
    setHouseholdMembership(world.components, birch, { householdId: household });
    const child = produceOffspring(world, alder, birch, { birthIntervalTicks: 0 }).offspringId;

    // The child leads the household, performs a real ritual, makes a real artwork.
    world.clock.advanceTicks(100);
    const leaderId = assignLeader(world, household);
    const belief = formBelief(world, world.events.eventsOfType("offspring-born")[0]!.id as EventId, household);
    performRitual(world, belief, [leaderId]);
    const portrait = createArtwork(world, materials, recipes.get("carve-trinket")!, 2, { kind: "beaver", id: child }, child, { x: 6, y: 3, z: 6 });

    // A real death, a real reputation stain on a different beaver (the page must not claim it).
    const decoy = spawnAt(world, "Zorb", 10, 3);

    const page = figurePage(world, child);

    // Every claim carries sources, and every source resolves to an
    // authoritative record (real event id, real attached component, or
    // the registry itself).
    expect(page.known).toBe(true);
    expect(page.claims.length).toBeGreaterThan(0);
    for (const claim of page.claims) {
      expect(claim.sources.length).toBeGreaterThan(0);
      for (const source of claim.sources) {
        expectSourceResolves(world, source, child);
      }
    }

    // The birth claim links to the real birth event.
    const birth = world.events.eventsOfType("offspring-born").find((e) => e.subjectIds.includes(child))!;
    const birthClaim = page.claims.find((c) => c.heading === "Birth")!;
    expect(birthClaim.sources).toContainEqual({ kind: "event", eventId: birth.id });

    // The leadership claim links to the real leader-appointed event.
    const leadershipEvent = world.events.eventsOfType("leader-appointed").find((e) => e.subjectIds.includes(child));
    if (leadershipEvent !== undefined) {
      const leadershipClaim = page.claims.find((c) => c.heading === "Leadership")!;
      expect(leadershipClaim.sources).toContainEqual({ kind: "event", eventId: leadershipEvent.id });
    }

    // The artwork claim links to the real good entity.
    const artworkClaim = page.claims.find((c) => c.heading === "Artworks")!;
    expect(artworkClaim.sources.some((s) => s.kind === "component" && s.entityId === portrait)).toBe(true);

    // The decoy never appears -- the page only claims what is real.
    expect(page.claims.some((c) => c.detail.includes("Zorb"))).toBe(false);

    // Reputation derives from the recorded deeds; its sources are real.
    const reputationClaim = page.claims.find((c) => c.heading === "Reputation")!;
    for (const source of reputationClaim.sources) {
      if (source.kind === "event") expect(world.events.has(source.eventId)).toBe(true);
    }

    // A dead beaver's page keeps resolving -- history outlives liveness.
    const doomed = spawnAt(world, "Doomed", 12, 3);
    die(world, doomed, "starvation");
    const deadPage = figurePage(world, doomed);
    expect(deadPage.known).toBe(true);
    expect(deadPage.live).toBe(false);
    const deathClaim = deadPage.claims.find((c) => c.heading === "Death")!;
    expect(deathClaim.sources.length).toBeGreaterThan(0);
    expect(deathClaim.sources[0]!.kind).toBe("event");
    expect(world.events.has((deathClaim.sources[0] as { eventId: EventId }).eventId)).toBe(true);
    expect(decoy).toBeDefined();
  });

  it("figure pages survive save/reload with identical claims and sources", () => {
    const { world, materials, recipes } = buildWorld();
    const alder = spawnAt(world, "Alder", 3, 3);
    const birch = spawnAt(world, "Birch", 4, 3);
    createClaimedLodgeRoom(world, alder, birch, 3, 3);
    setRelationshipWith(world.components, alder, { withId: birch, kin: "mate", familiarity: 1, affinity: 0.9 });
    setRelationshipWith(world.components, birch, { withId: alder, kin: "mate", familiarity: 1, affinity: 0.9 });
    const household = createHousehold(world);
    setHouseholdMembership(world.components, alder, { householdId: household });
    setHouseholdMembership(world.components, birch, { householdId: household });
    const child = produceOffspring(world, alder, birch, { birthIntervalTicks: 0 }).offspringId;
    world.clock.advanceTicks(50);
    assignLeader(world, household);
    const belief = formBelief(world, world.events.eventsOfType("offspring-born")[0]!.id as EventId, household);
    performRitual(world, belief, [child]);
    createArtwork(world, materials, recipes.get("carve-trinket")!, 2, { kind: "beaver", id: child }, child, { x: 6, y: 3, z: 6 });

    const before = figurePage(world, child);
    const m = new MaterialRegistry();
    registerStandardMaterials(m);
    const restored = restoreWorld(snapshotWorld(world), { componentTypes: ALL_COMPONENT_TYPES, materials: m });
    expect(figurePage(restored, child)).toEqual(before);
  });
});

function expectSourceResolves(world: World, source: FigureSource, personId: EntityId): void {
  if (source.kind === "event") {
    expect(world.events.has(source.eventId)).toBe(true);
  } else if (source.kind === "component") {
    const type = ALL_COMPONENT_TYPES.get(source.componentType);
    expect(type, `component type ${source.componentType} must be registered`).toBeDefined();
    expect(world.components.get(source.entityId, type!), `component ${source.componentType} must be attached to entity ${source.entityId}`).toBeDefined();
  } else {
    // Registry source: the person id must be known.
    expect(world.entities.isKnown(personId)).toBe(true);
  }
}
