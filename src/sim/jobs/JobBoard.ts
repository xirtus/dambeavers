import type { EntityId, EntityIdRegistry } from "../core/EntityId.js";
import type { ComponentStore } from "../core/ComponentStore.js";
import type { WorldGrid } from "../world/WorldGrid.js";
import type { TerrainField } from "../world/TerrainField.js";
import type { WaterField, ColumnCoordinate } from "../hydrology/WaterField.js";
import type { MaterialRegistry } from "../materials/Material.js";
import { findPath, type NavigationProfile } from "../navigation/Pathfinding.js";
import { getJob, setJob } from "./Job.js";
import { getDesignation, setDesignation } from "./Designation.js";
import { advanceTowards } from "../creatures/BeaverLocomotion.js";

function manhattan(a: ColumnCoordinate, b: ColumnCoordinate): number {
  return Math.abs(a.x - b.x) + Math.abs(a.z - b.z);
}

/**
 * True if `jobId` is genuinely claimable right now: `"unclaimed"`
 * outright, or `"reserved"`/`"in-progress"` but its worker is no longer
 * live. Reservations are authoritative state (ARCHITECTURE_CONTRACT §10)
 * -- this deliberately does NOT eagerly clear a dead worker's stale
 * `reservedBy` on some destroy-triggered subscription; it discovers
 * staleness the same way P1-04/P1-05/P1-06 discover changed world state
 * generally: freshly, from live data, every time someone asks, never
 * cached. `releaseStaleReservation` (below) is what actually rewrites the
 * job's stored state back to `"unclaimed"` once this function's answer is
 * acted on -- this function itself never mutates anything.
 *
 * This one check is what makes AGENTS.md Law 1.5's pipeline hold under
 * this task's own literal acceptance test: deleting the currently
 * assigned worker does not delete the `Designation` (nothing here ever
 * touches it), and the `Job` it was reserved for becomes selectable again
 * the very next time anything asks.
 */
export function isJobAvailable(entities: EntityIdRegistry, components: ComponentStore, jobId: EntityId): boolean {
  const job = getJob(components, jobId)!;
  if (job.status === "completed" || job.status === "failed") return false;
  if (job.status === "unclaimed") return true;
  return job.reservedBy === undefined || !entities.isLive(job.reservedBy);
}

/** If `jobId`'s reservation is stale (worker no longer live), rewrites it back to `"unclaimed"` and returns `true`. A no-op (returns `false`) for a job that's genuinely unclaimed, actively held by a live worker, or already concluded. */
export function releaseStaleReservation(entities: EntityIdRegistry, components: ComponentStore, jobId: EntityId): boolean {
  const job = getJob(components, jobId)!;
  const stale = (job.status === "reserved" || job.status === "in-progress") && job.reservedBy !== undefined && !entities.isLive(job.reservedBy);
  if (!stale) return false;
  setJob(components, jobId, { designationId: job.designationId, target: job.target, status: "unclaimed" });
  return true;
}

/**
 * Interrupts a job a LIVE worker is still actively reserving/working, and
 * requeues it back to `"unclaimed"` for someone else to pick up --
 * ARCHITECTURE_CONTRACT §10's own "need becomes urgent" job failure mode
 * (listed there from the start, first actually wired up by P1-14), the
 * "suspend" outcome of the pipeline's own "Complete / fail / suspend /
 * requeue" list. The identical state transition every labor type's own
 * tick function already performs inline for its "route currently
 * unreachable" case (`tickTreeCutJob`/`tickHaulJob`/`tickBuildJob` all
 * requeue a job the SAME way) -- exposed here as a named, general,
 * directly-callable operation for the OTHER reason a job can't continue
 * right now: not because the route/target became invalid, but because the
 * WORKER itself was urgently pulled away (P1-14's `BeaverBehavior.ts`).
 * Unlike `releaseStaleReservation` (which only ever fires for a worker no
 * longer live), this fires for a worker that's very much alive but has
 * something more urgent to do -- callers are expected to have already
 * decided that, this function only performs the resulting state change.
 * Throws if `jobId` doesn't resolve to a real `Job` (matching every other
 * function in this file's convention).
 */
export function suspendJob(components: ComponentStore, jobId: EntityId): void {
  const job = getJob(components, jobId)!;
  setJob(components, jobId, { designationId: job.designationId, target: job.target, status: "unclaimed" });
}

