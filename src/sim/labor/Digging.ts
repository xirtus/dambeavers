import { ComponentStore, defineComponent, type ComponentType } from "../core/ComponentStore.js";
import type { EntityId, EntityIdRegistry } from "../core/EntityId.js";
import type { WorldGrid } from "../world/WorldGrid.js";
import type { TerrainField } from "../world/TerrainField.js";
import type { WaterField, ColumnCoordinate } from "../hydrology/WaterField.js";
import { massOf, type MaterialId, type MaterialRegistry } from "../materials/Material.js";
import type { NavigationProfile } from "../navigation/Pathfinding.js";
import type { World } from "../persistence/WorldSnapshot.js";
import { practiceSkill, skillLevel } from "../creatures/SkillProgression.js";
import { advanceTowards } from "../creatures/BeaverLocomotion.js";
import { createDesignation, getDesignation } from "../jobs/Designation.js";
import { getJob, setJob } from "../jobs/Job.js";
import { isEligible, selectJob, reserveJob, currentJobOf, completeJob } from "../jobs/JobBoard.js";
import { setGood } from "../economy/Good.js";

/**
 * P3-04/P3-05/P3-13's shared labor type: excavating the topmost real
 * terrain cell of a column (`TerrainField.excavate`, P0-09 -- already
 * the general "digging" mechanism, unused by any labor type until now)
 * and turning what was removed into a real, physical raw-material item
 * (AGENTS.md Law 1.6), whose kind and mass are DERIVED from the real
 * material dug (`raw-<materialId>`, `massOf(material, CELL_VOLUME_M3)`
 * -- never a hardcoded "digging stone always yields a stone-block"
 * table). One system covers three roadmap tasks because they are, at
 * bottom, the same physical action: P3-04/P3-05 need a raw-material
 * SOURCE for their crafting recipes (`Recipe.ts`), and P3-13's own
 * acceptance test ("excavating terrain creates a new water path that
 * hydrology discovers automatically") is already true of
 * `TerrainField.excavate` alone -- `Flow.ts` derives obstruction from
 * real terrain solidity every step, with no separate "recompute
 * hydrology" call needed (the same reused-unmodified-mechanism pattern
 * `Dam.ts`'s own file doc comment establishes for `applyDamSegment`).
 * This file's only real job is giving beavers a way to actually PERFORM
 * an excavation through the ordinary job pipeline.
 */
export interface DigProgress {
  y: number;
  materialId: MaterialId;
  workDone: number;
  workRequired: number;
}
export const DigProgressComponent: ComponentType<DigProgress> = defineComponent<DigProgress>("dig-progress");

export function assertValidDigProgress(progress: DigProgress): void {
  if (!Number.isInteger(progress.y) || progress.y < 0) throw new RangeError(`dig progress y must be a non-negative integer, got ${progress.y}`);
  if (progress.materialId.trim().length === 0) throw new RangeError(`dig progress materialId must be non-empty`);
  if (!(Number.isFinite(progress.workDone) && progress.workDone >= 0)) throw new RangeError(`dig progress workDone must be non-negative`);
  if (!(Number.isFinite(progress.workRequired) && progress.workRequired >= 0)) throw new RangeError(`dig progress workRequired must be non-negative`);
}

export function setDigProgress(components: ComponentStore, id: EntityId, progress: DigProgress): void {
  assertValidDigProgress(progress);
  components.set(id, DigProgressComponent, progress);
}

export function getDigProgress(components: ComponentStore, id: EntityId): DigProgress | undefined {
  const progress = components.get(id, DigProgressComponent);
  if (progress !== undefined) assertValidDigProgress(progress);
  return progress;
}

/** Effort per unit of real material hardness -- a harder material genuinely takes longer to dig out, never a flat constant. Plausible, tunable balance data, matching `TreeCutting.ts`'s own `WORK_PER_KG` precedent. */
export const DIG_WORK_PER_HARDNESS = 8;
export const DIG_WORK_PER_TICK = 1;
export const DIG_SKILL_WORK_BONUS = 0.1;
/** One grid cell's real volume, m^3 -- pins the same unit convention `Material.ts`'s `massOf` doc comment establishes, so the raw material yielded by digging out one cell has a real, derived mass rather than an invented constant. */
export const CELL_VOLUME_M3 = 1;

/** Creates a `"dig"` designation targeting the topmost real terrain cell at `column` (`WorldGrid.surfaceY`). Throws if the column has no diggable material there. */
export function designateDig(world: World, column: ColumnCoordinate): EntityId {
  const y = world.grid.surfaceY(column.x, column.z);
  if (y === undefined || world.terrain.materialAt(column.x, y, column.z) === undefined) {
    throw new RangeError(`column (${column.x}, ${column.z}) has no real terrain to dig`);
  }
  return createDesignation(world, "dig", column);
}

