import { ComponentStore, defineComponent, type ComponentType } from "../core/ComponentStore.js";
import type { EntityId } from "../core/EntityId.js";
import type { ColumnCoordinate } from "../hydrology/WaterField.js";
import type { World } from "../persistence/WorldSnapshot.js";
import { getDesignation } from "./Designation.js";

/**
 * P1-07's pipeline, stages 2-3 (ARCHITECTURE_CONTRACT §10): "Work
 * opportunity" and "Job instance," merged into one entity here (kind
 * `"job"`) since for `"go-to"` designations the two are always exactly
 * 1:1 -- there is nothing to further decompose. A future designation kind
 * that decomposes into several discrete claimable units (P1-08 cutting
 * several trees from one designation, say) would generalize
 * `generateJobs` below into producing more than one `Job` per
 * `Designation`; the pipeline's per-job stages (eligibility, selection,
 * reservation, execution -- `JobBoard.ts`) already operate on individual
 * jobs and need no change for that. The one place that DOES already
 * account for multiple jobs sharing a `Designation`, on purpose, is
 * `JobBoard.ts`'s `allJobsForDesignationCompleted`: a designation only
 * reads `"completed"` once every job referencing it does, not the moment
 * any single one finishes.
 *
 * `reservedBy` is deliberately OPTIONAL (omitted, never set to
 * `undefined`) rather than a sentinel value: `ComponentType`'s JSON-plain
 * value contract has no representation for `undefined`, and an omitted
 * key survives a JSON round trip unambiguously where an explicit
 * `undefined` value would not (`JSON.stringify` silently drops it,
 * `JSON.parse` never reintroduces it -- see `NeedFocus`'s own doc comment
 * for why P1-06 chose a string sentinel there instead; a `"none"`-style
 * sentinel doesn't fit an `EntityId`-typed field, so this file uses
 * optional-key omission instead).
 */
export interface Job {
  designationId: EntityId;
  target: ColumnCoordinate;
  status: "unclaimed" | "reserved" | "in-progress" | "completed" | "failed";
  reservedBy?: EntityId;
}
export const JobComponent: ComponentType<Job> = defineComponent<Job>("job");

export function assertValidJob(job: Job): void {
  if (!Number.isInteger(job.designationId) || job.designationId < 1) {
    throw new RangeError(`job designationId must be a positive integer, got ${job.designationId}`);
  }
  if (!Number.isInteger(job.target.x) || !Number.isInteger(job.target.z)) {
    throw new RangeError(`job target must have integer coordinates, got ${JSON.stringify(job.target)}`);
  }
  const validStatuses = ["unclaimed", "reserved", "in-progress", "completed", "failed"];
  if (!validStatuses.includes(job.status)) {
    throw new RangeError(`job status must be one of ${validStatuses.join(", ")}, got ${JSON.stringify(job.status)}`);
  }
  if (job.reservedBy !== undefined && (!Number.isInteger(job.reservedBy) || job.reservedBy < 1)) {
    throw new RangeError(`job reservedBy must be a positive integer when present, got ${job.reservedBy}`);
  }
}

export function setJob(components: ComponentStore, id: EntityId, job: Job): void {
  assertValidJob(job);
  components.set(id, JobComponent, job);
}

export function getJob(components: ComponentStore, id: EntityId): Job | undefined {
  const job = components.get(id, JobComponent);
  if (job !== undefined) assertValidJob(job);
  return job;
}

/**
 * Expands one designation into its work opportunity/job instance(s). For
 * the only designation `kind` this task implements ("go-to"), this is
 * always exactly one job targeting the designation's own location. Throws
 * if `designationId` doesn't resolve to a real `Designation` -- the
 * caller (typically right after `createDesignation`) controls that
 * ordering.
 */
export function generateJobs(world: World, designationId: EntityId): EntityId[] {
  const designation = getDesignation(world.components, designationId);
  if (designation === undefined) {
    throw new RangeError(`entity ${designationId} has no Designation component -- cannot generate jobs for it`);
  }
  const jobId = world.entities.create("job");
  setJob(world.components, jobId, { designationId, target: designation.target, status: "unclaimed" });
  return [jobId];
}
