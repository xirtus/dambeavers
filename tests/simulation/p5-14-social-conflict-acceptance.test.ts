/**
 * Headless acceptance test for P5-14 -- Social conflict.
 *
 * Roadmap acceptance test: "grudges/stress can produce arguments or
 * fights through general decision systems."
 *
 * Conflict reuses the SAME general decision-scheduler shape as positive
 * social interaction (idle, adjacent, deterministic pairing): two real
 * rivals with enough combined conflict-proneness (stress x
 * possessiveness) produce a real "argument" or "fight" -- a fight applies
 * real trauma, and either outcome worsens affinity, accumulates grudge,
 * and records a negative memory. A beaver who isn't socially idle is
 * preoccupied with survival and takes no part.
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
import { getHealth, HealthComponent } from "../../src/sim/creatures/Beaver.js";
import { setNeeds } from "../../src/sim/creatures/Needs.js";
import { setRelationshipWith, relationshipWith } from "../../src/sim/creatures/Relationships.js";
import { setWorldTraits } from "../../src/sim/creatures/Traits.js";
import { setStress } from "../../src/sim/creatures/Stress.js";
import { getMemories } from "../../src/sim/creatures/Memory.js";
import { tickConflicts } from "../../src/sim/creatures/Conflict.js";

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
  const random = new RandomStreams(514);
  const events = new EventLog(entities);
  return { clock, random, entities, components, grid, terrain, events, water, weather };
}

function spawn(world: World, name: string, x: number, z: number): EntityId {
  return spawnBeaver(world, { name, position: { x, y: 3, z } });
}

describe("P5-14 -- Social conflict", () => {
  it("grudges and stress produce real arguments or fights through the general scheduler", () => {
    const world = buildWorld();
    const a = spawn(world, "GrudgeA", 16, 16);
    const b = spawn(world, "GrudgeB", 16, 17);

    // Real rivals: well-known, disliked, with an accumulated grudge.
    setRelationshipWith(world.components, a, { withId: b, kin: "unrelated", familiarity: 0.8, affinity: -0.6, grudge: 0.7 });
    setRelationshipWith(world.components, b, { withId: a, kin: "unrelated", familiarity: 0.8, affinity: -0.6, grudge: 0.7 });

    // Combined proneness (stress x possessiveness) clears the real threshold.
    setWorldTraits(world, a, { sociability: 0.5, resilience: 0.5, industriousness: 0.5, possessiveness: 1, assignedTick: 0 });
    setWorldTraits(world, b, { sociability: 0.5, resilience: 0.5, industriousness: 0.5, possessiveness: 1, assignedTick: 0 });
    setStress(world.components, a, { level: 0.8 });
    setStress(world.components, b, { level: 0.8 });

    const healthBeforeA = getHealth(world.components, a)!.fraction;
    const affinityBefore = relationshipWith(world.components, a, b)!.affinity;
    const grudgeBefore = relationshipWith(world.components, a, b)!.grudge!;

    const results = tickConflicts(world, world.random.stream("conflicts"), [a, b]);
    expect(results).toHaveLength(1);
    const result = results[0]!;
    expect(["argument", "fight"]).toContain(result.kind);
    expect(result.participantIds.sort()).toEqual([a, b].sort());

    // Either outcome worsens the relationship and accumulates grudge.
    expect(relationshipWith(world.components, a, b)!.affinity).toBeLessThan(affinityBefore);
    expect(relationshipWith(world.components, a, b)!.grudge).toBeGreaterThan(grudgeBefore);
    // A fight applies real trauma through the ordinary mortality system.
    if (result.kind === "fight") {
      expect(getHealth(world.components, a)!.fraction).toBeLessThan(healthBeforeA);
    }
    // A real negative memory is recorded for each participant.
    expect(getMemories(world.components, a)!.entries.length).toBeGreaterThan(0);
    expect(getMemories(world.components, b)!.entries.length).toBeGreaterThan(0);

    // The general scheduler's gates: a survival-preoccupied beaver (urgent
    // need -> not socially idle) takes no part in any conflict.
    const c = spawn(world, "BusyC", 18, 18);
    const d = spawn(world, "BusyD", 18, 19);
    setRelationshipWith(world.components, c, { withId: d, kin: "unrelated", familiarity: 0.8, affinity: -0.6, grudge: 0.7 });
    setRelationshipWith(world.components, d, { withId: c, kin: "unrelated", familiarity: 0.8, affinity: -0.6, grudge: 0.7 });
    setWorldTraits(world, c, { sociability: 0.5, resilience: 0.5, industriousness: 0.5, possessiveness: 1, assignedTick: 0 });
    setWorldTraits(world, d, { sociability: 0.5, resilience: 0.5, industriousness: 0.5, possessiveness: 1, assignedTick: 0 });
    setStress(world.components, c, { level: 0.8 });
    setStress(world.components, d, { level: 0.8 });
    setNeeds(world.components, c, { hunger: 0.9, thirst: 0, fatigue: 0, thermalComfort: 1 });
    expect(tickConflicts(world, world.random.stream("conflicts-2"), [c, d])).toHaveLength(0);
  });
});
