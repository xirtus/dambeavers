import { ComponentStore, defineComponent, type ComponentType } from "../core/ComponentStore.js";
import type { EntityId, EntityIdRegistry } from "../core/EntityId.js";
import type { WorldGrid } from "../world/WorldGrid.js";
import type { TerrainField } from "../world/TerrainField.js";
import type { WaterField } from "../hydrology/WaterField.js";
import type { MaterialRegistry } from "../materials/Material.js";
import type { NavigationProfile } from "../navigation/Pathfinding.js";
import type { World } from "../persistence/WorldSnapshot.js";
import type { EventLog } from "../history/EventLog.js";
import { getPlant, harvestableWoodMassKg } from "../ecology/Plant.js";
import type { PlantSpeciesRegistry } from "../ecology/PlantSpecies.js";
import { practiceSkill, skillLevel } from "../creatures/SkillProgression.js";
import { advanceTowards } from "../creatures/BeaverLocomotion.js";
import { createDesignation, getDesignation } from "../jobs/Designation.js";
import { getJob, setJob } from "../jobs/Job.js";
import { isEligible, selectJob, reserveJob, currentJobOf, completeJob } from "../jobs/JobBoard.js";
import { hasRequiredToolForJob, toolWorkMultiplier } from "./Equipment.js";
import { stressWorkMultiplier } from "../creatures/Stress.js";
import { setLog } from "./Log.js";

/**
 * P1-08's first real labor type built on P1-07's generic job pipeline
 * (`JobBoard.ts`): designate a tree -> path to it -> a real tool/body
 * capability check -> accumulated work progress (scaled by skill) ->
 * tree removal, abstracted (no fall physics/animation -- Law 2 doesn't
 * require one) -> physical log entities generated from the tree's real,
 * age-scaled mass (P0-10's `harvestableWoodMassKg`). Reuses
 * `JobBoard.ts`'s eligibility/selection/reservation primitives unchanged
 * (they already operate generically on any `Job` entity); only the
 * execution state machine (`tickTreeCutJob`, below) is specific to this
 * labor type, exactly as ARCHITECTURE_CONTRACT §10 intends.
 */

/** Per-job cutting state, attached to the SAME job entity `generateTreeCutJob` creates (component composition, not a separate registry) -- how much of `workRequired` has been done so far, and which tree this job concerns (redundant with the designation's own `targetEntity`, but reading it off the job avoids an extra designation lookup on every tick). */
export interface TreeCutProgress {
  treeId: EntityId;
  workDone: number;
  workRequired: number;
}
export const TreeCutProgressComponent: ComponentType<TreeCutProgress> = defineComponent<TreeCutProgress>("tree-cut-progress");

export function assertValidTreeCutProgress(progress: TreeCutProgress): void {
  if (!Number.isInteger(progress.treeId) || progress.treeId < 1) {
    throw new RangeError(`tree cut progress treeId must be a positive integer, got ${progress.treeId}`);
  }
  if (!(Number.isFinite(progress.workDone) && progress.workDone >= 0)) {
    throw new RangeError(`tree cut progress workDone must be a non-negative finite number, got ${progress.workDone}`);
  }
  if (!(Number.isFinite(progress.workRequired) && progress.workRequired >= 0)) {
    throw new RangeError(`tree cut progress workRequired must be a non-negative finite number, got ${progress.workRequired}`);
  }
}

export function setTreeCutProgress(components: ComponentStore, id: EntityId, progress: TreeCutProgress): void {
  assertValidTreeCutProgress(progress);
  components.set(id, TreeCutProgressComponent, progress);
}

export function getTreeCutProgress(components: ComponentStore, id: EntityId): TreeCutProgress | undefined {
  const progress = components.get(id, TreeCutProgressComponent);
  if (progress !== undefined) assertValidTreeCutProgress(progress);
  return progress;
}

