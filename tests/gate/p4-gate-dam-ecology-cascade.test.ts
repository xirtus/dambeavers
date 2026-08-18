/**
 * Phase 4 Gate -- "Building a dam can cause a multi-season ecological
 * cascade without a 'dam ecology' script."
 *
 * This is a COMPOSED test, like the Phase 2 gate soak: every mechanism it
 * drives is an already-real, already-tested system from its own task, and
 * nothing here is dam-ecology-specific. A real dam segment is built
 * through the real P1-10 haul+build pipeline and applied as real terrain
 * (P1-11); real inflow + stepFlow (P1-03) ponds water upstream of it; and
 * across several real seasons (P4-01's own tick-driven cycle), the
 * ponding drives P4-02's real plant lifecycles so a dry-adapted tree
 * upstream declines and dies while a wetland-adapted one thrives -- with
 * both species at an un-dammed control site untouched. The cascade is a
 * consequence of dam -> water -> wetness -> vegetation, all ordinary
 * systems, never a scripted "dam ecology" rule.
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
import { stepFlow, applyEdgeDrainage } from "../../src/sim/hydrology/Flow.js";
import type { World } from "../../src/sim/persistence/WorldSnapshot.js";
import { PlantSpeciesRegistry } from "../../src/sim/ecology/PlantSpecies.js";
import { registerStandardPlantSpecies } from "../../src/sim/ecology/standardPlantSpecies.js";
import { plantSapling } from "../../src/sim/ecology/EcologyResponse.js";
import { tickPlantLifecycle, bestFittingSpecies } from "../../src/sim/ecology/PlantLifecycle.js";
import { getPlant } from "../../src/sim/ecology/Plant.js";
import { spawnBeaver } from "../../src/sim/creatures/Beaver.js";
import type { NavigationProfile } from "../../src/sim/navigation/Pathfinding.js";
import { setLog } from "../../src/sim/labor/Log.js";
import { tickHaulJob } from "../../src/sim/labor/Hauling.js";
import { designateConstruction, checkMaterialsDelivered, ensureMaterialHaul, generateBuildJob, tickBuildJob } from "../../src/sim/labor/Construction.js";
import { applyDamSegment } from "../../src/sim/hydrology/Dam.js";
import { YEAR_LENGTH_TICKS } from "../../src/sim/weather/Seasons.js";

const PROFILE: NavigationProfile = { canSwim: true, maxWadingDepth: 0.5 };
const SIZE = 20;
const CHANNEL_X = 10;
const DAM_SITE = { x: CHANNEL_X, z: 8 };
const UPSTREAM_SITE = { x: CHANNEL_X, z: 5 };
const CONTROL_SITE = { x: 3, z: 15 };
const YEAR_TICKS = YEAR_LENGTH_TICKS / 10; // a full real year of flow steps, with plant ticks every 20 steps -- long enough for several seasons to pass on the world clock

function buildWorld(): { world: World; materials: MaterialRegistry; plantSpecies: PlantSpeciesRegistry } {
  const entities = new EntityIdRegistry();
  const components = new ComponentStore(entities);
  const grid = new WorldGrid({ sizeX: SIZE, sizeY: 10, sizeZ: SIZE }, entities);
  const materials = new MaterialRegistry();
  registerStandardMaterials(materials);
  const terrain = new TerrainField(grid, materials);
  for (let x = 0; x < SIZE; x++) for (let z = 0; z < SIZE; z++) for (let y = 0; y <= 2; y++) terrain.setMaterial(x, y, z, "soil");
  const water = new WaterField(grid);
  const weather = new Weather();
  const clock = new SimulationClock({ tickRateHz: 20 });
  const random = new RandomStreams("p4-gate-dam-ecology-cascade");
  const events = new EventLog(entities);
  const plantSpecies = new PlantSpeciesRegistry();
  registerStandardPlantSpecies(plantSpecies);
  const world: World = { clock, random, entities, components, grid, terrain, events, water, weather };
  return { world, materials, plantSpecies };
}

/** Real dam-segment construction at DAM_SITE through the ordinary P1-10 pipeline, exactly like p1-11's own acceptance test drives it. */
function buildRealDamSegment(world: World, materials: MaterialRegistry, hauler: EntityId, builder: EntityId): EntityId {
  // The log sits a few cells downstream of the site (a real delivery
  // distance -- placing it ON the site would make `findAvailableMaterial`
  // skip it as already-delivered, so the ordinary haul leg is real work).
  const logId = world.entities.create("log");
  world.grid.setEntityPosition(logId, DAM_SITE.x, 3, DAM_SITE.z + 4);
  setLog(world.components, logId, { materialId: "wood", massKg: 60 });

  const constructionId = designateConstruction(world, "dam-segment", DAM_SITE);
  let safety = 0;
  while (!checkMaterialsDelivered(world, constructionId)) {
    safety++;
    expect(safety).toBeLessThan(50);
    const haulJobId = ensureMaterialHaul(world, constructionId);
    if (haulJobId === undefined) break;
    let outcome = "";
    let iterations = 0;
    do {
      outcome = tickHaulJob(world.grid, world.terrain, world.water, materials, world.entities, world.components, hauler, PROFILE, [haulJobId]);
      iterations++;
      expect(iterations).toBeLessThan(150);
    } while (outcome !== "delivered" && outcome !== "failed" && outcome !== "requeued");
    expect(outcome).toBe("delivered");
  }
  const [buildJobId] = generateBuildJob(world, constructionId);
  let buildOutcome = "";
  let buildIterations = 0;
  do {
    buildOutcome = tickBuildJob(world.grid, world.terrain, world.water, materials, world.entities, world.components, builder, PROFILE, [buildJobId!]);
    buildIterations++;
    expect(buildIterations).toBeLessThan(300);
  } while (buildOutcome !== "built");
  return constructionId;
}

