/**
 * Headless acceptance test for P1-11 — Dam structure and hydraulic interaction.
 *
 * Roadmap acceptance test (DAMN_BEAVERS_MASTER_ROADMAP.md, P1-11):
 *   "adding dam material progressively reduces channel discharge and
 *   raises upstream depth; removing a segment increases discharge again."
 *
 * Drives the FULL real pipeline, not a hand-edited terrain shortcut: a real
 * beaver fells a real tree (P1-08), hauls the real resulting logs to a real
 * `"dam-segment"` construction site via P1-10's own unmodified machinery,
 * a second beaver performs real labor to complete it, and `Dam.ts`'s
 * `applyDamSegment` turns that completion into real `TerrainField` material
 * -- which `Flow.ts`'s ALREADY-EXISTING (P1-03) sill-height/permeability
 * formula alone responds to. Nothing in this test or in `Dam.ts` computes
 * discharge or upstream depth directly; both are measured the same way
 * `tests/simulation/p1-03-flow-acceptance.test.ts` measures them, purely
 * from `stepFlow`'s own output.
 */
import { describe, expect, it } from "vitest";
import { EntityIdRegistry, type EntityId } from "../../src/sim/core/EntityId.js";
import { ComponentStore } from "../../src/sim/core/ComponentStore.js";
import { SimulationClock } from "../../src/sim/core/SimulationClock.js";
import { RandomStreams } from "../../src/sim/core/Random.js";
import { WorldGrid } from "../../src/sim/world/WorldGrid.js";
import { TerrainField, applyHeightfield, type StrataLayer } from "../../src/sim/world/TerrainField.js";
import { EventLog } from "../../src/sim/history/EventLog.js";
import { MaterialRegistry } from "../../src/sim/materials/Material.js";
import { registerStandardMaterials } from "../../src/sim/materials/standardMaterials.js";
import { WaterField } from "../../src/sim/hydrology/WaterField.js";
import { Weather } from "../../src/sim/weather/Weather.js";
import { stepFlow, applyEdgeDrainage } from "../../src/sim/hydrology/Flow.js";
import type { World } from "../../src/sim/persistence/WorldSnapshot.js";
import type { NavigationProfile } from "../../src/sim/navigation/Pathfinding.js";
import { spawnBeaver, getSwimmer } from "../../src/sim/creatures/Beaver.js";
import { setPlant } from "../../src/sim/ecology/Plant.js";
import { PlantSpeciesRegistry } from "../../src/sim/ecology/PlantSpecies.js";
import { registerStandardPlantSpecies } from "../../src/sim/ecology/standardPlantSpecies.js";
import { designateTreeCut, generateTreeCutJob, tickTreeCutJob } from "../../src/sim/labor/TreeCutting.js";
import { getLog } from "../../src/sim/labor/Log.js";
import { tickHaulJob } from "../../src/sim/labor/Hauling.js";
import { designateConstruction, getConstruction, checkMaterialsDelivered, ensureMaterialHaul, generateBuildJob, tickBuildJob } from "../../src/sim/labor/Construction.js";
import { applyDamSegment, removeDamSegmentLayer } from "../../src/sim/hydrology/Dam.js";

const SIZE_X = 5;
const SIZE_Y = 12;
const SIZE_Z = 16;
const CHANNEL_X = 2; // the source's own column -- most concentrated flow, so a single-column dam here has a real, measurable effect
const SOURCE_Z = 4;
const UPSTREAM_Z = 6;
const DAM_SITE = { x: CHANNEL_X, z: 9 };
const TREE_AT = { x: 2, z: 2 };
const TICKS_PER_PHASE = 250; // long enough for real discharge to actually reach the exit and stabilize into a measurable, comparable signal (confirmed via a disposable probe)

