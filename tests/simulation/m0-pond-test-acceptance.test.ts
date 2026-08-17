/**
 * Headless acceptance test for Milestone 0 -- the Pond Test.
 *
 * This is intentionally a broad integration gate over the P0/P1 systems
 * already shipped. The only player command surface used for the play
 * session is `TextUI`: designate trees and designate a dam. The test loop
 * then drives the same real per-system tick functions earlier acceptance
 * tests use because no master systems scheduler exists yet.
 */
import { describe, expect, it } from "vitest";
import type { EntityId } from "../../src/sim/core/EntityId.js";
import { createWorld } from "../../src/sim/runtime/SimulationRunner.js";
import type { World } from "../../src/sim/persistence/WorldSnapshot.js";
import { snapshotWorld, restoreWorld } from "../../src/sim/persistence/WorldSnapshot.js";
import { ALL_COMPONENT_TYPES } from "../../src/sim/persistence/AllComponentTypes.js";
import { MaterialRegistry } from "../../src/sim/materials/Material.js";
import { registerStandardMaterials } from "../../src/sim/materials/standardMaterials.js";
import { PlantSpeciesRegistry } from "../../src/sim/ecology/PlantSpecies.js";
import { registerStandardPlantSpecies } from "../../src/sim/ecology/standardPlantSpecies.js";
import { generateWatershed, type WatershedLayout } from "../../src/sim/worldgen/WatershedGenerator.js";
import { WaterField, type ColumnCoordinate } from "../../src/sim/hydrology/WaterField.js";
import { applyEdgeDrainage, stepFlow } from "../../src/sim/hydrology/Flow.js";
import { TextUI } from "../../src/ui/TextUI.js";
import { spawnSevenStartingBeavers, getSwimmer } from "../../src/sim/creatures/Beaver.js";
import { setNeeds, getNeeds, BASELINE_NEEDS, NEED_URGENT_THRESHOLD } from "../../src/sim/creatures/Needs.js";
import { tickBeaverNeeds } from "../../src/sim/creatures/BeaverNeeds.js";
import { tickMortality } from "../../src/sim/creatures/Mortality.js";
import { getBreath } from "../../src/sim/creatures/Respiration.js";
import { getPlant, setPlant, harvestableWoodMassKg } from "../../src/sim/ecology/Plant.js";
import { applyVegetationHealthTick } from "../../src/sim/ecology/EcologyResponse.js";
import { findPath, describeEdgeBlock, type NavigationProfile } from "../../src/sim/navigation/Pathfinding.js";
import { generateTreeCutJob, tickTreeCutJob } from "../../src/sim/labor/TreeCutting.js";
import { getLog, getHeld } from "../../src/sim/labor/Log.js";
import { ensureMaterialHaul, checkMaterialsDelivered, generateBuildJob, tickBuildJob, getConstruction, getBuildProgress } from "../../src/sim/labor/Construction.js";
import { tickHaulJob, getHaulProgress } from "../../src/sim/labor/Hauling.js";
import { getJob } from "../../src/sim/jobs/Job.js";
import { currentJobOf } from "../../src/sim/jobs/JobBoard.js";
import { applyDamSegment, getDamSegment } from "../../src/sim/hydrology/Dam.js";
import { explainDeath, explainUnreachable, explainWaterRose } from "../../src/sim/history/CausalExplanation.js";

const DIMS = { sizeX: 41, sizeY: 14, sizeZ: 61 };
const SEED = "m0-pond-test";
const NON_SWIMMER: NavigationProfile = { canSwim: false, maxWadingDepth: 1 };

interface M0State {
  world: World;
  materials: MaterialRegistry;
  plantSpecies: PlantSpeciesRegistry;
  layout: WatershedLayout;
  beavers: EntityId[];
  damSite: ColumnCoordinate;
  upstreamProbe: ColumnCoordinate;
  source: ColumnCoordinate;
  atRiskColumn: ColumnCoordinate;
  atRiskBeaver: EntityId;
  ecologyPatch: EntityId;
}

function makeMaterials(): MaterialRegistry {
  const materials = new MaterialRegistry();
  registerStandardMaterials(materials);
  return materials;
}

function makePlantSpecies(): PlantSpeciesRegistry {
  const species = new PlantSpeciesRegistry();
  registerStandardPlantSpecies(species);
  return species;
}

