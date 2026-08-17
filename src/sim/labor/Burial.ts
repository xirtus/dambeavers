import { ComponentStore, defineComponent, type ComponentType } from "../core/ComponentStore.js";
import type { EntityId, EntityIdRegistry } from "../core/EntityId.js";
import type { WorldGrid } from "../world/WorldGrid.js";
import type { TerrainField } from "../world/TerrainField.js";
import type { WaterField } from "../hydrology/WaterField.js";
import type { MaterialRegistry } from "../materials/Material.js";
import type { NavigationProfile } from "../navigation/Pathfinding.js";
import type { World } from "../persistence/WorldSnapshot.js";
import { advanceTowards } from "../creatures/BeaverLocomotion.js";
import { createDesignation, getDesignation } from "../jobs/Designation.js";
import { getJob, setJob } from "../jobs/Job.js";
import { isEligible, selectJob, reserveJob, currentJobOf, completeJob } from "../jobs/JobBoard.js";

/**
 * P2-15's "body-handling work" half. Reuses P1-07's generic job pipeline
 * exactly the way P1-08's tree cutting did (`TreeCutting.ts`'s own
 * documented precedent): eligibility/selection/reservation unchanged,
 * only a labor-type-specific progress component and execution state
 * machine are new. Deliberately a single-leg "travel to the corpse, dig
 * in place" job -- unlike P1-09's hauling, a corpse is never picked up
 * and carried to a separate destination (a `Corpse` has no material/mass
 * like a `Log`/`Food`/`Refuse` item does, and inventing one just to reuse
 * `Hauling.ts`'s two-leg machinery would be exactly the "build machinery
 * a task doesn't need" AGENTS.md Law 10 warns against). The grave is dug
 * wherever the beaver died -- a genuine, minimal reading of "body-handling
 * work," not a burial-ground/cemetery-placement system nothing has asked
 * for yet.
 *
 * Deliberately imports NOTHING from `../creatures/Mortality.js`, even
 * though every real corpse originates there: `Mortality.ts`'s `die()`
 * calls INTO this file (`designateBurial`/`generateBurialJob`) to
 * auto-generate body-handling work the instant a beaver dies, so an
 * import in the other direction would create a genuine circular module
 * dependency. `causeOfDeath`/`deceasedBeaverId` are instead captured
 * directly onto `BurialProgress` by whoever generates the job (`die()`
 * already has both values in hand -- no `Corpse` re-read needed).
 * `BurialCauseOfDeath` mirrors `Mortality.ts`'s own `CauseOfDeath` union
 * exactly; duplicated rather than imported for the same reason.
 */
export type BurialCauseOfDeath = "drowning" | "starvation" | "exposure" | "trauma";
const VALID_CAUSES: readonly BurialCauseOfDeath[] = ["drowning", "starvation", "exposure", "trauma"];

export interface BurialProgress {
  corpseId: EntityId;
  causeOfDeath: BurialCauseOfDeath;
  deceasedBeaverId: EntityId;
  workDone: number;
  workRequired: number;
}
export const BurialProgressComponent: ComponentType<BurialProgress> = defineComponent<BurialProgress>("burial-progress");

export function assertValidBurialProgress(progress: BurialProgress): void {
  if (!Number.isInteger(progress.corpseId) || progress.corpseId < 1) {
    throw new RangeError(`burial progress corpseId must be a positive integer, got ${progress.corpseId}`);
  }
  if (!VALID_CAUSES.includes(progress.causeOfDeath)) {
    throw new RangeError(`burial progress causeOfDeath must be one of ${VALID_CAUSES.join(", ")}, got ${JSON.stringify(progress.causeOfDeath)}`);
  }
  if (!Number.isInteger(progress.deceasedBeaverId) || progress.deceasedBeaverId < 1) {
    throw new RangeError(`burial progress deceasedBeaverId must be a positive integer, got ${progress.deceasedBeaverId}`);
  }
  if (!(Number.isFinite(progress.workDone) && progress.workDone >= 0)) {
    throw new RangeError(`burial progress workDone must be a non-negative finite number, got ${progress.workDone}`);
  }
  if (!(Number.isFinite(progress.workRequired) && progress.workRequired >= 0)) {
    throw new RangeError(`burial progress workRequired must be a non-negative finite number, got ${progress.workRequired}`);
  }
}