function buildWorld(): { world: World; materials: MaterialRegistry; water: WaterField; plantSpecies: PlantSpeciesRegistry } {
  const entities = new EntityIdRegistry();
  const grid = new WorldGrid({ sizeX: SIZE_X, sizeY: SIZE_Y, sizeZ: SIZE_Z }, entities);
  const materials = new MaterialRegistry();
  registerStandardMaterials(materials);
  const terrain = new TerrainField(grid, materials);
  const strata: StrataLayer[] = [
    { materialId: "soil", depth: 2 },
    { materialId: "stone", depth: 1000 },
  ];
  // The same open, uniform-width sloped channel geometry
  // p1-03-flow-acceptance.test.ts itself uses -- no artificial banks, no
  // hand-added obstruction. The ONLY difference from a bare open channel
  // in this test is whatever a real beaver actually builds at DAM_SITE.
  applyHeightfield(terrain, (_x, z) => 5 - (z / (SIZE_Z - 1)) * 3, strata);
  const water = new WaterField(grid);
  const weather = new Weather();
  const plantSpecies = new PlantSpeciesRegistry();
  registerStandardPlantSpecies(plantSpecies);
  const clock = new SimulationClock({ tickRateHz: 20 });
  const random = new RandomStreams("p1-11-dam");
  const components = new ComponentStore(entities);
  const events = new EventLog(entities);
  const world: World = { clock, random, entities, components, grid, terrain, events, water, weather };
  return { world, materials, water, plantSpecies };
}

function spawnAt(world: World, x: number, z: number, name: string) {
  const floor = world.grid.surfaceY(x, z)!;
  return spawnBeaver(world, { name, position: { x, y: floor + 1, z } });
}

/**
 * Runs `ticks` simulated steps of continuous inflow at the channel source
 * over a FRESH `WaterField` (built from `world.grid`, which already
 * carries whatever real dam material has actually been built into
 * `world.terrain` so far), returning cumulative exit discharge and the
 * resulting upstream depth -- the exact measurement
 * `p1-03-flow-acceptance.test.ts` uses. A fresh field each call is what
 * makes each phase's measurement isolate ONLY the current dam height: this
 * channel is far from hydraulic equilibrium within any one phase's tick
 * budget (confirmed via a disposable probe), so comparing a LATER phase's
 * cumulative discharge against an EARLIER one on a single continuously-
 * accumulating water state would be confounded by "how much has simply
 * accumulated so far," not by the dam itself. The dam's own effect is real
 * and cumulative regardless (it lives in `world.terrain`, touched only by
 * `Dam.ts`); only the water simulation used to OBSERVE that effect is
 * reset between phases, the same controlled-experiment logic as re-running
 * an inflow test after a real physical change, not a fresh unrelated
 * scenario.
 */
function measure(world: World, materials: MaterialRegistry, ticks: number): { upstreamDepth: number; cumulativeExitDischarge: number } {
  const water = new WaterField(world.grid);
  const dt = 1;
  let cumulativeExitDischarge = 0;
  for (let tick = 0; tick < ticks; tick++) {
    water.addVolume(CHANNEL_X, SOURCE_Z, 3);
    stepFlow(water, world.terrain, materials, dt, { conductance: 0.6 });
    let exitBefore = 0;
    for (let x = 0; x < SIZE_X; x++) exitBefore += water.depthAt(x, SIZE_Z - 1);
    applyEdgeDrainage(water, dt, { drainRate: 0.5 });
    let exitAfter = 0;
    for (let x = 0; x < SIZE_X; x++) exitAfter += water.depthAt(x, SIZE_Z - 1);
    cumulativeExitDischarge += exitBefore - exitAfter;
  }
  return { upstreamDepth: water.depthAt(CHANNEL_X, UPSTREAM_Z), cumulativeExitDischarge };
}

/** Drives a real dam-segment construction (real haul, real labor) at `DAM_SITE` to completion, using logs already felled and sitting in the world. Returns the completed construction id. */
function buildRealDamSegment(world: World, materials: MaterialRegistry, water: WaterField, hauler: EntityId, haulerProfile: NavigationProfile, builder: EntityId, builderProfile: NavigationProfile): EntityId {
  const constructionId = designateConstruction(world, "dam-segment", DAM_SITE);

  let safety = 0;
  while (!checkMaterialsDelivered(world, constructionId)) {
    safety++;
    expect(safety).toBeLessThan(50);
    const haulJobId = ensureMaterialHaul(world, constructionId);
    if (haulJobId === undefined) break;
    let haulOutcome = "";
    let haulIterations = 0;
    do {
      haulOutcome = tickHaulJob(world.grid, world.terrain, water, materials, world.entities, world.components, hauler, haulerProfile, [haulJobId]);
      haulIterations++;
      expect(haulIterations).toBeLessThan(100);
    } while (haulOutcome !== "delivered" && haulOutcome !== "failed" && haulOutcome !== "requeued");
    expect(haulOutcome).toBe("delivered");
  }
  expect(getConstruction(world.components, constructionId)!.status).toBe("awaiting-labor");

  const [buildJobId] = generateBuildJob(world, constructionId);
  let buildOutcome: string;
  let buildIterations = 0;
  do {
    buildOutcome = tickBuildJob(world.grid, world.terrain, water, materials, world.entities, world.components, builder, builderProfile, [buildJobId!]);
    buildIterations++;
    expect(buildIterations).toBeLessThan(200);
  } while (buildOutcome !== "built");

  expect(getConstruction(world.components, constructionId)!.status).toBe("complete");
  return constructionId;
}

