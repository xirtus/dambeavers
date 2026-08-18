/**
 * The Pond scenario composer: builds the canonical "seven beavers beside a
 * stream" world through the SAME real systems the headless M0 acceptance
 * test uses (createWorld + generateWatershed + spawnSevenStartingBeavers +
 * real initial stream water), and owns the per-tick driving loop every
 * headless test in this project performs manually (job generation from
 * designations, material hauls, build jobs, hydrology steps, tickColony).
 *
 * Nothing here is a renderer shortcut: this file IS the ordinary
 * simulation composition a headless runner would use, exposed through the
 * presentation layer so the 3D client and the CI tests drive the exact
 * same world the same way.
 */
import { createWorld } from "../../sim/runtime/SimulationRunner.js";
import type { World } from "../../sim/persistence/WorldSnapshot.js";
import { snapshotWorld, restoreWorld, type WorldSnapshot } from "../../sim/persistence/WorldSnapshot.js";
import { ALL_COMPONENT_TYPES } from "../../sim/persistence/AllComponentTypes.js";
import { MaterialRegistry } from "../../sim/materials/Material.js";
import { registerStandardMaterials } from "../../sim/materials/standardMaterials.js";
import { PlantSpeciesRegistry } from "../../sim/ecology/PlantSpecies.js";
import { registerStandardPlantSpecies } from "../../sim/ecology/standardPlantSpecies.js";
import { RecipeRegistry, registerStandardRecipes } from "../../sim/economy/Recipe.js";
import { AnimalSpeciesRegistry, registerStandardAnimalSpecies } from "../../sim/creatures/AnimalSpecies.js";
import { PathogenRegistry, registerStandardPathogens } from "../../sim/creatures/Disease.js";
import { generateWatershed, type WatershedLayout } from "../../sim/worldgen/WatershedGenerator.js";
import { getPlant, setPlant } from "../../sim/ecology/Plant.js";
import { stepFlow, applyEdgeDrainage } from "../../sim/hydrology/Flow.js";
import { spawnSevenStartingBeavers, getSwimmer } from "../../sim/creatures/Beaver.js";
import type { EntityId } from "../../sim/core/EntityId.js";
import { tickColony, type ColonyLoopDeps } from "../../sim/runtime/ColonyLoop.js";
import { getDesignation } from "../../sim/jobs/Designation.js";
import { getJob } from "../../sim/jobs/Job.js";
import { generateTreeCutJob } from "../../sim/labor/TreeCutting.js";
import {
  ensureMaterialHaul,
  checkMaterialsDelivered,
  generateBuildJob,
  getConstruction,
  getBuildProgress,
} from "../../sim/labor/Construction.js";
import { getHaulProgress } from "../../sim/labor/Hauling.js";
import { applyDamSegment, DamApplicationComponent } from "../../sim/hydrology/Dam.js";
import type { ColumnCoordinate } from "../../sim/hydrology/WaterField.js";

export const POND_DIMS = { sizeX: 41, sizeY: 14, sizeZ: 61 } as const;
export const POND_SEED = "m0-pond-test";
/**
 * Stream source inflow per tick (volume == depth, 1-cell columns). Tuned
 * empirically (tools: diag3/diag4) for a LIVING stream that stays
 * channel-bound with modest natural pooling at bends over indefinite play:
 * 1.0/tick (the M0 test's short-burst flood rate) drowns the whole map by
 * ~tick 2400; 0.05 holds a living stream with natural pools (max natural
 * depth ~2.6 cells at tick 8000, colony stays habitable) and a real dam
 * ponds visibly within a game-day or two. Scenario configuration, not a
 * sim mechanic.
 */
export const POND_SOURCE_INFLOW_PER_TICK = 0.05;

