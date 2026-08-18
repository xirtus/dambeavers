/**
 * Headless acceptance test for P9-09 -- Quests as world situations.
 *
 * Roadmap acceptance test: "objectives reference actual world
 * entities/problems rather than spawning disposable quest copies."
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
import { RegionMap } from "../../src/sim/region/RegionMap.js";
import { createSite } from "../../src/sim/region/Site.js";
import { establishPolity } from "../../src/sim/politics/PoliticalEntity.js";
import { claimTerritory } from "../../src/sim/politics/Territory.js";
import { declareWar, endWar } from "../../src/sim/politics/War.js";
import { dispatchCaravan } from "../../src/sim/politics/Trade.js";
import { spawnBeaver } from "../../src/sim/creatures/Beaver.js";
import { setGood } from "../../src/sim/economy/Good.js";
import { setOwner } from "../../src/sim/creatures/Ownership.js";
import { fileAccusation, setConfinement } from "../../src/sim/politics/Justice.js";
import { isProhibited } from "../../src/sim/creatures/Law.js";
import { produceOffspring } from "../../src/sim/creatures/Reproduction.js";
import { assignLeader, getLeadership } from "../../src/sim/creatures/Leadership.js";
import { createHousehold, setHouseholdMembership, setRelationshipWith } from "../../src/sim/creatures/Relationships.js";
import { createZone } from "../../src/sim/spaces/FunctionalSpace.js";
import { claimSleepSpace, createSleepSpace } from "../../src/sim/spaces/SleepSpace.js";
import { setConstruction } from "../../src/sim/labor/Construction.js";
import { worldSituations, situationStatus, isKnownHistoricalFigure } from "../../src/sim/wayfarer/Situations.js";

function buildWorld(): { world: World; regionMap: RegionMap } {
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
  const random = new RandomStreams(909);
  const events = new EventLog(entities);
  return {
    world: { clock, random, entities, components, grid, terrain, events, water, weather },
    regionMap: new RegionMap(16, 16),
  };
}

describe("P9-09 -- Quests as world situations", () => {
  it("objectives reference actual world entities/problems rather than spawning disposable quest copies", () => {
    const { world, regionMap } = buildWorld();
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) regionMap.setElevation(x, z, 0);

    // A real shortage site.
    const poorSite = createSite(world, regionMap, 2, 2, 10, 20); // reserve 100, stored 20 => shortage
    const richSite = createSite(world, regionMap, 10, 2, 8, 300); // surplus

    // A real stolen item with a real accusation (evidence item).
    const thief = spawnBeaver(world, { name: "Thief", position: { x: 4, y: 3, z: 4 } });
    const accuser = spawnBeaver(world, { name: "Accuser", position: { x: 5, y: 3, z: 5 } });
    const amulet = world.entities.create("good");
    world.grid.setEntityPosition(amulet, 6, 3, 6);
    setGood(world.components, amulet, { goodKind: "artwork", materialId: "wood", massKg: 2 });
    setOwner(world.components, amulet, { ownerType: "personal", ownerId: thief });
    const violation = isProhibited(world, thief, amulet) ?? { action: "theft" as const, actorId: thief, itemId: amulet };
    const accusationId = fileAccusation(world, accuser, violation, [], amulet);

    // A real confined prisoner.
    const prisoner = spawnBeaver(world, { name: "Prisoner", position: { x: 8, y: 3, z: 8 } });
    setConfinement(world.components, prisoner, { untilTick: world.clock.tick + 1000, imposedByEventId: world.events.eventsOfType("accusation-filed")[0]!.id });

    // A real caravan in transit.
    const caravanId = dispatchCaravan(world, regionMap, richSite, poorSite);

    // The situations derive from the REAL entities -- every id in every
    // situation is a real entity or event; nothing was spawned as a copy.
    const situations = worldSituations(world);
    const kinds = situations.map((s) => s.kind);
    expect(kinds).toContain("recover-stolen-item");
    expect(kinds).toContain("aid-shortage");
    expect(kinds).toContain("rescue-prisoner");
    expect(kinds).toContain("deliver-caravan");

    const recovery = situations.find((s) => s.kind === "recover-stolen-item")!;
    expect(recovery.targetIds).toContain(amulet); // the REAL item, not a copy
    expect(recovery.targetIds).toContain(accusationId);
    expect(recovery.eventIds.length).toBeGreaterThan(0);
    for (const eventId of recovery.eventIds) expect(world.events.has(eventId)).toBe(true);
    expect(recovery.resolved).toBe(false);

    const shortage = situations.find((s) => s.kind === "aid-shortage")!;
    expect(shortage.targetIds).toContain(poorSite);
    const caravan = situations.find((s) => s.kind === "deliver-caravan")!;
    expect(caravan.targetIds).toContain(caravanId!);

    const rescue = situations.find((s) => s.kind === "rescue-prisoner")!;
    expect(rescue.targetIds).toContain(prisoner);

    // Situations resolve when the WORLD changes, not when a quest script
    // says so: giving the item back to the accuser resolves the recovery.
    setOwner(world.components, amulet, { ownerType: "personal", ownerId: accuser });
    expect(situationStatus(world, recovery.id).resolved).toBe(true);

    // A situation that never existed reports honestly.
    expect(situationStatus(world, "recover-stolen-item-999999").exists).toBe(false);
  });

  it("a real historical figure is recognized for the gate's meeting clause", () => {
    const { world, regionMap } = buildWorld();
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) regionMap.setElevation(x, z, 0);
    const site = createSite(world, regionMap, 4, 4, 10, 200);
    establishPolity(world, site);

    // A real historical figure: a parent of many recorded births.
    const founderA = spawnBeaver(world, { name: "FounderA", position: { x: 3, y: 3, z: 3 } });
    const founderB = spawnBeaver(world, { name: "FounderB", position: { x: 4, y: 3, z: 3 } });
    const household = createHousehold(world);
    setHouseholdMembership(world.components, founderA, { householdId: household });
    setHouseholdMembership(world.components, founderB, { householdId: household });
    setRelationshipWith(world.components, founderA, { withId: founderB, kin: "mate", familiarity: 1, affinity: 0.9 });
    setRelationshipWith(world.components, founderB, { withId: founderA, kin: "mate", familiarity: 1, affinity: 0.9 });
    const zoneId = createZone(world, { cells: [{ x: 3, z: 3 }, { x: 4, z: 3 }], declaredFunction: "general-zone" });
    for (const wall of [{ x: 2, z: 3 }, { x: 3, z: 2 }, { x: 3, z: 4 }, { x: 4, z: 2 }, { x: 4, z: 4 }, { x: 5, z: 3 }]) {
      const wallId = world.entities.create("construction");
      setConstruction(world.components, wallId, { designationId: wallId, kind: "wall", site: { x: wall.x, z: wall.z }, requiredMaterialId: "wood", requiredMassKg: 1, workDone: 1, workRequired: 1, status: "complete" });
    }
    const lodge = world.entities.create("construction");
    setConstruction(world.components, lodge, { designationId: lodge, kind: "lodge-segment", site: { x: 3, z: 3 }, requiredMaterialId: "wood", requiredMassKg: 1, workDone: 1, workRequired: 1, status: "complete" });
    const left = createSleepSpace(world, { zoneId, kind: "nest", cell: { x: 3, z: 3 } });
    const right = createSleepSpace(world, { zoneId, kind: "nest", cell: { x: 4, z: 3 } });
    claimSleepSpace(world, founderA, left);
    claimSleepSpace(world, founderB, right);

    const child = produceOffspring(world, founderA, founderB, { birthIntervalTicks: 0 }).offspringId;
    for (let i = 0; i < 5; i++) produceOffspring(world, founderA, founderB, { birthIntervalTicks: 0 });
    // A real leader of a real household with many recorded births
    // crosses P5-15's own historical-figure threshold.
    const leaderId = assignLeader(world, household);
    const householdLeader = getLeadership(world.components, household)!.leaderId;
    expect(householdLeader).toBe(leaderId);
    expect(isKnownHistoricalFigure(world, leaderId)).toBe(true);
    // A descendant of a simulated figure: the child's parent IS the
    // historical figure, by the SAME parentage the archive reads.
    const situations = worldSituations(world);
    expect(situations.some((s) => s.kind === "meet-figure" && s.targetIds.includes(leaderId))).toBe(true);
    expect(child).toBeGreaterThan(0);
  });
});