describe("P1-11 acceptance: adding dam material progressively reduces channel discharge and raises upstream depth; removing a segment increases discharge again", () => {
  it("holds across a real construction pipeline and real generic flow physics -- no dam-specific hydraulic rule anywhere", () => {
    const { world, materials, water, plantSpecies } = buildWorld();

    // A real, fully-grown tree, really felled -- enough wood for TWO real 50kg dam-segment requirements.
    const woodcutter = spawnAt(world, TREE_AT.x + 1, TREE_AT.z, "Chop");
    const woodcutterProfile = getSwimmer(world.components, woodcutter)!;
    const tree = world.entities.create("tree");
    world.grid.setEntityPosition(tree, TREE_AT.x, world.grid.surfaceY(TREE_AT.x, TREE_AT.z)! + 1, TREE_AT.z);
    setPlant(world.components, tree, { speciesId: "aspen", ageTicks: 20_000, health: 1 });
    const [cutJobId] = generateTreeCutJob(world, materials, plantSpecies, designateTreeCut(world, tree));
    let cutOutcome: string;
    let cutIterations = 0;
    do {
      cutOutcome = tickTreeCutJob(world.grid, world.terrain, water, materials, plantSpecies, world.entities, world.components, woodcutter, woodcutterProfile, [cutJobId!]);
      cutIterations++;
      expect(cutIterations).toBeLessThan(200);
    } while (cutOutcome !== "felled");
    const totalFelledMassKg = world.entities.liveIdsOfKind("log").reduce((sum, id) => sum + getLog(world.components, id)!.massKg, 0);
    expect(totalFelledMassKg).toBeGreaterThanOrEqual(100); // enough for two 50kg dam-segment requirements

    const hauler = spawnAt(world, TREE_AT.x, TREE_AT.z, "Haul");
    const haulerProfile = getSwimmer(world.components, hauler)!;
    const builder = spawnAt(world, DAM_SITE.x, DAM_SITE.z, "Build");
    const builderProfile = getSwimmer(world.components, builder)!;

    // Phase 0: baseline, no dam at all.
    const baseline = measure(world, materials, TICKS_PER_PHASE);

    // Phase 1: ONE real dam segment, built and applied.
    const firstConstructionId = buildRealDamSegment(world, materials, water, hauler, haulerProfile, builder, builderProfile);
    const firstDamId = applyDamSegment(world, firstConstructionId);
    const oneSegment = measure(world, materials, TICKS_PER_PHASE);

    expect(oneSegment.cumulativeExitDischarge).toBeLessThan(baseline.cumulativeExitDischarge);
    expect(oneSegment.upstreamDepth).toBeGreaterThan(baseline.upstreamDepth);

    // Phase 2: a SECOND real dam segment, stacked at the same site --
    // "progressively" reduces discharge / raises depth further still.
    const secondConstructionId = buildRealDamSegment(world, materials, water, hauler, haulerProfile, builder, builderProfile);
    const secondDamId = applyDamSegment(world, secondConstructionId);
    expect(secondDamId).toBe(firstDamId); // stacked onto the SAME physical dam, per Dam.ts's own site-reuse behavior
    const twoSegments = measure(world, materials, TICKS_PER_PHASE);

    expect(twoSegments.cumulativeExitDischarge).toBeLessThan(oneSegment.cumulativeExitDischarge);
    expect(twoSegments.upstreamDepth).toBeGreaterThan(oneSegment.upstreamDepth);

    // Phase 3: remove a segment -- discharge increases again.
    removeDamSegmentLayer(world, firstDamId);
    const afterRemoval = measure(world, materials, TICKS_PER_PHASE);

    expect(afterRemoval.cumulativeExitDischarge).toBeGreaterThan(twoSegments.cumulativeExitDischarge);
  });
});
