import { ComponentStore, defineComponent, type ComponentType } from "../core/ComponentStore.js";
import type { EntityId, EntityIdRegistry } from "../core/EntityId.js";
import type { WorldGrid } from "../world/WorldGrid.js";
import type { TerrainField } from "../world/TerrainField.js";
import type { WaterField, ColumnCoordinate } from "../hydrology/WaterField.js";
import type { MaterialRegistry } from "../materials/Material.js";
import type { NavigationProfile } from "../navigation/Pathfinding.js";
import type { World } from "../persistence/WorldSnapshot.js";
import { practiceSkill, skillLevel } from "../creatures/SkillProgression.js";
import { advanceTowards } from "../creatures/BeaverLocomotion.js";
import { createDesignation, getDesignation, setDesignation } from "../jobs/Designation.js";
import { getJob, setJob } from "../jobs/Job.js";
import { isEligible, selectJob, reserveJob, currentJobOf, completeJob } from "../jobs/JobBoard.js";
import { getLog, getHeld, getReservation, setReservation, clearReservation } from "../labor/Log.js";
import { getGood, setGood } from "./Good.js";
import { getWorkshop } from "./Workshop.js";
import { type RecipeDefinition, RecipeRegistry } from "./Recipe.js";
import { designateHaul, generateHaulJob } from "../labor/Hauling.js";
import { toolWorkMultiplier } from "../labor/Equipment.js";
import { workshopPowerMultiplier } from "../mechanics/Machine.js";
import { clamp01 } from "../creatures/Needs.js";
import { motorFactor, cognitiveFactor } from "../creatures/Metabolism.js";
import { TechKnowledgeComponent } from "./TechKnowledge.js";
import { getHouseholdMembership } from "../creatures/Relationships.js";

/**
 * P3-01/P3-02's generic workshop execution driver: one `CraftOrder`
 * pipeline (designate -> haul real input mass to the workshop's site ->
 * accumulate work -> consume input, spawn output) parameterized entirely
 * by a `RecipeDefinition` -- the identical "material delivery via
 * ordinary hauls, claim on arrival, consume on completion" shape
 * `Construction.ts` already proved out, generalized from one hardcoded
 * per-`ConstructionKind` requirements table to ANY data-defined recipe.
 * Nothing here branches on a recipe id or workshop kind -- adding a new
 * recipe to `Recipe.ts`'s registry is the entire extension surface (the
 * literal P3-01/P3-02 acceptance test).
 */
export interface CraftOrder {
  designationId: EntityId;
  workshopId: EntityId;
  recipeId: string;
  site: ColumnCoordinate;
  workDone: number;
  status: "awaiting-materials" | "awaiting-labor" | "complete" | "cancelled";
}
export const CraftOrderComponent: ComponentType<CraftOrder> = defineComponent<CraftOrder>("craft-order");

const VALID_CRAFT_STATUSES = ["awaiting-materials", "awaiting-labor", "complete", "cancelled"];

export function assertValidCraftOrder(order: CraftOrder): void {
  if (!Number.isInteger(order.designationId) || order.designationId < 1) {
    throw new RangeError(`craft order designationId must be a positive integer, got ${order.designationId}`);
  }
  if (!Number.isInteger(order.workshopId) || order.workshopId < 1) {
    throw new RangeError(`craft order workshopId must be a positive integer, got ${order.workshopId}`);
  }
  if (order.recipeId.trim().length === 0) throw new RangeError(`craft order recipeId must be non-empty`);
  if (!Number.isInteger(order.site.x) || !Number.isInteger(order.site.z)) {
    throw new RangeError(`craft order site must have integer coordinates, got ${JSON.stringify(order.site)}`);
  }
  if (!(Number.isFinite(order.workDone) && order.workDone >= 0)) {
    throw new RangeError(`craft order workDone must be a non-negative finite number, got ${order.workDone}`);
  }
  if (!VALID_CRAFT_STATUSES.includes(order.status)) {
    throw new RangeError(`craft order status must be one of ${VALID_CRAFT_STATUSES.join(", ")}, got ${JSON.stringify(order.status)}`);
  }
}

