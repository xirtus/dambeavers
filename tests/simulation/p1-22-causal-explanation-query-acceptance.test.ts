/**
 * Headless acceptance test for P1-22 — Causal explanation query.
 *
 * Roadmap acceptance test (DAMN_BEAVERS_MASTER_ROADMAP.md, P1-22):
 *   "after an emergent flooding death, the game can return a causal chain
 *   containing the dam obstruction, water-level increase, accessibility
 *   change, agent action, and death mechanism."
 *
 * The flooding is genuinely emergent, not staged: a real beaver fells a
 * real tree (P1-08), hauls the real logs to a real `"dam-segment"`
 * construction (P1-10) via the SAME unmodified pipeline
 * `p1-11-dam-structure-hydraulic-interaction-acceptance.test.ts` already
 * proves, and `Dam.ts`'s `applyDamSegment` turns that completion into
 * real `TerrainField` material -- which `Flow.ts`'s ALREADY-EXISTING
 * (P1-03) sill-height/permeability formula alone responds to, raising
 * real upstream depth over many real `stepFlow` ticks with a continuous
 * real source inflow, exactly like P1-11's own acceptance test measures.
 * The victim is already present in the upstream chamber before the
 * inflow run. In the dammed world, the chamber's water surface rises high
 * enough that the map's own vertical bound blocks surfacing; in the
 * no-dam control, the identical victim/chamber/inflow setup does not
 * drown. `tickMortality` (P1-16, unmodified) is driven until the dammed
 * victim genuinely dies.
 *
 * `explainDeath` is then called on the resulting corpse with NO further
 * hints -- it must independently rediscover the antecedent dam event,
 * the real elevated water depth, the real entrapment fact, the beaver's
 * presence, and the real recorded death event, purely from live/recorded
 * state, never from anything this test tells it directly.
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
import { setNeeds, BASELINE_NEEDS } from "../../src/sim/creatures/Needs.js";
import { setBreath, BASELINE_BREATH } from "../../src/sim/creatures/Respiration.js";
import { tickMortality } from "../../src/sim/creatures/Mortality.js";
import { setPlant } from "../../src/sim/ecology/Plant.js";
import { PlantSpeciesRegistry } from "../../src/sim/ecology/PlantSpecies.js";
import { registerStandardPlantSpecies } from "../../src/sim/ecology/standardPlantSpecies.js";
import { designateTreeCut, generateTreeCutJob, tickTreeCutJob } from "../../src/sim/labor/TreeCutting.js";
import { getLog } from "../../src/sim/labor/Log.js";
import { tickHaulJob } from "../../src/sim/labor/Hauling.js";
import { designateConstruction, getConstruction, checkMaterialsDelivered, ensureMaterialHaul, generateBuildJob, tickBuildJob } from "../../src/sim/labor/Construction.js";
import { applyDamSegment } from "../../src/sim/hydrology/Dam.js";
import { explainDeath } from "../../src/sim/history/CausalExplanation.js";

const SIZE_X = 5;
const SIZE_Y = 11;
const SIZE_Z = 16;
const CHANNEL_X = 2;
const SOURCE_Z = 4;
const CHAMBER_Z = 6; // upstream of the dam -- where real depth genuinely rises once flow is obstructed
const DAM_SITE = { x: CHANNEL_X, z: 9 };
const TREE_AT = { x: 2, z: 2 };

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
  applyHeightfield(terrain, (x, z) => (x === CHANNEL_X ? 3 - (z / (SIZE_Z - 1)) : 6), strata);
  const water = new WaterField(grid);
  const weather = new Weather();
  const plantSpecies = new PlantSpeciesRegistry();
  registerStandardPlantSpecies(plantSpecies);
  const clock = new SimulationClock({ tickRateHz: 20 });
  const random = new RandomStreams("p1-22-causal-explanation");
  const components = new ComponentStore(entities);
  const events = new EventLog(entities);
  const world: World = { clock, random, entities, components, grid, terrain, events, water, weather };
  return { world, materials, water, plantSpecies };
}

function spawnAt(world: World, x: number, z: number, name: string): EntityId {
  const floor = world.grid.surfaceY(x, z)!;
  const id = spawnBeaver(world, { name, position: { x, y: floor + 1, z } });
  setBreath(world.components, id, { ...BASELINE_BREATH });
  return id;
}

/** Drives a real dam-segment construction (real haul, real labor) at `DAM_SITE` to completion, then applies it to real terrain -- the same real pipeline `p1-11-dam-structure-hydraulic-interaction-acceptance.test.ts` proves. */
function buildAndApplyRealDamSegment(world: World, materials: MaterialRegistry, water: WaterField, hauler: EntityId, haulerProfile: NavigationProfile, builder: EntityId, builderProfile: NavigationProfile): EntityId {
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

  return applyDamSegment(world, constructionId);
}

function driveSustainedInflow(world: World, materials: MaterialRegistry, water: WaterField, ticks = 101): number {
  const dt = 1;
  for (let tick = 0; tick < ticks; tick++) {
    water.addVolume(CHANNEL_X, SOURCE_Z, 3);
    stepFlow(water, world.terrain, materials, dt, { conductance: 0.6 });
    applyEdgeDrainage(water, dt, { drainRate: 0.5 });
  }
  return water.depthAt(CHANNEL_X, CHAMBER_Z);
}

