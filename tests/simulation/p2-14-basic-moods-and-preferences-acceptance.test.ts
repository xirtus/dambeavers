/**
 * Headless acceptance test for P2-14 -- Basic moods and preferences.
 *
 * Roadmap acceptance test:
 *   "two beavers exposed to the same event can react differently because
 *   of persistent traits/preferences."
 *
 * Two live beavers start with IDENTICAL needs and social state (a control:
 * anything that differs afterward cannot be blamed on those), but
 * DIFFERENT persistent P2-14 `Traits`. They're put through the real,
 * unmodified P2-13 social scheduler (`tickSocialNeeds`/
 * `tickSocialInteractions`) so both end up subjects of the exact SAME
 * recorded `"social-interaction"` event -- one `EventId`, not two separate
 * ones. `Mood.ts`'s `deriveMood` is then called for each beaver and their
 * resulting moods are shown to differ. Both the event contribution AND the
 * social contribution end up different between the two beavers -- both
 * beavers' `SocialState.socialNeed` drops by the SAME absolute relief
 * amount (`SocialInteraction.ts`'s own symmetric formula), but each
 * beaver's OWN `sociability` trait then scales that resulting value (and
 * the shared event's valence) differently, so two channels of the one
 * shared `deriveMood` formula both diverge from the same trait input, not
 * just one. Either channel alone would already satisfy the roadmap
 * wording; this proves the reaction difference comes from each beaver's
 * own persistent trait values, not a per-event random roll (nothing in
 * this test or `Mood.ts` calls into a `RandomStream` during reaction) and
 * not an authored per-beaver script (`deriveMood` is one shared formula
 * for both). Finishes with a real full-world save/reload proving traits
 * persist and mood re-derives identically afterward.
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
import { setNeeds } from "../../src/sim/creatures/Needs.js";
import { setRelationshipWith } from "../../src/sim/creatures/Relationships.js";
import { SOCIAL_INTERACTION_THRESHOLD, setWorldSocialState, tickSocialInteractions } from "../../src/sim/creatures/SocialInteraction.js";
import { setConstruction } from "../../src/sim/labor/Construction.js";
import { createZone } from "../../src/sim/spaces/FunctionalSpace.js";
import { claimSleepSpace, createSleepSpace } from "../../src/sim/spaces/SleepSpace.js";
import { getWorldTraits, setWorldTraits } from "../../src/sim/creatures/Traits.js";
import { deriveMood } from "../../src/sim/creatures/Mood.js";

function buildFlatWorld(sizeX = 10, sizeY = 8, sizeZ = 10, floor = 2): { world: World; materials: MaterialRegistry } {
  const entities = new EntityIdRegistry();
  const components = new ComponentStore(entities);
  const grid = new WorldGrid({ sizeX, sizeY, sizeZ }, entities);
  const materials = new MaterialRegistry();
  registerStandardMaterials(materials);
  const terrain = new TerrainField(grid, materials);
  for (let x = 0; x < sizeX; x++) {
    for (let z = 0; z < sizeZ; z++) {
      for (let y = 0; y <= floor; y++) terrain.setMaterial(x, y, z, "soil");
    }
  }
  const water = new WaterField(grid);
  const weather = new Weather();
  const clock = new SimulationClock({ tickRateHz: 20 });
  const random = new RandomStreams(4242);
  const events = new EventLog(entities);
  return { world: { clock, random, entities, components, grid, terrain, events, water, weather }, materials };
}

function spawnAt(world: World, name: string, x: number, z: number): EntityId {
  const floor = world.grid.surfaceY(x, z)!;
  return spawnBeaver(world, { name, position: { x, y: floor + 1, z } });
}

function completeConstruction(world: World, kind: "wall" | "lodge-segment", x: number, z: number): EntityId {
  const id = world.entities.create("construction");
  setConstruction(world.components, id, {
    designationId: id,
    kind,
    site: { x, z },
    requiredMaterialId: "wood",
    requiredMassKg: 1,
    workDone: 1,
    workRequired: 1,
    status: "complete",
  });
  return id;
}

function createClaimedLodgeRoom(world: World, leftResident: EntityId, rightResident: EntityId): EntityId {
  const zoneId = createZone(world, { cells: [{ x: 3, z: 3 }, { x: 4, z: 3 }], declaredFunction: "general-zone" });
  for (const wall of [
    { x: 2, z: 3 },
    { x: 3, z: 2 },
    { x: 3, z: 4 },
    { x: 4, z: 2 },
    { x: 4, z: 4 },
    { x: 5, z: 3 },
  ]) {
    completeConstruction(world, "wall", wall.x, wall.z);
  }
  completeConstruction(world, "lodge-segment", 3, 3);
  const leftSpace = createSleepSpace(world, { zoneId, kind: "nest", cell: { x: 3, z: 3 } });
  const rightSpace = createSleepSpace(world, { zoneId, kind: "nest", cell: { x: 4, z: 3 } });
  claimSleepSpace(world, leftResident, leftSpace);
  claimSleepSpace(world, rightResident, rightSpace);
  return zoneId;
}

describe("P2-14 -- Basic moods and preferences", () => {
  it("two beavers exposed to the same recorded event react differently because of persistent traits", () => {
    const { world } = buildFlatWorld();
    const social = spawnAt(world, "Chatty", 3, 3);
    const loner = spawnAt(world, "Loner", 4, 3);
    createClaimedLodgeRoom(world, social, loner);

    // Identical needs (a midpoint, contributing exactly 0 either way) and
    // identical relationship/social state -- a control, so any later
    // difference cannot be attributed to these.
    const midpointNeeds = { hunger: 0.5, thirst: 0.5, fatigue: 0.5, thermalComfort: 0.5 };
    setNeeds(world.components, social, midpointNeeds);
    setNeeds(world.components, loner, midpointNeeds);
    setRelationshipWith(world.components, social, { withId: loner, kin: "unrelated", familiarity: 0.4, affinity: 0.2 });
    setRelationshipWith(world.components, loner, { withId: social, kin: "unrelated", familiarity: 0.4, affinity: 0.2 });
    setWorldSocialState(world, social, { socialNeed: SOCIAL_INTERACTION_THRESHOLD });
    setWorldSocialState(world, loner, { socialNeed: SOCIAL_INTERACTION_THRESHOLD });

    // Only the persistent P2-14 trait differs: a sociable beaver and a
    // low-sociability loner, both otherwise equally resilient.
    setWorldTraits(world, social, { sociability: 0.6, resilience: 0.5, assignedTick: 0 });
    setWorldTraits(world, loner, { sociability: 0.1, resilience: 0.5, assignedTick: 0 });

    // The real, unmodified P2-13 scheduler -- no hand-authored event, no
    // per-beaver script. Both beavers already meet the interaction
    // threshold and stand together in the same claimed lodge room, so
    // this produces exactly one shared interaction.
    const interactions = tickSocialInteractions(world);
    expect(interactions).toHaveLength(1);
    const interaction = interactions[0]!;
    expect(interaction.participantIds).toEqual([social, loner]);

    const event = world.events.get(interaction.eventId);
    expect(event.eventType).toBe("social-interaction");
    expect(event.subjectIds).toEqual([social, loner]); // ONE event, both beavers as subjects

    const socialMood = deriveMood(world, social);
    const lonerMood = deriveMood(world, loner);

    // Same underlying needs -> identical needs contribution (the control).
    expect(socialMood.needsContribution).toBe(lonerMood.needsContribution);
    // The interaction relieved both beavers' socialNeed by the identical
    // absolute amount, but each beaver's own sociability trait scales that
    // resulting value differently -- a second channel of the same shared
    // formula that also diverges purely from trait differences.
    expect(socialMood.socialContribution).not.toBe(lonerMood.socialContribution);
    expect(socialMood.socialContribution).toBeGreaterThan(lonerMood.socialContribution);
    // Same shared event, but each beaver's own trait produces a different
    // reaction to it -- the literal roadmap acceptance wording.
    expect(socialMood.eventContribution).not.toBe(lonerMood.eventContribution);
    expect(socialMood.eventContribution).toBeGreaterThan(lonerMood.eventContribution);
    expect(socialMood.mood).not.toBe(lonerMood.mood);
    expect(socialMood.mood).toBeGreaterThan(lonerMood.mood);

    // Full-world save/reload: traits persist as ordinary ComponentStore
    // data, and mood -- a pure derivation, not a stored value -- re-derives
    // identically from the restored state.
    const restoredMaterials = new MaterialRegistry();
    registerStandardMaterials(restoredMaterials);
    const restored = restoreWorld(JSON.parse(JSON.stringify(snapshotWorld(world))), {
      componentTypes: ALL_COMPONENT_TYPES,
      materials: restoredMaterials,
    });

    expect(getWorldTraits(restored, social)).toEqual(getWorldTraits(world, social));
    expect(getWorldTraits(restored, loner)).toEqual(getWorldTraits(world, loner));
    expect(deriveMood(restored, social)).toEqual(socialMood);
    expect(deriveMood(restored, loner)).toEqual(lonerMood);
  });
});