export interface PondScenario {
  readonly world: World;
  /** Inflow rate the driver adds at the stream source each tick. */
  readonly sourceInflowPerTick: number;
  readonly materials: MaterialRegistry;
  readonly plantSpecies: PlantSpeciesRegistry;
  readonly deps: ColonyLoopDeps;
  readonly layout: WatershedLayout;
  readonly beavers: readonly EntityId[];
  readonly damSite: ColumnCoordinate;
  readonly upstreamProbe: ColumnCoordinate;
  readonly source: ColumnCoordinate;
}

function makeRegistries(): { materials: MaterialRegistry; plantSpecies: PlantSpeciesRegistry } {
  const materials = new MaterialRegistry();
  registerStandardMaterials(materials);
  const plantSpecies = new PlantSpeciesRegistry();
  registerStandardPlantSpecies(plantSpecies);
  return { materials, plantSpecies };
}

/** Builds the canonical pond world identically to the M0 headless acceptance test's buildM0State (same seed, same constants, same systems). */
export function createPondScenario(seed: string | number = POND_SEED, sourceInflowPerTick = POND_SOURCE_INFLOW_PER_TICK): PondScenario {
  const world = createWorld({ seed, dimensions: { ...POND_DIMS } });
  const { materials, plantSpecies } = makeRegistries();
  const layout = generateWatershed(world, { species: plantSpecies, treeDensity: 0.22 });

  const damZ = Math.floor((layout.prospectiveDamSite.zStart + layout.prospectiveDamSite.zEnd) / 2);
  const damSite = { x: layout.channelCenterlineX[damZ]!, z: damZ };
  const upstreamProbe = { x: layout.channelCenterlineX[damZ - 3]!, z: damZ - 3 };
  const source = { x: layout.channelCenterlineX[damZ - 8]!, z: damZ - 8 };

  // The real starting stream: the same 0.15-depth ribbon the M0 test lays.
  for (let z = 0; z < POND_DIMS.sizeZ; z++) {
    world.water.setDepth(layout.channelCenterlineX[z]!, z, 0.15);
  }

  // An established, mature forest -- the M0 test's own starting state
  // (freshly generated watershed trees are age-0 seedlings whose real
  // lifecycle self-thins ~half within a day; the canonical scenario opens
  // on the established forest, exactly like buildM0State).
  for (const treeId of layout.treeIds) {
    const plant = getPlant(world.components, treeId)!;
    setPlant(world.components, treeId, { ...plant, ageTicks: 20_000, health: 1 });
  }

  const arrivalZ = damZ - 5;
  const arrivalX = layout.channelCenterlineX[arrivalZ]! + 4;
  const beavers = spawnSevenStartingBeavers(world, {
    x: arrivalX,
    y: world.grid.surfaceY(arrivalX, arrivalZ)! + 1,
    z: arrivalZ,
  });

  const recipes = new RecipeRegistry();
  registerStandardRecipes(recipes);
  const animalSpecies = new AnimalSpeciesRegistry();
  registerStandardAnimalSpecies(animalSpecies);
  const pathogens = new PathogenRegistry();
  registerStandardPathogens(pathogens);

  const deps: ColonyLoopDeps = {
    grid: world.grid,
    terrain: world.terrain,
    water: world.water,
    materials,
    plantSpecies,
    recipes,
    animalSpecies,
    pathogens,
    entities: world.entities,
    components: world.components,
    profile: { canSwim: true, maxWadingDepth: 0.4 },
  };

  return { world, materials, plantSpecies, deps, layout, beavers, damSite, upstreamProbe, source, sourceInflowPerTick };
}

/**
 * Restores a scenario from a real save snapshot: `restoreWorld` (the
 * actual persistence path) + fresh code-defined registries, then rederives
 * the descriptive layout markers from restored terrain (the layout is
 * generation metadata, deliberately NOT persisted -- see
 * WatershedLayout's own doc comment; the stream channel's centerline is
 * still discoverable from the water field the save DID persist).
 */
