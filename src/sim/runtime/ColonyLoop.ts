import type { EntityId, EntityIdRegistry } from "../core/EntityId.js";
import type { ComponentStore } from "../core/ComponentStore.js";
import type { WorldGrid } from "../world/WorldGrid.js";
import type { TerrainField } from "../world/TerrainField.js";
import type { WaterField } from "../hydrology/WaterField.js";
import type { MaterialRegistry } from "../materials/Material.js";
import type { PlantSpeciesRegistry } from "../ecology/PlantSpecies.js";
import type { NavigationProfile } from "../navigation/Pathfinding.js";
import type { World } from "../persistence/WorldSnapshot.js";
import { tickBeaverBehavior } from "../creatures/BeaverBehavior.js";
import { getNeeds, NEED_URGENT_THRESHOLD } from "../creatures/Needs.js";
import { currentJobOf, isJobAvailable } from "../jobs/JobBoard.js";
import { tickJobForBeaver } from "../jobs/JobBoard.js";
import { tickTreeCutJob, getTreeCutProgress } from "../labor/TreeCutting.js";
import { tickHaulJob, getHaulProgress } from "../labor/Hauling.js";
import { tickBuildJob, getBuildProgress } from "../labor/Construction.js";
import { tickBurialJob, getBurialProgress } from "../labor/Burial.js";
import { tickDigJob, getDigProgress } from "../labor/Digging.js";
import { tickCraftJob, getCraftProgress } from "../economy/Craft.js";
import { RecipeRegistry } from "../economy/Recipe.js";
import { tickMortality } from "../creatures/Mortality.js";
import { tickSocialNeeds, tickSocialInteractions } from "../creatures/SocialInteraction.js";
import { tickAllAging } from "../creatures/Aging.js";
import { tickReproduction } from "../creatures/Reproduction.js";
import { tickAllFoodProducers } from "../ecology/FoodProduction.js";
import { tickAllFoodSpoilage } from "../ecology/FoodSpoilage.js";
import { StockpileComponent, generateStockpileHaulJobs } from "../logistics/Stockpile.js";
import { tickAllDamStructures } from "../hydrology/Dam.js";
import { tickAllBridgeStructures } from "../structures/Bridge.js";
import { tickAllPlantLifecycles } from "../ecology/PlantLifecycle.js";
import type { AnimalSpeciesRegistry } from "../creatures/AnimalSpecies.js";
import { tickAllAnimals } from "../creatures/AnimalPopulation.js";
import { tickFishDistribution } from "../ecology/FishEcology.js";
import { tickAllFire } from "../ecology/Fire.js";
import { PathogenRegistry, tickAllDisease } from "../creatures/Disease.js";
import { tickAllMemoryDecay } from "../creatures/Memory.js";
import { tickAllStress } from "../creatures/Stress.js";
import { tickConflicts } from "../creatures/Conflict.js";

/**
 * The Phase 2 gate's own missing piece, built to verify it: this codebase
 * has never before had ONE function that composes every already-real
 * subsystem into a genuine per-tick colony loop -- every acceptance test
 * to date hand-drives the one or two subsystems its own task cares about
 * (P1-18's own critic review confirmed "no automatic systems loop
 * anywhere in this codebase yet"). `tickColony` is that composition, and
 * ONLY that: it invents no new simulation mechanic, no new component, no
 * new balance data -- every call here is a pass-through to an existing,
 * already-tested, already-critic-reviewed function from its own owning
 * task. This is deliberately NOT a numbered roadmap task's deliverable;
 * it is the real infrastructure "operate for a full year with limited
 * player intervention" (the Phase 2 gate's own literal wording) requires
 * to even be checkable, the same way M0's Pond Test needed a driving
 * loop before its own gate could be verified.
 *
 * Per-tick order, chosen for real dependency reasons (never arbitrary):
 * renewable food/spoilage advance first (so freshly produced food is
 * immediately haulable/eatable this same tick); stockpile policy then
 * turns any newly-loose food into real haul jobs; every live beaver then
 * gets exactly ONE action this tick (job assignment-and-act, OR
 * behavior-arbitrated needs/job-continuation -- see `tickOneBeaver`'s own
 * doc comment for why these are mutually exclusive per beaver per tick);
 * mortality, social pressure/interaction, aging, and reproduction close
 * out the tick over whichever beavers are still live afterward.
 */
export interface ColonyLoopDeps {
  grid: WorldGrid;
  terrain: TerrainField;
  water: WaterField;
  materials: MaterialRegistry;
  plantSpecies: PlantSpeciesRegistry;
  recipes: RecipeRegistry;
  animalSpecies: AnimalSpeciesRegistry;
  pathogens: PathogenRegistry;
  entities: EntityIdRegistry;
  components: ComponentStore;
  profile: NavigationProfile;
}

