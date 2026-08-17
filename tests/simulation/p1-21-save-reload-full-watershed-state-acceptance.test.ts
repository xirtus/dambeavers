/**
 * Headless acceptance test for P1-21 — Save/reload full watershed state.
 *
 * Roadmap acceptance test (DAMN_BEAVERS_MASTER_ROADMAP.md, P1-21):
 *   "save during an active dam build with a log in transit, reload, and
 *   continue to the same final deterministic state."
 *
 * The literal scenario: a real dam-segment construction is designated, a
 * real beaver has picked up a real felled log and is actively carrying it
 * toward the site (`"carrying"`, P1-09's own mid-haul outcome -- the log
 * is genuinely "in transit," not merely reserved), and at EXACTLY that
 * moment the world is saved via `snapshotWorld`/`JSON.stringify`/
 * `JSON.parse`/`restoreWorld` (P0-06's canonical mechanism, now extended
 * by this task to also cover `water`/`weather`, P1-21's own two new
 * `World` sections, and `AllComponentTypes.ts`'s canonical, full
 * component-type registry rather than a hand-picked subset).
 *
 * "Continue to the same final deterministic state" is proven by running
 * the IDENTICAL deterministic driving sequence twice from that exact
 * save point -- once on the original, never-saved world, once on the
 * independently-restored world -- and asserting both branches converge
 * on the same final state: the dam segment completed, the same log
 * entities with the same masses, the same real terrain material placed
 * by `applyDamSegment`, and the same evolved `Needs` values for every
 * other beaver ticking in the background the whole time (a real,
 * multi-tick determinism check, not just a structural comparison at one
 * instant).
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
import { snapshotWorld, restoreWorld, type WorldRestoreContext } from "../../src/sim/persistence/WorldSnapshot.js";
import { ALL_COMPONENT_TYPES } from "../../src/sim/persistence/AllComponentTypes.js";
import type { NavigationProfile } from "../../src/sim/navigation/Pathfinding.js";
import { PlantSpeciesRegistry } from "../../src/sim/ecology/PlantSpecies.js";
import { registerStandardPlantSpecies } from "../../src/sim/ecology/standardPlantSpecies.js";
import { setPlant, getPlant } from "../../src/sim/ecology/Plant.js";
import { spawnSevenStartingBeavers, getSwimmer, getIdentity } from "../../src/sim/creatures/Beaver.js";
import { getNeeds, setNeeds, BASELINE_NEEDS } from "../../src/sim/creatures/Needs.js";
import { tickBeaverNeeds } from "../../src/sim/creatures/BeaverNeeds.js";
import { getLog, setLog } from "../../src/sim/labor/Log.js";
import { tickHaulJob } from "../../src/sim/labor/Hauling.js";
import { designateConstruction, getConstruction, ensureMaterialHaul, checkMaterialsDelivered, generateBuildJob, tickBuildJob } from "../../src/sim/labor/Construction.js";
import { applyDamSegment, getDamSegment, findDamSegmentAt } from "../../src/sim/hydrology/Dam.js";

const SIZE_X = 20;
const SIZE_Y = 8;
const SIZE_Z = 12;
const LOG_AT = { x: 3, z: 4 };
const DAM_SITE = { x: 10, z: 4 };
const TREE_AT = { x: 16, z: 8 }; // a real, untouched plant elsewhere -- proves "plants" persist too

function buildWorld(seed: string): { world: World; materials: MaterialRegistry; water: WaterField; plantSpecies: PlantSpeciesRegistry } {
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
  weather.setCondition("rain"); // real, non-default weather -- proves "time/weather" persists
  const plantSpecies = new PlantSpeciesRegistry();
  registerStandardPlantSpecies(plantSpecies);
  const clock = new SimulationClock({ tickRateHz: 20 });
  const random = new RandomStreams(seed);
  const events = new EventLog(entities);
  const world: World = { clock, random, entities, components, grid, terrain, events, water, weather };
  return { world, materials, water, plantSpecies };
}

/** Every id/profile the deterministic driving sequence below needs, gathered once so the SAME sequence of calls can be replayed identically against two independent world instances. */
interface DriveHandles {
  haulJobId: EntityId;
  constructionId: EntityId;
  logId: EntityId;
  hauler: EntityId;
  haulerProfile: NavigationProfile;
  builder: EntityId;
  builderProfile: NavigationProfile;
  idleBeavers: EntityId[];
  idleProfiles: NavigationProfile[];
}

/**
 * Builds the real, literal "save point": seven starting beavers, a real
 * live untouched tree elsewhere, a real felled log, a real dam-segment
 * construction, and a haul actively IN TRANSIT (`"carrying"` -- the log
 * has been picked up and the hauler is now en route to the site, not
 * merely reserved or still walking toward the item).
 */