export function setCraftOrder(components: ComponentStore, id: EntityId, order: CraftOrder): void {
  assertValidCraftOrder(order);
  components.set(id, CraftOrderComponent, order);
}

export function getCraftOrder(components: ComponentStore, id: EntityId): CraftOrder | undefined {
  const order = components.get(id, CraftOrderComponent);
  if (order !== undefined) assertValidCraftOrder(order);
  return order;
}

const MASS_EPSILON_KG = 1e-6;

/** Raw-material item kinds `Craft.ts` can source input mass from -- logs (`TreeCutting.ts`) and generic goods (raw-gathered via `Digging.ts`, or a prior recipe's own output feeding a later recipe). Mirrors `Construction.ts`'s own kind-filtered mass search, generalized past `"log"` alone. */
function materialIdAndMassOf(components: ComponentStore, id: EntityId): { materialId: string; massKg: number } | undefined {
  const log = getLog(components, id);
  if (log !== undefined) return { materialId: log.materialId, massKg: log.massKg };
  const good = getGood(components, id);
  if (good !== undefined) return { materialId: good.materialId, massKg: good.massKg };
  return undefined;
}

function craftInputKindsAt(entities: EntityIdRegistry, x: number, y: number, z: number, grid: WorldGrid): EntityId[] {
  return [...grid.entitiesAt(x, y, z)].filter((id) => entities.kindOf(id) === "log" || entities.kindOf(id) === "good");
}

export function deliveredMassAtSite(entities: EntityIdRegistry, components: ComponentStore, grid: WorldGrid, recipe: RecipeDefinition, site: ColumnCoordinate, craftOrderId: EntityId): number {
  const floor = grid.surfaceY(site.x, site.z);
  if (floor === undefined) return 0;
  let total = 0;
  for (const id of craftInputKindsAt(entities, site.x, floor + 1, site.z, grid)) {
    const material = materialIdAndMassOf(components, id);
    if (material === undefined || material.materialId !== recipe.inputMaterialId) continue;
    const reservation = getReservation(components, id);
    if (reservation !== undefined && entities.isLive(reservation.by) && reservation.by !== craftOrderId) continue;
    total += material.massKg;
  }
  return total;
}

function claimDeliveredMaterial(entities: EntityIdRegistry, components: ComponentStore, grid: WorldGrid, recipe: RecipeDefinition, site: ColumnCoordinate, craftOrderId: EntityId): void {
  const floor = grid.surfaceY(site.x, site.z);
  if (floor === undefined) return;
  const candidates = craftInputKindsAt(entities, site.x, floor + 1, site.z, grid).sort((a, b) => a - b);
  let claimed = 0;
  for (const id of candidates) {
    if (claimed >= recipe.inputMassKg - MASS_EPSILON_KG) break;
    const material = materialIdAndMassOf(components, id);
    if (material === undefined || material.materialId !== recipe.inputMaterialId) continue;
    const reservation = getReservation(components, id);
    if (reservation !== undefined && entities.isLive(reservation.by) && reservation.by !== craftOrderId) continue;
    if (reservation === undefined || reservation.by !== craftOrderId) setReservation(components, id, { by: craftOrderId });
    claimed += material.massKg;
  }
}

function manhattan(a: ColumnCoordinate, b: ColumnCoordinate): number {
  return Math.abs(a.x - b.x) + Math.abs(a.z - b.z);
}

