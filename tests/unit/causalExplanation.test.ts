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
import type { NavigationProfile } from "../../src/sim/navigation/Pathfinding.js";
import { setJob } from "../../src/sim/jobs/Job.js";
import { createDesignation } from "../../src/sim/jobs/Designation.js";
import { spawnBeaver } from "../../src/sim/creatures/Beaver.js";
import { setBreath, BASELINE_BREATH } from "../../src/sim/creatures/Respiration.js";
import { die } from "../../src/sim/creatures/Mortality.js";
import { designateConstruction, getConstruction, setConstruction } from "../../src/sim/labor/Construction.js";
import { applyDamSegment, removeDamSegmentLayer } from "../../src/sim/hydrology/Dam.js";
import {
  explainUnreachable,
  explainJobStalled,
  explainWaterRose,
  explainDeath,
  explainPlantDeath,
} from "../../src/sim/history/CausalExplanation.js";

const PROFILE: NavigationProfile = { canSwim: false, maxWadingDepth: 0.4 };

function buildFlatWorld(sizeX = 14, sizeY = 8, sizeZ = 14, floor = 2): { world: World; materials: MaterialRegistry; water: WaterField } {
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
  const world: World = { clock, random, entities, components, grid, terrain, events, water, weather };
  return { world, materials, water };
}

function completedDamSegmentConstruction(world: World, site: { x: number; z: number }): EntityId {
  const constructionId = designateConstruction(world, "dam-segment", site);
  const construction = getConstruction(world.components, constructionId)!;
  setConstruction(world.components, constructionId, { ...construction, status: "complete", workDone: construction.workRequired });
  return constructionId;
}

function spawnAt(world: World, x: number, z: number, name = "Worker"): EntityId {
  const floor = world.grid.surfaceY(x, z)!;
  const id = spawnBeaver(world, { name, position: { x, y: floor + 1, z } });
  setBreath(world.components, id, { ...BASELINE_BREATH });
  return id;
}

describe("explainUnreachable", () => {
  it("reports a directly blocked destination (too deep to cross)", () => {
    const { world, materials, water } = buildFlatWorld();
    water.setDepth(6, 6, 2); // far beyond PROFILE's 0.4 wading depth, and PROFILE can't swim
    const explanation = explainUnreachable(world, water, materials, PROFILE, { x: 1, z: 1 }, { x: 6, z: 6 });
    expect(explanation.steps).toHaveLength(1);
    expect(explanation.steps[0]!.description).toContain("too deep");
  });

  it("reports a destination with no ground", () => {
    // A grid larger than the terrain actually fills -- x >= 6 is genuinely
    // ungenerated (in-bounds, but no real ground), not merely out of bounds.
    const bigger = buildBiggerWorld();
    const explanation = explainUnreachable(bigger.world, bigger.water, bigger.materials, PROFILE, { x: 1, z: 1 }, { x: 9, z: 1 });
    expect(explanation.steps[0]!.description).toContain("no real ground");
  });

  it("reports genuine reachability when nothing actually blocks the route", () => {
    const { world, materials, water } = buildFlatWorld();
    const explanation = explainUnreachable(world, water, materials, PROFILE, { x: 1, z: 1 }, { x: 5, z: 5 });
    expect(explanation.steps[0]!.description).toContain("actually reachable");
  });
});

function buildBiggerWorld(): { world: World; materials: MaterialRegistry; water: WaterField } {
  const entities = new EntityIdRegistry();
  const components = new ComponentStore(entities);
  const grid = new WorldGrid({ sizeX: 12, sizeY: 8, sizeZ: 12 }, entities);
  const materials = new MaterialRegistry();
  registerStandardMaterials(materials);
  const terrain = new TerrainField(grid, materials);
  for (let x = 0; x < 6; x++) {
    for (let z = 0; z < 12; z++) {
      for (let y = 0; y <= 2; y++) terrain.setMaterial(x, y, z, "soil");
    }
  }
  const water = new WaterField(grid);
  const weather = new Weather();
  const clock = new SimulationClock({ tickRateHz: 20 });
  const random = new RandomStreams(1);
  const events = new EventLog(entities);
  const world: World = { clock, random, entities, components, grid, terrain, events, water, weather };
  return { world, materials, water };
}

