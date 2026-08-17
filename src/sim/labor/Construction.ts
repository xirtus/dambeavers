import { ComponentStore, defineComponent, type ComponentType } from "../core/ComponentStore.js";
import type { EntityId, EntityIdRegistry } from "../core/EntityId.js";
import type { WorldGrid } from "../world/WorldGrid.js";
import type { TerrainField } from "../world/TerrainField.js";
import type { WaterField, ColumnCoordinate } from "../hydrology/WaterField.js";
import type { MaterialRegistry, MaterialId } from "../materials/Material.js";
import type { NavigationProfile } from "../navigation/Pathfinding.js";
import type { World } from "../persistence/WorldSnapshot.js";
import { getSkills } from "../creatures/Beaver.js";
import { advanceTowards } from "../creatures/BeaverLocomotion.js";
import { createDesignation, getDesignation, setDesignation } from "../jobs/Designation.js";
import { getJob, setJob } from "../jobs/Job.js";
import { isEligible, selectJob, reserveJob, currentJobOf, completeJob } from "../jobs/JobBoard.js";
import { getLog, getHeld, getReservation, setReservation, clearReservation } from "./Log.js";
import { designateHaul, generateHaulJob } from "./Hauling.js";

/**
 * P1-10's labor type: a construction (wall/lodge-segment/bridge/dam-
 * segment) is the first job in this project with TWO genuinely separate
 * phases with different actors -- material must physically arrive at the
 * site (P1-09's hauling, reused unmodified: a construction never invents
 * its own item-movement logic, it just repeatedly designates ordinary
 * hauls) before labor (this file's own new execution driver,
 * `tickBuildJob`) can even begin. `Construction`'s own `status` is the
 * single source of truth for which phase a given site is in; nothing
 * duplicates `workDone`/`workRequired` onto a second component the way
 * `TreeCutProgress` does, since here there is exactly one `Construction`
 * per designation for the whole job's lifetime (mirroring `Log`'s own
 * "derive/store once" precedent) -- the job entity `generateBuildJob`
 * creates only carries a POINTER (`BuildProgress.constructionId`), not a
 * second copy of the work counters.
 */
export type ConstructionKind = "wall" | "lodge-segment" | "bridge" | "dam-segment";

const VALID_CONSTRUCTION_KINDS: readonly ConstructionKind[] = ["wall", "lodge-segment", "bridge", "dam-segment"];

export interface Construction {
  designationId: EntityId;
  kind: ConstructionKind;
  site: ColumnCoordinate;
  requiredMaterialId: MaterialId;
  requiredMassKg: number;
  workDone: number;
  workRequired: number;
  status: "awaiting-materials" | "awaiting-labor" | "complete" | "cancelled";
}
export const ConstructionComponent: ComponentType<Construction> = defineComponent<Construction>("construction");

export function assertValidConstruction(construction: Construction): void {
  if (!Number.isInteger(construction.designationId) || construction.designationId < 1) {
    throw new RangeError(`construction designationId must be a positive integer, got ${construction.designationId}`);
  }
  if (!VALID_CONSTRUCTION_KINDS.includes(construction.kind)) {
    throw new RangeError(`construction kind must be one of ${VALID_CONSTRUCTION_KINDS.join(", ")}, got ${JSON.stringify(construction.kind)}`);
  }
  if (!Number.isInteger(construction.site.x) || !Number.isInteger(construction.site.z)) {
    throw new RangeError(`construction site must have integer coordinates, got ${JSON.stringify(construction.site)}`);
  }
  if (construction.requiredMaterialId.trim().length === 0) {
    throw new RangeError(`construction requiredMaterialId must be non-empty, got ${JSON.stringify(construction.requiredMaterialId)}`);
  }
  if (!(Number.isFinite(construction.requiredMassKg) && construction.requiredMassKg > 0)) {
    throw new RangeError(`construction requiredMassKg must be a positive finite number, got ${construction.requiredMassKg}`);
  }
  if (!(Number.isFinite(construction.workDone) && construction.workDone >= 0)) {
    throw new RangeError(`construction workDone must be a non-negative finite number, got ${construction.workDone}`);
  }
  if (!(Number.isFinite(construction.workRequired) && construction.workRequired >= 0)) {
    throw new RangeError(`construction workRequired must be a non-negative finite number, got ${construction.workRequired}`);
  }
  const validStatuses = ["awaiting-materials", "awaiting-labor", "complete", "cancelled"];
  if (!validStatuses.includes(construction.status)) {
    throw new RangeError(`construction status must be one of ${validStatuses.join(", ")}, got ${JSON.stringify(construction.status)}`);
  }
}