function findAvailableInputMaterial(entities: EntityIdRegistry, components: ComponentStore, grid: WorldGrid, materialId: string, site: ColumnCoordinate): EntityId | undefined {
  let best: EntityId | undefined;
  let bestDistance = Infinity;
  for (const kind of ["log", "good"] as const) {
    for (const id of entities.liveIdsOfKind(kind)) {
      const material = materialIdAndMassOf(components, id);
      if (material === undefined || material.materialId !== materialId) continue;
      if (getHeld(components, id) !== undefined) continue;
      const reservation = getReservation(components, id);
      if (reservation !== undefined && entities.isLive(reservation.by)) continue;
      const position = grid.positionOf(id);
      if (position === undefined) continue;
      if (position.x === site.x && position.z === site.z) continue;
      const distance = manhattan(site, { x: position.x, z: position.z });
      if (distance < bestDistance || (distance === bestDistance && (best === undefined || id < best))) {
        best = id;
        bestDistance = distance;
      }
    }
  }
  return best;
}

/** Creates a `"craft"` designation plus its `CraftOrder`, starting `"awaiting-materials"`. Throws if `workshopId` isn't a live workshop, `recipeId` doesn't name a real recipe, or the recipe isn't runnable at that workshop's `workshopKind`. */
export function designateCraft(world: World, recipes: RecipeRegistry, workshopId: EntityId, recipeId: string): EntityId {
  const workshop = getWorkshop(world.components, workshopId);
  if (workshop === undefined) throw new RangeError(`entity ${workshopId} has no Workshop component -- cannot designate a craft order`);
  const recipe = recipes.get(recipeId);
  if (recipe.workshopKind !== workshop.workshopKind) {
    throw new RangeError(`recipe "${recipeId}" requires workshop kind "${recipe.workshopKind}", but workshop ${workshopId} is "${workshop.workshopKind}"`);
  }
  const designationId = createDesignation(world, "craft", workshop.site);
  const craftOrderId = world.entities.create("craft-order");
  setCraftOrder(world.components, craftOrderId, {
    designationId,
    workshopId,
    recipeId,
    site: workshop.site,
    workDone: 0,
    status: "awaiting-materials",
  });
  return craftOrderId;
}

/** Mirrors `Construction.ts`'s `ensureMaterialHaul` -- designates one more ordinary haul of the recipe's input material toward the workshop's site, if more is still needed and something's available. */
export function ensureCraftMaterialHaul(world: World, recipes: RecipeRegistry, craftOrderId: EntityId): EntityId | undefined {
  const order = getCraftOrder(world.components, craftOrderId);
  if (order === undefined || order.status !== "awaiting-materials") return undefined;
  const recipe = recipes.get(order.recipeId);
  claimDeliveredMaterial(world.entities, world.components, world.grid, recipe, order.site, craftOrderId);
  const delivered = deliveredMassAtSite(world.entities, world.components, world.grid, recipe, order.site, craftOrderId);
  if (delivered >= recipe.inputMassKg - MASS_EPSILON_KG) return undefined;
  const source = findAvailableInputMaterial(world.entities, world.components, world.grid, recipe.inputMaterialId, order.site);
  if (source === undefined) return undefined;
  const haulDesignationId = designateHaul(world, source, order.site);
  const [haulJobId] = generateHaulJob(world, haulDesignationId);
  return haulJobId;
}

/** Mirrors `Construction.ts`'s `checkMaterialsDelivered`. */
export function checkCraftMaterialsDelivered(world: World, recipes: RecipeRegistry, craftOrderId: EntityId): boolean {
  const order = getCraftOrder(world.components, craftOrderId);
  if (order === undefined || order.status !== "awaiting-materials") return false;
  const recipe = recipes.get(order.recipeId);
  claimDeliveredMaterial(world.entities, world.components, world.grid, recipe, order.site, craftOrderId);
  const delivered = deliveredMassAtSite(world.entities, world.components, world.grid, recipe, order.site, craftOrderId);
  if (delivered < recipe.inputMassKg - MASS_EPSILON_KG) return false;
  setCraftOrder(world.components, craftOrderId, { ...order, status: "awaiting-labor" });
  return true;
}