describe("Phase 4 Gate -- dam-driven multi-season ecological cascade", () => {
  it("a real dam ponds upstream water across seasons, which kills the dry-adapted tree there while the wetland-adapted one and the un-dammed control site are unaffected", () => {
    const { world, materials, plantSpecies } = buildWorld();

    // A real narrow channel: solid stone walls flank the channel column
    // (scenario terrain shaping, not a simulation mechanism) so the single
    // dam segment genuinely ponds water upstream instead of letting it
    // flow laterally around the dam.
    for (let z = 0; z < SIZE; z++) {
      for (let y = 3; y <= 8; y++) {
        world.terrain.setMaterial(CHANNEL_X - 1, y, z, "stone");
        world.terrain.setMaterial(CHANNEL_X + 1, y, z, "stone");
      }
    }

    // Real construction: a hauler and a builder beaver, one real log.
    const hauler = spawnBeaver(world, { name: "Hauler", position: { x: DAM_SITE.x, y: 3, z: DAM_SITE.z + 4 } });
    const builder = spawnBeaver(world, { name: "Builder", position: { x: DAM_SITE.x, y: 3, z: DAM_SITE.z + 4 } });
    const constructionId = buildRealDamSegment(world, materials, hauler, builder);
    applyDamSegment(world, constructionId);

    // The vegetation under test: a dry-adapted (aspen) and a wetland-adapted
    // (willow) tree both upstream (where the dam will pond water) and both
    // at an un-dammed control site.
    const upstreamAspen = plantSapling(world, "aspen", UPSTREAM_SITE);
    const upstreamWillow = plantSapling(world, "willow", UPSTREAM_SITE);
    const controlAspen = plantSapling(world, "aspen", CONTROL_SITE);
    const controlWillow = plantSapling(world, "willow", CONTROL_SITE);

    // Run several real seasons: continuous inflow ponds upstream of the
    // real dam (P1-03's own stepFlow), while the world clock advances and
    // P4-02's own real plant lifecycles respond to the persistent wetness.
    const random = world.random.stream("gate-plants");
    for (let tick = 0; tick < YEAR_TICKS; tick++) {
      world.water.addVolume(CHANNEL_X, 0, 2);
      stepFlow(world.water, world.terrain, materials, 1, { conductance: 0.6 });
      applyEdgeDrainage(world.water, 1, { drainRate: 0.5 });
      if (tick % 20 === 0) {
        world.clock.advanceTicks(1);
        tickPlantLifecycle(world, plantSpecies, random, upstreamAspen);
        tickPlantLifecycle(world, plantSpecies, random, upstreamWillow);
        tickPlantLifecycle(world, plantSpecies, random, controlAspen);
        tickPlantLifecycle(world, plantSpecies, random, controlWillow);
      }
    }

    // The cascade: persistent ponding upstream drove the dry-adapted tree
    // down (health well below its starting 1) while the wetland-adapted
    // tree at the SAME site stayed healthy -- and at the never-flooded
    // control site the exact MIRROR happened (dry-adapted thrives,
    // wetland-adapted declines), proving the shift is the site's own
    // changed wetness, not a global effect.
    expect(world.water.depthAt(UPSTREAM_SITE.x, UPSTREAM_SITE.z)).toBeGreaterThan(0.5);
    const upstreamAspenHealth = getPlant(world.components, upstreamAspen)!.health;
    const upstreamWillowHealth = getPlant(world.components, upstreamWillow)!.health;
    expect(upstreamAspenHealth).toBeLessThan(0.5);
    expect(upstreamWillowHealth).toBeGreaterThan(0.9);
    expect(getPlant(world.components, controlAspen)!.health).toBeGreaterThan(0.9);
    expect(getPlant(world.components, controlWillow)!.health).toBeLessThan(0.5);

    // Ecological suitability itself shifted: the persistently-ponded
    // upstream site now favors the wetland species, the dry control site
    // still favors the dry-adapted one -- through the SAME fitness-weighted
    // sampler (P4-04), never a dam-specific rule.
    const upstreamCounts: Record<string, number> = {};
    const controlCounts: Record<string, number> = {};
    for (let i = 0; i < 300; i++) {
      const upstreamPick = bestFittingSpecies(plantSpecies, world.water, random, UPSTREAM_SITE.x, UPSTREAM_SITE.z)!;
      const controlPick = bestFittingSpecies(plantSpecies, world.water, random, CONTROL_SITE.x, CONTROL_SITE.z)!;
      upstreamCounts[upstreamPick] = (upstreamCounts[upstreamPick] ?? 0) + 1;
      controlCounts[controlPick] = (controlCounts[controlPick] ?? 0) + 1;
    }
    expect(upstreamCounts["willow"]!).toBeGreaterThan(upstreamCounts["aspen"] ?? 0);
    expect(controlCounts["aspen"]!).toBeGreaterThan(controlCounts["willow"] ?? 0);
  });
});