export function setConstruction(components: ComponentStore, id: EntityId, construction: Construction): void {
  assertValidConstruction(construction);
  components.set(id, ConstructionComponent, construction);
}

export function getConstruction(components: ComponentStore, id: EntityId): Construction | undefined {
  const construction = components.get(id, ConstructionComponent);
  if (construction !== undefined) assertValidConstruction(construction);
  return construction;
}

/** Per-kind requirements -- plausible, tunable balance data, not derived from anything deeper (no such deeper model exists yet, matching P1-08's own `WORK_PER_KG`-style precedent for "a real, tunable number, not a placeholder"). */
const CONSTRUCTION_REQUIREMENTS: Record<ConstructionKind, { materialId: MaterialId; requiredMassKg: number; workRequired: number }> = {
  wall: { materialId: "wood", requiredMassKg: 20, workRequired: 10 },
  "lodge-segment": { materialId: "wood", requiredMassKg: 40, workRequired: 20 },
  bridge: { materialId: "wood", requiredMassKg: 30, workRequired: 15 },
  "dam-segment": { materialId: "wood", requiredMassKg: 50, workRequired: 25 },
};

/**
 * Mass tolerance for delivery/threshold comparisons -- floating-point log
 * masses (e.g. tree-felling's own remainder-splitting in `TreeCutting.ts`'s
 * `fellTree`) can land a few ULPs short of an exact requirement: without a
 * tolerance, two logs summing to `19.999999999999996` instead of an exact
 * `20` could permanently starve a construction of the LAST sliver of
 * material it will ever actually need. The SAME class of floating-point
 * issue `TreeCutting.ts`'s own `MASS_EPSILON_KG` guards against, though
 * that constant (`1e-9`) tolerates a near-zero REMAINDER after repeated
 * subtraction -- a different comparison shape than this file's "is the
 * cumulative delivered total close enough to the requirement," so a
 * separate (and, for hauling whole discrete logs whose masses are never
 * anywhere near this small, comfortably generous) value is used here.
 */
const MASS_EPSILON_KG = 1e-6;

/**
 * Creates a `"construct-<kind>"` designation plus its `Construction`
 * tracking entity (kind `"construction"`), starting `"awaiting-materials"`.
 * Throws if `kind` isn't a real, recognized construction kind, if `site`
 * has no real ground to build on, or if another construction is already
 * active (not yet `"complete"`/`"cancelled"`) at that exact site -- two
 * constructions sharing one site would otherwise let their material
 * requirements be satisfied by the SAME physical logs, double-counting
 * real mass that only exists once (a real, reproduced bug this task's own
 * critic review caught). A site freed up by a prior construction
 * finishing or being cancelled can be reused for a new one.
 *
 * `kind` is validated FIRST, before any entity is created -- matching
 * `TreeCutting.ts`'s own `designateTreeCut` precedent (validate
 * everything, then create). An earlier version of this function looked up
 * `CONSTRUCTION_REQUIREMENTS[kind]` and had already created both the
 * designation AND the construction entity before that lookup could ever
 * fail, so an invalid `kind` (unreachable through this project's own
 * TypeScript-typed call sites today, but reachable the moment ANY
 * non-typechecked caller exists -- P1-20's `TextUI.designateConstruction`
 * is exactly that: a real command surface with no compile-time guarantee
 * on what a future text-command parser might pass through it) crashed
 * with a raw, confusing `TypeError` reading `undefined.materialId` deep
 * inside this function, AFTER already permanently allocating two orphaned
 * entities (a designation with no valid kind, and a `"construction"`-kind
 * entity with no `Construction` component ever attached to it -- neither
 * entity id can ever be reclaimed, per `EntityIdRegistry`'s own "ids are
 * never reused" contract) instead of failing cleanly with no side effects
 * at all. Found during P1-20's own critic review.
 */
