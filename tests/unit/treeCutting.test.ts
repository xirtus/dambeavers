import { describe, expect, it } from "vitest";
import { EntityIdRegistry } from "../../src/sim/core/EntityId.js";
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
import type { NavigationProfile } from "../../src/sim/navigation/Pathfinding.js";
import { setPlant, harvestableWoodMassKg } from "../../src/sim/ecology/Plant.js";
import { PlantSpeciesRegistry } from "../../src/sim/ecology/PlantSpecies.js";
import { registerStandardPlantSpecies } from "../../src/sim/ecology/standardPlantSpecies.js";
import { spawnBeaver, setSkills } from "../../src/sim/creatures/Beaver.js";
import { getDesignation, setDesignation } from "../../src/sim/jobs/Designation.js";
import { getJob } from "../../src/sim/jobs/Job.js";
import { getLog } from "../../src/sim/labor/Log.js";
import {
  designateTreeCut,
  generateTreeCutJob,
  getTreeCutProgress,
  hasTreeCuttingCapability,
  isEligibleForTreeCut,
  tickTreeCutJob,
  WORK_PER_KG,
} from "../../src/sim/labor/TreeCutting.js";

const PROFILE: NavigationProfile = { canSwim: true, maxWadingDepth: 0.5 };

function buildFlatWorld(sizeX = 12, sizeY = 8, sizeZ = 12, floor = 2): { world: World; materials: MaterialRegistry; water: WaterField; plantSpecies: PlantSpeciesRegistry } {
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
  const plantSpecies = new PlantSpeciesRegistry();
  registerStandardPlantSpecies(plantSpecies);
  const clock = new SimulationClock({ tickRateHz: 20 });
  const random = new RandomStreams(1);
  const events = new EventLog(entities);
  const world: World = { clock, random, entities, components, grid, terrain, events, water, weather };
  return { world, materials, water, plantSpecies };
}

function spawnTree(world: World, x: number, z: number, speciesId = "aspen", ageTicks = 20_000) {
  const id = world.entities.create("tree");
  const floor = world.grid.surfaceY(x, z)!;
  world.grid.setEntityPosition(id, x, floor + 1, z);
  setPlant(world.components, id, { speciesId, ageTicks, health: 1 });
  return id;
}

function spawnAt(world: World, x: number, z: number, name = "Worker") {
  const floor = world.grid.surfaceY(x, z)!;
  return spawnBeaver(world, { name, position: { x, y: floor + 1, z } });
}

function wallOffColumn(world: World, x: number, sizeZ: number): void {
  for (let z = 0; z < sizeZ; z++) {
    for (let y = 3; y < world.grid.dims.sizeY; y++) world.terrain.setMaterial(x, y, z, "stone");
  }
}

describe("designateTreeCut", () => {
  it("creates a 'cut-tree' designation targeting the tree's column and entity", () => {
    const { world } = buildFlatWorld();
    const tree = spawnTree(world, 4, 4);
    const id = designateTreeCut(world, tree);
    expect(getDesignation(world.components, id)).toEqual({
      kind: "cut-tree",
      target: { x: 4, z: 4 },
      status: "active",
      targetEntity: tree,
    });
  });

  it("throws for a non-tree entity", () => {
    const { world } = buildFlatWorld();
    const beaver = spawnAt(world, 0, 0);
    expect(() => designateTreeCut(world, beaver)).toThrow(RangeError);
  });

  it("throws for a dead tree", () => {
    const { world } = buildFlatWorld();
    const tree = spawnTree(world, 4, 4);
    world.entities.destroy(tree);
    expect(() => designateTreeCut(world, tree)).toThrow(RangeError);
  });
});