function buildM0State(): M0State {
  const world = createWorld({ seed: SEED, dimensions: DIMS });
  const materials = makeMaterials();
  const plantSpecies = makePlantSpecies();
  const layout = generateWatershed(world, { species: plantSpecies, treeDensity: 0.22 });

  const damZ = Math.floor((layout.prospectiveDamSite.zStart + layout.prospectiveDamSite.zEnd) / 2);
  const damSite = { x: layout.channelCenterlineX[damZ]!, z: damZ };
  const upstreamZ = damZ - 3;
  const upstreamProbe = { x: layout.channelCenterlineX[upstreamZ]!, z: upstreamZ };
  const sourceZ = damZ - 8;
  const source = { x: layout.channelCenterlineX[sourceZ]!, z: sourceZ };
  const atRiskZ = sourceZ - 1;
  const atRiskColumn = { x: layout.channelCenterlineX[atRiskZ]!, z: atRiskZ };

  for (let z = 0; z < DIMS.sizeZ; z++) {
    world.water.setDepth(layout.channelCenterlineX[z]!, z, 0.15);
  }

  for (const treeId of layout.treeIds) {
    const plant = getPlant(world.components, treeId)!;
    setPlant(world.components, treeId, { ...plant, ageTicks: 20_000, health: 1 });
  }

  const arrivalZ = damZ - 5;
  const arrival = { x: layout.channelCenterlineX[arrivalZ]! + 4, z: arrivalZ };
  const beavers = spawnSevenStartingBeavers(world, {
    x: arrival.x,
    y: world.grid.surfaceY(arrival.x, arrival.z)! + 1,
    z: arrival.z,
  });

  const atRiskBeaver = beavers[6]!;
  world.grid.setEntityPosition(
    atRiskBeaver,
    atRiskColumn.x,
    world.grid.surfaceY(atRiskColumn.x, atRiskColumn.z)! + 1,
    atRiskColumn.z,
  );

  const ecologyPatch = world.entities.create("tree");
  world.grid.setEntityPosition(
    ecologyPatch,
    upstreamProbe.x,
    world.grid.surfaceY(upstreamProbe.x, upstreamProbe.z)! + 1,
    upstreamProbe.z,
  );
  setPlant(world.components, ecologyPatch, { speciesId: "aspen", ageTicks: 20_000, health: 1 });

  return { world, materials, plantSpecies, layout, beavers, damSite, upstreamProbe, source, atRiskColumn, atRiskBeaver, ecologyPatch };
}

function advanceClock(world: World): void {
  world.clock.resume();
  world.clock.advanceTicks(1);
}

function nearestTrees(state: M0State, count: number): EntityId[] {
  const origin = state.damSite;
  const trees = state.layout.treeIds.filter((id) => state.world.entities.isLive(id));
  trees.sort((a, b) => {
    const pa = state.world.grid.positionOf(a)!;
    const pb = state.world.grid.positionOf(b)!;
    const da = Math.abs(pa.x - origin.x) + Math.abs(pa.z - origin.z);
    const db = Math.abs(pb.x - origin.x) + Math.abs(pb.z - origin.z);
    return da !== db ? da - db : a - b;
  });
  if (trees.length < count) throw new RangeError(`M0 seed produced only ${trees.length} trees`);
  return trees.slice(0, count);
}

function makeHarvestable(state: M0State, treeIds: readonly EntityId[]): number {
  let total = 0;
  for (const treeId of treeIds) {
    const plant = getPlant(state.world.components, treeId)!;
    const species = state.plantSpecies.get(plant.speciesId);
    total += harvestableWoodMassKg(species, plant, state.materials.get(species.woodMaterialId));
  }
  return total;
}

function damCrossSectionSites(state: M0State): ColumnCoordinate[] {
  const center = state.damSite.x;
  return [-2, -1, 0, 1, 2].map((dx) => ({ x: center + dx, z: state.damSite.z }));
}

function laborBeavers(state: M0State): EntityId[] {
  return state.beavers.filter((id) => id !== state.atRiskBeaver && state.world.entities.isLive(id));
}