export function designateConstruction(world: World, kind: ConstructionKind, site: ColumnCoordinate): EntityId {
  if (!VALID_CONSTRUCTION_KINDS.includes(kind)) {
    throw new RangeError(`construction kind must be one of ${VALID_CONSTRUCTION_KINDS.join(", ")}, got ${JSON.stringify(kind)}`);
  }
  if (world.grid.surfaceY(site.x, site.z) === undefined) {
    throw new RangeError(`site (${site.x}, ${site.z}) has no ground -- cannot designate a construction there`);
  }
  for (const existingId of world.entities.liveIdsOfKind("construction")) {
    const existing = getConstruction(world.components, existingId)!;
    if (existing.site.x === site.x && existing.site.z === site.z && existing.status !== "complete" && existing.status !== "cancelled") {
      throw new RangeError(`site (${site.x}, ${site.z}) already has an active construction (entity ${existingId}) -- cannot designate another one there`);
    }
  }
  const requirements = CONSTRUCTION_REQUIREMENTS[kind];
  const designationId = createDesignation(world, `construct-${kind}`, site);
  const constructionId = world.entities.create("construction");
  setConstruction(world.components, constructionId, {
    designationId,
    kind,
    site,
    requiredMaterialId: requirements.materialId,
    requiredMassKg: requirements.requiredMassKg,
    workDone: 0,
    workRequired: requirements.workRequired,
    status: "awaiting-materials",
  });
  return constructionId;
}

/** Total mass of real, physical `requiredMaterialId` logs currently sitting (not held, not in transit) at `constructionId`'s site AND not claimed by some OTHER live entity -- the honest, derived-every-time answer to "how much has actually arrived for THIS construction," never a separately-tracked counter that could drift from what's really on the ground. A log claimed (via `Log.ts`'s own `Reservation`, see `claimDeliveredMaterial` below) by a different construction never counts twice toward two requirements. */
export function deliveredMassAtSite(entities: EntityIdRegistry, components: ComponentStore, grid: WorldGrid, constructionId: EntityId): number {
  const construction = getConstruction(components, constructionId);
  if (construction === undefined) return 0;
  const floor = grid.surfaceY(construction.site.x, construction.site.z);
  if (floor === undefined) return 0;
  let total = 0;
  for (const id of grid.entitiesAt(construction.site.x, floor + 1, construction.site.z)) {
    if (entities.kindOf(id) !== "log") continue;
    const log = getLog(components, id);
    if (log === undefined || log.materialId !== construction.requiredMaterialId) continue;
    const reservation = getReservation(components, id);
    if (reservation !== undefined && entities.isLive(reservation.by) && reservation.by !== constructionId) continue; // claimed by a different construction -- not this one's
    total += log.massKg;
  }
  return total;
}

/**
 * Greedily claims (via `Log.ts`'s own `Reservation` component, `by` set to
 * `constructionId`) just enough already-delivered, unclaimed logs at the
 * site to cover `construction.requiredMassKg`. Reused, physical-resource-
 * ownership machinery, not a new concept: once claimed, `Hauling.ts`'s own
 * `designateHaul` already refuses to re-haul a live-reserved item away, and
 * `findAvailableMaterial`/`deliveredMassAtSite` already treat a live
 * reservation by someone else as unavailable/uncounted -- exactly the same
 * "reserve the physical resource, not just the job" pattern P1-09's own
 * `isEligibleForHaul` established for hauling. Without this, a Critical bug
 * this task's own critic review reproduced twice: delivered material sat
 * completely unprotected between arrival and assembly, so it could be
 * silently re-hauled elsewhere by an unrelated designation (the construction
 * would still "complete" having consumed nothing) or double-counted by a
 * second construction sharing a site.
 *
 * Called on every `checkMaterialsDelivered`/`ensureMaterialHaul` check (not
 * only once at the final "enough has arrived" transition) so a PARTIAL
 * delivery is locked to its construction the moment it lands, not left
 * momentarily unclaimed and stealable while more material is still en
 * route. Idempotent: re-claiming an item already reserved to this same
 * construction is a no-op.
 */