/** Whether `beaverId` may take `jobId` -- live, a beaver, and the job is actually available. Deliberately minimal (no skill/tool/reachability filtering here): a future labor type (P1-08+) that needs those adds them to ITS OWN eligibility check, not this generic one. */
export function isEligible(entities: EntityIdRegistry, components: ComponentStore, beaverId: EntityId, jobId: EntityId): boolean {
  if (!entities.isLive(beaverId) || entities.kindOf(beaverId) !== "beaver") return false;
  return isJobAvailable(entities, components, jobId);
}

/**
 * The nearest REACHABLE available candidate job to `beaverId`'s current
 * column, or `undefined` if none of `candidateJobIds` qualify. Ties
 * broken by lowest `EntityId` for determinism. This is the pipeline's
 * "utility / priority evaluation" stage (ARCHITECTURE_CONTRACT §10) --
 * deliberately the simplest possible real metric (distance) among
 * candidates a real route actually exists to, rather than a placeholder;
 * a richer utility function (urgency, skill match, ...) is a future
 * refinement, not something to fake here.
 *
 * Reachability is checked via a real `findPath` call (P1-04) before a job
 * is even considered a candidate -- mirroring P1-06's `resolveThirst`/
 * `resolveHunger` (`BeaverNeeds.ts`), which needed the identical fix
 * after its own critic pass found that ranking by raw distance ALONE lets
 * an unreachable target win the ranking. Left unguarded here, a beaver
 * would reserve the nearest-by-distance job, have `advanceTowards`
 * immediately report `"unreachable"`, get it requeued by
 * `tickJobForBeaver`, and re-select the SAME still-nearest-but-still-
 * unreachable job again next tick -- forever, permanently starving every
 * OTHER, genuinely reachable job in the candidate list. Confirmed as a
 * real, reproducible livelock (not a hypothetical) during this task's own
 * critic review, via a disposable probe.
 */
export function selectJob(
  entities: EntityIdRegistry,
  components: ComponentStore,
  grid: WorldGrid,
  terrain: TerrainField,
  water: WaterField,
  materials: MaterialRegistry,
  profile: NavigationProfile,
  beaverId: EntityId,
  candidateJobIds: readonly EntityId[],
): EntityId | undefined {
  const position = grid.positionOf(beaverId);
  if (position === undefined) return undefined;
  const from: ColumnCoordinate = { x: position.x, z: position.z };

  let best: EntityId | undefined;
  let bestDistance = Infinity;
  for (const jobId of candidateJobIds) {
    if (!isJobAvailable(entities, components, jobId)) continue;
    const job = getJob(components, jobId)!;
    if (findPath(grid, terrain, water, materials, from, job.target, profile) === undefined) continue; // unreachable right now -- not a real candidate
    const distance = manhattan(from, job.target);
    if (distance < bestDistance || (distance === bestDistance && (best === undefined || jobId < best))) {
      best = jobId;
      bestDistance = distance;
    }
  }
  return best;
}

/** Reservation is authoritative state (ARCHITECTURE_CONTRACT §10). Throws if `jobId` is not actually available right now -- callers should only reserve a job `selectJob` (or a fresh `isJobAvailable` check) just confirmed. */
export function reserveJob(components: ComponentStore, entities: EntityIdRegistry, jobId: EntityId, beaverId: EntityId): void {
  if (!isJobAvailable(entities, components, jobId)) {
    throw new RangeError(`job ${jobId} is not available to reserve`);
  }
  const job = getJob(components, jobId)!;
  setJob(components, jobId, { designationId: job.designationId, target: job.target, status: "reserved", reservedBy: beaverId });
}

/** The job currently reserved by/in-progress for `beaverId`, if any. Linear scan over live jobs -- fine at this project's scale (matches `EntityIdRegistry.liveIdsOfKind`'s own documented precedent). */
export function currentJobOf(entities: EntityIdRegistry, components: ComponentStore, beaverId: EntityId): EntityId | undefined {
  for (const jobId of entities.liveIdsOfKind("job")) {
    const job = getJob(components, jobId)!;
    if ((job.status === "reserved" || job.status === "in-progress") && job.reservedBy === beaverId) return jobId;
  }
  return undefined;
}