export interface CraftProgress {
  craftOrderId: EntityId;
}
export const CraftProgressComponent: ComponentType<CraftProgress> = defineComponent<CraftProgress>("craft-progress");

export function setCraftProgress(components: ComponentStore, id: EntityId, progress: CraftProgress): void {
  if (!Number.isInteger(progress.craftOrderId) || progress.craftOrderId < 1) {
    throw new RangeError(`craft progress craftOrderId must be a positive integer, got ${progress.craftOrderId}`);
  }
  components.set(id, CraftProgressComponent, progress);
}

export function getCraftProgress(components: ComponentStore, id: EntityId): CraftProgress | undefined {
  return components.get(id, CraftProgressComponent);
}

/** Expands an `"awaiting-labor"` craft order into its one job instance. */
export function generateCraftJob(world: World, craftOrderId: EntityId): EntityId[] {
  const order = getCraftOrder(world.components, craftOrderId);
  if (order === undefined || order.status !== "awaiting-labor") {
    throw new RangeError(`craft order ${craftOrderId} is not awaiting labor -- cannot generate a craft job for it`);
  }
  const jobId = world.entities.create("job");
  setJob(world.components, jobId, { designationId: order.designationId, target: order.site, status: "unclaimed" });
  setCraftProgress(world.components, jobId, { craftOrderId });
  return [jobId];
}

export function isEligibleForCraft(entities: EntityIdRegistry, components: ComponentStore, beaverId: EntityId, jobId: EntityId): boolean {
  if (!isEligible(entities, components, beaverId, jobId)) return false;
  const progress = getCraftProgress(components, jobId);
  if (progress === undefined) return false;
  const order = getCraftOrder(components, progress.craftOrderId);
  if (order === undefined || order.status !== "awaiting-labor") return false;
  // P11-09: technological knowledge is culture -- a beaver whose
  // household does not genuinely know the recipe is not eligible for the
  // job, even with the materials in hand. (A beaver with no household
  // membership uses its own knowledge -- there is no social group to
  // gate, so the old behavior stands for unhouseholded workers.)
  const membership = getHouseholdMembership(components, beaverId);
  if (membership !== undefined) {
    const householdId = membership.householdId;
    if (!householdKnowsRecipe(components, householdId, order.recipeId)) return false;
  }
  return true;
}

/**
 * Does `householdId` genuinely know `recipeId`? Reads the beaver's own
 * components store (not the world -- `isEligibleForCraft` is called from
 * both the colony loop and bare dependency contexts). A household with
 * no tech-knowledge entity knows nothing.
 */
export function householdKnowsRecipe(components: ComponentStore, householdId: EntityId, recipeId: string): boolean {
  const allIds = components.query(TechKnowledgeComponent);
  for (const knowledgeId of allIds) {
    const knowledge = components.get(knowledgeId, TechKnowledgeComponent);
    if (knowledge !== undefined && knowledge.heldByHouseholdIds.includes(householdId) && knowledge.recipeIds.includes(recipeId)) {
      return true;
    }
  }
  return false;
}

function assembleCraftOrder(materials: MaterialRegistry, entities: EntityIdRegistry, components: ComponentStore, grid: WorldGrid, recipe: RecipeDefinition, order: CraftOrder, craftOrderId: EntityId, beaverId: EntityId): boolean {
  const floor = grid.surfaceY(order.site.x, order.site.z)!;
  const toConsume: EntityId[] = [];
  let consumedMassKg = 0;
  for (const id of craftInputKindsAt(entities, order.site.x, floor + 1, order.site.z, grid)) {
    const material = materialIdAndMassOf(components, id);
    if (material === undefined || material.materialId !== recipe.inputMaterialId) continue;
    const reservation = getReservation(components, id);
    if (reservation === undefined || reservation.by !== craftOrderId) continue;
    toConsume.push(id);
    consumedMassKg += material.massKg;
  }
  if (consumedMassKg < recipe.inputMassKg - MASS_EPSILON_KG) return false;
  for (const id of toConsume) entities.destroy(id);

  const outputId = entities.create("good");
  grid.setEntityPosition(outputId, order.site.x, floor + 1, order.site.z);
  const quality = qualityOf(materials, components, beaverId, recipe);
  setGood(components, outputId, {
    goodKind: recipe.outputGoodKind,
    materialId: recipe.outputMaterialId ?? recipe.inputMaterialId,
    massKg: recipe.outputMassKg,
    quality,
    makerId: beaverId,
    value: recipe.outputMassKg * (0.5 + quality) * VALUE_PER_KG,
  });

  setCraftOrder(components, craftOrderId, { ...order, status: "complete" });
  return true;
}

