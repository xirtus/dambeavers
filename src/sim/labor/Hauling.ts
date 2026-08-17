import { ComponentStore, defineComponent, type ComponentType } from "../core/ComponentStore.js";
import type { EntityId, EntityIdRegistry } from "../core/EntityId.js";
import type { WorldGrid } from "../world/WorldGrid.js";
import type { TerrainField } from "../world/TerrainField.js";
import type { WaterField, ColumnCoordinate } from "../hydrology/WaterField.js";
import type { MaterialRegistry } from "../materials/Material.js";
import type { NavigationProfile } from "../navigation/Pathfinding.js";
import type { World } from "../persistence/WorldSnapshot.js";
import { getLocomotion, setLocomotion } from "../creatures/Beaver.js";
import { advanceTowards, type AdvanceResult } from "../creatures/BeaverLocomotion.js";
import { createDesignation, getDesignation } from "../jobs/Designation.js";
import { getJob, setJob } from "../jobs/Job.js";
import { isEligible, selectJob, reserveJob, currentJobOf, completeJob } from "../jobs/JobBoard.js";
import { getLog, getHeld, getReservation, setReservation, clearReservation, pickUp, drop } from "./Log.js";
import { getFood } from "./Food.js";
import { getRefuse } from "../logistics/Refuse.js";
import { getGood } from "../economy/Good.js";

/**
 * P1-09's labor type: physical items get a real holder/container
 * relation, reservation state, and movement/hauling cost (`Log.ts`'s
 * `Held`/`Reservation` plus this file's execution driver) -- the three of
 * P1-09's five-item list P1-08 deliberately left for this task ("mass,
 * material, location" were already real). P2-07 broadens the accepted
 * item component from only `Log` to every currently-real physical haulable
 * item (`Log`, `Food`, or `Refuse`) without changing the execution state machine:
 * both still move through ordinary reservations, pickup, burdened travel,
 * and drop. Reuses P1-07's `JobBoard.ts` pipeline exactly the way P1-08's
 * tree cutting did: eligibility/selection/reservation unchanged, only the
 * execution state machine is new.
 *
 * A haul has two legs -- travel to the item, then travel (burdened) to
 * the destination -- neither of which is a bare "go to a column" the
 * generic `Job.target` alone can express across both legs, so
 * `HaulProgress.phase` tracks which leg is current and the execution
 * driver (`tickHaulJob`) recomputes the real target for `advanceTowards`
 * from live state each tick (the item's own current position while
 * `"to-item"`; the fixed destination while `"to-destination"`) --
 * consistent with P1-04/05/06/07/08's shared "discover from live state,
 * never cache a stale target" discipline.
 */
export interface HaulProgress {
  itemId: EntityId;
  destination: ColumnCoordinate;
  phase: "to-item" | "to-destination";
}
export const HaulProgressComponent: ComponentType<HaulProgress> = defineComponent<HaulProgress>("haul-progress");

export function assertValidHaulProgress(progress: HaulProgress): void {
  if (!Number.isInteger(progress.itemId) || progress.itemId < 1) {
    throw new RangeError(`haul progress itemId must be a positive integer, got ${progress.itemId}`);
  }
  if (!Number.isInteger(progress.destination.x) || !Number.isInteger(progress.destination.z)) {
    throw new RangeError(`haul progress destination must have integer coordinates, got ${JSON.stringify(progress.destination)}`);
  }
  if (progress.phase !== "to-item" && progress.phase !== "to-destination") {
    throw new RangeError(`haul progress phase must be "to-item" or "to-destination", got ${JSON.stringify(progress.phase)}`);
  }
}

export function setHaulProgress(components: ComponentStore, id: EntityId, progress: HaulProgress): void {
  assertValidHaulProgress(progress);
  components.set(id, HaulProgressComponent, progress);
}

export function getHaulProgress(components: ComponentStore, id: EntityId): HaulProgress | undefined {
  const progress = components.get(id, HaulProgressComponent);
  if (progress !== undefined) assertValidHaulProgress(progress);
  return progress;
}

/** Extra effective-speed cost while carrying `carriedMassKg` -- a real, tunable formula (not a flat constant), so a heavier log genuinely slows a beaver down more than a lighter one. Plausible, tunable balance data. */
const HAUL_COST_PER_KG = 0.02;

function haulSpeedMultiplier(carriedMassKg: number): number {
  return 1 + carriedMassKg * HAUL_COST_PER_KG;
}

export function haulableMassKg(components: ComponentStore, itemId: EntityId): number | undefined {
  return getLog(components, itemId)?.massKg ?? getFood(components, itemId)?.massKg ?? getRefuse(components, itemId)?.massKg ?? getGood(components, itemId)?.massKg;
}

