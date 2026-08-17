/**
 * Headless acceptance test for P5-11 -- Leadership roles.
 *
 * Roadmap acceptance test: "a settlement can assign a leader through an
 * explicit social rule and preserve succession history."
 *
 * The leader is the household's live member with the highest TOTAL real
 * skill level -- an explicit rule, never a random/authored figurehead.
 * Reappointing the same member is a no-op; when leadership genuinely
 * changes hands, the new appointment event causally chains back to the
 * previous one, making succession a walkable EventLog chain.
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
import { setSkills } from "../../src/sim/creatures/Beaver.js";
import { ensureSharedHousehold } from "../../src/sim/creatures/Household.js";
import { assignLeader, getLeadership } from "../../src/sim/creatures/Leadership.js";

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
  const random = new RandomStreams(511);
  const events = new EventLog(entities);
  return { clock, random, entities, components, grid, terrain, events, water, weather };
}

function spawn(world: World, name: string, x: number, z: number): EntityId {
  return spawnBeaver(world, { name, position: { x, y: 3, z } });
}

describe("P5-11 -- Leadership roles", () => {
  it("leadership follows the explicit skill rule and succession history is preserved", () => {
    const world = buildWorld();
    const junior = spawn(world, "Junior", 12, 12);
    const senior = spawn(world, "Senior", 12, 13);
    setSkills(world.components, junior, { levels: { woodcutting: 2 } });
    setSkills(world.components, senior, { levels: { woodcutting: 8 } });
    const householdId = ensureSharedHousehold(world, junior, senior);

    // The explicit rule: highest TOTAL real skill wins -- not the first member.
    const leaderId = assignLeader(world, householdId);
    expect(leaderId).toBe(senior);
    expect(getLeadership(world.components, householdId)!.leaderId).toBe(senior);
    const appointmentCountBefore = world.events.eventsOfType("leader-appointed").length;
    expect(appointmentCountBefore).toBe(1);

    // Idempotent: reappointing the same member is a no-op, no new event.
    assignLeader(world, householdId);
    expect(world.events.eventsOfType("leader-appointed").length).toBe(appointmentCountBefore);

    // Succession: when the junior overtakes the senior in total skill, the
    // appointment genuinely changes hands and the new event causally chains
    // back to the previous appointment.
    setSkills(world.components, junior, { levels: { woodcutting: 9, stoneworking: 5 } });
    world.clock.advanceTicks(10);
    const successorId = assignLeader(world, householdId);
    expect(successorId).toBe(junior);

    const appointments = world.events.eventsOfType("leader-appointed");
    expect(appointments.length).toBe(2);
    const latest = appointments[appointments.length - 1]!;
    expect(latest.causeEventId).toBe(appointments[0]!.id); // walkable succession chain
    const chain = world.events.traceBack(latest.id);
    expect(chain.map((e) => e.eventType)).toContain("leader-appointed");
  });
});