describe("explainJobStalled", () => {
  it("throws for an id with no Job component", () => {
    const { world, materials, water } = buildFlatWorld();
    expect(() => explainJobStalled(world, water, materials, PROFILE, 999 as EntityId)).toThrow(RangeError);
  });

  it("reports an already-complete job as not stalled", () => {
    const { world, materials, water } = buildFlatWorld();
    const designationId = createDesignation(world, "go-to", { x: 3, z: 3 });
    const jobId = world.entities.create("job");
    setJob(world.components, jobId, { designationId, target: { x: 3, z: 3 }, status: "completed" });
    expect(explainJobStalled(world, water, materials, PROFILE, jobId).steps[0]!.description).toContain("already complete");
  });

  it("reports an already-failed job accordingly", () => {
    const { world, materials, water } = buildFlatWorld();
    const designationId = createDesignation(world, "go-to", { x: 3, z: 3 });
    const jobId = world.entities.create("job");
    setJob(world.components, jobId, { designationId, target: { x: 3, z: 3 }, status: "failed" });
    expect(explainJobStalled(world, water, materials, PROFILE, jobId).steps[0]!.description).toContain("already failed");
  });

  it("reports an unreachable target as the real blocker", () => {
    const { world, materials, water } = buildFlatWorld();
    water.setDepth(3, 3, 2);
    const designationId = createDesignation(world, "go-to", { x: 3, z: 3 });
    const jobId = world.entities.create("job");
    setJob(world.components, jobId, { designationId, target: { x: 3, z: 3 }, status: "unclaimed" });
    const explanation = explainJobStalled(world, water, materials, PROFILE, jobId);
    expect(explanation.steps[0]!.description).toContain("unreachable");
  });

  it("REGRESSION (P1-22 critic): reports a passable target disconnected by intervening water, not 'reachable'", () => {
    const { world, materials, water } = buildFlatWorld();
    spawnAt(world, 1, 1);
    const target = { x: 5, z: 5 };
    for (const neighbor of [
      { x: 4, z: 5 },
      { x: 6, z: 5 },
      { x: 5, z: 4 },
      { x: 5, z: 6 },
    ]) {
      water.setDepth(neighbor.x, neighbor.z, 2);
    }
    const designationId = createDesignation(world, "go-to", target);
    const jobId = world.entities.create("job");
    setJob(world.components, jobId, { designationId, target, status: "unclaimed" });

    const explanation = explainJobStalled(world, water, materials, PROFILE, jobId);
    expect(explanation.steps[0]!.description).toContain("none currently has a connected route");
  });

  it("reports a dead assigned beaver as the real blocker", () => {
    const { world, materials, water } = buildFlatWorld();
    const beaver = spawnAt(world, 2, 2);
    const designationId = createDesignation(world, "go-to", { x: 3, z: 3 });
    const jobId = world.entities.create("job");
    setJob(world.components, jobId, { designationId, target: { x: 3, z: 3 }, status: "in-progress", reservedBy: beaver });
    world.entities.destroy(beaver);
    const explanation = explainJobStalled(world, water, materials, PROFILE, jobId);
    expect(explanation.steps[0]!.description).toContain("no longer alive");
  });

  it("reports active progress as not stalled when a live beaver holds it", () => {
    const { world, materials, water } = buildFlatWorld();
    const beaver = spawnAt(world, 2, 2);
    const designationId = createDesignation(world, "go-to", { x: 3, z: 3 });
    const jobId = world.entities.create("job");
    setJob(world.components, jobId, { designationId, target: { x: 3, z: 3 }, status: "in-progress", reservedBy: beaver });
    const explanation = explainJobStalled(world, water, materials, PROFILE, jobId);
    expect(explanation.steps[0]!.description).toContain("progressing");
  });

  it("REGRESSION (P1-22 second critic): reports a live assigned worker with no route as stalled", () => {
    const { world, materials, water } = buildFlatWorld();
    const beaver = spawnAt(world, 1, 1);
    const target = { x: 5, z: 5 };
    for (const neighbor of [
      { x: 4, z: 5 },
      { x: 6, z: 5 },
      { x: 5, z: 4 },
      { x: 5, z: 6 },
    ]) {
      water.setDepth(neighbor.x, neighbor.z, 2);
    }
    const designationId = createDesignation(world, "go-to", target);
    const jobId = world.entities.create("job");
    setJob(world.components, jobId, { designationId, target, status: "in-progress", reservedBy: beaver });

    const explanation = explainJobStalled(world, water, materials, PROFILE, jobId);
    expect(explanation.steps[0]!.description).toContain("no connected route");
  });

  it("reports 'no beaver exists' when the job is unclaimed and reachable with nobody alive", () => {
    const { world, materials, water } = buildFlatWorld();
    const designationId = createDesignation(world, "go-to", { x: 3, z: 3 });
    const jobId = world.entities.create("job");
    setJob(world.components, jobId, { designationId, target: { x: 3, z: 3 }, status: "unclaimed" });
    const explanation = explainJobStalled(world, water, materials, PROFILE, jobId);
    expect(explanation.steps[0]!.description).toContain("No living beaver");
  });

  it("reports 'nobody has claimed it yet' when reachable, unclaimed, and beavers exist", () => {
    const { world, materials, water } = buildFlatWorld();
    spawnAt(world, 10, 10); // alive, but not assigned
    const designationId = createDesignation(world, "go-to", { x: 3, z: 3 });
    const jobId = world.entities.create("job");
    setJob(world.components, jobId, { designationId, target: { x: 3, z: 3 }, status: "unclaimed" });
    const explanation = explainJobStalled(world, water, materials, PROFILE, jobId);
    expect(explanation.steps[0]!.description).toContain("none has claimed it yet");
  });
});