function driveTreeCutting(state: M0State, ui: TextUI, trees: readonly EntityId[]): Set<EntityId> {
  const jobIds = trees.flatMap((tree) => generateTreeCutJob(state.world, state.materials, state.plantSpecies, ui.designateTreeCutting(tree)));
  const workers = new Set<EntityId>();

  for (let tick = 0; tick < 1_200 && trees.some((tree) => state.world.entities.isLive(tree)); tick++) {
    advanceClock(state.world);
    for (const beaver of laborBeavers(state)) {
      const heldJob = state.world.entities.liveIdsOfKind("job").find((jobId) => getJob(state.world.components, jobId)?.reservedBy === beaver);
      const jobIdsForThisBeaver = heldJob === undefined ? jobIds : [heldJob];
      const outcome = tickTreeCutJob(
        state.world.grid,
        state.world.terrain,
        state.world.water,
        state.materials,
        state.plantSpecies,
        state.world.entities,
        state.world.components,
        beaver,
        getSwimmer(state.world.components, beaver)!,
        jobIdsForThisBeaver,
      );
      if (outcome === "assigned" || outcome === "traveling" || outcome === "working" || outcome === "felled") workers.add(beaver);
    }
  }

  expect(trees.every((tree) => !state.world.entities.isLive(tree))).toBe(true);
  return workers;
}

function driveFirstHaulToInTransit(state: M0State, constructionId: EntityId): EntityId {
  const haulJobId = ensureMaterialHaul(state.world, constructionId);
  expect(haulJobId).toBeDefined();

  for (let tick = 0; tick < 300; tick++) {
    advanceClock(state.world);
    for (const beaver of laborBeavers(state)) {
      const outcome = tickHaulJob(
        state.world.grid,
        state.world.terrain,
        state.world.water,
        state.materials,
        state.world.entities,
        state.world.components,
        beaver,
        getSwimmer(state.world.components, beaver)!,
        [haulJobId!],
      );
      if (outcome === "carrying" || outcome === "picked-up") {
        return haulJobId!;
      }
    }
  }
  throw new Error("first M0 haul never entered an in-transit state");
}

function restoreState(state: M0State): M0State {
  const parsed = JSON.parse(JSON.stringify(snapshotWorld(state.world)));
  const materials = makeMaterials();
  const restored = restoreWorld(parsed, { componentTypes: ALL_COMPONENT_TYPES, materials });
  return { ...state, world: restored, materials, plantSpecies: makePlantSpecies() };
}

function activeHaulJobs(state: M0State): EntityId[] {
  return state.world.entities.liveIdsOfKind("job").filter((jobId) => {
    const job = getJob(state.world.components, jobId);
    return job !== undefined && job.status !== "completed" && job.status !== "failed" && getHaulProgress(state.world.components, jobId) !== undefined;
  });
}

function driveHaulJobUntilDelivered(state: M0State, haulJobId: EntityId): void {
  let delivered = false;
  for (let tick = 0; tick < 600 && !delivered; tick++) {
    advanceClock(state.world);
    for (const beaver of laborBeavers(state)) {
      const outcome = tickHaulJob(
        state.world.grid,
        state.world.terrain,
        state.world.water,
        state.materials,
        state.world.entities,
        state.world.components,
        beaver,
        getSwimmer(state.world.components, beaver)!,
        [haulJobId],
      );
      if (outcome === "delivered") delivered = true;
    }
  }
  expect(delivered).toBe(true);
}

function finishDamConstruction(state: M0State, constructionId: EntityId): EntityId {
  let haulJobsCreated = 1;
  while (!checkMaterialsDelivered(state.world, constructionId)) {
    let haulJobs = activeHaulJobs(state);
    if (haulJobs.length === 0) {
      const haulJobId = ensureMaterialHaul(state.world, constructionId);
      if (haulJobId !== undefined) haulJobsCreated++;
      haulJobs = haulJobId === undefined ? [] : [haulJobId];
    }
    expect(haulJobsCreated).toBeLessThan(20);

    for (const haulJobId of haulJobs) driveHaulJobUntilDelivered(state, haulJobId);
  }

  expect(getConstruction(state.world.components, constructionId)!.status).toBe("awaiting-labor");
  const [buildJobId] = generateBuildJob(state.world, constructionId);
  let built = false;
  for (let tick = 0; tick < 300 && !built; tick++) {
    advanceClock(state.world);
    for (const beaver of laborBeavers(state)) {
      const currentJob = currentJobOf(state.world.entities, state.world.components, beaver);
      if (currentJob !== undefined && getBuildProgress(state.world.components, currentJob) === undefined) continue;
      const outcome = tickBuildJob(
        state.world.grid,
        state.world.terrain,
        state.world.water,
        state.materials,
        state.world.entities,
        state.world.components,
        beaver,
        getSwimmer(state.world.components, beaver)!,
        [buildJobId!],
      );
      if (outcome === "built") built = true;
    }
  }
  expect(built).toBe(true);
  expect(getConstruction(state.world.components, constructionId)!.status).toBe("complete");
  return applyDamSegment(state.world, constructionId);
}