describe("generateTreeCutJob", () => {
  it("creates one job with correct target and a TreeCutProgress derived from the tree's real mass", () => {
    const { world, materials, plantSpecies } = buildFlatWorld();
    const tree = spawnTree(world, 4, 4, "aspen", 20_000);
    const designationId = designateTreeCut(world, tree);

    const [jobId] = generateTreeCutJob(world, materials, plantSpecies, designationId);

    expect(getJob(world.components, jobId!)).toEqual({ designationId, target: { x: 4, z: 4 }, status: "unclaimed" });
    const progress = getTreeCutProgress(world.components, jobId!)!;
    expect(progress.treeId).toBe(tree);
    expect(progress.workDone).toBe(0);

    const species = plantSpecies.get("aspen");
    const expectedMass = harvestableWoodMassKg(species, { speciesId: "aspen", ageTicks: 20_000, health: 1 }, materials.get("wood"));
    expect(progress.workRequired).toBeCloseTo(expectedMass * WORK_PER_KG, 10);
  });

  it("a bigger/older tree requires more work than a smaller/younger one", () => {
    const { world, materials, plantSpecies } = buildFlatWorld();
    const young = spawnTree(world, 2, 2, "aspen", 1000);
    const mature = spawnTree(world, 6, 6, "aspen", 20_000);
    const [youngJob] = generateTreeCutJob(world, materials, plantSpecies, designateTreeCut(world, young));
    const [matureJob] = generateTreeCutJob(world, materials, plantSpecies, designateTreeCut(world, mature));

    expect(getTreeCutProgress(world.components, matureJob!)!.workRequired).toBeGreaterThan(
      getTreeCutProgress(world.components, youngJob!)!.workRequired,
    );
  });

  it("throws for a designation that isn't 'cut-tree'", () => {
    const { world, materials, plantSpecies } = buildFlatWorld();
    const designationId = world.entities.create("designation");
    // deliberately a "go-to"-shaped designation
    setDesignation(world.components, designationId, { kind: "go-to", target: { x: 1, z: 1 }, status: "active" });
    expect(() => generateTreeCutJob(world, materials, plantSpecies, designationId)).toThrow(RangeError);
  });
});

describe("hasTreeCuttingCapability / isEligibleForTreeCut", () => {
  it("every beaver currently has the capability (no tool system exists yet)", () => {
    const { world } = buildFlatWorld();
    const beaver = spawnAt(world, 0, 0);
    expect(hasTreeCuttingCapability(world.entities, world.components, beaver)).toBe(true);
  });

  it("composes the generic eligibility check with the capability check", () => {
    const { world, materials, plantSpecies } = buildFlatWorld();
    const beaver = spawnAt(world, 0, 0);
    const tree = spawnTree(world, 4, 4);
    const [jobId] = generateTreeCutJob(world, materials, plantSpecies, designateTreeCut(world, tree));
    expect(isEligibleForTreeCut(world.entities, world.components, beaver, jobId!)).toBe(true);
  });
});