function driveMortalityUntilDeath(world: World, water: WaterField, victim: EntityId, ticks = 100): EntityId | undefined {
  for (let tick = 0; tick < ticks; tick++) {
    world.clock.resume();
    world.clock.advanceTicks(1);
    const result = tickMortality(world, water, victim);
    if (result.died) return result.corpseId;
  }
  return undefined;
}

function measureFreshInflowDepth(world: World, materials: MaterialRegistry, ticks = 101): number {
  const measuredWater = new WaterField(world.grid);
  const dt = 1;
  for (let tick = 0; tick < ticks; tick++) {
    measuredWater.addVolume(CHANNEL_X, SOURCE_Z, 3);
    stepFlow(measuredWater, world.terrain, materials, dt, { conductance: 0.6 });
    applyEdgeDrainage(measuredWater, dt, { drainRate: 0.5 });
  }
  return measuredWater.depthAt(CHANNEL_X, CHAMBER_Z);
}

describe("P1-22 acceptance: after an emergent flooding death, the game can return a causal chain containing the dam obstruction, water-level increase, accessibility change, agent action, and death mechanism", () => {
  it("explainDeath independently rediscovers every real link in the chain, with no hints", () => {
    const { world, materials, water, plantSpecies } = buildWorld();

    // -- Real tree felling and real dam construction (the emergent obstruction). --
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

    const hauler = spawnAt(world, TREE_AT.x, TREE_AT.z + 1, "Haul");
    const haulerProfile = getSwimmer(world.components, hauler)!;
    const builder = spawnAt(world, DAM_SITE.x, DAM_SITE.z - 2, "Build");
    const builderProfile = getSwimmer(world.components, builder)!;
    const damSegmentId = buildAndApplyRealDamSegment(world, materials, water, hauler, haulerProfile, builder, builderProfile);

    const victim = spawnAt(world, CHANNEL_X, CHAMBER_Z, "Trapped");
    setNeeds(world.components, victim, { ...BASELINE_NEEDS });

    // -- Real, sustained inflow + real stepFlow -- the SAME mechanism
    // P1-11's own acceptance test uses to measure real upstream depth
    // rise. No solid ceiling is added; entrapment comes from the map's
    // own finite vertical extent once the water surface is high enough
    // that the beaver cannot surface to open air.
    const { world: noDamWorld, materials: noDamMaterials } = buildWorld();
    const noDamDepth = measureFreshInflowDepth(noDamWorld, noDamMaterials);
    const damDepth = measureFreshInflowDepth(world, materials);
    expect(damDepth).toBeGreaterThan(noDamDepth); // controlled no-dam comparison: the obstruction raises upstream depth

    const floodedDepth = driveSustainedInflow(world, materials, water);
    expect(floodedDepth).toBeGreaterThan(6.9); // genuinely, measurably elevated by the real dam

    // -- Same victim/vertical-bound setup WITHOUT a dam does not drown.
    // This is the control the causal claim needs: the chamber's trapping
    // condition is the map's own vertical bound, not a post-flood ceiling
    // injected to force the result.
    const { world: noDeathWorld, materials: noDeathMaterials, water: noDeathWater } = buildWorld();
    const noDeathFloor = noDeathWorld.grid.surfaceY(CHANNEL_X, CHAMBER_Z)!;
    const noDeathVictim = spawnAt(noDeathWorld, CHANNEL_X, CHAMBER_Z, "NoDamControl");
    setNeeds(noDeathWorld.components, noDeathVictim, { ...BASELINE_NEEDS });
    const noDeathDepth = driveSustainedInflow(noDeathWorld, noDeathMaterials, noDeathWater);
    expect(floodedDepth).toBeGreaterThan(noDeathDepth);
    expect(driveMortalityUntilDeath(noDeathWorld, noDeathWater, noDeathVictim)).toBeUndefined();
    expect(noDeathWorld.grid.positionOf(noDeathVictim)).toEqual({ x: CHANNEL_X, y: noDeathFloor + 1, z: CHAMBER_Z });

    const corpseId = driveMortalityUntilDeath(world, water, victim);
    expect(corpseId).toBeDefined();

    // -- The causal explanation query, given ONLY the corpse id. --
    const explanation = explainDeath(world, water, corpseId!);
    const narrative = explanation.steps.map((s) => s.description).join(" | ");

    // Dam obstruction: a real, recorded dam-segment-applied event.
    const damStep = explanation.steps.find((s) => s.eventId !== undefined && s.description.includes("dam segment was built"));
    expect(damStep).toBeDefined();

    // Water-level increase: a real, current, elevated depth reading.
    expect(narrative).toMatch(/observed water depth.*is now \d/);

    // Accessibility change / entrapment: the real "no path to air" fact.
    expect(narrative).toContain("no real path to open air exists");

    // Agent action: the beaver's own real presence.
    expect(narrative).toContain("An agent was present");

    // Death mechanism: the real, recorded drowning event.
    const deathStep = explanation.steps.at(-1)!;
    expect(deathStep.description).toContain("died of drowning");
    expect(deathStep.eventId).toBeDefined();

    // The whole chain is genuinely chronological (oldest first).
    for (let i = 1; i < explanation.steps.length; i++) {
      expect(explanation.steps[i]!.tick).toBeGreaterThanOrEqual(explanation.steps[i - 1]!.tick);
    }

    void damSegmentId; // exercised via the real event chain above, not referenced directly
  });
});
