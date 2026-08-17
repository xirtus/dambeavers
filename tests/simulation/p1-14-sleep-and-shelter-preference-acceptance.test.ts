/**
 * Headless acceptance test for P1-14 — Sleep and shelter preference.
 *
 * Roadmap acceptance test (DAMN_BEAVERS_MASTER_ROADMAP.md, P1-14):
 *   "exhausted beavers interrupt lower-priority work and sleep; providing
 *   a completed lodge changes chosen sleep location."
 *
 * Two real, literal claims, both driven end to end:
 *
 * 1. "Interrupt lower-priority work and sleep" -- a real beaver is given a
 *    real, genuinely multi-tick `"cut-tree"` job (P1-08) and driven by
 *    `tickBeaverBehavior` (P1-14's own arbitration primitive) composed
 *    with `tickTreeCutJob` exactly the way a real driving loop would:
 *    while `tickBeaverBehavior` reports `"working"`, the job's own tick
 *    function runs; the instant fatigue (accumulating from that same real
 *    job activity -- P1-14's own contribution, since nothing previously
 *    advanced `Needs` for a beaver that never called `tickBeaverNeeds`)
 *    crosses urgency, `tickBeaverBehavior` reports `"job-interrupted"`
 *    instead, and the job is provably abandoned mid-progress: genuinely
 *    unfinished, `Job.status` back to `"unclaimed"` (P1-07's own
 *    `suspendJob`), immediately available for a different worker.
 * 2. "Providing a completed lodge changes chosen sleep location" -- the
 *    SAME exhausted beaver's own rest destination (`decideIntent`'s
 *    `"rest"` intent) is compared before any lodge exists (rests in
 *    place, no target) against after a REAL completed `"lodge-segment"`
 *    construction (P1-10) exists nearby (targets its real site) -- never
 *    a hand-set intent, purely `decideIntent` reading live world state.
 */
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
import { spawnBeaver, getSwimmer } from "../../src/sim/creatures/Beaver.js";
import type { NavigationProfile } from "../../src/sim/navigation/Pathfinding.js";
import { getNeeds, setNeeds, NEED_URGENT_THRESHOLD } from "../../src/sim/creatures/Needs.js";
import { setNeedFocus, decideIntent } from "../../src/sim/creatures/BeaverNeeds.js";
import { tickBeaverBehavior } from "../../src/sim/creatures/BeaverBehavior.js";
import { setPlant } from "../../src/sim/ecology/Plant.js";
import { PlantSpeciesRegistry } from "../../src/sim/ecology/PlantSpecies.js";
import { registerStandardPlantSpecies } from "../../src/sim/ecology/standardPlantSpecies.js";
import { designateTreeCut, generateTreeCutJob, tickTreeCutJob } from "../../src/sim/labor/TreeCutting.js";
import { getJob, type Job } from "../../src/sim/jobs/Job.js";
import { getDesignation } from "../../src/sim/jobs/Designation.js";
import { designateConstruction, checkMaterialsDelivered, generateBuildJob, tickBuildJob, getConstruction } from "../../src/sim/labor/Construction.js";
import { setLog } from "../../src/sim/labor/Log.js";

const SIZE_X = 20;
const SIZE_Y = 8;
const SIZE_Z = 12;

function buildWorld(): { world: World; materials: MaterialRegistry; water: WaterField; plantSpecies: PlantSpeciesRegistry } {
  const entities = new EntityIdRegistry();
  const components = new ComponentStore(entities);
  const grid = new WorldGrid({ sizeX: SIZE_X, sizeY: SIZE_Y, sizeZ: SIZE_Z }, entities);
  const materials = new MaterialRegistry();
  registerStandardMaterials(materials);
  const terrain = new TerrainField(grid, materials);
  for (let x = 0; x < SIZE_X; x++) {
    for (let z = 0; z < SIZE_Z; z++) {
      for (let y = 0; y <= 2; y++) terrain.setMaterial(x, y, z, "soil");
    }
  }
  const water = new WaterField(grid);
  const weather = new Weather();
  const plantSpecies = new PlantSpeciesRegistry();
  registerStandardPlantSpecies(plantSpecies);
  const clock = new SimulationClock({ tickRateHz: 20 });
  const random = new RandomStreams("p1-14-sleep-shelter");
  const events = new EventLog(entities);
  const world: World = { clock, random, entities, components, grid, terrain, events, water, weather };
  return { world, materials, water, plantSpecies };
}

function spawnAt(world: World, x: number, z: number, name: string) {
  const floor = world.grid.surfaceY(x, z)!;
  return spawnBeaver(world, { name, position: { x, y: floor + 1, z } });
}