function claimDeliveredMaterial(entities: EntityIdRegistry, components: ComponentStore, grid: WorldGrid, constructionId: EntityId, construction: Construction): void {
  const floor = grid.surfaceY(construction.site.x, construction.site.z);
  if (floor === undefined) return;
  const candidates = [...grid.entitiesAt(construction.site.x, floor + 1, construction.site.z)].sort((a, b) => a - b); // deterministic claim order
  let claimed = 0;
  for (const id of candidates) {
    if (claimed >= construction.requiredMassKg - MASS_EPSILON_KG) break;
    if (entities.kindOf(id) !== "log") continue;
    const log = getLog(components, id);
    if (log === undefined || log.materialId !== construction.requiredMaterialId) continue;
    const reservation = getReservation(components, id);
    if (reservation !== undefined && entities.isLive(reservation.by) && reservation.by !== constructionId) continue; // already claimed by someone else
    if (reservation === undefined || reservation.by !== constructionId) setReservation(components, id, { by: constructionId });
    claimed += log.massKg;
  }
}

function manhattan(a: ColumnCoordinate, b: ColumnCoordinate): number {
  return Math.abs(a.x - b.x) + Math.abs(a.z - b.z);
}

/**
 * Nearest live item of `materialId` anywhere in the world that's genuinely
 * free to haul right now -- not held, not reserved by a still-live beaver
 * (a stale reservation is no obstacle, matching `isEligibleForHaul`'s own
 * "discover from live state" precedent), and not already sitting AT `site`
 * (material already delivered there is not "still needing to be fetched" --
 * without this exclusion, a search anchored at the site itself would keep
 * finding its own just-delivered material as the "nearest" source and
 * generate a pointless self-haul instead of going after material that's
 * actually still elsewhere). Ties broken by lowest `EntityId` for
 * determinism, mirroring `selectJob`'s own tie-break rule.
 */