describe("tickTreeCutJob", () => {
  it("returns 'idle' when there are no candidate jobs", () => {
    const { world, materials, water, plantSpecies } = buildFlatWorld();
    const beaver = spawnAt(world, 0, 0);
    const outcome = tickTreeCutJob(world.grid, world.terrain, water, materials, plantSpecies, world.entities, world.components, beaver, PROFILE, []);
    expect(outcome).toBe("idle");
  });

  it("assigns a job and travels to the tree before doing any work", () => {
    const { world, materials, water, plantSpecies } = buildFlatWorld();
    const beaver = spawnAt(world, 0, 0);
    const tree = spawnTree(world, 5, 0);
    const [jobId] = generateTreeCutJob(world, materials, plantSpecies, designateTreeCut(world, tree));

    const outcome = tickTreeCutJob(world.grid, world.terrain, water, materials, plantSpecies, world.entities, world.components, beaver, PROFILE, [jobId!]);

    expect(outcome).toBe("assigned");
    expect(getJob(world.components, jobId!)!.reservedBy).toBe(beaver);
    expect(getTreeCutProgress(world.components, jobId!)!.workDone).toBe(0); // no work yet -- still traveling
  });

  it("accumulates real work once at the tree, and a skilled beaver progresses faster than an unskilled one", () => {
    const { world: worldA, materials, water, plantSpecies } = buildFlatWorld();
    const beaverA = spawnAt(worldA, 4, 5); // adjacent to the tree already
    const treeA = spawnTree(worldA, 4, 4);
    const [jobA] = generateTreeCutJob(worldA, materials, plantSpecies, designateTreeCut(worldA, treeA));
    tickTreeCutJob(worldA.grid, worldA.terrain, water, materials, plantSpecies, worldA.entities, worldA.components, beaverA, PROFILE, [jobA!]); // travel (1 step, arrives)
    const resultA = tickTreeCutJob(worldA.grid, worldA.terrain, water, materials, plantSpecies, worldA.entities, worldA.components, beaverA, PROFILE, [jobA!]); // work

    expect(resultA).toBe("working");
    const workDoneUnskilled = getTreeCutProgress(worldA.components, jobA!)!.workDone;
    expect(workDoneUnskilled).toBeGreaterThan(0);

    const { world: worldB } = buildFlatWorld();
    const beaverB = spawnAt(worldB, 4, 5);
    setSkills(worldB.components, beaverB, { levels: { woodcutting: 5 } });
    const treeB = spawnTree(worldB, 4, 4);
    const [jobB] = generateTreeCutJob(worldB, materials, plantSpecies, designateTreeCut(worldB, treeB));
    tickTreeCutJob(worldB.grid, worldB.terrain, water, materials, plantSpecies, worldB.entities, worldB.components, beaverB, PROFILE, [jobB!]);
    tickTreeCutJob(worldB.grid, worldB.terrain, water, materials, plantSpecies, worldB.entities, worldB.components, beaverB, PROFILE, [jobB!]);
    const workDoneSkilled = getTreeCutProgress(worldB.components, jobB!)!.workDone;

    expect(workDoneSkilled).toBeGreaterThan(workDoneUnskilled);
  });

  it("fells the tree and produces log entities whose combined mass exactly equals the tree's harvestable mass", () => {
    const { world, materials, water, plantSpecies } = buildFlatWorld();
    const beaver = spawnAt(world, 4, 5);
    const tree = spawnTree(world, 4, 4, "aspen", 10_000); // half-grown -- non-round mass, exercises the log-splitting remainder
    const species = plantSpecies.get("aspen");
    const expectedTotalMass = harvestableWoodMassKg(species, { speciesId: "aspen", ageTicks: 10_000, health: 1 }, materials.get("wood"));
    const [jobId] = generateTreeCutJob(world, materials, plantSpecies, designateTreeCut(world, tree));
    const designationId = getJob(world.components, jobId!)!.designationId;

    let outcome: string;
    let iterations = 0;
    do {
      outcome = tickTreeCutJob(world.grid, world.terrain, water, materials, plantSpecies, world.entities, world.components, beaver, PROFILE, [jobId!]);
      iterations++;
      expect(iterations).toBeLessThan(200);
    } while (outcome === "assigned" || outcome === "traveling" || outcome === "working");

    expect(outcome).toBe("felled");
    expect(world.entities.isLive(tree)).toBe(false); // tree removed
    expect(getJob(world.components, jobId!)!.status).toBe("completed");
    expect(getDesignation(world.components, designationId)!.status).toBe("completed");

    const logs = world.entities.liveIdsOfKind("log");
    expect(logs.length).toBeGreaterThan(1); // the remainder produced more than one log
    const totalLogMass = logs.reduce((sum, id) => sum + getLog(world.components, id)!.massKg, 0);
    expect(totalLogMass).toBeCloseTo(expectedTotalMass, 10);
    for (const id of logs) {
      expect(getLog(world.components, id)!.materialId).toBe("wood");
      expect(world.grid.positionOf(id)).toEqual({ x: 4, y: world.grid.surfaceY(4, 4)! + 1, z: 4 });
    }
  });

  it("requeues (not permanently fails) a job whose route becomes blocked mid-journey", () => {
    const { world, materials, water, plantSpecies } = buildFlatWorld(8, 8, 3, 2);
    const beaver = spawnAt(world, 0, 0);
    const tree = spawnTree(world, 6, 0);
    const [jobId] = generateTreeCutJob(world, materials, plantSpecies, designateTreeCut(world, tree));

    const first = tickTreeCutJob(world.grid, world.terrain, water, materials, plantSpecies, world.entities, world.components, beaver, PROFILE, [jobId!]);
    expect(first).toBe("assigned");

    wallOffColumn(world, 3, 3);

    const second = tickTreeCutJob(world.grid, world.terrain, water, materials, plantSpecies, world.entities, world.components, beaver, PROFILE, [jobId!]);
    expect(second).toBe("requeued");
    expect(getJob(world.components, jobId!)!.status).toBe("unclaimed");
  });

  it("fails outright (does not retry forever) if the tree is destroyed out from under an in-progress job", () => {
    const { world, materials, water, plantSpecies } = buildFlatWorld();
    const beaver = spawnAt(world, 4, 5);
    const tree = spawnTree(world, 4, 4);
    const [jobId] = generateTreeCutJob(world, materials, plantSpecies, designateTreeCut(world, tree));
    tickTreeCutJob(world.grid, world.terrain, water, materials, plantSpecies, world.entities, world.components, beaver, PROFILE, [jobId!]); // travel/arrive

    world.entities.destroy(tree); // defensive scenario -- nothing else currently does this

    const outcome = tickTreeCutJob(world.grid, world.terrain, water, materials, plantSpecies, world.entities, world.components, beaver, PROFILE, [jobId!]);
    expect(outcome).toBe("failed");
    expect(getJob(world.components, jobId!)!.status).toBe("failed");
  });

  it("REGRESSION: deleting the assigned worker mid-cut does not delete the designation, and another eligible beaver takes over the SAME job and finishes it", () => {
    const { world, materials, water, plantSpecies } = buildFlatWorld();
    const first = spawnAt(world, 4, 5, "First");
    const second = spawnAt(world, 4, 3, "Second");
    const tree = spawnTree(world, 4, 4, "aspen", 5_000); // modest tree -- a few ticks of work
    const [jobId] = generateTreeCutJob(world, materials, plantSpecies, designateTreeCut(world, tree));
    const designationId = getJob(world.components, jobId!)!.designationId;

    tickTreeCutJob(world.grid, world.terrain, water, materials, plantSpecies, world.entities, world.components, first, PROFILE, [jobId!]); // assigned, travels/arrives
    tickTreeCutJob(world.grid, world.terrain, water, materials, plantSpecies, world.entities, world.components, first, PROFILE, [jobId!]); // some real work
    expect(getTreeCutProgress(world.components, jobId!)!.workDone).toBeGreaterThan(0);

    world.entities.destroy(first);

    expect(world.entities.isLive(designationId)).toBe(true);
    expect(getDesignation(world.components, designationId)!.status).toBe("active");

    let outcome: string;
    let iterations = 0;
    do {
      outcome = tickTreeCutJob(world.grid, world.terrain, water, materials, plantSpecies, world.entities, world.components, second, PROFILE, [jobId!]);
      iterations++;
      expect(iterations).toBeLessThan(200);
    } while (outcome === "assigned" || outcome === "traveling" || outcome === "working");

    expect(outcome).toBe("felled");
    expect(getJob(world.components, jobId!)!.reservedBy).toBe(second);
    expect(getDesignation(world.components, designationId)!.status).toBe("completed");
  });

  it("two concurrent designations on two different trees, offered to the SAME beaver pool every tick, are each independently claimed and felled without interference", () => {
    const { world, materials, water, plantSpecies } = buildFlatWorld();
    const near = spawnAt(world, 0, 0, "Near");
    const far = spawnAt(world, 11, 11, "Far");
    const treeNear = spawnTree(world, 2, 2, "aspen", 5_000);
    const treeFar = spawnTree(world, 9, 9, "aspen", 5_000);
    const jobNear = generateTreeCutJob(world, materials, plantSpecies, designateTreeCut(world, treeNear))[0]!;
    const jobFar = generateTreeCutJob(world, materials, plantSpecies, designateTreeCut(world, treeFar))[0]!;

    for (let tick = 0; tick < 100; tick++) {
      for (const beaver of [near, far]) {
        tickTreeCutJob(world.grid, world.terrain, water, materials, plantSpecies, world.entities, world.components, beaver, PROFILE, [jobNear, jobFar]);
      }
    }

    // Each beaver claimed and finished the tree nearer to itself, not a coin flip.
    expect(getJob(world.components, jobNear)!.reservedBy).toBe(near);
    expect(getJob(world.components, jobFar)!.reservedBy).toBe(far);
    expect(getJob(world.components, jobNear)!.status).toBe("completed");
    expect(getJob(world.components, jobFar)!.status).toBe("completed");
    expect(world.entities.isLive(treeNear)).toBe(false);
    expect(world.entities.isLive(treeFar)).toBe(false);

    // Distinct log piles at each tree's own former column -- no collision/overwrite.
    const logsNearTree = world.grid.entitiesAt(2, world.grid.surfaceY(2, 2)! + 1, 2).filter((id) => world.entities.kindOf(id) === "log");
    const logsFarTree = world.grid.entitiesAt(9, world.grid.surfaceY(9, 9)! + 1, 9).filter((id) => world.entities.kindOf(id) === "log");
    expect(logsNearTree.length).toBeGreaterThan(0);
    expect(logsFarTree.length).toBeGreaterThan(0);
    expect(world.entities.liveIdsOfKind("log")).toHaveLength(logsNearTree.length + logsFarTree.length);
  });
});
