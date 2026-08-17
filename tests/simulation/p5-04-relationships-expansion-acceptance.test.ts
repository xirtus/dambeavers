/**
 * Headless acceptance test for P5-04 -- Relationships expansion.
 *
 * Roadmap acceptance test: "relationship state changes from shared events
 * and interactions."
 *
 * Bond labels are live-derived from real familiarity/affinity (never a
 * stored, driftable label): a shared positive interaction through the
 * real P2-13 social scheduler raises familiarity and can change the
 * derived bond. Mentorship and colleague status are live-derived facts
 * from real skill gaps and real shared labor kinds.
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
import { setNeeds, BASELINE_NEEDS } from "../../src/sim/creatures/Needs.js";
import { setRelationshipWith, relationshipWith } from "../../src/sim/creatures/Relationships.js";
import { socialBond, socialBondBetween, isMentorOf, areColleagues } from "../../src/sim/creatures/RelationshipTypes.js";
import { setWorldSocialState, tickSocialInteractions } from "../../src/sim/creatures/SocialInteraction.js";
import { setConstruction } from "../../src/sim/labor/Construction.js";
import { createZone } from "../../src/sim/spaces/FunctionalSpace.js";
import { createSleepSpace, claimSleepSpace } from "../../src/sim/spaces/SleepSpace.js";
import { createDesignation } from "../../src/sim/jobs/Designation.js";
import { generateJobs } from "../../src/sim/jobs/Job.js";
import { reserveJob } from "../../src/sim/jobs/JobBoard.js";

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
  const random = new RandomStreams(504);
  const events = new EventLog(entities);
  return { clock, random, entities, components, grid, terrain, events, water, weather };
}

function spawn(world: World, name: string, x: number, z: number): EntityId {
  return spawnBeaver(world, { name, position: { x, y: 3, z } });
}

describe("P5-04 -- Relationships expansion", () => {
  it("bond labels derive live from relationship state, and a shared interaction changes them", () => {
    const world = buildWorld();

    // Live-derived labels: familiarity/affinity thresholds classify bonds;
    // a grudge field coexists as P5-14's accumulator.
    const a = spawn(world, "A", 5, 5);
    const b = spawn(world, "B", 5, 6);
    setRelationshipWith(world.components, a, { withId: b, kin: "unrelated", familiarity: 0.1, affinity: 0 });
    expect(socialBond(relationshipWith(world.components, a, b))).toBe("stranger");
    setRelationshipWith(world.components, a, { withId: b, kin: "unrelated", familiarity: 0.8, affinity: 0.6 });
    expect(socialBond(relationshipWith(world.components, a, b))).toBe("friend");
    setRelationshipWith(world.components, a, { withId: b, kin: "unrelated", familiarity: 0.8, affinity: -0.6, grudge: 0.9 });
    expect(socialBond(relationshipWith(world.components, a, b))).toBe("rival");

    // A shared positive interaction through the REAL P2-13 scheduler
    // changes relationship state: familiarity rises on both sides.
    const c = spawn(world, "C", 8, 8);
    const d = spawn(world, "D", 9, 8);
    const zoneId = createZone(world, { cells: [{ x: 8, z: 8 }, { x: 9, z: 8 }], declaredFunction: "general-zone" });
    for (const wall of [{ x: 7, z: 8 }, { x: 8, z: 7 }, { x: 8, z: 9 }, { x: 9, z: 7 }, { x: 9, z: 9 }, { x: 10, z: 8 }]) {
      const wallId = world.entities.create("construction");
      setConstruction(world.components, wallId, { designationId: wallId, kind: "wall", site: wall, requiredMaterialId: "wood", requiredMassKg: 1, workDone: 1, workRequired: 1, status: "complete" });
    }
    const lodgeId = world.entities.create("construction");
    setConstruction(world.components, lodgeId, { designationId: lodgeId, kind: "lodge-segment", site: { x: 8, z: 8 }, requiredMaterialId: "wood", requiredMassKg: 1, workDone: 1, workRequired: 1, status: "complete" });
    const spaceC = createSleepSpace(world, { zoneId, kind: "nest", cell: { x: 8, z: 8 } });
    const spaceD = createSleepSpace(world, { zoneId, kind: "nest", cell: { x: 9, z: 8 } });
    claimSleepSpace(world, c, spaceC);
    claimSleepSpace(world, d, spaceD);
    setNeeds(world.components, c, { ...BASELINE_NEEDS });
    setNeeds(world.components, d, { ...BASELINE_NEEDS });
    setRelationshipWith(world.components, c, { withId: d, kin: "unrelated", familiarity: 0.45, affinity: 0.3 });
    setRelationshipWith(world.components, d, { withId: c, kin: "unrelated", familiarity: 0.45, affinity: 0.3 });
    setWorldSocialState(world, c, { socialNeed: 0.9 });
    setWorldSocialState(world, d, { socialNeed: 0.9 });
    const bondBefore = socialBondBetween(world.components, c, d);
    tickSocialInteractions(world);
    expect(relationshipWith(world.components, c, d)!.familiarity).toBeGreaterThan(0.45);
    expect(relationshipWith(world.components, d, c)!.familiarity).toBeGreaterThan(0.45);
    expect(bondBefore).not.toBe("friend"); // familiarity 0.45 -> below the friend threshold
    expect(socialBondBetween(world.components, c, d)).toBe("friend"); // the shared interaction lifted it

    // Mentorship: derived from a real skill gap between related beavers.
    setSkills(world.components, a, { levels: { woodcutting: 10 } });
    setSkills(world.components, b, { levels: { woodcutting: 1 } });
    setRelationshipWith(world.components, a, { withId: b, kin: "unrelated", familiarity: 0.3, affinity: 0 });
    setRelationshipWith(world.components, b, { withId: a, kin: "unrelated", familiarity: 0.3, affinity: 0 });
    expect(isMentorOf(world.components, a, b, "woodcutting")).toBe(true);
    expect(isMentorOf(world.components, b, a, "woodcutting")).toBe(false);

    // Colleagues: derived from both holding a job of the same real labor kind.
    const e = spawn(world, "E", 12, 12);
    const f = spawn(world, "F", 12, 13);
    const designationE = createDesignation(world, "cut-tree", { x: 14, z: 14 });
    const designationF = createDesignation(world, "cut-tree", { x: 15, z: 15 });
    const [jobE] = generateJobs(world, designationE);
    const [jobF] = generateJobs(world, designationF);
    reserveJob(world.components, world.entities, jobE!, e);
    reserveJob(world.components, world.entities, jobF!, f);
    expect(areColleagues(world.components, world.entities, e, f)).toBe(true);
  });
});