/**
 * Whether EVERY job referencing `designationId` is `"completed"` (and at
 * least one exists) -- a `"go-to"` designation's `generateJobs` always
 * produces exactly one, so this is trivially "that one job" today, but
 * this function (not raw job-count assumptions inline at the call site)
 * is what stays correct unchanged once a future labor type's
 * `generateJobs` starts producing several jobs per designation: the
 * designation as a whole shouldn't read `"completed"` until every part of
 * it is.
 */
export function allJobsForDesignationCompleted(entities: EntityIdRegistry, components: ComponentStore, designationId: EntityId): boolean {
  let sawAny = false;
  for (const jobId of entities.liveIdsOfKind("job")) {
    const job = getJob(components, jobId)!;
    if (job.designationId !== designationId) continue;
    sawAny = true;
    if (job.status !== "completed") return false;
  }
  return sawAny;
}

/**
 * Marks `jobId` `"completed"` (crediting `beaverId` as the one who
 * finished it) and, once EVERY job referencing its designation is also
 * `"completed"` (`allJobsForDesignationCompleted`), marks the designation
 * `"completed"` too -- preserving any other designation fields (like
 * `targetEntity`) via a spread rather than reconstructing the object
 * field-by-field, so this stays correct if `Designation`'s shape ever
 * grows again.
 *
 * Shared by every labor type's own execution driver (`tickJobForBeaver`'s
 * `"go-to"` here; `src/sim/labor/TreeCutting.ts`'s tree-felling
 * completion) so "what does finishing a job actually do to its
 * designation" can never drift into two different answers.
 */
export function completeJob(entities: EntityIdRegistry, components: ComponentStore, jobId: EntityId, beaverId: EntityId): void {
  const job = getJob(components, jobId)!;
  setJob(components, jobId, { designationId: job.designationId, target: job.target, status: "completed", reservedBy: beaverId });
  if (allJobsForDesignationCompleted(entities, components, job.designationId)) {
    const designation = getDesignation(components, job.designationId)!;
    setDesignation(components, job.designationId, { ...designation, status: "completed" });
  }
}

export type JobStepOutcome = "assigned" | "progressed" | "arrived" | "requeued" | "idle";

/**
 * One simulated tick of the job pipeline's last stages (reservation
 * through completion/failure/requeue -- ARCHITECTURE_CONTRACT §10) for
 * ONE beaver: if it already holds a job, execute it (real navigation via
 * `advanceTowards`, P1-05); otherwise try to find and reserve a new one
 * among `candidateJobIds`. On arrival, marks the job AND its underlying
 * designation `"completed"`. On a route that's currently unreachable,
 * releases the reservation back to `"unclaimed"` (ARCHITECTURE_CONTRACT
 * §10's "route unavailable" is a recoverable/requeue condition here, not
 * a terminal failure -- matching P1-04/P1-05's own "discover from live
 * state" discipline: a route blocked today may open up later with no
 * separate unblocking mechanism needed).
 *
 * This is a movement/pipeline PRIMITIVE, not a scheduler: nothing here
 * decides which beaver goes first, or arbitrates against P1-06's needs --
 * that composition is the caller's job. Callable once per simulated tick
 * per beaver, by a test loop today or a future scheduler once one exists.
 */
export function tickJobForBeaver(
  grid: WorldGrid,
  terrain: TerrainField,
  water: WaterField,
  materials: MaterialRegistry,
  entities: EntityIdRegistry,
  components: ComponentStore,
  beaverId: EntityId,
  profile: NavigationProfile,
  candidateJobIds: readonly EntityId[],
): JobStepOutcome {
  let jobId = currentJobOf(entities, components, beaverId);

  if (jobId === undefined) {
    const chosen = selectJob(entities, components, grid, terrain, water, materials, profile, beaverId, candidateJobIds);
    if (chosen === undefined) return "idle";
    reserveJob(components, entities, chosen, beaverId);
    jobId = chosen;
  }

  const job = getJob(components, jobId)!;
  const result = advanceTowards(grid, terrain, water, materials, components, beaverId, job.target);

  if (result.outcome === "arrived" || result.outcome === "already-there") {
    completeJob(entities, components, jobId, beaverId);
    return "arrived";
  }
  if (result.outcome === "unreachable") {
    setJob(components, jobId, { designationId: job.designationId, target: job.target, status: "unclaimed" });
    return "requeued";
  }
  // "moved" -- still genuinely en route.
  setJob(components, jobId, { designationId: job.designationId, target: job.target, status: "in-progress", reservedBy: beaverId });
  return job.status === "reserved" ? "assigned" : "progressed";
}
