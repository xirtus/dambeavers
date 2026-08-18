/**
 * Headless acceptance test for P7-08 -- Government forms.
 *
 * Roadmap acceptance test: "leadership selection/succession differs
 * between data-defined government structures."
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
import { spawnBeaver } from "../../src/sim/creatures/Beaver.js";
import { ensureSharedHousehold } from "../../src/sim/creatures/Household.js";
import { setRelationshipWith } from "../../src/sim/creatures/Relationships.js";
import { practiceSkill } from "../../src/sim/creatures/SkillProgression.js";
import { establishPolity, bindPolityHousehold, getPoliticalEntity, polityLeader, setPoliticalEntity } from "../../src/sim/politics/PoliticalEntity.js";
import { successorFor, tickSuccession, governmentForm } from "../../src/sim/politics/Government.js";
import { getLeadership } from "../../src/sim/creatures/Leadership.js";

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
  const random = new RandomStreams(708);
  const events = new EventLog(entities);
  return {
    world: { clock, random, entities, components, grid, terrain, events, water, weather },
    regionMap: new RegionMap(16, 16),
  };
}

describe("P7-08 -- Government forms", () => {
  it("leadership selection and succession differ between data-defined government structures", () => {
    const { world, regionMap } = buildWorld();
    const siteId = createSite(world, regionMap, 4, 4, 5, 100);
    establishPolity(world, siteId);

    const elder = spawnBeaver(world, { name: "Elder", position: { x: 5, y: 3, z: 5 } });
    const heir = spawnBeaver(world, { name: "Heir", position: { x: 5, y: 3, z: 6 } });
    const beloved = spawnBeaver(world, { name: "Beloved", position: { x: 5, y: 3, z: 7 } });
    const confidant = spawnBeaver(world, { name: "Confidant", position: { x: 5, y: 3, z: 8 } });
    const householdId = ensureSharedHousehold(world, elder, heir);
    ensureSharedHousehold(world, elder, beloved);
    ensureSharedHousehold(world, elder, confidant);
    bindPolityHousehold(world, siteId, householdId);

    // Real, DIFFERENT strengths: elder = most skilled; heir = leader's
    // kin; beloved = best reputation; confidant = leader's favourite.
    practiceSkill(world.components, elder, "crafting", 50);
    world.events.record({ tick: 0, eventType: "leader-appointed", subjectIds: [beloved], objectIds: [householdId], location: { x: 5, y: 3, z: 7 } });
    world.events.record({ tick: 0, eventType: "leader-appointed", subjectIds: [beloved], objectIds: [householdId], location: { x: 5, y: 3, z: 7 } });

    const elderCouncil = governmentForm("elder-council")!;
    const lineage = governmentForm("lineage")!;
    const acclamation = governmentForm("acclamation")!;
    const appointment = governmentForm("appointment")!;

    // Real kinship and affinity edges (the state the inheritance and
    // appointment rules read).
    setRelationshipWith(world.components, elder, { withId: heir, kin: "child", familiarity: 0.8, affinity: 0.4 });
    setRelationshipWith(world.components, elder, { withId: confidant, kin: "unrelated", familiarity: 0.9, affinity: 0.9 });

    // The SAME state yields DIFFERENT successors under different forms.
    expect(successorFor(world, householdId, elderCouncil)).toBe(elder);       // highest skill
    expect(successorFor(world, householdId, lineage, elder)).toBe(heir);      // leader's kin
    expect(successorFor(world, householdId, acclamation)).toBe(beloved);      // best reputation
    expect(successorFor(world, householdId, appointment, elder)).toBe(confidant);

    // Real succession through the site's own form. First selection under
    // the default elder-council names the most skilled; then the leader
    // dies, the polity's form changes to lineage, and succession inherits
    // through the DEAD leader's own kin edges.
    expect(tickSuccession(world, siteId)).toBe(elder);
    expect(polityLeader(world, siteId)).toBe(elder);
    world.entities.destroy(elder);
    setPoliticalEntity(world.components, siteId, { ...getPoliticalEntity(world.components, siteId)!, governmentFormId: "lineage" });
    expect(tickSuccession(world, siteId)).toBe(heir);
    expect(polityLeader(world, siteId)).toBe(heir);
    expect(getLeadership(world.components, householdId)!.leaderId).toBe(heir);

    // A live leader blocks succession (a no-op returning them).
    expect(tickSuccession(world, siteId)).toBe(heir);

    // The succession history is the real appointment-event chain.
    const appointments = world.events.eventsOfType("leader-appointed");
    expect(appointments.length).toBeGreaterThanOrEqual(2);
    const last = appointments[appointments.length - 1]!;
    expect(last.causeEventId).toBeDefined();
  });
});