export function isPhysicalHaulableItem(components: ComponentStore, itemId: EntityId): boolean {
  return haulableMassKg(components, itemId) !== undefined;
}

/** Creates a `"haul-item"` designation: move `itemId` (must be a real, currently unheld, unreserved item sitting in the world) to `destination`. */
export function designateHaul(world: World, itemId: EntityId, destination: ColumnCoordinate): EntityId {
  if (!world.entities.isLive(itemId) || !isPhysicalHaulableItem(world.components, itemId)) {
    throw new RangeError(`entity ${itemId} is not a live physical haulable item -- cannot designate a haul`);
  }
  if (getHeld(world.components, itemId) !== undefined) {
    throw new RangeError(`item ${itemId} is currently held -- cannot designate a haul for it`);
  }
  const existingReservation = getReservation(world.components, itemId);
  if (existingReservation !== undefined && world.entities.isLive(existingReservation.by)) {
    // Not strictly required for correctness (`isEligibleForHaul` already
    // makes a second job for the same item safely wait rather than race),
    // but rejecting an obviously-doomed-to-wait duplicate designation up
    // front is better than silently accepting one.
    throw new RangeError(`item ${itemId} is already reserved for another haul -- cannot designate a second one`);
  }
  if (world.grid.positionOf(itemId) === undefined) {
    throw new RangeError(`item ${itemId} has no position in the grid -- cannot designate a haul`);
  }
  return createDesignation(world, "haul-item", destination, itemId);
}

/** Expands a `"haul-item"` designation into its one job instance, starting in the `"to-item"` phase. This file's own analogue to `Job.ts`'s `generateJobs` (`"go-to"`) and `TreeCutting.ts`'s `generateTreeCutJob` (`"cut-tree"`) -- each labor type owns its own job generation. */
export function generateHaulJob(world: World, designationId: EntityId): EntityId[] {
  const designation = getDesignation(world.components, designationId);
  if (designation === undefined || designation.kind !== "haul-item" || designation.targetEntity === undefined) {
    throw new RangeError(`entity ${designationId} is not a valid "haul-item" designation`);
  }
  const itemId = designation.targetEntity;
  const itemPosition = world.grid.positionOf(itemId);
  if (itemPosition === undefined) {
    throw new RangeError(`designation ${designationId}'s target item ${itemId} has no position -- perhaps already picked up`);
  }
  const jobId = world.entities.create("job");
  setJob(world.components, jobId, { designationId, target: { x: itemPosition.x, z: itemPosition.z }, status: "unclaimed" });
  setHaulProgress(world.components, jobId, { itemId, destination: designation.target, phase: "to-item" });
  return [jobId];
}

/**
 * `JobBoard.isEligible`'s generic check, plus a haul-specific guard
 * nothing else was checking: is the item this job concerns ALREADY held
 * or reserved by a different, currently-live beaver? Nothing prevents
 * two separate designations from targeting the SAME physical item
 * (matching P1-08's own tolerance for two designations on one tree --
 * `TreeCutting.ts` never prevents that either) -- without this check,
 * two independently-generated jobs for one item could each be
 * selected/reserved by a different beaver, and whichever arrived at the
 * item SECOND would find it already gone (picked up by the first),
 * which used to crash rather than fail intelligibly (confirmed and fixed
 * during this task's own critic review -- see `tickHaulJob`'s `"to-item"`
 * phase). A STALE hold/reservation (its beaver no longer live) is
 * treated as no obstacle at all -- the same "discover from live state"
 * precedent `JobBoard.isJobAvailable` already established for stale JOB
 * reservations, applied here at the ITEM level too.
 *
 * Also excludes a job whose target item isn't live AT ALL anymore --
 * found empirically by the Phase 2 gate soak test (`src/sim/runtime/
 * ColonyLoop.ts`): P2-08's `FoodSpoilage` can destroy a `Food` item out
 * from under a haul job that was generated for it many ticks earlier and
 * only just now getting claimed (a real, expected outcome once P2-08
 * existed, but this file's own eligibility check was never revisited to
 * account for it). Before this fix, `tickHaulJob`'s fresh-assignment path
 * called `setReservation` on the item UNCONDITIONALLY once selected,
 * which threw an uncaught `ComponentStore` error ("not a live entity")
 * instead of failing the job intelligibly the same way the ALREADY-
 * documented "item vanished mid-haul" case above does. A job stuck
 * pointing at a dead item is not requeued here (nothing could ever make
 * it eligible again) -- it simply stops being selectable; the stale job
 * itself remains queryable history, matching how a stale reservation is
 * handled everywhere else in this codebase.
 */