export function setBurialProgress(components: ComponentStore, id: EntityId, progress: BurialProgress): void {
  assertValidBurialProgress(progress);
  components.set(id, BurialProgressComponent, progress);
}

export function getBurialProgress(components: ComponentStore, id: EntityId): BurialProgress | undefined {
  const progress = components.get(id, BurialProgressComponent);
  if (progress !== undefined) assertValidBurialProgress(progress);
  return progress;
}

/**
 * A grave -- the real, permanent physical trace a corpse becomes once
 * buried (Law 1.6: the body doesn't just vanish, it becomes something
 * else real). `deceasedBeaverId` deliberately still names the original
 * beaver's `EntityId`, resolvable via `EntityIdRegistry.isKnown` even
 * though that id is long destroyed and not live -- the SAME "historical
 * reference outlives liveness" precedent `EventLog`/`Corpse.deathEventId`
 * already establish.
 */
export interface Grave {
  deceasedBeaverId: EntityId;
  causeOfDeath: BurialCauseOfDeath;
}
export const GraveComponent: ComponentType<Grave> = defineComponent<Grave>("grave");

export function assertValidGrave(grave: Grave): void {
  if (!Number.isInteger(grave.deceasedBeaverId) || grave.deceasedBeaverId < 1) {
    throw new RangeError(`grave deceasedBeaverId must be a positive integer, got ${grave.deceasedBeaverId}`);
  }
  if (!VALID_CAUSES.includes(grave.causeOfDeath)) {
    throw new RangeError(`grave causeOfDeath must be one of ${VALID_CAUSES.join(", ")}, got ${JSON.stringify(grave.causeOfDeath)}`);
  }
}

export function setGrave(components: ComponentStore, id: EntityId, grave: Grave): void {
  assertValidGrave(grave);
  components.set(id, GraveComponent, grave);
}

export function getGrave(components: ComponentStore, id: EntityId): Grave | undefined {
  const grave = components.get(id, GraveComponent);
  if (grave !== undefined) assertValidGrave(grave);
  return grave;
}

/** Digging effort for one grave -- a flat, plausible, tunable constant (unlike `TreeCutting.ts`'s mass-scaled effort, a grave's size doesn't meaningfully vary by which beaver died). */
export const BURIAL_WORK_REQUIRED = 20;
/** Base burial progress per tick, at zero skill -- matches `TreeCutting.ts`'s own `WORK_PER_TICK` baseline; no `"gravedigging"` skill exists (Law 10 -- nothing yet needs one), so this never scales with a beaver's skill level. */
export const BURIAL_WORK_PER_TICK = 1;

/** Creates a `"bury-corpse"` designation targeting `corpseId`'s own current position -- the real, persistent order a beaver's job pipeline can pick up independently of any specific worker (P1-07's own survives-its-worker guarantee). */
export function designateBurial(world: World, corpseId: EntityId): EntityId {
  if (!world.entities.isLive(corpseId) || world.entities.kindOf(corpseId) !== "corpse") {
    throw new RangeError(`entity ${corpseId} is not a live corpse -- cannot designate a burial`);
  }
  const position = world.grid.positionOf(corpseId);
  if (position === undefined) {
    throw new RangeError(`corpse ${corpseId} has no position in the grid -- cannot designate a burial`);
  }
  return createDesignation(world, "bury-corpse", { x: position.x, z: position.z }, corpseId);
}

/**
 * Expands a `"bury-corpse"` designation into its one job instance. This
 * file's own analogue to `TreeCutting.ts`'s `generateTreeCutJob` -- each
 * labor type owns its own job generation. `causeOfDeath`/
 * `deceasedBeaverId` are supplied by the caller (`Mortality.ts`'s `die()`
 * already has both in hand at the exact moment it creates the corpse)
 * rather than re-derived here from `Corpse` -- see this file's own header
 * doc comment for why this file never imports `Mortality.ts` at all.
 */