/** Cutting effort per kg of harvestable wood -- a mature tree takes real, tunable time to fell, scaling with its actual size rather than a flat constant. Plausible, tunable balance data. */
export const WORK_PER_KG = 0.2;
/** Base cutting progress per tick, at zero skill. Plausible, tunable balance data. */
export const WORK_PER_TICK = 1;
/** Fractional bonus to cutting progress per level of a beaver's `"woodcutting"` skill (P1-05's `Skills` component) -- P2-03 now grants woodcutting practice from real cutting work, so repeated felling measurably improves later cutting speed. */
export const SKILL_WORK_BONUS = 0.1;
/** Plausible mass for one carryable log -- a felled tree's total harvestable mass is split into logs of at most this size (the last one getting the remainder), so total log mass always exactly equals the tree's real harvestable mass, never rounds it up or invents extra material. */
export const LOG_MASS_KG = 20;

/** Whether `beaverId` currently has the body capability to cut down a tree -- always `true` today: no body-part/wound/tool-use anatomy system exists yet (AGENTS.md Law 10). Physical tool requirements are checked separately through P2-04's `RequiredTool`/`Tool` components, so this hook remains the body-side half only. */
export function hasTreeCuttingCapability(_entities: EntityIdRegistry, _components: ComponentStore, _beaverId: EntityId): boolean {
  return true;
}

/**
 * `JobBoard.isEligible`'s generic check, plus this labor type's own
 * guards: the job must actually be a tree-cut job (`TreeCutProgress`),
 * its target tree must still be live (a tree destroyed some other way --
 * nothing currently does this except `fellTree` itself, but excluding it
 * here rather than only inside `tickTreeCutJob`'s execution keeps a
 * vanished target from being SELECTED and traveled to at all, not merely
 * failed after the trip -- the same "don't offer a job whose target is
 * already gone" standard `Hauling.ts`'s `isEligibleForHaul` learned the
 * hard way once P2-08 food spoilage started destroying haul targets
 * out from under stale jobs), the beaver must have tree-cutting body
 * capability, and any P2-04 physical tool requirement attached to the
 * job must be satisfied by a matching held tool in the beaver's own
 * inventory.
 */
export function isEligibleForTreeCut(entities: EntityIdRegistry, components: ComponentStore, beaverId: EntityId, jobId: EntityId): boolean {
  const progress = getTreeCutProgress(components, jobId);
  return (
    isEligible(entities, components, beaverId, jobId) &&
    progress !== undefined &&
    entities.isLive(progress.treeId) &&
    hasTreeCuttingCapability(entities, components, beaverId) &&
    hasRequiredToolForJob(components, beaverId, jobId, "woodcutting")
  );
}

/** Creates a `"cut-tree"` designation targeting `treeId`: a player's persistent order to fell one specific tree, independent of any worker (same survives-its-worker guarantee P1-07's own acceptance test established for `"go-to"`). */
export function designateTreeCut(world: World, treeId: EntityId): EntityId {
  if (!world.entities.isLive(treeId) || world.entities.kindOf(treeId) !== "tree") {
    throw new RangeError(`entity ${treeId} is not a live tree -- cannot designate a cut`);
  }
  const position = world.grid.positionOf(treeId);
  if (position === undefined) {
    throw new RangeError(`tree ${treeId} has no position in the grid -- cannot designate a cut`);
  }
  return createDesignation(world, "cut-tree", { x: position.x, z: position.z }, treeId);
}

/**
 * Expands a `"cut-tree"` designation into its one job instance, with a
 * `TreeCutProgress` computed from the tree's REAL current state --
 * `harvestableWoodMassKg` (P0-10) already derives mass fresh from
 * species/age, so two trees of different size/species genuinely take
 * different effort to fell, never a flat per-tree constant. This file's
 * own analogue to `Job.ts`'s `generateJobs` (which only handles
 * `"go-to"`) -- each labor type owns its own job generation, so `Job.ts`
 * never needs to grow a dispatch switch as more labor types arrive.
 */