/**
 * P3-17's quality formula: worker skill, material, and process each
 * contribute one factor, combined as their geometric mean into a single
 * [0,1] score. Each factor is a formula over real inputs
 * (ARCHITECTURE_CONTRACT §7 discipline, same as `Material.ts`'s own
 * behavior functions), not a scripted per-recipe quality table:
 *
 * - skill: `level / (level + 10)` -- the worker's real P2-03 skill level
 *   for the recipe's own `skillName`, asymptotic toward 1;
 * - material: `hardness / (hardness + 4)` -- the output material's real
 *   `MaterialProperties.hardness` (P0-07), so a harder material yields a
 *   higher-quality item through the SAME rule regardless of which
 *   material it is, never a per-material-name table;
 * - process: `workRequired / (workRequired + 10)` -- the recipe's own
 *   process definition (a longer, more careful process yields better
 *   work through the same rule every recipe shares).
 *
 * The geometric mean makes every input load-bearing: quality is 0
 * whenever ANY input is 0 (an unskilled worker, an impossible material,
 * or a zero-effort process cannot produce quality), and no input alone
 * can reach 1.
 */
export function qualityOf(materials: MaterialRegistry, components: ComponentStore, beaverId: EntityId, recipe: RecipeDefinition): number {
  const level = skillLevel(components, beaverId, recipe.skillName);
  const skillFactor = clamp01(level / (level + 10));
  const materialId = recipe.outputMaterialId ?? recipe.inputMaterialId;
  const hardness = materials.get(materialId).hardness;
  const materialFactor = clamp01(hardness / (hardness + 4));
  const processFactor = clamp01(recipe.workRequired / (recipe.workRequired + 10));
  // P11-04: the worker's OWN chemistry scales the skill check -- a drunk
  // beaver's craft genuinely suffers (cognitive performance through
  // metabolism, not an event).
  return clamp01(Math.cbrt(skillFactor * materialFactor * processFactor) * cognitiveFactor(components, beaverId));
}

/** P3-18's provenance value formula -- a plausible, tunable coefficient over real mass and derived quality, not a fixed price table. */
export const VALUE_PER_KG = 5;

export const CRAFT_WORK_PER_TICK = 1;
export const CRAFT_SKILL_WORK_BONUS = 0.1;

export type CraftStepOutcome = "assigned" | "traveling" | "working" | "crafted" | "requeued" | "failed" | "idle";

