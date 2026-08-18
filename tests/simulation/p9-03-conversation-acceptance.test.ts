/**
 * Headless acceptance test for P9-03 -- Conversation.
 *
 * Roadmap acceptance test: "conversation options/outcomes depend on
 * identity, knowledge, relationship, culture, and situation."
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
import { createHousehold, setHouseholdMembership, setRelationshipWith, relationshipWith } from "../../src/sim/creatures/Relationships.js";
import { assignLeader } from "../../src/sim/creatures/Leadership.js";
import { formBelief, beliefsOf } from "../../src/sim/creatures/Belief.js";
import { recordMemory, getMemories } from "../../src/sim/creatures/Memory.js";
import { setStress, getStress } from "../../src/sim/creatures/Stress.js";
import { setNeeds, getNeeds } from "../../src/sim/creatures/Needs.js";
import { conversationOptions, conductConversation } from "../../src/sim/wayfarer/Conversation.js";

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
  const random = new RandomStreams(903);
  const events = new EventLog(entities);
  return { clock, random, entities, components, grid, terrain, events, water, weather };
}

function spawnAt(world: World, name: string, x: number, z: number): EntityId {
  const floor = world.grid.surfaceY(x, z)!;
  return spawnBeaver(world, { name, position: { x, y: floor + 1, z } });
}

describe("P9-03 -- Conversation", () => {
  it("conversation options and outcomes depend on identity, knowledge, relationship, culture, and situation", () => {
    const world = buildWorld();
    const alder = spawnAt(world, "Alder", 3, 3);
    const birch = spawnAt(world, "Birch", 4, 3);

    // Baseline: strangers have only the identity-based chat option.
    const baseline = conversationOptions(world, alder, birch);
    expect(baseline.map((o) => o.kind)).toContain("chat");
    expect(baseline.map((o) => o.kind)).not.toContain("ask-about-kin");
    expect(baseline.map((o) => o.kind)).not.toContain("discuss-belief");
    expect(baseline.map((o) => o.kind)).not.toContain("console");

    // RELATIONSHIP: a real kin edge unlocks the kin discussion.
    setRelationshipWith(world.components, alder, { withId: birch, kin: "sibling", familiarity: 0.8, affinity: 0.7 });
    setRelationshipWith(world.components, birch, { withId: alder, kin: "sibling", familiarity: 0.8, affinity: 0.7 });
    const kinOptions = conversationOptions(world, alder, birch);
    expect(kinOptions.map((o) => o.kind)).toContain("ask-about-kin");
    expect(kinOptions.find((o) => o.kind === "chat")!.label).toContain("sibling");

    // KNOWLEDGE: the listener's real recorded deed becomes askable.
    const deedEventId = world.events.record({
      tick: world.clock.tick,
      eventType: "ritual-performed",
      subjectIds: [birch],
      location: { x: 4, y: 3, z: 3 },
    });
    const knowledgeOptions = conversationOptions(world, alder, birch);
    expect(knowledgeOptions.some((o) => o.kind === "ask-about-event" && o.eventIds.includes(deedEventId))).toBe(true);

    // Asking about the deed genuinely moves knowledge (a real memory).
    const ask = conductConversation(world, alder, birch, `ask-about-event-${deedEventId}`);
    expect(ask.ok).toBe(true);
    expect(getMemories(world.components, alder)?.entries.some((e) => e.eventId === deedEventId)).toBe(true);

    // The speaker's own memory becomes shareable, and sharing moves it.
    const ownMemoryEventId = world.events.record({
      tick: world.clock.tick,
      eventType: "wayfarer-conversation",
      subjectIds: [alder, birch],
      location: { x: 3, y: 3, z: 3 },
    });
    recordMemory(world, alder, ownMemoryEventId, 0.5);
    const shareOptions = conversationOptions(world, alder, birch);
    expect(shareOptions.some((o) => o.kind === "share-memory" && o.eventIds.includes(ownMemoryEventId))).toBe(true);
    const share = conductConversation(world, alder, birch, `share-memory-${ownMemoryEventId}`);
    expect(share.ok).toBe(true);
    expect(getMemories(world.components, birch)?.entries.some((e) => e.eventId === ownMemoryEventId)).toBe(true);

    // CULTURE: a real belief of the listener's household becomes
    // discussable AND adoptable (the speaker's household lacks it).
    const alderHousehold = createHousehold(world);
    const birchHousehold = createHousehold(world);
    setHouseholdMembership(world.components, alder, { householdId: alderHousehold });
    setHouseholdMembership(world.components, birch, { householdId: birchHousehold });
    const belief = formBelief(world, deedEventId, birchHousehold);
    const cultureOptions = conversationOptions(world, alder, birch);
    expect(cultureOptions.some((o) => o.kind === "discuss-belief" && o.entityIds.includes(belief))).toBe(true);
    expect(cultureOptions.some((o) => o.kind === "adopt-belief" && o.entityIds.includes(belief))).toBe(true);
    const adopt = conductConversation(world, alder, birch, `adopt-belief-${belief}`);
    expect(adopt.ok).toBe(true);
    expect(beliefsOf(world, alderHousehold)).toContain(belief);

    // IDENTITY: a real leader is addressed as a leader.
    assignLeader(world, birchHousehold);
    const identityOptions = conversationOptions(world, alder, birch);
    expect(identityOptions.find((o) => o.kind === "chat")!.label).toContain("leader");

    // SITUATION: a stressed listener unlocks console; a needy one unlocks comfort.
    setStress(world.components, birch, { level: 0.7 });
    expect(conversationOptions(world, alder, birch).map((o) => o.kind)).toContain("console");
    const consoleResult = conductConversation(world, alder, birch, "console");
    expect(consoleResult.ok).toBe(true);
    expect(getStress(world.components, birch)!.level).toBeLessThan(0.7);
    setNeeds(world.components, birch, { ...getNeeds(world.components, birch)!, hunger: 0.9 });
    expect(conversationOptions(world, alder, birch).map((o) => o.kind)).toContain("comfort");

    // An option that no longer derives fails honestly.
    const fake = conductConversation(world, alder, birch, "console");
    expect(fake.ok).toBe(false); // stress already relieved below threshold

    // Every real conversation records a real event and applies real
    // relationship contact (familiarity grew from its initial 0.8
    // across the whole conversation history, up to the real clamp).
    const chat = conductConversation(world, alder, birch, "chat");
    expect(chat.ok).toBe(true);
    expect(chat.eventIds.length).toBe(1);
    expect(world.events.get(chat.eventIds[0]!).eventType).toBe("wayfarer-conversation");
    expect(relationshipWith(world.components, alder, birch)!.familiarity).toBeGreaterThan(0.8);
  });
});