function measurePonding(state: M0State, ticks: number): number {
  const measured = new WaterField(state.world.grid);
  for (let z = 0; z < DIMS.sizeZ; z++) measured.setDepth(state.layout.channelCenterlineX[z]!, z, 0.15);
  for (let tick = 0; tick < ticks; tick++) {
    measured.addVolume(state.source.x, state.source.z, 1);
    stepFlow(measured, state.world.terrain, state.materials, 1, { conductance: 0.8 });
    applyEdgeDrainage(measured, 1, { drainRate: 0.05 });
  }
  return measured.depthAt(state.upstreamProbe.x, state.upstreamProbe.z);
}

function drivePonding(state: M0State, ticks: number): void {
  for (let tick = 0; tick < ticks; tick++) {
    state.world.water.addVolume(state.source.x, state.source.z, 1);
    stepFlow(state.world.water, state.world.terrain, state.materials, 1, { conductance: 0.8 });
    applyEdgeDrainage(state.world.water, 1, { drainRate: 0.05 });
    advanceClock(state.world);
  }
}

function tickEcologyPatch(state: M0State): void {
  const plant = getPlant(state.world.components, state.ecologyPatch);
  if (plant === undefined) return;
  setPlant(
    state.world.components,
    state.ecologyPatch,
    applyVegetationHealthTick(plant, state.plantSpecies.get(plant.speciesId), state.world.water, state.upstreamProbe.x, state.upstreamProbe.z),
  );
}

function drivePondingScenario(state: M0State, ticks: number): EntityId | undefined {
  let corpseId: EntityId | undefined;
  for (let tick = 0; tick < ticks; tick++) {
    state.world.water.addVolume(state.source.x, state.source.z, 1);
    stepFlow(state.world.water, state.world.terrain, state.materials, 1, { conductance: 0.8 });
    applyEdgeDrainage(state.world.water, 1, { drainRate: 0.05 });
    tickEcologyPatch(state);
    advanceClock(state.world);
    if (corpseId === undefined && state.world.entities.isLive(state.atRiskBeaver)) {
      const result = tickMortality(state.world, state.world.water, state.atRiskBeaver);
      if (result.died) corpseId = result.corpseId!;
    }
  }
  return corpseId;
}

function tickNeedsUntil(state: M0State, beaver: EntityId, predicate: () => boolean, maxTicks: number): void {
  for (let tick = 0; tick < maxTicks && !predicate(); tick++) {
    advanceClock(state.world);
    tickBeaverNeeds(
      state.world.grid,
      state.world.terrain,
      state.world.water,
      state.materials,
      state.world.entities,
      state.world.components,
      beaver,
      getSwimmer(state.world.components, beaver)!,
    );
  }
  expect(predicate()).toBe(true);
}

function driveMortalityUntilDeath(state: M0State, victim: EntityId): EntityId {
  for (let tick = 0; tick < 120; tick++) {
    advanceClock(state.world);
    const result = tickMortality(state.world, state.world.water, victim);
    if (result.died) return result.corpseId!;
  }
  throw new Error("M0 victim did not die through ordinary mortality");
}