describe("explainWaterRose", () => {
  it("reports no dam obstruction when none exists", () => {
    const { world, water } = buildFlatWorld();
    water.setDepth(5, 5, 0.3);
    const explanation = explainWaterRose(world, water, 5, 5);
    expect(explanation.steps).toHaveLength(1);
    expect(explanation.steps[0]!.description).toContain("No dam segment");
    expect(explanation.steps[0]!.description).toContain("0.30");
  });

  it("reports the real, nearest dam-segment-applied event and current depth", () => {
    const { world, water } = buildFlatWorld();
    const site = { x: 5, z: 5 };
    const constructionId = completedDamSegmentConstruction(world, site);
    world.clock.resume();
    world.clock.advanceTicks(3);
    applyDamSegment(world, constructionId);
    water.setDepth(5, 5, 0.9);

    const explanation = explainWaterRose(world, water, 5, 5);
    expect(explanation.steps).toHaveLength(2);
    expect(explanation.steps[0]!.description).toContain("A dam segment was built");
    expect(explanation.steps[0]!.eventId).toBeDefined();
    expect(explanation.steps[0]!.location).toEqual({ x: 5, z: 5 });
    expect(explanation.steps[1]!.description).toContain("0.90");
  });

  it("REGRESSION (P1-22 critic): still reports historical dam obstruction after the dam entity is removed", () => {
    const { world, water } = buildFlatWorld();
    const site = { x: 5, z: 5 };
    const constructionId = completedDamSegmentConstruction(world, site);
    const damId = applyDamSegment(world, constructionId);
    removeDamSegmentLayer(world, damId);
    water.setDepth(5, 5, 0.7);

    const explanation = explainWaterRose(world, water, 5, 5);
    expect(explanation.steps).toHaveLength(2);
    expect(explanation.steps[0]!.description).toContain("A dam segment was built");
    expect(explanation.steps[1]!.description).toContain("0.70");
  });

  it("picks the geometrically NEAREST dam event when multiple exist", () => {
    const { world, water } = buildFlatWorld(20, 8, 20);
    const nearConstructionId = completedDamSegmentConstruction(world, { x: 5, z: 5 });
    applyDamSegment(world, nearConstructionId);
    const farConstructionId = completedDamSegmentConstruction(world, { x: 18, z: 18 });
    applyDamSegment(world, farConstructionId);

    const explanation = explainWaterRose(world, water, 6, 6); // much closer to (5,5)
    expect(explanation.steps[0]!.location).toEqual({ x: 5, z: 5 });
  });
});