export function generateBurialJob(
  world: World,
  designationId: EntityId,
  causeOfDeath: BurialCauseOfDeath,
  deceasedBeaverId: EntityId,
): EntityId[] {
  const designation = getDesignation(world.components, designationId);
  if (designation === undefined || designation.kind !== "bury-corpse" || designation.targetEntity === undefined) {
    throw new RangeError(`entity ${designationId} is not a valid "bury-corpse" designation`);
  }
  const corpseId = designation.targetEntity;
  const jobId = world.entities.create("job");
  setJob(world.components, jobId, { designationId, target: designation.target, status: "unclaimed" });
  setBurialProgress(world.components, jobId, { corpseId, causeOfDeath, deceasedBeaverId, workDone: 0, workRequired: BURIAL_WORK_REQUIRED });
  return [jobId];
}

/** `JobBoard.isEligible`'s generic check plus this labor type's own guard: the job must actually be a burial job (`BurialProgress`). No body/tool capability requirement exists yet (Law 10 -- no digging-tool system has been asked for). */
export function isEligibleForBurial(entities: EntityIdRegistry, components: ComponentStore, beaverId: EntityId, jobId: EntityId): boolean {
  return isEligible(entities, components, beaverId, jobId) && getBurialProgress(components, jobId) !== undefined;
}

export type BurialStepOutcome = "assigned" | "traveling" | "working" | "buried" | "requeued" | "failed" | "idle";

/**
 * One simulated tick of a burial job for ONE beaver -- the same
 * reserve/travel/accumulate-work/resolve shape `tickTreeCutJob` already
 * established, with no separate hauling leg (see this file's own header
 * doc comment). On enough accumulated work, destroys the corpse and
 * creates a real, permanent `"grave"` entity in its place, completing the
 * job (and, once every job referencing it is done, the designation --
 * `JobBoard.completeJob`).
 */
export function tickBurialJob(
  grid: WorldGrid,
  terrain: TerrainField,
  water: WaterField,
  materials: MaterialRegistry,
  entities: EntityIdRegistry,
  components: ComponentStore,
  beaverId: EntityId,
  profile: NavigationProfile,
  candidateJobIds: readonly EntityId[],
): BurialStepOutcome {
  let jobId = currentJobOf(entities, components, beaverId);
  let freshlyAssigned = false;

  if (jobId === undefined) {
    const eligible = candidateJobIds.filter((id) => isEligibleForBurial(entities, components, beaverId, id));
    const chosen = selectJob(entities, components, grid, terrain, water, materials, profile, beaverId, eligible);
    if (chosen === undefined) return "idle";
    reserveJob(components, entities, chosen, beaverId);
    jobId = chosen;
    freshlyAssigned = true;
  }

  const job = getJob(components, jobId)!;
  const progress = getBurialProgress(components, jobId)!;

  if (!entities.isLive(progress.corpseId)) {
    setJob(components, jobId, { designationId: job.designationId, target: job.target, status: "failed" });
    return "failed";
  }

  const position = grid.positionOf(beaverId)!;
  const atWorkPosition = position.x === job.target.x && position.z === job.target.z;

  if (!atWorkPosition) {
    const result = advanceTowards(grid, terrain, water, materials, components, beaverId, job.target);
    if (result.outcome === "unreachable") {
      setJob(components, jobId, { designationId: job.designationId, target: job.target, status: "unclaimed" });
      return "requeued";
    }
    setJob(components, jobId, { designationId: job.designationId, target: job.target, status: "in-progress", reservedBy: beaverId });
    return freshlyAssigned ? "assigned" : "traveling";
  }

  const workDone = Math.min(progress.workRequired, progress.workDone + BURIAL_WORK_PER_TICK);
  setBurialProgress(components, jobId, { ...progress, workDone });

  if (workDone >= progress.workRequired) {
    const gravePosition = grid.positionOf(progress.corpseId)!;
    entities.destroy(progress.corpseId);
    const graveId = entities.create("grave");
    grid.setEntityPosition(graveId, gravePosition.x, gravePosition.y, gravePosition.z);
    setGrave(components, graveId, { deceasedBeaverId: progress.deceasedBeaverId, causeOfDeath: progress.causeOfDeath });
    completeJob(entities, components, jobId, beaverId);
    return "buried";
  }

  setJob(components, jobId, { designationId: job.designationId, target: job.target, status: "in-progress", reservedBy: beaverId });
  return "working";
}