function buildSavePoint(seed: string): { world: World; materials: MaterialRegistry; water: WaterField; plantSpecies: PlantSpeciesRegistry; handles: DriveHandles } {
  const { world, materials, water, plantSpecies } = buildWorld(seed);

  const floor = world.grid.surfaceY(1, 1)!;
  const beavers = spawnSevenStartingBeavers(world, { x: 1, y: floor + 1, z: 1 });
  const [hauler, builder, ...idleBeavers] = beavers as [EntityId, EntityId, ...EntityId[]];
  const haulerProfile = getSwimmer(world.components, hauler)!;
  const builderProfile = getSwimmer(world.components, builder)!;
  const idleProfiles = idleBeavers.map((id) => getSwimmer(world.components, id)!);

  // Real, non-baseline, non-uniform Needs -- real state for the
  // determinism check to actually diverge in if something were wrong.
  beavers.forEach((id, i) => {
    setNeeds(world.components, id, { ...BASELINE_NEEDS, hunger: 0.1 * i, thirst: 0.05 * i, fatigue: 0.02 * i });
  });

  // A real, untouched tree elsewhere.
  const tree = world.entities.create("tree");
  world.grid.setEntityPosition(tree, TREE_AT.x, world.grid.surfaceY(TREE_AT.x, TREE_AT.z)! + 1, TREE_AT.z);
  setPlant(world.components, tree, { speciesId: "aspen", ageTicks: 9000, health: 0.85 });

  // A real, physical, pre-felled log ready to be hauled.
  const logId = world.entities.create("log");
  world.grid.setEntityPosition(logId, LOG_AT.x, world.grid.surfaceY(LOG_AT.x, LOG_AT.z)! + 1, LOG_AT.z);
  setLog(world.components, logId, { materialId: "wood", massKg: 60 }); // comfortably above a dam-segment's requirement

  const constructionId = designateConstruction(world, "dam-segment", DAM_SITE);
  expect(getConstruction(world.components, constructionId)!.status).toBe("awaiting-materials");

  const haulJobId = ensureMaterialHaul(world, constructionId)!;
  expect(haulJobId).toBeDefined();

  // Drive the haul to "picked up" then one further tick into "carrying"
  // -- the log is now genuinely in transit, not merely reserved.
  let outcome = "";
  let iterations = 0;
  while (outcome !== "picked-up") {
    outcome = tickHaulJob(world.grid, world.terrain, water, materials, world.entities, world.components, hauler, haulerProfile, [haulJobId]);
    iterations++;
    if (iterations > 100) throw new Error("hauler never picked up the log");
  }
  outcome = tickHaulJob(world.grid, world.terrain, water, materials, world.entities, world.components, hauler, haulerProfile, [haulJobId]);
  expect(outcome).toBe("carrying"); // in transit, exactly the roadmap's own scenario

  const handles: DriveHandles = { haulJobId, constructionId, logId, hauler, haulerProfile, builder, builderProfile, idleBeavers, idleProfiles };
  return { world, materials, water, plantSpecies, handles };
}

interface Ctx {
  world: World;
  materials: MaterialRegistry;
  water: WaterField;
  plantSpecies: PlantSpeciesRegistry;
}

/**
 * The deterministic continuation from the save point to a fully completed,
 * terrain-applied dam segment -- finishes the in-transit haul, drives
 * labor to completion, and applies the real dam segment. Idle beavers'
 * `Needs` keep ticking the whole time (real background activity, not
 * frozen state), so a long, real sequence of independent state changes
 * happens between the save point and the final assertions -- a much
 * stronger determinism check than comparing two snapshots taken one tick
 * apart.
 */
function driveToCompletion(ctx: Ctx, handles: DriveHandles): void {
  const { world, materials, water } = ctx;
  const { haulJobId, constructionId, hauler, haulerProfile, builder, builderProfile, idleBeavers, idleProfiles } = handles;

  function tickIdleNeeds(): void {
    idleBeavers.forEach((id, i) => {
      tickBeaverNeeds(world.grid, world.terrain, water, materials, world.entities, world.components, id, idleProfiles[i]!);
    });
  }

  let haulOutcome = "";
  let haulIterations = 0;
  do {
    haulOutcome = tickHaulJob(world.grid, world.terrain, water, materials, world.entities, world.components, hauler, haulerProfile, [haulJobId]);
    tickIdleNeeds();
    haulIterations++;
    if (haulIterations > 100) throw new Error("haul did not deliver in time");
  } while (haulOutcome !== "delivered" && haulOutcome !== "failed" && haulOutcome !== "requeued");
  if (haulOutcome !== "delivered") throw new Error(`unexpected haul outcome: ${haulOutcome}`);

  checkMaterialsDelivered(world, constructionId); // claims delivered mass and flips status once the requirement is met

  if (getConstruction(world.components, constructionId)!.status !== "awaiting-labor") {
    throw new Error("construction did not reach awaiting-labor after delivery");
  }
  const [buildJobId] = generateBuildJob(world, constructionId);

  let buildOutcome = "";
  let buildIterations = 0;
  do {
    buildOutcome = tickBuildJob(world.grid, world.terrain, water, materials, world.entities, world.components, builder, builderProfile, [buildJobId!]);
    tickIdleNeeds();
    buildIterations++;
    if (buildIterations > 200) throw new Error("build did not complete in time");
  } while (buildOutcome !== "built");

  applyDamSegment(world, constructionId);
}