describe("explainDeath", () => {
  it("assembles a real, multi-step drowning chain including the antecedent dam obstruction and a real sealed-chamber entrapment", () => {
    const { world, water } = buildFlatWorld();
    // The dam sits one column over from the beaver's own sealed chamber
    // -- a real, nearby obstruction, not literally occupying the same
    // cell the beaver is trapped in.
    const damSite = { x: 5, z: 6 };
    const constructionId = completedDamSegmentConstruction(world, damSite);
    applyDamSegment(world, constructionId);

    // A real, fully sealed, flooded chamber (matching P1-16's own
    // acceptance-test pattern) -- the beaver's own actual entrapment
    // mechanism, not merely "deep water" (every default beaver can swim).
    const floor = world.grid.surfaceY(5, 5)!;
    world.terrain.setMaterial(5, floor + 3, 5, "stone"); // a real solid ceiling
    water.setDepth(5, 5, 4); // real water filling past the ceiling

    const beaver = spawnAt(world, 5, 5);
    world.clock.resume();
    world.clock.advanceTicks(5);
    const corpseId = die(world, beaver, "drowning");

    const explanation = explainDeath(world, water, corpseId);
    const descriptions = explanation.steps.map((s) => s.description).join(" | ");
    expect(descriptions).toContain("A dam segment was built");
    expect(descriptions).toContain("no real path to open air exists");
    expect(descriptions).toContain("An agent was present");
    expect(descriptions).toContain("died of drowning");
    expect(explanation.steps.at(-1)!.eventId).toBeDefined();
  });

  it("throws for an entity with no Corpse component", () => {
    const { world, water } = buildFlatWorld();
    expect(() => explainDeath(world, water, 999 as EntityId)).toThrow(RangeError);
  });

  it("non-drowning causes skip the dam/depth-specific steps but still report presence and the real death event", () => {
    const { world, water } = buildFlatWorld();
    const beaver = spawnAt(world, 3, 3);
    const corpseId = die(world, beaver, "starvation");
    const explanation = explainDeath(world, water, corpseId);
    expect(explanation.steps).toHaveLength(2); // presence + death event only
    expect(explanation.steps[0]!.description).toContain("An agent was present");
    expect(explanation.steps[1]!.description).toContain("died of starvation");
  });
});

describe("explainPlantDeath", () => {
  it("reports a still-living plant as not dead", () => {
    const { world } = buildFlatWorld();
    const tree = world.entities.create("tree");
    expect(explainPlantDeath(world, tree).steps[0]!.description).toContain("still alive");
  });

  it("throws when asked to explain plant death for a non-plant entity", () => {
    const { world } = buildFlatWorld();
    const beaver = spawnAt(world, 2, 2);
    expect(() => explainPlantDeath(world, beaver)).toThrow(RangeError);
  });

  it("honestly reports no causal record for a destroyed tree -- no plant-death mechanism exists yet", () => {
    const { world } = buildFlatWorld();
    const tree = world.entities.create("tree");
    world.entities.destroy(tree);
    const explanation = explainPlantDeath(world, tree);
    expect(explanation.steps[0]!.description).toContain("No causal record exists");
    expect(explanation.steps[0]!.description).toContain("P4-02");
  });
});