type JobKind = "burial" | "haul" | "tree-cut" | "build" | "dig" | "craft" | "generic";

/**
 * Which real, labor-type-specific progress component (if any) `jobId`
 * carries -- the SAME component-presence check each labor type's own
 * `isEligibleForX` already uses internally, just surfaced here so this
 * file can decide which driver to call without duplicating any of those
 * types' own eligibility logic.
 */
function jobKindOf(components: ComponentStore, jobId: EntityId): JobKind {
  if (getBurialProgress(components, jobId) !== undefined) return "burial";
  if (getHaulProgress(components, jobId) !== undefined) return "haul";
  if (getTreeCutProgress(components, jobId) !== undefined) return "tree-cut";
  if (getBuildProgress(components, jobId) !== undefined) return "build";
  if (getDigProgress(components, jobId) !== undefined) return "dig";
  if (getCraftProgress(components, jobId) !== undefined) return "craft";
  return "generic";
}

/**
 * Drives whichever job `beaverId` ALREADY holds exactly one tick further,
 * by dispatching to that job's own real type-specific driver. Never
 * called for a jobless beaver (see `tickOneBeaver`).
 */
function driveHeldJob(deps: ColonyLoopDeps, world: World, beaverId: EntityId): void {
  const jobId = currentJobOf(deps.entities, deps.components, beaverId)!;
  const kind = jobKindOf(deps.components, jobId);
  const args = [deps.grid, deps.terrain, deps.water, deps.materials, deps.entities, deps.components, beaverId, deps.profile, [jobId]] as const;
  if (kind === "burial") tickBurialJob(...args);
  else if (kind === "haul") tickHaulJob(...args);
  else if (kind === "tree-cut") {
    tickTreeCutJob(deps.grid, deps.terrain, deps.water, deps.materials, deps.plantSpecies, deps.entities, deps.components, beaverId, deps.profile, [jobId], world.events, world.clock.tick);
  } else if (kind === "build") tickBuildJob(...args);
  else if (kind === "dig") tickDigJob(...args);
  else if (kind === "craft") tickCraftJob(deps.grid, deps.terrain, deps.water, deps.materials, deps.recipes, deps.entities, deps.components, beaverId, deps.profile, [jobId]);
  else tickJobForBeaver(...args);
}

/**
 * Tries to find AND immediately start acting on one new job for a
 * currently jobless `beaverId`, trying each real labor type in a fixed
 * priority order (handling the dead first, then feeding the stockpile
 * loop, then raw material gathering, then construction) -- an external
 * ordering choice this file owns, since nothing elsewhere in the codebase
 * arbitrates ACROSS labor types the way `JobBoard.selectJob` already
 * arbitrates WITHIN one. Each candidate driver internally filters
 * `allJobIds` to only the ones it actually owns (via its own
 * `isEligibleForX`), so trying all four in sequence is safe. Returns
 * `true` iff this beaver's action for the tick was consumed here -- which
 * includes every non-`"idle"` outcome, deliberately: a driver that
 * claimed a job and then immediately requeued/failed it (e.g. a
 * burial whose corpse is unreachable this tick) still counts as this
 * beaver's ONE action for the tick (the same one-action-per-tick
 * discipline the drivers themselves enforce internally), so the next
 * labor type is NOT attempted until next tick. Deciding "consumed" from
 * each driver's OWN outcome string (all five share `"idle"` as
 * precisely "nothing was claimed") rather than re-querying
 * `currentJobOf` after every driver is both correct and materially
 * cheaper: `currentJobOf` is O(live jobs) and live job history only ever
 * grows in a long-running colony, so removing four such scans per
 * jobless beaver per tick was the single largest measured per-tick cost
 * in the Phase 2 gate soak run. The final generic fallback
 * (`tickJobForBeaver`, P1-07's bare "go-to" driver) is deliberately
 * restricted to jobs with NONE of the four specialized progress
 * components -- passing it an unfiltered job list would let it
 * mis-select and prematurely "complete" a specialized job (e.g. a
 * tree-cut job on mere arrival, skipping the real felling/log-spawning
 * that job's own driver is responsible for) purely because the generic
 * driver has no way to know that type even exists.
 */