export function restorePondScenario(snapshot: WorldSnapshot): PondScenario {
  const { materials, plantSpecies } = makeRegistries();
  const world = restoreWorld(snapshot, { componentTypes: ALL_COMPONENT_TYPES, materials });

  // Rederive the channel centerline from the persisted water field: for
  // each z row, the wettest column; fall back to map center on dry rows.
  const dims = world.grid.dims;
  const centerline: number[] = [];
  for (let z = 0; z < dims.sizeZ; z++) {
    let bestX = Math.floor(dims.sizeX / 2);
    let bestDepth = 0;
    for (let x = 0; x < dims.sizeX; x++) {
      const depth = world.water.depthAt(x, z);
      if (depth > bestDepth) {
        bestDepth = depth;
        bestX = x;
      }
    }
    centerline.push(bestX);
  }
  const damZ = Math.floor(dims.sizeZ / 2);
  const layout: WatershedLayout = {
    dimensions: { ...dims },
    channelCenterlineX: centerline,
    classify: () => "upland", // classification is generation-time metadata; not rederivable, not needed by any system
    streamSource: { x: centerline[0]!, y: world.grid.surfaceY(centerline[0]!, 0) ?? 0, z: 0 },
    prospectiveDamSite: { zStart: Math.floor(dims.sizeZ / 3), zEnd: Math.floor((2 * dims.sizeZ) / 3), x: centerline[damZ]! },
    treeIds: [],
  };

  const beavers = world.entities.liveIdsOfKind("beaver").sort((a, b) => a - b);
  const damSite = { x: centerline[damZ]!, z: damZ };
  const upstreamProbe = { x: centerline[Math.max(0, damZ - 3)]!, z: Math.max(0, damZ - 3) };
  const source = { x: centerline[Math.max(0, damZ - 8)]!, z: Math.max(0, damZ - 8) };

  const recipes = new RecipeRegistry();
  registerStandardRecipes(recipes);
  const animalSpecies = new AnimalSpeciesRegistry();
  registerStandardAnimalSpecies(animalSpecies);
  const pathogens = new PathogenRegistry();
  registerStandardPathogens(pathogens);
  const deps: ColonyLoopDeps = {
    grid: world.grid,
    terrain: world.terrain,
    water: world.water,
    materials,
    plantSpecies,
    recipes,
    animalSpecies,
    pathogens,
    entities: world.entities,
    components: world.components,
    profile: { canSwim: true, maxWadingDepth: 0.4 },
  };
  return { world, materials, plantSpecies, deps, layout, beavers, damSite, upstreamProbe, source, sourceInflowPerTick: POND_SOURCE_INFLOW_PER_TICK };
}

export function snapshotPondScenario(scenario: PondScenario): WorldSnapshot {
  return snapshotWorld(scenario.world);
}

/**
 * True iff any job (live history is never destroyed) already exists for
 * `designationId` -- the live-state check that keeps job generation
 * idempotent ACROSS SAVE/LOAD, where no driver-side Set could survive.
 */
function designationHasJob(world: World, designationId: EntityId): boolean {
  for (const jobId of world.entities.liveIdsOfKind("job")) {
    if (getJob(world.components, jobId)?.designationId === designationId) return true;
  }
  return false;
}

/** True iff an unfinished haul job is already delivering to this construction's site. Matches on the haul DESIGNATION's target (the authoritative intent): the job's own target cell can differ -- tickHaulJob legitimately redirects a drop to a reachable neighbor of a flooded site, and matching on it spawned 91 duplicate haul jobs for one dam row in this driver's own soak. */
function hasActiveHaulFor(world: World, site: ColumnCoordinate): boolean {
  for (const jobId of world.entities.liveIdsOfKind("job")) {
    const job = getJob(world.components, jobId);
    if (job === undefined || job.status === "completed" || job.status === "failed") continue;
    if (getHaulProgress(world.components, jobId) === undefined) continue;
    const designation = getDesignation(world.components, job.designationId);
    if (designation !== undefined && designation.target.x === site.x && designation.target.z === site.z) return true;
  }
  return false;
}