describe("P1-14 acceptance: exhausted beavers interrupt lower-priority work and sleep; providing a completed lodge changes chosen sleep location", () => {
  it("a real, still-in-progress cut-tree job is genuinely interrupted once fatigue (accumulated from that same job activity) becomes urgent", () => {
    const { world, materials, water, plantSpecies } = buildWorld();
    const woodcutter = spawnAt(world, 2, 2, "Woodcutter");
    const profile = getSwimmer(world.components, woodcutter)!;
    setNeeds(world.components, woodcutter, { hunger: 0, thirst: 0, fatigue: 0, thermalComfort: 1 });
    setNeedFocus(world.components, woodcutter, { current: "none" });

    // A big, old, slow-to-fell tree -- genuinely many ticks of real work,
    // so the job is provably still unfinished when interruption happens.
    const tree = world.entities.create("tree");
    world.grid.setEntityPosition(tree, 15, world.grid.surfaceY(15, 2)! + 1, 2);
    setPlant(world.components, tree, { speciesId: "aspen", ageTicks: 20_000, health: 1 });
    const designationId = designateTreeCut(world, tree);
    const [jobId] = generateTreeCutJob(world, materials, plantSpecies, designationId);

    let interrupted = false;
    let sawWorking = false;
    let sawFelled = false;
    let fatigueJustBeforeInterrupt = 0;
    for (let tick = 0; tick < 300 && !interrupted; tick++) {
      // `tickBeaverBehavior` only decides whether to LET an already-held
      // job continue or INTERRUPT it -- it never claims one itself
      // (that's `tickTreeCutJob`'s own selection/reservation logic, the
      // same as every other labor-type acceptance test drives). So this
      // loop calls `tickTreeCutJob` on every tick EXCEPT the one where a
      // job just got interrupted -- calling it that same tick would
      // simply re-claim the job right back, undoing the interruption.
      const fatigueBeforeThisTick = getNeeds(world.components, woodcutter)!.fatigue;
      const behavior = tickBeaverBehavior(world.grid, world.terrain, water, materials, world.entities, world.components, woodcutter, profile);
      if (behavior.kind === "job-interrupted") {
        interrupted = true;
        fatigueJustBeforeInterrupt = fatigueBeforeThisTick;
        expect(behavior.needsResult.intent.kind).toBe("rest");
        continue;
      }
      sawWorking = true;
      const outcome = tickTreeCutJob(world.grid, world.terrain, water, materials, plantSpecies, world.entities, world.components, woodcutter, profile, [jobId!]);
      if (outcome === "felled") sawFelled = true;
    }

    expect(sawWorking).toBe(true); // real job work genuinely happened first
    expect(interrupted).toBe(true); // and was genuinely interrupted
    expect(sawFelled).toBe(false); // BEFORE the tree was ever felled -- lower-priority work, truly abandoned mid-progress
    expect(world.entities.isLive(tree)).toBe(true); // tree still standing -- the job never finished

    const job = getJob(world.components, jobId!)!;
    expect(job.status).toBe("unclaimed"); // suspended, not completed or failed -- available for another worker
    expect(getDesignation(world.components, designationId)!.status).toBe("active"); // the underlying order survives, same as any other suspended/requeued job
    // Fatigue was genuinely urgent AT THE MOMENT interruption was decided
    // (the value going INTO that tick, before rest had any chance to
    // recover it) -- the persisted value AFTER that same tick is already
    // lower, since resting starts recovering fatigue immediately, which is
    // correct behavior, not something this assertion should fight.
    expect(fatigueJustBeforeInterrupt).toBeGreaterThanOrEqual(NEED_URGENT_THRESHOLD);
    expect(getNeeds(world.components, woodcutter)!.fatigue).toBeLessThan(fatigueJustBeforeInterrupt); // already genuinely resting/recovering
  });

  it("providing a completed lodge changes the exhausted beaver's chosen sleep location from 'in place' to the lodge's real site", () => {
    const { world, materials, water } = buildWorld();
    const position = { x: 3, z: 3 };
    const exhausted = { hunger: 0, thirst: 0, fatigue: NEED_URGENT_THRESHOLD + 0.1, thermalComfort: 1 };
    const profile: NavigationProfile = { canSwim: true, maxWadingDepth: 0.5 };

    const before = decideIntent(exhausted, "none", world.entities, world.components, world.grid, world.terrain, water, materials, profile, position);
    expect(before.intent).toEqual({ kind: "rest" }); // no lodge exists yet -- sleeps wherever it stands

    // Build a REAL completed lodge-segment via P1-10's own construction
    // pipeline, not a hand-set status.
    const lodgeSite = { x: 12, z: 3 };
    const lodgeConstructionId = designateConstruction(world, "lodge-segment", lodgeSite);
    const materialItem = world.entities.create("log");
    world.grid.setEntityPosition(materialItem, lodgeSite.x, world.grid.surfaceY(lodgeSite.x, lodgeSite.z)! + 1, lodgeSite.z);
    setLog(world.components, materialItem, { materialId: "wood", massKg: 40 });
    expect(checkMaterialsDelivered(world, lodgeConstructionId)).toBe(true);
    const [buildJobId] = generateBuildJob(world, lodgeConstructionId);
    const builder = spawnAt(world, lodgeSite.x, lodgeSite.z, "Builder");
    const builderProfile = getSwimmer(world.components, builder)!;
    let buildOutcome: string;
    let iterations = 0;
    do {
      buildOutcome = tickBuildJob(world.grid, world.terrain, water, materials, world.entities, world.components, builder, builderProfile, [buildJobId!]);
      iterations++;
      expect(iterations).toBeLessThan(200);
    } while (buildOutcome !== "built");
    expect(getConstruction(world.components, lodgeConstructionId)!.status).toBe("complete");

    const after = decideIntent(exhausted, "none", world.entities, world.components, world.grid, world.terrain, water, materials, profile, position);
    expect(after.intent).toEqual({ kind: "rest", target: lodgeSite }); // the same beaver, same position, same fatigue -- ONLY the lodge changed
  });
});