export function generateTreeCutJob(
  world: World,
  materials: MaterialRegistry,
  plantSpecies: PlantSpeciesRegistry,
  designationId: EntityId,
): EntityId[] {
  const designation = getDesignation(world.components, designationId);
  if (designation === undefined || designation.kind !== "cut-tree" || designation.targetEntity === undefined) {
    throw new RangeError(`entity ${designationId} is not a valid "cut-tree" designation`);
  }
  const treeId = designation.targetEntity;
  const plant = getPlant(world.components, treeId);
  if (plant === undefined) {
    throw new RangeError(`designation ${designationId}'s target tree ${treeId} has no Plant component`);
  }
  const species = plantSpecies.get(plant.speciesId);
  const wood = materials.get(species.woodMaterialId);
  const workRequired = harvestableWoodMassKg(species, plant, wood) * WORK_PER_KG;

  const jobId = world.entities.create("job");
  setJob(world.components, jobId, { designationId, target: designation.target, status: "unclaimed" });
  setTreeCutProgress(world.components, jobId, { treeId, workDone: 0, workRequired });
  return [jobId];
}

/**
 * Destroys the tree (P1-08's "tree removal" -- no fall physics/animation
 * state is modeled; that's a presentation concern, not something Law 2
 * requires the simulation to own) and spawns real, physical log entities
 * (AGENTS.md Law 1.6) whose combined mass exactly equals the tree's real
 * harvestable mass at the moment it was felled.
 *
 * `events`/`tick` (P4-03) are OPTIONAL and trailing -- every existing
 * call site (tests, `ColonyLoop.ts` before this change) keeps working
 * unmodified with no event recorded, matching `EcologyResponse.ts`'s own
 * flagged gap ("felling a tree leaves no trace... a future task extending
 * `TreeCutting.ts` first" -- this is that task). When supplied, a real
 * `"tree-felled"` event is recorded so P4-03's forest succession can
 * discover newly-cleared land, and P4-16's causality reports can explain
 * a vegetation shift back to the felling that started it.
 */
function fellTree(
  grid: WorldGrid,
  materials: MaterialRegistry,
  plantSpecies: PlantSpeciesRegistry,
  entities: EntityIdRegistry,
  components: ComponentStore,
  treeId: EntityId,
  atColumn: { x: number; z: number },
  events?: EventLog,
  tick?: number,
): EntityId[] {
  const plant = getPlant(components, treeId)!;
  const species = plantSpecies.get(plant.speciesId);
  const wood = materials.get(species.woodMaterialId);
  const totalMassKg = harvestableWoodMassKg(species, plant, wood);

  // Guaranteed defined: a tree can only ever have been placed on real
  // terrain (WatershedGenerator's own tree-placement precedent), and
  // felling it doesn't touch the terrain underneath.
  const floor = grid.surfaceY(atColumn.x, atColumn.z)!;

  if (events !== undefined && tick !== undefined) {
    events.record({ tick, eventType: "tree-felled", subjectIds: [treeId], location: { x: atColumn.x, y: floor, z: atColumn.z } });
  }

  entities.destroy(treeId);

  // Floating-point guard: subtracting exact `LOG_MASS_KG` multiples from
  // `remaining` can leave a residual of a few ULPs (e.g. 7e-15) rather
  // than exactly 0 whenever `totalMassKg` happens to land near a multiple
  // of `LOG_MASS_KG` -- confirmed possible (though it never actually
  // occurs for any current species/age combination) during this task's
  // own critic review. A residual below `MASS_EPSILON_KG` is
  // representation noise, not real wood, so it's dropped rather than
  // spawned as a physically-meaningless sliver log (which would also
  // fail `assertValidLog`'s `massKg > 0` requirement at exactly 0).
  const MASS_EPSILON_KG = 1e-9;
  const logIds: EntityId[] = [];
  let remaining = totalMassKg;
  while (remaining > MASS_EPSILON_KG) {
    const massKg = Math.min(LOG_MASS_KG, remaining);
    const logId = entities.create("log");
    grid.setEntityPosition(logId, atColumn.x, floor + 1, atColumn.z);
    setLog(components, logId, { materialId: species.woodMaterialId, massKg });
    logIds.push(logId);
    remaining -= massKg;
  }
  return logIds;
}

export type TreeCutStepOutcome = "assigned" | "traveling" | "working" | "felled" | "requeued" | "failed" | "idle";

