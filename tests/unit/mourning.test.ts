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
import { setRelationshipWith } from "../../src/sim/creatures/Relationships.js";
import { MOURNED_EVENT_TYPE, notifyDeathForMourning } from "../../src/sim/creatures/Mourning.js";

function buildFlatWorld(sizeX = 10, sizeY = 8, sizeZ = 10, floor = 2): World {
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
  const random = new RandomStreams(1);
  const events = new EventLog(entities);
  return { clock, random, entities, components, grid, terrain, events, water, weather };
}

function spawnAt(world: World, name: string, x: number, z: number): EntityId {
  const floor = world.grid.surfaceY(x, z)!;
  return spawnBeaver(world, { name, position: { x, y: floor + 1, z } });
}

describe("Mourning", () => {
  it("records one shared event naming every live beaver with a relationship edge toward the deceased", () => {
    const world = buildFlatWorld();
    const deceased = spawnAt(world, "Victim", 3, 3);
    const mate = spawnAt(world, "Mate", 4, 3);
    const acquaintance = spawnAt(world, "Acquaintance", 5, 3);
    const stranger = spawnAt(world, "Stranger", 6, 3);
    setRelationshipWith(world.components, mate, { withId: deceased, kin: "mate", familiarity: 0.9, affinity: 0.8 });
    setRelationshipWith(world.components, acquaintance, { withId: deceased, kin: "unrelated", familiarity: 0.2, affinity: 0 });
    // stranger has no edge at all toward the deceased.

    const eventId = notifyDeathForMourning(world, deceased, world.grid.positionOf(deceased)!);
    expect(eventId).toBeDefined();
    const event = world.events.get(eventId!);
    expect(event.eventType).toBe(MOURNED_EVENT_TYPE);
    expect(new Set(event.subjectIds)).toEqual(new Set([mate, acquaintance]));
    expect(event.subjectIds).not.toContain(stranger);
    expect(event.subjectIds).not.toContain(deceased);
    expect(event.objectIds).toEqual([deceased]);
  });

  it("records nothing if no living beaver had any relationship with the deceased", () => {
    const world = buildFlatWorld();
    const deceased = spawnAt(world, "Victim", 3, 3);
    spawnAt(world, "Stranger", 4, 3);
    expect(notifyDeathForMourning(world, deceased, world.grid.positionOf(deceased)!)).toBeUndefined();
  });

  it("only counts a mourner's own OUTGOING edge -- an edge the deceased held toward a stranger doesn't make that stranger mourn", () => {
    const world = buildFlatWorld();
    const deceased = spawnAt(world, "Victim", 3, 3);
    const oneWayKnown = spawnAt(world, "OneWayKnown", 4, 3);
    // The DECEASED had an edge toward oneWayKnown, but oneWayKnown never had one back.
    setRelationshipWith(world.components, deceased, { withId: oneWayKnown, kin: "unrelated", familiarity: 0.5, affinity: 0.1 });

    expect(notifyDeathForMourning(world, deceased, world.grid.positionOf(deceased)!)).toBeUndefined();
  });
});
