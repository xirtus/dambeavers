/**
 * Headless acceptance test for P7-16 -- Wars.
 *
 * Roadmap acceptance test: "multiple battles and territorial/political
 * objectives can compose into one historically tracked war."
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
import { RegionMap } from "../../src/sim/region/RegionMap.js";
import { createSite, getSite, setSite } from "../../src/sim/region/Site.js";
import { claimTerritory, overlappingClaimCells, claimedCellsOfSite, claimsOfSite } from "../../src/sim/politics/Territory.js";
import { territorialWarCause } from "../../src/sim/politics/WarPlanning.js";
import {
  declareWar, attachBattleToWar, endWar, getWar, warBattles, warHistory, warContestedTerritory,
} from "../../src/sim/politics/War.js";
import { startBattle, endBattle } from "../../src/sim/politics/Battle.js";
import { createOrganization, joinOrganization } from "../../src/sim/politics/Organization.js";
import { formMilitaryUnit } from "../../src/sim/politics/Military.js";
import { spawnBeaver } from "../../src/sim/creatures/Beaver.js";
import { activeTreatiesOf, diplomaticStanding } from "../../src/sim/politics/Diplomacy.js";

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
  const random = new RandomStreams(716);
  const events = new EventLog(entities);
  return {
    world: { clock, random, entities, components, grid, terrain, events, water, weather },
    regionMap: new RegionMap(16, 16),
  };
}

describe("P7-16 -- Wars", () => {
  it("multiple battles and territorial objectives compose into one historically tracked war", () => {
    const { world, regionMap } = buildWorld();
    const siteA = createSite(world, regionMap, 4, 4, 5, 100);
    const siteB = createSite(world, regionMap, 6, 4, 5, 100);

    // Real territorial stakes: overlapping claims + genuinely hostile
    // standing = a real territorial war cause.
    claimTerritory(world, regionMap, siteA, 2);
    claimTerritory(world, regionMap, siteB, 2);
    expect(overlappingClaimCells(world, siteA, siteB).length).toBeGreaterThan(0);
    world.events.record({ tick: world.clock.tick, eventType: "raid-looted", subjectIds: [siteA], objectIds: [siteB], location: { x: 0, y: 0, z: 0 } });
    const causeEventId = territorialWarCause(world, siteA, siteB);
    expect(causeEventId).toBeDefined();

    // Declaration chains to the real cause.
    const warId = declareWar(world, siteA, siteB, "territory", causeEventId!);
    const declared = world.events.eventsOfType("war-declared")[0]!;
    expect(declared.causeEventId).toBe(causeEventId);
    expect(getWar(world.components, warId)!.status).toBe("ongoing");

    // Two real battles compose into the SAME war.
    const orgA = createOrganization(world, ["soldier"], world.random.stream("war-org-a"));
    const orgB = createOrganization(world, ["soldier"], world.random.stream("war-org-b"));
    formMilitaryUnit(world, orgA);
    formMilitaryUnit(world, orgB);
    joinOrganization(world, orgA, spawnBeaver(world, { name: "WA1", position: { x: 5, y: 3, z: 5 } }), "soldier");
    joinOrganization(world, orgB, spawnBeaver(world, { name: "WB1", position: { x: 7, y: 3, z: 5 } }), "soldier");
    const battle1 = startBattle(world, siteB, orgA, orgB);
    const battle2 = startBattle(world, siteA, orgA, orgB);
    attachBattleToWar(world, battle1, warId);
    attachBattleToWar(world, battle2, warId);
    expect(warBattles(world, warId).sort()).toEqual([battle1, battle2].sort());
    endBattle(world, battle1, orgA);
    endBattle(world, battle2, orgA);

    // Ending the war has real territorial consequences: contested cells
    // genuinely change hands from loser to winner, a real peace treaty
    // is signed, and the whole arc is recorded.
    const contested = warContestedTerritory(world, warId);
    expect(contested.length).toBeGreaterThan(0);
    const loserCellsBefore = claimedCellsOfSite(world, siteB).length;
    const winnerClaimsBefore = claimsOfSite(world, siteA).length;
    endWar(world, warId, siteA);
    const war = getWar(world.components, warId)!;
    expect(war.status).toBe("ended");
    expect(war.outcome!.winnerSiteId).toBe(siteA);
    expect(war.outcome!.cededCellCount).toBe(contested.length);
    expect(claimedCellsOfSite(world, siteB).length).toBeLessThan(loserCellsBefore);
    // The winner gains a real claim entity over the ceded ground (they
    // already claimed it -- cession is about EXCLUSIVE control, which the
    // zero-overlap assertion below proves).
    expect(claimsOfSite(world, siteA).length).toBeGreaterThan(winnerClaimsBefore);
    expect(overlappingClaimCells(world, siteA, siteB)).toEqual([]);
    expect(world.events.eventsOfType("territory-ceded").length).toBe(1);
    expect(activeTreatiesOf(world, siteA).length).toBe(1); // the peace treaty
    expect(diplomaticStanding(world, siteA, siteB)).toBeLessThanOrEqual(0.2);

    // One historically tracked war: the full real arc, in order.
    const history = warHistory(world, warId);
    const types = history.map((event) => event.eventType);
    expect(types).toContain("war-declared");
    expect(types).toContain("battle-began");
    expect(types).toContain("battle-ended");
    expect(types).toContain("territory-ceded");
    expect(types).toContain("war-ended");
    const ticks = history.map((event) => event.tick);
    expect([...ticks].sort((a, b) => a - b)).toEqual(ticks);
    const warEnded = history.find((event) => event.eventType === "war-ended")!;
    expect(warEnded.causeEventId).toBe(declared.id);

    // Persistence: the war survives save/reload with its battles.
    const restoredMaterials = new MaterialRegistry();
    registerStandardMaterials(restoredMaterials);
    const restored = restoreWorld(JSON.parse(JSON.stringify(snapshotWorld(world))), { componentTypes: ALL_COMPONENT_TYPES, materials: restoredMaterials });
    expect(getWar(restored.components, warId)!.status).toBe("ended");
    expect(warBattles(restored, warId).sort()).toEqual([battle1, battle2].sort());
  });
});