/** True iff a build job already exists for this construction. */
function hasBuildJobFor(world: World, constructionId: EntityId): boolean {
  for (const jobId of world.entities.liveIdsOfKind("job")) {
    const progress = getBuildProgress(world.components, jobId);
    if (progress !== undefined && progress.constructionId === constructionId) return true;
  }
  return false;
}

/**
 * ONE tick of every scenario system, composed exactly the way the headless
 * acceptance tests drive them: player-facing designations become real jobs
 * (the same generation calls M0 makes by hand), hydrology advances through
 * the real flow solver, and the full Phase-2 colony loop runs every
 * creature/job/ecology system. Deliberately does NOT advance the clock:
 * the bridge registers this as the clock's `onTick` listener, so the ONE
 * authoritative clock (SimulationClock.advance / advanceTicks) drives it
 * exactly like every headless loop in this project, and pause/speed are
 * the clock's own real states. The renderer never calls sim tick functions
 * directly -- only through this driver via the bridge.
 */
export function stepPondScenarioSystems(scenario: PondScenario): void {
  const { world, materials, plantSpecies, deps, source } = scenario;

  // 1. Turn active designations into real jobs -- idempotently, derived
  //    from live job state so a reloaded world never double-generates.
  for (const designationId of world.entities.liveIdsOfKind("designation").sort((a, b) => a - b)) {
    const designation = getDesignation(world.components, designationId);
    if (designation === undefined || designation.status !== "active") continue;
    if (designation.kind === "cut-tree" && !designationHasJob(world, designationId)) {
      generateTreeCutJob(world, materials, plantSpecies, designationId);
    }
  }
  // Constructions: ensure material haul jobs exist while materials are
  // short; once delivered, ensure exactly one build job exists.
  for (const constructionId of world.entities.liveIdsOfKind("construction").sort((a, b) => a - b)) {
    const construction = getConstruction(world.components, constructionId);
    if (construction === undefined) continue;
    if (construction.status === "awaiting-materials") {
      if (!hasActiveHaulFor(world, construction.site)) ensureMaterialHaul(world, constructionId);
      checkMaterialsDelivered(world, constructionId);
    }
    const refreshed = getConstruction(world.components, constructionId);
    if (refreshed !== undefined && refreshed.status === "awaiting-labor" && !hasBuildJobFor(world, constructionId)) {
      generateBuildJob(world, constructionId);
    }
    // A COMPLETED dam-segment construction becomes real terrain -- the
    // same applyDamSegment call the M0 acceptance test makes by hand; no
    // automatic caller exists anywhere in the sim, so this driver (the
    // game-loop composer) owns it, exactly like job generation above.
    // Application is deferred while any live entity occupies the cell
    // about to be filled: applyDamSegment sets real solid material, and
    // entombing the very builder standing on the site produced an
    // immediate four-beaver mass burial in this driver's own soak (they
    // still deliver/stand on the site cell when the last piece lands) --
    // the one-tick-later retry is the game loop's ordinary "the crew
    // steps off the completed work" rule, not a scripted outcome: flood
    // drowning (the intended lethality) is untouched.
    if (refreshed !== undefined && refreshed.status === "complete" && refreshed.kind === "dam-segment" && !world.components.has(constructionId, DamApplicationComponent)) {
      const floor = world.grid.surfaceY(refreshed.site.x, refreshed.site.z);
      const occupied =
        floor !== undefined &&
        world.grid.entitiesAt(refreshed.site.x, floor + 1, refreshed.site.z).some((id) => world.entities.isLive(id));
      if (!occupied) {
        applyDamSegment(world, constructionId);
      }
    }
  }

  // 2. Hydrology through the real solver: source inflow, flow, edge drainage.
  world.water.addVolume(source.x, source.z, scenario.sourceInflowPerTick);
  stepFlow(world.water, world.terrain, materials, 1, { conductance: 0.8 });
  applyEdgeDrainage(world.water, 1, { drainRate: 0.05 });

  // 3. The whole colony: jobs, needs, mortality, ecology, dams, bridges.
  tickColony(deps, world);
}