/**
 * One simulated tick of a tree-cutting job for ONE beaver: reserve a job
 * if it doesn't hold one (via `JobBoard`'s generic selection/reservation,
 * filtered by `isEligibleForTreeCut`), travel to the tree's column (real
 * navigation via `advanceTowards`, P1-05) if not already there, then
 * accumulate real cutting work -- scaled by the beaver's `"woodcutting"`
 * skill -- once it is. On enough accumulated work, fells the tree and
 * completes the job (and, once every job referencing it is done, the
 * designation -- `JobBoard.completeJob`). A route that becomes
 * unreachable mid-journey requeues the job (back to `"unclaimed"`) rather
 * than failing it permanently, mirroring `tickJobForBeaver`'s own
 * "route unavailable is recoverable" choice; a tree that vanishes out
 * from under an in-progress job (defensive -- nothing currently destroys
 * a tree except this very function) fails the job outright, since
 * retrying can never succeed.
 *
 * Movement and work accumulation are never combined in the same tick
 * (arriving this tick means work starts next tick) -- the same
 * one-action-per-tick discipline P1-06's `tickBeaverNeeds` already
 * established, kept here for the same reason: simpler, unambiguous
 * per-tick state transitions.
 */
export function tickTreeCutJob(
  grid: WorldGrid,
  terrain: TerrainField,
  water: WaterField,
  materials: MaterialRegistry,
  plantSpecies: PlantSpeciesRegistry,
  entities: EntityIdRegistry,
  components: ComponentStore,
  beaverId: EntityId,
  profile: NavigationProfile,
  candidateJobIds: readonly EntityId[],
  events?: EventLog,
  tick?: number,
): TreeCutStepOutcome {
  let jobId = currentJobOf(entities, components, beaverId);
  let freshlyAssigned = false;

  if (jobId === undefined) {
    const eligible = candidateJobIds.filter((id) => isEligibleForTreeCut(entities, components, beaverId, id));
    const chosen = selectJob(entities, components, grid, terrain, water, materials, profile, beaverId, eligible);
    if (chosen === undefined) return "idle";
    reserveJob(components, entities, chosen, beaverId);
    jobId = chosen;
    freshlyAssigned = true;
  }

  const job = getJob(components, jobId)!;
  const progress = getTreeCutProgress(components, jobId)!;
  if (!hasRequiredToolForJob(components, beaverId, jobId, "woodcutting")) {
    setJob(components, jobId, { designationId: job.designationId, target: job.target, status: "unclaimed" });
    return "requeued";
  }
  const position = grid.positionOf(beaverId)!;
  const atWorkPosition = position.x === job.target.x && position.z === job.target.z;

  if (!atWorkPosition) {
    const result = advanceTowards(grid, terrain, water, materials, components, beaverId, job.target);
    if (result.outcome === "unreachable") {
      setJob(components, jobId, { designationId: job.designationId, target: job.target, status: "unclaimed" });
      return "requeued";
    }
    // "arrived" or "moved" -- either way travel concludes this tick; work accumulation starts next tick.
    setJob(components, jobId, { designationId: job.designationId, target: job.target, status: "in-progress", reservedBy: beaverId });
    return freshlyAssigned ? "assigned" : "traveling";
  }

  if (!entities.isLive(progress.treeId)) {
    setJob(components, jobId, { designationId: job.designationId, target: job.target, status: "failed" });
    return "failed";
  }

  const currentSkillLevel = skillLevel(components, beaverId, "woodcutting");
  const toolMultiplier = toolWorkMultiplier(materials, components, beaverId, "woodcutting");
  const stressMultiplier = stressWorkMultiplier(components, beaverId);
  const workThisTick = WORK_PER_TICK * (1 + currentSkillLevel * SKILL_WORK_BONUS) * toolMultiplier * stressMultiplier;
  const workDone = Math.min(progress.workRequired, progress.workDone + workThisTick);
  setTreeCutProgress(components, jobId, { treeId: progress.treeId, workDone, workRequired: progress.workRequired });
  practiceSkill(components, beaverId, "woodcutting", workDone - progress.workDone);

  if (workDone >= progress.workRequired) {
    fellTree(grid, materials, plantSpecies, entities, components, progress.treeId, job.target, events, tick);
    completeJob(entities, components, jobId, beaverId);
    return "felled";
  }

  setJob(components, jobId, { designationId: job.designationId, target: job.target, status: "in-progress", reservedBy: beaverId });
  return "working";
}