function tryAssignJob(deps: ColonyLoopDeps, world: World, beaverId: EntityId, allJobIds: readonly EntityId[]): boolean {
  const args = [deps.grid, deps.terrain, deps.water, deps.materials, deps.entities, deps.components, beaverId, deps.profile, allJobIds] as const;

  if (tickBurialJob(...args) !== "idle") return true;
  if (tickHaulJob(...args) !== "idle") return true;
  if (
    tickTreeCutJob(
      deps.grid, deps.terrain, deps.water, deps.materials, deps.plantSpecies, deps.entities, deps.components, beaverId, deps.profile, allJobIds,
      world.events, world.clock.tick,
    ) !== "idle"
  ) {
    return true;
  }
  if (tickBuildJob(...args) !== "idle") return true;
  if (tickDigJob(...args) !== "idle") return true;
  if (
    tickCraftJob(deps.grid, deps.terrain, deps.water, deps.materials, deps.recipes, deps.entities, deps.components, beaverId, deps.profile, allJobIds) !== "idle"
  ) {
    return true;
  }
  const genericJobIds = allJobIds.filter((id) => jobKindOf(deps.components, id) === "generic");
  return tickJobForBeaver(deps.grid, deps.terrain, deps.water, deps.materials, deps.entities, deps.components, beaverId, deps.profile, genericJobIds) !== "idle";
}

/**
 * Mirrors `SocialInteraction.ts`'s own private `urgentSurvivalNeed` check
 * (not exported there, so duplicated here rather than reached into --
 * the same tiny-local-helper precedent `assertNonNegativeInteger` already
 * sets across many files in this codebase): true while ANY of hunger,
 * thirst, or fatigue sits at or past `NEED_URGENT_THRESHOLD`.
 */
function hasUrgentSurvivalNeed(components: ComponentStore, beaverId: EntityId): boolean {
  const needs = getNeeds(components, beaverId);
  if (needs === undefined) return false;
  return needs.hunger >= NEED_URGENT_THRESHOLD || needs.thirst >= NEED_URGENT_THRESHOLD || needs.fatigue >= NEED_URGENT_THRESHOLD;
}

/**
 * Exactly one action for `beaverId` this tick -- the same discipline
 * `tickBeaverNeeds`/every labor-type driver already enforces individually
 * (arrival concludes travel, work starts next tick; movement and
 * pickup/drop are never combined), applied here across "should this
 * beaver start a new job or attend to survival" too:
 *
 * A beaver that enters this tick jobless AND has no urgent survival need
 * gets ONE assignment attempt (`tryAssignJob`); if that succeeds, the
 * attempt's own first action (a reservation, a first step of travel) IS
 * this tick's action, and nothing else runs for this beaver this tick.
 * Only if assignment genuinely fails (no eligible job of any kind right
 * now) does this beaver fall through to `tickBeaverBehavior` -- P1-06/
 * P1-14's real needs/rest arbitration, which is what actually produces
 * "idle" when nothing is urgent either.
 *
 * The urgent-need check exists to close two real starvation/livelock
 * modes found empirically during this file's own development:
 *
 * 1. (Fatigue.) `tickBeaverBehavior`'s own rule is "urgent fatigue
 *    interrupts a HELD job outright," but a JOBLESS, urgently-fatigued
 *    beaver that this function let attempt assignment anyway would
 *    immediately re-claim the very job it (or another beaver) was just
 *    interrupted from, one tick before `tickBeaverBehavior` would have
 *    suspended it again -- assign/suspend/assign/suspend forever, with
 *    the beaver's own rest-directed travel only ever getting a single
 *    fragment of a step on the "suspended" half-ticks, never enough to
 *    actually reach its bed.
 * 2. (Hunger/thirst.) `BeaverBehavior.ts`'s own documented design
 *    deliberately does NOT interrupt an ALREADY-HELD job for urgent
 *    hunger/thirst (only fatigue) -- a real, narrow choice about not
 *    yanking a beaver off a job it already committed to. But this loop's
 *    own ASSIGNMENT decision is a different question: handing a FRESH job
 *    to an already-starving/dehydrated beaver, when nothing forces that
 *    beaver to take it, produced real observed deaths during this file's
 *    own soak testing -- a beaver that happened to pick up hauling work
 *    right as hunger crossed urgent just kept working, since nothing
 *    interrupts work for hunger, until it starved. Declining to assign
 *    NEW work to an already-needy beaver is the ordinary, non-scripted
 *    judgment call a colony's own labor allocation would make -- it
 *    changes nothing about the simulation's own interrupt rules, only
 *    which beaver this composition offers a new job to.
 *
 * Routing such a beaver straight into `tickBeaverBehavior`'s
 * `tickBeaverNeeds` fallback lets its OWN `decideIntent` -- which already
 * treats urgent fatigue as an unconditional first-priority branch, and
 * urgent hunger/thirst as the next real candidates -- resolve the need,
 * exactly like a beaver that never held a job in the first place.
 *
 * A beaver that already held a job before this tick skips assignment
 * entirely and goes straight to `tickBeaverBehavior`, which decides
 * whether fatigue must interrupt that job (`"job-interrupted"`) or the
 * job should be driven one more tick (`"working"`, handled by
 * `driveHeldJob`) -- exactly `tickBeaverBehavior`'s own documented
 * calling convention.
 */
