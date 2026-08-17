/**
 * Headless acceptance test for P5-08 -- Beliefs, myths, and ritual.
 *
 * Roadmap acceptance test: "remembered historical events can become
 * referenced by persistent cultural beliefs/rituals."
 *
 * A belief is a real persistent entity whose origin is an ACTUAL recorded
 * event (validated at creation -- a fabricated event id throws). Other
 * households can adopt an existing belief (real cultural transmission),
 * and a performed ritual is a real recorded event causally linked back
 * to the belief's own origin event.
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
import { ensureSharedHousehold } from "../../src/sim/creatures/Household.js";
import { formBelief, adoptBelief, performRitual, beliefsOf } from "../../src/sim/creatures/Belief.js";

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
  const random = new RandomStreams(508);
  const events = new EventLog(entities);
  return { clock, random, entities, components, grid, terrain, events, water, weather };
}

function spawn(world: World, name: string, x: number, z: number): EntityId {
  return spawnBeaver(world, { name, position: { x, y: 3, z } });
}

describe("P5-08 -- Beliefs, myths, and ritual", () => {
  it("a remembered event becomes a persistent belief that rituals causally reference", () => {
    const world = buildWorld();
    const believer = spawn(world, "Believer", 11, 11);

    // The remembered event: a real recorded disaster.
    const originEventId = world.events.record({ tick: 0, eventType: "plant-burned-out", subjectIds: [believer], location: { x: 11, y: 3, z: 11 } });

    // A belief must reference a REAL event: a fabricated id throws.
    expect(() => formBelief(world, 999999 as EventId, ensureSharedHousehold(world, believer, spawn(world, "Kin", 11, 12)))).toThrow(RangeError);

    const household = ensureSharedHousehold(world, believer, spawn(world, "Kin2", 11, 13));
    const beliefId = formBelief(world, originEventId, household);
    expect(beliefsOf(world, household)).toContain(beliefId);

    // Cultural transmission: another household adopts the existing belief.
    const otherHousehold = ensureSharedHousehold(world, spawn(world, "C1", 12, 11), spawn(world, "C2", 12, 12));
    adoptBelief(world, beliefId, otherHousehold);
    expect(beliefsOf(world, otherHousehold)).toContain(beliefId);

    // Ritual: a real recorded act, causally linked to the belief's origin.
    const ritualEventId = performRitual(world, beliefId, [believer]);
    const ritualEvent = world.events.get(ritualEventId);
    expect(ritualEvent.eventType).toBe("ritual-performed");
    expect(ritualEvent.causeEventId).toBe(originEventId);

    // Persistence: beliefs survive full-world save/reload.
    const restoredMaterials = new MaterialRegistry();
    registerStandardMaterials(restoredMaterials);
    const restored = restoreWorld(JSON.parse(JSON.stringify(snapshotWorld(world))), { componentTypes: ALL_COMPONENT_TYPES, materials: restoredMaterials });
    expect(beliefsOf(restored, household)).toContain(beliefId);
    expect(beliefsOf(restored, otherHousehold)).toContain(beliefId);
  });
});