export function isEligibleForHaul(entities: EntityIdRegistry, components: ComponentStore, beaverId: EntityId, jobId: EntityId): boolean {
  if (!isEligible(entities, components, beaverId, jobId)) return false;
  const progress = getHaulProgress(components, jobId);
  if (progress === undefined) return false;
  if (!entities.isLive(progress.itemId)) return false;
  const held = getHeld(components, progress.itemId);
  if (held !== undefined && entities.isLive(held.by)) return false;
  const reservation = getReservation(components, progress.itemId);
  if (reservation !== undefined && entities.isLive(reservation.by) && reservation.by !== beaverId) return false;
  return true;
}

export type HaulStepOutcome = "assigned" | "traveling" | "picked-up" | "carrying" | "delivered" | "requeued" | "failed" | "idle";

/**
 * One simulated tick of a haul job: reserve a job if the beaver doesn't
 * hold one (generic `JobBoard` selection/reservation, unchanged from
 * P1-07/P1-08 -- including its reachability check, so the P1-07 livelock
 * class of bug can't recur here either), then drive whichever leg is
 * current. Movement and pickup/drop are never combined in the same tick
 * (arriving concludes travel; the actual pickup/drop happens on the NEXT
 * call), matching P1-06/P1-08's established one-action-per-tick
 * discipline.
 *
 * `"to-item"` leg: travel to the item's live position (unburdened
 * speed); on arrival, pick it up (`Log.pickUp`) and advance to
 * `"to-destination"`. If the item becomes unreachable, requeue the job
 * (nothing physical has moved yet, so this is a clean, ordinary
 * "route unavailable" per ARCHITECTURE_CONTRACT §10 -- no different from
 * P1-08's own requeue case).
 *
 * `"to-destination"` leg: travel to the fixed destination, at a REAL
 * hauling-cost-penalized effective speed (`haulSpeedMultiplier`) --
 * applied by temporarily overriding the beaver's own `Locomotion.speed`
 * for exactly the duration of this one `advanceTowards` call and
 * restoring the true base value immediately after, so `Locomotion.speed`
 * always reads as the beaver's real unburdened capability at every OTHER
 * point in the simulation. On arrival, drops the item at the destination
 * and completes the job (and, once every job referencing it is done, the
 * designation -- `JobBoard.completeJob`), clearing the item's
 * `Reservation`. If the destination becomes unreachable WHILE carrying,
 * the item is dropped where the beaver currently stands (never left in a
 * phantom "held but permanently stuck" state -- the roadmap's own "a log
 * remains where it falls until an agent physically moves it" already
 * implies a log can never just vanish or float) and the job fails
 * outright (not requeued: the specific destination genuinely can't be
 * reached from here, and blindly reusing stale `HaulProgress` from a
 * pickup phase that already happened would be wrong -- a fresh
 * designation from the item's new resting place is the honest next
 * step, not something this function invents on its own).
 */