function tickOneBeaver(deps: ColonyLoopDeps, world: World, beaverId: EntityId, allJobIds: readonly EntityId[]): void {
  const hadJobBefore = currentJobOf(deps.entities, deps.components, beaverId) !== undefined;
  if (!hadJobBefore && !hasUrgentSurvivalNeed(deps.components, beaverId)) {
    if (tryAssignJob(deps, world, beaverId, allJobIds)) return;
  }
  const outcome = tickBeaverBehavior(deps.grid, deps.terrain, deps.water, deps.materials, deps.entities, deps.components, beaverId, deps.profile);
  if (outcome.kind === "working") driveHeldJob(deps, world, beaverId);
}

/**
 * One full simulated tick for the whole colony. Returns nothing -- every
 * effect is real, persistent `World` state, inspectable the ordinary way
 * (`DebugInspector`/`TextUI.populationPanel`) exactly like any other
 * tick in this codebase. Deliberately does NOT drive weather/precipitation
 * (no current caller composes that into survival mechanics either -- see
 * `Weather.ts`'s own doc comment) or a master `SimulationClock.advance`
 * call (the caller owns advancing the clock itself, matching every other
 * driving loop in this project).
 */
export function tickColony(deps: ColonyLoopDeps, world: World): void {
  tickAllFoodProducers(world);
  tickAllFoodSpoilage(world, deps.materials);
  for (const stockpileId of world.components.query(StockpileComponent).sort((a, b) => a - b)) {
    generateStockpileHaulJobs(world, deps.materials, stockpileId);
  }

  // Deliberately pre-filtered to genuinely available jobs (`isJobAvailable`
  // -- unclaimed, or reserved/in-progress with a no-longer-live worker)
  // BEFORE any per-labor-type eligibility check runs, not just the raw
  // `liveIdsOfKind("job")` scan. Completed/failed jobs are never destroyed
  // (matching every other labor type's own precedent of keeping them as
  // queryable history), so over a long-running colony that list only ever
  // grows; without this cheap up-front filter, `tryAssignJob` would re-run
  // 4-5 full `isEligibleForX` passes over the WHOLE ever-growing historical
  // job list for every jobless beaver, every tick -- a real, measured
  // quadratic slowdown found empirically while soak-testing this file
  // against `FOOD_PRODUCTION_YEAR_TICKS`. The actually-available set stays
  // small and roughly constant in practice (only recently generated,
  // not-yet-claimed jobs), which is what this filter narrows down to.
  const availableJobIds = world.entities
    .liveIdsOfKind("job")
    .filter((jobId) => isJobAvailable(world.entities, world.components, jobId))
    .sort((a, b) => a - b);
  for (const beaverId of world.entities.liveIdsOfKind("beaver").sort((a, b) => a - b)) {
    tickOneBeaver(deps, world, beaverId, availableJobIds);
  }

  for (const beaverId of world.entities.liveIdsOfKind("beaver").sort((a, b) => a - b)) {
    tickMortality(world, deps.water, beaverId);
  }
  tickSocialNeeds(world);
  tickSocialInteractions(world);
  tickAllAging(world);
  tickReproduction(world);
  tickAllDamStructures(world, deps.materials);
  tickAllBridgeStructures(world, deps.materials);
  tickAllPlantLifecycles(world, deps.plantSpecies, world.random.stream("plant-lifecycle"));
  for (const species of deps.animalSpecies.all()) {
    if (species.aquatic) tickFishDistribution(world, deps.animalSpecies, world.random.stream("fish-distribution"), species.id);
  }
  tickAllAnimals(deps, deps.animalSpecies, world.random.stream("animal-population"), world);
  tickAllFire(world, deps.plantSpecies, deps.materials, world.random.stream("fire"));
  tickAllDisease(world, deps.pathogens, world.random.stream("disease"));
  tickAllMemoryDecay(world);
  tickAllStress(world);
  tickConflicts(world, world.random.stream("conflict"), world.entities.liveIdsOfKind("beaver"));
}