/** Expands a `"dig"` designation into its one job, with `DigProgress` computed from the REAL material's own hardness at the moment of expansion. */
export function generateDigJob(world: World, materials: MaterialRegistry, designationId: EntityId): EntityId[] {
  const designation = getDesignation(world.components, designationId);
  if (designation === undefined || designation.kind !== "dig") {
    throw new RangeError(`entity ${designationId} is not a valid "dig" designation`);
  }
  const y = world.grid.surfaceY(designation.target.x, designation.target.z);
  const materialId = y === undefined ? undefined : world.terrain.materialAt(designation.target.x, y, designation.target.z);
  if (y === undefined || materialId === undefined) {
    throw new RangeError(`designation ${designationId}'s column (${designation.target.x}, ${designation.target.z}) no longer has terrain to dig`);
  }
  const hardness = materials.get(materialId).hardness;
  const workRequired = Math.max(1, hardness * DIG_WORK_PER_HARDNESS);

  const jobId = world.entities.create("job");
  setJob(world.components, jobId, { designationId, target: designation.target, status: "unclaimed" });
  setDigProgress(world.components, jobId, { y, materialId, workDone: 0, workRequired });
  return [jobId];
}

export function isEligibleForDig(entities: EntityIdRegistry, components: ComponentStore, terrain: TerrainField, beaverId: EntityId, jobId: EntityId): boolean {
  if (!isEligible(entities, components, beaverId, jobId)) return false;
  const progress = getDigProgress(components, jobId);
  if (progress === undefined) return false;
  const job = getJob(components, jobId)!;
  return terrain.materialAt(job.target.x, progress.y, job.target.z) === progress.materialId;
}

function excavateAndSpawn(entities: EntityIdRegistry, grid: WorldGrid, terrain: TerrainField, materials: MaterialRegistry, column: ColumnCoordinate, progress: DigProgress, components: ComponentStore): void {
  terrain.excavate(column.x, progress.y, column.z);
  const outputId = entities.create("good");
  grid.setEntityPosition(outputId, column.x, progress.y, column.z);
  setGood(components, outputId, {
    goodKind: `raw-${progress.materialId}`,
    materialId: progress.materialId,
    massKg: massOf(materials.get(progress.materialId), CELL_VOLUME_M3),
  });
}

export type DigStepOutcome = "assigned" | "traveling" | "working" | "dug" | "requeued" | "failed" | "idle";

/** Mirrors `TreeCutting.ts`'s `tickTreeCutJob` almost exactly: reserve/travel/accumulate-work/complete. A cell whose material changed out from under an in-progress dig (nothing currently does this except this very function) fails the job outright, since retrying can never succeed. */
export function tickDigJob(
  grid: WorldGrid,
  terrain: TerrainField,
  water: WaterField,
  materials: MaterialRegistry,
  entities: EntityIdRegistry,
  components: ComponentStore,
  beaverId: EntityId,
  profile: NavigationProfile,
  candidateJobIds: readonly EntityId[],
): DigStepOutcome {
  let jobId = currentJobOf(entities, components, beaverId);
  let freshlyAssigned = false;

  if (jobId === undefined) {
    const eligible = candidateJobIds.filter((id) => isEligibleForDig(entities, components, terrain, beaverId, id));
    const chosen = selectJob(entities, components, grid, terrain, water, materials, profile, beaverId, eligible);
    if (chosen === undefined) return "idle";
    reserveJob(components, entities, chosen, beaverId);
    jobId = chosen;
    freshlyAssigned = true;
  }

  const job = getJob(components, jobId)!;
  const progress = getDigProgress(components, jobId)!;
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

  if (terrain.materialAt(job.target.x, progress.y, job.target.z) !== progress.materialId) {
    setJob(components, jobId, { designationId: job.designationId, target: job.target, status: "failed" });
    return "failed";
  }

  const currentSkillLevel = skillLevel(components, beaverId, "digging");
  const workThisTick = DIG_WORK_PER_TICK * (1 + currentSkillLevel * DIG_SKILL_WORK_BONUS);
  const workDone = Math.min(progress.workRequired, progress.workDone + workThisTick);
  setDigProgress(components, jobId, { ...progress, workDone });
  practiceSkill(components, beaverId, "digging", workDone - progress.workDone);

  if (workDone >= progress.workRequired) {
    excavateAndSpawn(entities, grid, terrain, materials, job.target, progress, components);
    completeJob(entities, components, jobId, beaverId);
    return "dug";
  }

  setJob(components, jobId, { designationId: job.designationId, target: job.target, status: "in-progress", reservedBy: beaverId });
  return "working";
}
