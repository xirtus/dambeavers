/**
 * Headless acceptance test for P5-02 -- Memories.
 *
 * Roadmap acceptance test: "significant events create memories with
 * valence and persistence affecting later behavior."
 *
 * A real recorded event creates a per-beaver memory entry referencing the
 * event itself, with a signed valence and a strength that decays over
 * time (persistence, not permanence). The aggregate memory influence
 * feeds real later behavior: it raises chronic stress (P5-03) measurably
 * more than a beaver with no such memory.
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
import { recordMemory, getMemories, memoryInfluence, tickMemoryDecay } from "../../src/sim/creatures/Memory.js";
import { tickStress, getStress } from "../../src/sim/creatures/Stress.js";

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
  const random = new RandomStreams(502);
  const events = new EventLog(entities);
  return { clock, random, entities, components, grid, terrain, events, water, weather };
}

describe("P5-02 -- Memories", () => {
  it("significant events create decaying, valenced memories that influence later stress", () => {
    const world = buildWorld();
    const rememberer = spawnBeaver(world, { name: "Rememberer", position: { x: 3, y: 3, z: 3 } });
    const control = spawnBeaver(world, { name: "Control", position: { x: 4, y: 3, z: 4 } });

    const eventId = world.events.record({ tick: 0, eventType: "beaver-fight", subjectIds: [rememberer], location: { x: 3, y: 3, z: 3 } });
    recordMemory(world, rememberer, eventId, -0.9);

    // Valence: the memory references the real event and carries its sign.
    const memories = getMemories(world.components, rememberer)!;
    expect(memories.entries).toHaveLength(1);
    expect(memories.entries[0]!.eventId).toBe(eventId);
    expect(memoryInfluence(world.components, rememberer)).toBeLessThan(0);

    // Persistence: strength decays over time, but the memory survives.
    const strengthBefore = memories.entries[0]!.strength;
    for (let i = 0; i < 500; i++) tickMemoryDecay(world, rememberer);
    const strengthAfter = getMemories(world.components, rememberer)!.entries[0]!.strength;
    expect(strengthAfter).toBeLessThan(strengthBefore);
    expect(strengthAfter).toBeGreaterThan(0);

    // Later behavior: chronic negative memory raises stress measurably more
    // than identical conditions without it.
    for (let i = 0; i < 100; i++) {
      world.clock.advanceTicks(1);
      tickStress(world, rememberer);
      tickStress(world, control);
    }
    expect(getStress(world.components, rememberer)!.level).toBeGreaterThan(getStress(world.components, control)!.level);
  });
});