export function tickHaulJob(
  grid: WorldGrid,
  terrain: TerrainField,
  water: WaterField,
  materials: MaterialRegistry,
  entities: EntityIdRegistry,
  components: ComponentStore,
  beaverId: EntityId,
  profile: NavigationProfile,
  candidateJobIds: readonly EntityId[],
): HaulStepOutcome {
  let jobId = currentJobOf(entities, components, beaverId);
  let freshlyAssigned = false;

  if (jobId === undefined) {
    const eligible = candidateJobIds.filter((id) => isEligibleForHaul(entities, components, beaverId, id));
    const chosen = selectJob(entities, components, grid, terrain, water, materials, profile, beaverId, eligible);
    if (chosen === undefined) return "idle";
    reserveJob(components, entities, chosen, beaverId);
    jobId = chosen;
    freshlyAssigned = true;
    const progress = getHaulProgress(components, jobId)!;
    // Belt-and-suspenders re-check right before writing the item's own
    // Reservation: `isEligibleForHaul` should already guarantee this, but
    // silently overwriting a DIFFERENT live beaver's claim on the item
    // (rather than throwing) is exactly the kind of quiet authoritative-
    // state corruption this task's own critic review found and fixed --
    // fail loudly instead if this invariant is ever violated.
    const existingReservation = getReservation(components, progress.itemId);
    if (existingReservation !== undefined && entities.isLive(existingReservation.by) && existingReservation.by !== beaverId) {
      throw new RangeError(
        `item ${progress.itemId} is already reserved by live beaver ${existingReservation.by} -- isEligibleForHaul should have excluded job ${jobId}`,
      );
    }
    setReservation(components, progress.itemId, { by: beaverId });
  }

  const job = getJob(components, jobId)!;
  const progress = getHaulProgress(components, jobId)!;

  if (progress.phase === "to-item") {
    if (!entities.isLive(progress.itemId)) {
      setJob(components, jobId, { designationId: job.designationId, target: job.target, status: "failed" });
      clearReservation(components, progress.itemId);
      return "failed";
    }
    // Not asserted non-null: `isEligibleForHaul` should guarantee no OTHER
    // live beaver already holds/reserved this item before this job could
    // ever be selected, but a competing job's `pickUp` clears the item's
    // `WorldGrid` position -- if that invariant is ever violated (the
    // exact crash this task's own critic review found and fixed), fail
    // this job intelligibly instead of throwing an unhandled TypeError.
    const itemPosition = grid.positionOf(progress.itemId);
    if (itemPosition === undefined) {
      setJob(components, jobId, { designationId: job.designationId, target: job.target, status: "failed" });
      clearReservation(components, progress.itemId);
      return "failed";
    }
    const itemColumn: ColumnCoordinate = { x: itemPosition.x, z: itemPosition.z };
    const beaverPosition = grid.positionOf(beaverId)!;

    if (beaverPosition.x !== itemColumn.x || beaverPosition.z !== itemColumn.z) {
      const result = advanceTowards(grid, terrain, water, materials, components, beaverId, itemColumn);
      if (result.outcome === "unreachable") {
        setJob(components, jobId, { designationId: job.designationId, target: job.target, status: "unclaimed" });
        clearReservation(components, progress.itemId);
        return "requeued";
      }
      setJob(components, jobId, { designationId: job.designationId, target: job.target, status: "in-progress", reservedBy: beaverId });
      return freshlyAssigned ? "assigned" : "traveling";
    }

    pickUp(components, grid, progress.itemId, beaverId);
    setHaulProgress(components, jobId, { itemId: progress.itemId, destination: progress.destination, phase: "to-destination" });
    setJob(components, jobId, { designationId: job.designationId, target: job.target, status: "in-progress", reservedBy: beaverId });
    return "picked-up";
  }

  // phase === "to-destination"
  //
  // Defensive: confirm this beaver genuinely still possesses the item
  // before carrying/delivering it. As of P1-16, `Mortality.ts`'s `die` --
  // the ONLY place a beaver is ever destroyed in this codebase -- drops
  // every held item (clearing `Held`, restoring a real `WorldGrid`
  // position) BEFORE calling `entities.destroy()`, precisely so a dead
  // beaver's held items are never left in the unrecoverable "position-
  // less, held-by-nothing-live" limbo this comment used to describe as a
  // known, deferred gap. This check remains necessary regardless: a
  // SECOND beaver can still reclaim this job the instant the first
  // beaver dies (`JobBoard.isJobAvailable`'s own stale-reservation logic,
  // correctly -- the underlying designation must survive, per this
  // project's own P1-07 acceptance test) despite never having actually
  // picked the item up itself. Without this check, the code below would
  // silently walk that second beaver to the destination and mark the job
  // "delivered" for an item it never touched. Failing the job outright
  // here (rather than phantom-delivering) is still the honest answer --
  // the item itself is no longer lost (P1-16 already dropped it at the
  // original beaver's last position), just not this SPECIFIC job's to
  // deliver anymore; a fresh haul designation can pick it up from there.
  if (getHeld(components, progress.itemId)?.by !== beaverId) {
    setJob(components, jobId, { designationId: job.designationId, target: job.target, status: "failed" });
    clearReservation(components, progress.itemId);
    return "failed";
  }

  const beaverPosition = grid.positionOf(beaverId)!;
  if (beaverPosition.x === progress.destination.x && beaverPosition.z === progress.destination.z) {
    drop(components, grid, progress.itemId, progress.destination);
    clearReservation(components, progress.itemId);
    completeJob(entities, components, jobId, beaverId);
    return "delivered";
  }

  const carriedMassKg = haulableMassKg(components, progress.itemId);
  if (carriedMassKg === undefined) {
    setJob(components, jobId, { designationId: job.designationId, target: job.target, status: "failed" });
    clearReservation(components, progress.itemId);
    return "failed";
  }
  const baseLocomotion = getLocomotion(components, beaverId)!;
  let result: AdvanceResult;
  try {
    setLocomotion(components, beaverId, { speed: baseLocomotion.speed / haulSpeedMultiplier(carriedMassKg) });
    result = advanceTowards(grid, terrain, water, materials, components, beaverId, progress.destination);
  } finally {
    // Restored unconditionally, even if advanceTowards throws -- Locomotion.speed
    // must never be left reading the temporary burdened value.
    setLocomotion(components, beaverId, baseLocomotion);
  }

  if (result.outcome === "unreachable") {
    drop(components, grid, progress.itemId, { x: beaverPosition.x, z: beaverPosition.z });
    clearReservation(components, progress.itemId);
    setJob(components, jobId, { designationId: job.designationId, target: job.target, status: "failed" });
    return "failed";
  }

  setJob(components, jobId, { designationId: job.designationId, target: job.target, status: "in-progress", reservedBy: beaverId });
  return "carrying";
}