describe("P1-21 acceptance: save during an active dam build with a log in transit, reload, and continue to the same final deterministic state", () => {
  it("the original (never-saved) and independently-restored worlds converge on an identical final state", () => {
    const seed = "p1-21-save-reload";
    const original = buildSavePoint(seed);

    // -- Save at EXACTLY the "log in transit" moment. --
    const snapshot = JSON.parse(JSON.stringify(snapshotWorld(original.world)));

    // -- Reload into a genuinely independent World. --
    const restoreMaterials = new MaterialRegistry();
    registerStandardMaterials(restoreMaterials);
    const context: WorldRestoreContext = { componentTypes: ALL_COMPONENT_TYPES, materials: restoreMaterials };
    const restoredWorld = restoreWorld(snapshot, context);

    // Sanity: the restored world genuinely captured mid-transit state.
    const restoredJob = getConstruction(restoredWorld.components, original.handles.constructionId);
    expect(restoredJob!.status).toBe("awaiting-materials");
    const restoredLogIds = restoredWorld.entities.liveIdsOfKind("log");
    expect(restoredLogIds.some((id) => getLog(restoredWorld.components, id) !== undefined)).toBe(true);

    // Independent PlantSpeciesRegistry/MaterialRegistry for the restored
    // branch (code-defined, never part of the save -- P0-07/P0-10's own
    // established precedent), and a rebuilt WaterField isn't needed
    // separately: `restoredWorld.water` is itself already the real,
    // restored WaterField (P1-21's own new section).
    const restoredPlantSpecies = new PlantSpeciesRegistry();
    registerStandardPlantSpecies(restoredPlantSpecies);

    // -- Continue BOTH branches with the IDENTICAL deterministic sequence. --
    driveToCompletion({ world: original.world, materials: original.materials, water: original.water, plantSpecies: original.plantSpecies }, original.handles);
    driveToCompletion({ world: restoredWorld, materials: restoreMaterials, water: restoredWorld.water, plantSpecies: restoredPlantSpecies }, original.handles);

    // -- Construction: identical final status/work/mass on both branches. --
    const originalConstruction = getConstruction(original.world.components, original.handles.constructionId)!;
    const restoredConstruction = getConstruction(restoredWorld.components, original.handles.constructionId)!;
    expect(originalConstruction.status).toBe("complete");
    expect(restoredConstruction).toEqual(originalConstruction);

    // -- Dam segment: identical real terrain application on both branches. --
    const originalDamId = findDamSegmentAt(original.world.entities, original.world.components, DAM_SITE)!;
    const restoredDamId = findDamSegmentAt(restoredWorld.entities, restoredWorld.components, DAM_SITE)!;
    expect(originalDamId).toBe(restoredDamId); // same EntityId -- ids never renumber across save/reload
    expect(getDamSegment(restoredWorld.components, restoredDamId)).toEqual(getDamSegment(original.world.components, originalDamId));
    expect(restoredWorld.terrain.materialAt(DAM_SITE.x, getDamSegment(restoredWorld.components, restoredDamId)!.baseY, DAM_SITE.z)).toBe(
      original.world.terrain.materialAt(DAM_SITE.x, getDamSegment(original.world.components, originalDamId)!.baseY, DAM_SITE.z),
    );

    // -- The real log entity: the SAME physical resource was consumed by
    // assembly (Law 1.6 -- real material genuinely used up, not left
    // behind), identically on both branches. --
    const { logId } = original.handles;
    expect(original.world.entities.isLive(logId)).toBe(false);
    expect(restoredWorld.entities.isLive(logId)).toBe(false);
    expect(restoredWorld.entities.kindOf(logId)).toBe(original.world.entities.kindOf(logId));

    // -- The untouched tree: identical Plant state on both branches (it
    // was never touched by either drive, but this proves "plants" rode
    // through the save/reload boundary unchanged, not merely coincidentally
    // absent from divergence). --
    const tree = original.world.entities.liveIdsOfKind("tree")[0]!;
    expect(getPlant(restoredWorld.components, tree)).toEqual(getPlant(original.world.components, tree));

    // -- Every idle beaver's Needs, evolved over the SAME real number of
    // ticks on both branches -- the strongest determinism check: many
    // independent per-tick decisions (decay math) had to land identically. --
    for (const id of original.handles.idleBeavers) {
      expect(getNeeds(restoredWorld.components, id)).toEqual(getNeeds(original.world.components, id));
      expect(getIdentity(restoredWorld.components, id)).toEqual(getIdentity(original.world.components, id));
    }

    // -- Weather ("time/weather" persistence) -- the real, non-default
    // condition set before the save survived and is identical afterward. --
    expect(restoredWorld.weather.condition).toBe(original.world.weather.condition);
    expect(restoredWorld.weather.condition).toBe("rain");
  });
});
