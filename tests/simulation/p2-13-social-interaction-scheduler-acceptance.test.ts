/**
 * Headless acceptance test for P2-13 -- Social interaction scheduler.
 *
 * Roadmap acceptance test:
 *   "idle/social needs generate interactions without hand-authored
 *   scenes."
 *
 * The setup supplies only ordinary simulation prerequisites: two live
 * beavers with P1-19 relationship edges, P2-06 claimed sleep spaces in a
 * recognized lodge room they are physically standing inside, no urgent
 * survival need, and persistent social pressure. The scheduler emits a
 * generic interaction event and updates relationship state; there is no
 * named scene, dialogue script, or participant teleport.
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
import { BASELINE_NEEDS, setNeeds } from "../../src/sim/creatures/Needs.js";
import { relationshipWith, setRelationshipWith } from "../../src/sim/creatures/Relationships.js";
import {
  SOCIAL_INTERACTION_THRESHOLD,
  getSocialDebugState,
  getSocialState,
  setWorldSocialState,
  tickSocialInteractions,
  tickSocialNeeds,
} from "../../src/sim/creatures/SocialInteraction.js";
import { setConstruction } from "../../src/sim/labor/Construction.js";
import { createZone } from "../../src/sim/spaces/FunctionalSpace.js";
import { claimSleepSpace, createSleepSpace } from "../../src/sim/spaces/SleepSpace.js";

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
  const random = new RandomStreams(213);
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

describe("P2-13 -- Social interaction scheduler", () => {
  it("idle social pressure generates a generic interaction from relationship and lodge occupancy state", () => {
    const { world } = buildFlatWorld();
    const alder = spawnAt(world, "Alder", 3, 3);
    const birch = spawnAt(world, "Birch", 4, 3);
    const zoneId = createClaimedLodgeRoom(world, alder, birch);
    setNeeds(world.components, alder, { ...BASELINE_NEEDS });
    setNeeds(world.components, birch, { ...BASELINE_NEEDS });
    setRelationshipWith(world.components, alder, { withId: birch, kin: "mate", familiarity: 0.4, affinity: 0.2 });
    setRelationshipWith(world.components, birch, { withId: alder, kin: "mate", familiarity: 0.4, affinity: 0.2 });
    setWorldSocialState(world, alder, { socialNeed: SOCIAL_INTERACTION_THRESHOLD - 0.01 });
    setWorldSocialState(world, birch, { socialNeed: SOCIAL_INTERACTION_THRESHOLD - 0.01 });

    tickSocialNeeds(world);
    const beforeAlder = world.grid.positionOf(alder);
    const beforeBirch = world.grid.positionOf(birch);
    const interactions = tickSocialInteractions(world);

    expect(interactions).toHaveLength(1);
    const interaction = interactions[0]!;
    expect(interaction.participantIds).toEqual([alder, birch]);
    expect(interaction.venueZoneId).toBe(zoneId);
    expect(world.grid.positionOf(alder)).toEqual(beforeAlder);
    expect(world.grid.positionOf(birch)).toEqual(beforeBirch);
    expect(getSocialState(world.components, alder)!.socialNeed).toBeLessThan(SOCIAL_INTERACTION_THRESHOLD);
    expect(getSocialState(world.components, birch)!.socialNeed).toBeLessThan(SOCIAL_INTERACTION_THRESHOLD);
    expect(relationshipWith(world.components, alder, birch)).toMatchObject({ kin: "mate", familiarity: 0.5, affinity: 0.23 });

    const event = world.events.get(interaction.eventId);
    expect(event.eventType).toBe("social-interaction");
    expect(event.subjectIds).toEqual([alder, birch]);
    expect(event.objectIds).toEqual([zoneId]);
    expect(getSocialDebugState(world, alder)).toMatchObject({ beaverId: alder, idle: true, venueZoneId: zoneId });

    const restoredMaterials = new MaterialRegistry();
    registerStandardMaterials(restoredMaterials);
    const restored = restoreWorld(JSON.parse(JSON.stringify(snapshotWorld(world))), {
      componentTypes: ALL_COMPONENT_TYPES,
      materials: restoredMaterials,
    });

    expect(getSocialState(restored.components, alder)).toEqual(getSocialState(world.components, alder));
    expect(relationshipWith(restored.components, alder, birch)).toEqual(relationshipWith(world.components, alder, birch));
    expect(restored.events.get(interaction.eventId)).toEqual(event);
  });
});