describe("M0 acceptance: Pond Test", () => {
  it("passes the canonical Seven Beavers beside a stream scenario through real systems", () => {
    let state = buildM0State();
    const ui = new TextUI(state.world, state.world.water);

    // Deterministic watershed generation and seven persistent beavers.
    const repeat = buildM0State();
    expect(repeat.layout.channelCenterlineX).toEqual(state.layout.channelCenterlineX);
    expect(repeat.layout.treeIds).toHaveLength(state.layout.treeIds.length);
    expect(state.beavers).toHaveLength(7);
    expect(new Set(state.beavers).size).toBe(7);

    ui.setCameraPosition(state.damSite.x, state.damSite.z);
    expect(ui.inspectTile(state.damSite.x, state.damSite.z).waterDepth).toBeGreaterThan(0);

    // Walk, swim, eat, drink, and sleep all use ordinary live state.
    const walker = state.beavers[0]!;
    const walkerPos = state.world.grid.positionOf(walker)!;
    expect(findPath(state.world.grid, state.world.terrain, state.world.water, state.materials, walkerPos, state.damSite, getSwimmer(state.world.components, walker)!)).toBeDefined();
    expect(findPath(state.world.grid, state.world.terrain, state.world.water, state.materials, state.damSite, state.source, getSwimmer(state.world.components, walker)!)).toBeDefined();

    const trees = nearestTrees(state, 5);
    const expectedWoodMass = makeHarvestable(state, trees);
    expect(expectedWoodMass).toBeGreaterThan(750);

    const eater = state.beavers[1]!;
    setNeeds(state.world.components, eater, { ...BASELINE_NEEDS, hunger: NEED_URGENT_THRESHOLD });
    tickNeedsUntil(state, eater, () => getNeeds(state.world.components, eater)!.hunger < 0.05, 120);

    const drinker = state.beavers[2]!;
    setNeeds(state.world.components, drinker, { ...BASELINE_NEEDS, thirst: NEED_URGENT_THRESHOLD });
    tickNeedsUntil(state, drinker, () => getNeeds(state.world.components, drinker)!.thirst < 0.05, 120);

    const sleeper = state.beavers[3]!;
    setNeeds(state.world.components, sleeper, { ...BASELINE_NEEDS, fatigue: NEED_URGENT_THRESHOLD });
    tickNeedsUntil(state, sleeper, () => getNeeds(state.world.components, sleeper)!.fatigue < NEED_URGENT_THRESHOLD, 20);

    // UI-only player commands: designate trees, then designate the dam.
    const cuttingWorkers = driveTreeCutting(state, ui, trees);
    expect(cuttingWorkers.size).toBeGreaterThan(0);
    const logsAfterCut = state.world.entities.liveIdsOfKind("log").filter((id) => getLog(state.world.components, id) !== undefined);
    expect(logsAfterCut.length).toBeGreaterThan(0);
    expect(logsAfterCut.reduce((sum, id) => sum + getLog(state.world.components, id)!.massKg, 0)).toBeCloseTo(expectedWoodMass, 6);

    const noDamControl = restoreState(state);
    const noDamPatchStart = getPlant(noDamControl.world.components, noDamControl.ecologyPatch)!.health;
    expect(noDamPatchStart).toBe(1);
    expect(noDamControl.world.entities.isLive(noDamControl.atRiskBeaver)).toBe(true);

    const constructionId = ui.designateConstruction("dam-segment", state.damSite);
    expect(getConstruction(state.world.components, constructionId)!.status).toBe("awaiting-materials");

    const damSegmentIds = [finishDamConstruction(state, constructionId)];
    const partialNoDamDepth = measurePonding(noDamControl, 40);
    drivePonding(state, 40);
    const partialDamDepth = state.world.water.depthAt(state.upstreamProbe.x, state.upstreamProbe.z);
    expect(partialDamDepth).toBeGreaterThan(partialNoDamDepth);

    const remainingDamSites: ColumnCoordinate[] = [];
    for (let level = 0; level < 3; level++) {
      for (const site of damCrossSectionSites(state)) {
        if (level === 0 && site.x === state.damSite.x) continue;
        remainingDamSites.push(site);
      }
    }
    const secondConstructionId = new TextUI(state.world, state.world.water).designateConstruction("dam-segment", remainingDamSites.shift()!);
    const inTransitHaulJob = driveFirstHaulToInTransit(state, secondConstructionId);
    const postRiseHaul = getJob(state.world.components, inTransitHaulJob)!;
    expect(postRiseHaul.status).toBe("in-progress");
    expect(postRiseHaul.reservedBy).toBeDefined();
    expect(state.world.water.depthAt(state.upstreamProbe.x, state.upstreamProbe.z)).toBeGreaterThan(partialNoDamDepth);
    expect(state.world.entities.liveIdsOfKind("log").some((id) => getHeld(state.world.components, id) !== undefined)).toBe(true);

    // Save/reload while a later dam segment is incomplete, a log is in
    // transit, and upstream water is already measurably rising.
    state = restoreState(state);
    expect(state.beavers.every((id) => state.world.entities.isLive(id))).toBe(true);
    expect(getJob(state.world.components, inTransitHaulJob)!.status).toBe("in-progress");
    expect(state.world.water.depthAt(state.upstreamProbe.x, state.upstreamProbe.z)).toBeCloseTo(partialDamDepth, 9);

    damSegmentIds.push(finishDamConstruction(state, secondConstructionId));
    for (const site of remainingDamSites) {
      const nextConstructionId = new TextUI(state.world, state.world.water).designateConstruction("dam-segment", site);
      damSegmentIds.push(finishDamConstruction(state, nextConstructionId));
    }
    const damSegmentId = damSegmentIds[0]!;
    const uniqueDamSegmentIds = [...new Set(damSegmentIds)];
    expect(getDamSegment(state.world.components, damSegmentId)).toBeDefined();
    expect(uniqueDamSegmentIds).toHaveLength(5);
    expect(uniqueDamSegmentIds.every((id) => getDamSegment(state.world.components, id)?.heightCells === 3)).toBe(true);
    expect(state.world.events.eventsOfType("dam-segment-applied")).toHaveLength(damSegmentIds.length);

    const noDamState = buildM0State();
    const noDamDepth = measurePonding(noDamState, 220);
    const damDepth = measurePonding(state, 220);
    expect(damDepth).toBeGreaterThan(noDamDepth);

    const dryPathBefore = findPath(state.world.grid, state.world.terrain, new WaterField(state.world.grid), state.materials, state.damSite, state.upstreamProbe, NON_SWIMMER);
    expect(dryPathBefore).toBeDefined();
    const noDamCorpse = drivePondingScenario(noDamControl, 220);
    const noDamFloodDepth = noDamControl.world.water.depthAt(noDamControl.upstreamProbe.x, noDamControl.upstreamProbe.z);
    expect(noDamFloodDepth).toBeLessThanOrEqual(NON_SWIMMER.maxWadingDepth);
    expect(describeEdgeBlock(noDamControl.world.grid, noDamControl.world.water, NON_SWIMMER, noDamControl.upstreamProbe)).toBeUndefined();
    expect(noDamCorpse).toBeUndefined();

    const corpseId = drivePondingScenario(state, 220) ?? driveMortalityUntilDeath(state, state.atRiskBeaver);
    expect(state.world.water.depthAt(state.upstreamProbe.x, state.upstreamProbe.z)).toBeGreaterThan(1);
    expect(describeEdgeBlock(state.world.grid, state.world.water, NON_SWIMMER, state.upstreamProbe)).toBe("too-deep-to-cross");
    expect(findPath(state.world.grid, state.world.terrain, state.world.water, state.materials, state.damSite, state.upstreamProbe, getSwimmer(state.world.components, walker)!)).toBeDefined();

    // The ecology response is driven by real water depth, not a scenario flag.
    const noDamPatchHealth = getPlant(noDamControl.world.components, noDamControl.ecologyPatch)!.health;
    const damPatchHealth = getPlant(state.world.components, state.ecologyPatch)!.health;
    expect(damPatchHealth).toBeLessThan(noDamPatchHealth);

    // Accidental harm/death through universal respiration and mortality.
    expect(getBreath(noDamControl.world.components, noDamControl.atRiskBeaver)!.fraction).toBe(1);
    expect(corpseId).toBeDefined();
    expect(state.world.entities.kindOf(corpseId!)).toBe("corpse");

    const deathExplanation = explainDeath(state.world, state.world.water, corpseId!);
    const narrative = deathExplanation.steps.map((s) => s.description).join(" | ");
    expect(narrative).toContain("dam segment was built");
    expect(narrative).toContain("observed water depth");
    expect(narrative).toContain("no real path to open air exists");
    expect(narrative).toContain("An agent was present");
    expect(narrative).toContain("died of drowning");
    expect(explainWaterRose(state.world, state.world.water, state.upstreamProbe.x, state.upstreamProbe.z).steps.length).toBeGreaterThan(1);
    expect(explainUnreachable(state.world, state.world.water, state.materials, NON_SWIMMER, state.damSite, state.upstreamProbe).steps[0]!.description).toContain("too deep");

    const finalRestored = restoreState(state);
    expect(finalRestored.world.entities.kindOf(corpseId!)).toBe("corpse");
    expect(finalRestored.world.events.eventsOfType("drowning-death")).toHaveLength(1);
    expect(finalRestored.world.water.depthAt(state.upstreamProbe.x, state.upstreamProbe.z)).toBeCloseTo(state.world.water.depthAt(state.upstreamProbe.x, state.upstreamProbe.z), 9);
  });
});