function findAvailableMaterial(
  entities: EntityIdRegistry,
  components: ComponentStore,
  grid: WorldGrid,
  materialId: MaterialId,
  site: ColumnCoordinate,
): EntityId | undefined {
  let best: EntityId | undefined;
  let bestDistance = Infinity;
  for (const id of entities.liveIdsOfKind("log")) {
    const log = getLog(components, id);
    if (log === undefined || log.materialId !== materialId) continue;
    if (getHeld(components, id) !== undefined) continue;
    const reservation = getReservation(components, id);
    if (reservation !== undefined && entities.isLive(reservation.by)) continue;
    const position = grid.positionOf(id);
    if (position === undefined) continue;
    if (position.x === site.x && position.z === site.z) continue; // already delivered
    const distance = manhattan(site, { x: position.x, z: position.z });
    if (distance < bestDistance || (distance === bestDistance && (best === undefined || id < best))) {
      best = id;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * If `constructionId` still needs more material and a free item of the
 * right kind exists anywhere in the world, designates+generates ONE more
 * ordinary `"haul-item"` job (P1-09, entirely unmodified) to bring it to
 * the site, returning the new job's id. Returns `undefined` if enough
 * material has already arrived, the construction isn't in the
 * `"awaiting-materials"` phase, or nothing is currently available to haul
 * (the caller is expected to call this again later -- e.g. once per tick
 * of a driving loop -- rather than treating `undefined` as permanent
 * failure).
 *
 * Deliberately does NOT itself decide who carries out the resulting haul
 * job -- that's `tickHaulJob`'s job, exactly as for any other haul. This
 * function only ever creates AT MOST one designation per call, so calling
 * it repeatedly (rather than trying to compute "how many hauls total will
 * be needed" up front, which could over-order against a site whose
 * requirement is nearly met) naturally stops requesting more once
 * `deliveredMassAtSite` reports enough.
 */
export function ensureMaterialHaul(world: World, constructionId: EntityId): EntityId | undefined {
  const construction = getConstruction(world.components, constructionId);
  if (construction === undefined || construction.status !== "awaiting-materials") return undefined;
  claimDeliveredMaterial(world.entities, world.components, world.grid, constructionId, construction);
  const delivered = deliveredMassAtSite(world.entities, world.components, world.grid, constructionId);
  if (delivered >= construction.requiredMassKg - MASS_EPSILON_KG) return undefined;
  const source = findAvailableMaterial(world.entities, world.components, world.grid, construction.requiredMaterialId, construction.site);
  if (source === undefined) return undefined;
  const haulDesignationId = designateHaul(world, source, construction.site);
  const [haulJobId] = generateHaulJob(world, haulDesignationId);
  return haulJobId;
}

/**
 * Re-checks whether enough material now sits at the site and, if so,
 * transitions `constructionId` from `"awaiting-materials"` to
 * `"awaiting-labor"` (returns `true`). A no-op (returns `false`) if
 * already past `"awaiting-materials"` or still short. Separate from
 * `ensureMaterialHaul` so a driving loop can check delivery progress
 * without accidentally spawning a redundant haul on the same call.
 */
export function checkMaterialsDelivered(world: World, constructionId: EntityId): boolean {
  const construction = getConstruction(world.components, constructionId);
  if (construction === undefined || construction.status !== "awaiting-materials") return false;
  claimDeliveredMaterial(world.entities, world.components, world.grid, constructionId, construction);
  const delivered = deliveredMassAtSite(world.entities, world.components, world.grid, constructionId);
  if (delivered < construction.requiredMassKg - MASS_EPSILON_KG) return false;
  setConstruction(world.components, constructionId, { ...construction, status: "awaiting-labor" });
  return true;
}

/** Points a job entity at the `Construction` it advances -- a pointer, not a duplicated copy of `workDone`/`workRequired` (see this file's own top doc comment). */
export interface BuildProgress {
  constructionId: EntityId;
}
export const BuildProgressComponent: ComponentType<BuildProgress> = defineComponent<BuildProgress>("build-progress");

export function assertValidBuildProgress(progress: BuildProgress): void {
  if (!Number.isInteger(progress.constructionId) || progress.constructionId < 1) {
    throw new RangeError(`build progress constructionId must be a positive integer, got ${progress.constructionId}`);
  }
}

export function setBuildProgress(components: ComponentStore, id: EntityId, progress: BuildProgress): void {
  assertValidBuildProgress(progress);
  components.set(id, BuildProgressComponent, progress);
}

export function getBuildProgress(components: ComponentStore, id: EntityId): BuildProgress | undefined {
  const progress = components.get(id, BuildProgressComponent);
  if (progress !== undefined) assertValidBuildProgress(progress);
  return progress;
}

/** Expands an `"awaiting-labor"` construction into its one build job. Throws if the construction isn't actually ready for labor yet -- callers should only call this once `checkMaterialsDelivered` (or an equivalent live check) has just confirmed it. */
export function generateBuildJob(world: World, constructionId: EntityId): EntityId[] {
  const construction = getConstruction(world.components, constructionId);
  if (construction === undefined || construction.status !== "awaiting-labor") {
    throw new RangeError(`construction ${constructionId} is not awaiting labor -- cannot generate a build job for it`);
  }
  const jobId = world.entities.create("job");
  setJob(world.components, jobId, { designationId: construction.designationId, target: construction.site, status: "unclaimed" });
  setBuildProgress(world.components, jobId, { constructionId });
  return [jobId];
}

/** `JobBoard.isEligible`'s generic check, plus this labor type's own guard: the construction must still genuinely be `"awaiting-labor"` (a job that outlived its construction being cancelled elsewhere shouldn't be pickable). */
export function isEligibleForBuild(entities: EntityIdRegistry, components: ComponentStore, beaverId: EntityId, jobId: EntityId): boolean {
  if (!isEligible(entities, components, beaverId, jobId)) return false;
  const progress = getBuildProgress(components, jobId);
  if (progress === undefined) return false;
  const construction = getConstruction(components, progress.constructionId);
  return construction !== undefined && construction.status === "awaiting-labor";
}

/**
 * Destroys ONLY this construction's own CLAIMED logs (`Reservation.by ===
 * constructionId`, set by `claimDeliveredMaterial`) of `requiredMaterialId`
 * sitting at the site (they're now "built into" the structure -- consumed,
 * not merely moved, matching Law 1.6's own "physical resources are
 * physical" in reverse: a structure that consumes real material must
 * actually remove that material from the world, not just mark it
 * invisible) and marks the construction `"complete"`. Deliberately does
 * NOT sweep up any UNCLAIMED matching-material log also sitting at the
 * site (e.g. genuine over-delivery beyond what `claimDeliveredMaterial`
 * ever needed to claim to satisfy the requirement) -- excess material is
 * real, physical, reusable stock for a future order, not waste to be
 * silently destroyed just because it happens to be standing nearby (this
 * task's own verification review flagged the earlier "unreserved-or-mine"
 * filter for exactly this over-consumption gap). By the time this function
 * can ever run, `generateBuildJob`'s own precondition guarantees
 * `checkMaterialsDelivered` already ran at least once, which always claims
 * before flipping to `"awaiting-labor"` -- so genuinely required material
 * is never left unclaimed here. Defensively re-verifies enough CLAIMED mass
 * is actually still present immediately before destroying anything (should
 * always be true given the above, but this is the same "fail intelligibly
 * if an invariant is ever violated" belt-and-suspenders discipline
 * `Hauling.ts`'s `tickHaulJob` already established) -- returns `false`
 * (destroying nothing, completing nothing) rather than completing a
 * construction that didn't actually consume its required material.
 */
function assembleConstruction(entities: EntityIdRegistry, components: ComponentStore, grid: WorldGrid, constructionId: EntityId): boolean {
  const construction = getConstruction(components, constructionId)!;
  const floor = grid.surfaceY(construction.site.x, construction.site.z)!;
  const toConsume: EntityId[] = [];
  let consumedMassKg = 0;
  for (const id of grid.entitiesAt(construction.site.x, floor + 1, construction.site.z)) {
    if (entities.kindOf(id) !== "log") continue;
    const log = getLog(components, id);
    if (log === undefined || log.materialId !== construction.requiredMaterialId) continue;
    const reservation = getReservation(components, id);
    if (reservation === undefined || reservation.by !== constructionId) continue; // not claimed for THIS construction -- leave it alone
    toConsume.push(id);
    consumedMassKg += log.massKg;
  }
  if (consumedMassKg < construction.requiredMassKg - MASS_EPSILON_KG) return false;
  for (const id of toConsume) entities.destroy(id);
  setConstruction(components, constructionId, { ...construction, status: "complete" });
  return true;
}

/** Base build-work progress per tick, at zero skill -- named/exported the same way `TreeCutting.ts`'s `WORK_PER_TICK` is, not an inline magic number. Plausible, tunable balance data. */
export const BUILD_WORK_PER_TICK = 1;
/** Fractional bonus to build-work progress per level of a beaver's `"construction"` skill (P1-05's `Skills` component) -- the same skill-influence mechanism `TreeCutting.ts`'s `SKILL_WORK_BONUS` established for woodcutting. Currently a documented no-op in practice (no system yet grants `"construction"` skill XP), same as woodcutting's own precedent. */
export const BUILD_SKILL_WORK_BONUS = 0.1;

export type BuildStepOutcome = "assigned" | "traveling" | "working" | "built" | "requeued" | "failed" | "idle";

/**
 * One simulated tick of a build (labor/assembly) job for ONE beaver:
 * reserve a job if it doesn't hold one (generic `JobBoard` selection/
 * reservation filtered by `isEligibleForBuild`), travel to the site if not
 * already there, then accumulate real work -- scaled by the beaver's
 * `"construction"` skill, the same skill-influence mechanism P1-08's
 * `WORK_PER_KG`/`SKILL_WORK_BONUS` established for woodcutting -- once it
 * is. On enough accumulated work, consumes the delivered material and
 * completes the job (and, once every job referencing it is done, the
 * designation -- `JobBoard.completeJob`).
 *
 * A construction cancelled out from under an in-progress build (checked
 * fresh every tick, never cached) fails the job outright rather than
 * continuing to "work" on a site nobody wants finished anymore.
 *
 * Movement and work accumulation are never combined in the same tick,
 * matching P1-08's `tickTreeCutJob`'s own one-action-per-tick discipline.
 */
export function tickBuildJob(
  grid: WorldGrid,
  terrain: TerrainField,
  water: WaterField,
  materials: MaterialRegistry,
  entities: EntityIdRegistry,
  components: ComponentStore,
  beaverId: EntityId,
  profile: NavigationProfile,
  candidateJobIds: readonly EntityId[],
): BuildStepOutcome {
  let jobId = currentJobOf(entities, components, beaverId);
  let freshlyAssigned = false;

  if (jobId === undefined) {
    const eligible = candidateJobIds.filter((id) => isEligibleForBuild(entities, components, beaverId, id));
    const chosen = selectJob(entities, components, grid, terrain, water, materials, profile, beaverId, eligible);
    if (chosen === undefined) return "idle";
    reserveJob(components, entities, chosen, beaverId);
    jobId = chosen;
    freshlyAssigned = true;
  }

  const job = getJob(components, jobId)!;
  const progress = getBuildProgress(components, jobId)!;
  const construction = getConstruction(components, progress.constructionId);

  if (construction === undefined || construction.status !== "awaiting-labor") {
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

  const skillLevel = getSkills(components, beaverId)?.levels["construction"] ?? 0;
  const workThisTick = BUILD_WORK_PER_TICK * (1 + skillLevel * BUILD_SKILL_WORK_BONUS);
  const workDone = Math.min(construction.workRequired, construction.workDone + workThisTick);
  setConstruction(components, progress.constructionId, { ...construction, workDone });

  if (workDone >= construction.workRequired) {
    if (!assembleConstruction(entities, components, grid, progress.constructionId)) {
      setJob(components, jobId, { designationId: job.designationId, target: job.target, status: "failed" });
      return "failed";
    }
    completeJob(entities, components, jobId, beaverId);
    return "built";
  }

  setJob(components, jobId, { designationId: job.designationId, target: job.target, status: "in-progress", reservedBy: beaverId });
  return "working";
}

/**
 * Cancels a construction before it's assembled: marks the `Construction`
 * `"cancelled"` and its `Designation` `"cancelled"` (the generic status
 * value P1-07's `Designation.status` already reserved for exactly this,
 * never previously set by any code path), and fails every live job still
 * referencing the designation so no beaver keeps pursuing it (the next
 * time `currentJobOf` is asked, a `"failed"` job no longer counts as
 * reserved/in-progress for that beaver -- the same "discover from live
 * state, stop naturally" pattern every other job type already relies on;
 * no special-casing is needed in `tickBuildJob`/`tickHaulJob` itself).
 *
 * Deliberately does NOT destroy, move, or otherwise disturb any material
 * already delivered to the site: `assembleConstruction` (the only code
 * that ever consumes delivered material) is only ever reached from a
 * completing build job, which cancellation prevents from ever running --
 * so delivered physical materials are preserved simply by this function
 * never destroying them, satisfying the roadmap's own acceptance test
 * literally: "cancelling construction before assembly leaves delivered
 * physical materials in the world." It DOES release any `Reservation`
 * claim (`claimDeliveredMaterial`) this construction had placed on those
 * logs, though -- a cancelled construction is a dead end that will never
 * consume them, and leaving them permanently locked to it (the entity
 * itself is never destroyed, just marked `"cancelled"`, so a naive
 * `entities.isLive` check would treat the claim as live forever) would
 * strand real, physical wood no future order could ever use again. The
 * logs themselves are completely untouched -- still real, still physical,
 * still exactly where they were dropped -- only the claim on them is
 * lifted.
 */
export function cancelConstruction(entities: EntityIdRegistry, components: ComponentStore, grid: WorldGrid, constructionId: EntityId): void {
  const construction = getConstruction(components, constructionId);
  if (construction === undefined) {
    throw new RangeError(`entity ${constructionId} has no Construction component -- cannot cancel it`);
  }
  if (construction.status === "complete" || construction.status === "cancelled") return;
  setConstruction(components, constructionId, { ...construction, status: "cancelled" });

  const designation = getDesignation(components, construction.designationId)!;
  setDesignation(components, construction.designationId, { ...designation, status: "cancelled" });

  for (const jobId of entities.liveIdsOfKind("job")) {
    const job = getJob(components, jobId)!;
    if (job.designationId !== construction.designationId) continue;
    if (job.status === "completed" || job.status === "failed") continue;
    setJob(components, jobId, { designationId: job.designationId, target: job.target, status: "failed" });
  }

  const floor = grid.surfaceY(construction.site.x, construction.site.z);
  if (floor !== undefined) {
    for (const id of grid.entitiesAt(construction.site.x, floor + 1, construction.site.z)) {
      if (entities.kindOf(id) !== "log") continue;
      const reservation = getReservation(components, id);
      if (reservation !== undefined && reservation.by === constructionId) clearReservation(components, id);
    }
  }
}