/** Mirrors `Construction.ts`'s `tickBuildJob` almost exactly -- reserve/travel/work/complete, generalized over a `RecipeDefinition` instead of a hardcoded per-kind table, and applying a held tool's efficiency multiplier (P3-06) to work-rate the same way skill already does. */
export function tickCraftJob(
  grid: WorldGrid,
  terrain: TerrainField,
  water: WaterField,
  materials: MaterialRegistry,
  recipes: RecipeRegistry,
  entities: EntityIdRegistry,
  components: ComponentStore,
  beaverId: EntityId,
  profile: NavigationProfile,
  candidateJobIds: readonly EntityId[],
): CraftStepOutcome {
  let jobId = currentJobOf(entities, components, beaverId);
  let freshlyAssigned = false;

  if (jobId === undefined) {
    const eligible = candidateJobIds.filter((id) => isEligibleForCraft(entities, components, beaverId, id));
    const chosen = selectJob(entities, components, grid, terrain, water, materials, profile, beaverId, eligible);
    if (chosen === undefined) return "idle";
    reserveJob(components, entities, chosen, beaverId);
    jobId = chosen;
    freshlyAssigned = true;
  }

  const job = getJob(components, jobId)!;
  const progress = getCraftProgress(components, jobId)!;
  const order = getCraftOrder(components, progress.craftOrderId);

  if (order === undefined || order.status !== "awaiting-labor") {
    setJob(components, jobId, { designationId: job.designationId, target: job.target, status: "failed" });
    return "failed";
  }
  const recipe = recipes.get(order.recipeId);

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

  const currentSkillLevel = skillLevel(components, beaverId, recipe.skillName);
  const toolMultiplier = toolWorkMultiplier(materials, components, beaverId, recipe.skillName);
  const powerMultiplier = workshopPowerMultiplier(entities, components, water, order.workshopId);
  // P11-04: real work-rate is motor performance -- the worker's own
  // blood chemistry scales how much work happens this tick (drunk
  // beavers work slower, through metabolism, not an event).
  const workThisTick = CRAFT_WORK_PER_TICK * (1 + currentSkillLevel * CRAFT_SKILL_WORK_BONUS) * toolMultiplier * powerMultiplier * motorFactor(components, beaverId);
  const workDone = Math.min(recipe.workRequired, order.workDone + workThisTick);
  const workDelta = workDone - order.workDone;

  if (workDone >= recipe.workRequired) {
    setCraftOrder(components, progress.craftOrderId, { ...order, workDone });
    if (!assembleCraftOrder(materials, entities, components, grid, recipe, { ...order, workDone }, progress.craftOrderId, beaverId)) {
      setCraftOrder(components, progress.craftOrderId, order);
      setJob(components, jobId, { designationId: job.designationId, target: job.target, status: "failed" });
      return "failed";
    }
    practiceSkill(components, beaverId, recipe.skillName, workDelta);
    completeJob(entities, components, jobId, beaverId);
    return "crafted";
  }

  setCraftOrder(components, progress.craftOrderId, { ...order, workDone });
  practiceSkill(components, beaverId, recipe.skillName, workDelta);
  setJob(components, jobId, { designationId: job.designationId, target: job.target, status: "in-progress", reservedBy: beaverId });
  return "working";
}

/** Mirrors `Construction.ts`'s `cancelConstruction`: marks the order/designation cancelled, fails every live job referencing it, releases (but never destroys) any claimed input material. */
export function cancelCraftOrder(entities: EntityIdRegistry, components: ComponentStore, grid: WorldGrid, craftOrderId: EntityId): void {
  const order = getCraftOrder(components, craftOrderId);
  if (order === undefined) throw new RangeError(`entity ${craftOrderId} has no CraftOrder component -- cannot cancel it`);
  if (order.status === "complete" || order.status === "cancelled") return;
  setCraftOrder(components, craftOrderId, { ...order, status: "cancelled" });

  const designation = getDesignation(components, order.designationId)!;
  setDesignation(components, order.designationId, { ...designation, status: "cancelled" });

  for (const jobId of entities.liveIdsOfKind("job")) {
    const job = getJob(components, jobId)!;
    if (job.designationId !== order.designationId) continue;
    if (job.status === "completed" || job.status === "failed") continue;
    setJob(components, jobId, { designationId: job.designationId, target: job.target, status: "failed" });
  }

  const floor = grid.surfaceY(order.site.x, order.site.z);
  if (floor !== undefined) {
    for (const id of craftInputKindsAt(entities, order.site.x, floor + 1, order.site.z, grid)) {
      const reservation = getReservation(components, id);
      if (reservation !== undefined && reservation.by === craftOrderId) clearReservation(components, id);
    }
  }
}

