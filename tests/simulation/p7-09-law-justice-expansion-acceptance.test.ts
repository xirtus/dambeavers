/**
 * Headless acceptance test for P7-09 -- Law and justice expansion.
 *
 * Roadmap acceptance test: "investigation, accusation, judgment, and
 * punishment operate on witnessed/evidenced actions."
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
import { createSite } from "../../src/sim/region/Site.js";
import { spawnBeaver } from "../../src/sim/creatures/Beaver.js";
import { ensureSharedHousehold } from "../../src/sim/creatures/Household.js";
import { setOwner, getOwner } from "../../src/sim/creatures/Ownership.js";
import { isProhibited } from "../../src/sim/creatures/Law.js";
import { establishPolity, bindPolityHousehold, polityLeader } from "../../src/sim/politics/PoliticalEntity.js";
import { selectInitialLeader } from "../../src/sim/politics/Government.js";
import {
  fileAccusation, tickInvestigations, renderJudgment, applyPunishment, judgeOfSite,
  getAccusation, getConfinement, isConfined, evidenceOf,
} from "../../src/sim/politics/Justice.js";
import { getMigrationGroup, MigrationGroupComponent } from "../../src/sim/politics/Migration.js";

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
  const random = new RandomStreams(709);
  const events = new EventLog(entities);
  return {
    world: { clock, random, entities, components, grid, terrain, events, water, weather },
    regionMap: new RegionMap(16, 16),
  };
}

describe("P7-09 -- Law and justice expansion", () => {
  it("investigation, accusation, judgment, and punishment operate on witnessed/evidenced actions", () => {
    const { world, regionMap } = buildWorld();
    const siteId = createSite(world, regionMap, 4, 4, 6, 100);
    establishPolity(world, siteId);

    const thief = spawnBeaver(world, { name: "Thief", position: { x: 5, y: 3, z: 5 } });
    const victim = spawnBeaver(world, { name: "Victim", position: { x: 5, y: 3, z: 6 } });
    const witness = spawnBeaver(world, { name: "Witness", position: { x: 6, y: 3, z: 5 } });
    const judge = spawnBeaver(world, { name: "Judge", position: { x: 6, y: 3, z: 6 } });
    const householdId = ensureSharedHousehold(world, victim, witness);
    ensureSharedHousehold(world, householdId ? victim : victim, judge);
    bindPolityHousehold(world, siteId, householdId);

    // A real theft: the item was the victim's, now in the thief's possession.
    const itemId = world.entities.create("good");
    setOwner(world.components, itemId, { ownerType: "personal", ownerId: victim });
    const violation = isProhibited(world, thief, itemId)!;
    expect(violation.action).toBe("theft");
    setOwner(world.components, itemId, { ownerType: "personal", ownerId: thief }); // real possession

    // Accusation requires REAL evidence: no witness + no physical evidence throws.
    expect(() => fileAccusation(world, victim, violation, [])).toThrow(RangeError);
    // With a real witness on the violation event, the accusation files.
    const accusationId = fileAccusation(world, victim, violation, [witness]);
    const filed = getAccusation(world.components, accusationId)!;
    expect(filed.witnessIds).toContain(witness);
    expect(filed.status).toBe("filed");

    // Investigation derives further witnesses from REAL history: another
    // event at the same place and time makes its subject a witness.
    world.events.record({ tick: world.clock.tick, eventType: "social-interaction", subjectIds: [judge], objectIds: [], location: { x: 5, y: 3, z: 5 } });
    tickInvestigations(world);
    const investigating = getAccusation(world.components, accusationId)!;
    expect(investigating.status).toBe("investigating");
    expect(investigating.witnessIds).toContain(judge);

    // Judgment by the polity's real leader; evidence convicts. (No leader
    // yet = genuinely no judge -- an honest absence, resolved by the
    // polity's own succession once a leader exists.)
    expect(judgeOfSite(world, siteId)).toBeUndefined();
    const leader = selectInitialLeader(world, siteId)!;
    expect(judgeOfSite(world, siteId)).toBe(leader);
    expect(renderJudgment(world, accusationId, leader)).toBe(true);
    expect(getAccusation(world.components, accusationId)!.guilty).toBe(true);
    const judgmentEvent = world.events.eventsOfType("judgment-rendered")[0]!;
    expect(judgmentEvent.causeEventId).toBe(filed.filedEventId);

    // Punishment is a real consequence: the thief's stolen goods transfer
    // to the polity, and confinement is a real until-tick restriction.
    const punishmentEventId = applyPunishment(world, regionMap, accusationId, "confinement", siteId)!;
    expect(isConfined(world, thief)).toBe(true);
    expect(getConfinement(world.components, thief)!.untilTick).toBeGreaterThan(world.clock.tick);
    expect(getConfinement(world.components, thief)!.imposedByEventId).toBe(punishmentEventId);
    expect(world.events.get(punishmentEventId).causeEventId).toBe(judgmentEvent.id);
    expect(evidenceOf(world, accusationId).witnessIds).toContain(witness);

    // Persistence: accusations and confinements survive save/reload.
    const restoredMaterials = new MaterialRegistry();
    registerStandardMaterials(restoredMaterials);
    const restored = restoreWorld(JSON.parse(JSON.stringify(snapshotWorld(world))), { componentTypes: ALL_COMPONENT_TYPES, materials: restoredMaterials });
    expect(getAccusation(restored.components, accusationId)!.guilty).toBe(true);
    expect(isConfined(restored, thief)).toBe(true);

    // Exile: a real migration caused by the punishment itself.
    const thief2 = spawnBeaver(world, { name: "Thief2", position: { x: 7, y: 3, z: 5 } });
    const victim2 = spawnBeaver(world, { name: "Victim2", position: { x: 7, y: 3, z: 6 } });
    const witness2 = spawnBeaver(world, { name: "Witness2", position: { x: 8, y: 3, z: 5 } });
    ensureSharedHousehold(world, thief2, victim2);
    const item2 = world.entities.create("good");
    setOwner(world.components, item2, { ownerType: "personal", ownerId: victim2 });
    const violation2 = isProhibited(world, thief2, item2)!;
    setOwner(world.components, item2, { ownerType: "personal", ownerId: thief2 });
    const accusation2 = fileAccusation(world, victim2, violation2, [witness2]);
    renderJudgment(world, accusation2, leader);
    const destination = createSite(world, regionMap, 10, 10, 2, 200);
    const exileEventId = applyPunishment(world, regionMap, accusation2, "exile", siteId)!;
    const exileEvent = world.events.get(exileEventId);
    const groups = world.components.query(MigrationGroupComponent);
    expect(groups.length).toBe(1);
    const group = getMigrationGroup(world.components, groups[0]!)!;
    expect(group.originSiteId).toBe(siteId);
    expect(group.destinationSiteId).toBe(destination);
    expect(group.reason).toBe("displacement");
    const departure = world.events.get(group.departedEventId);
    expect(departure.causeEventId).toBe(exileEvent.id);
  });
});
