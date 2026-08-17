import { ComponentStore, defineComponent, type ComponentType } from "../core/ComponentStore.js";
import type { EntityId } from "../core/EntityId.js";
import type { ColumnCoordinate } from "../hydrology/WaterField.js";
import { designateHaul, generateHaulJob } from "../labor/Hauling.js";
import { getHeld, getLog, getReservation } from "../labor/Log.js";
import type { MaterialDefinition, MaterialId, MaterialRegistry } from "../materials/Material.js";
import type { World } from "../persistence/WorldSnapshot.js";
import { getDesignation } from "../jobs/Designation.js";
import { getFood } from "../labor/Food.js";
import { getRefuse } from "./Refuse.js";

/**
 * P2-01's storage policy is deliberately a rule over real material
 * properties and real item locations, not a hidden inventory counter.
 * P2-07 extends the material-bearing haulable set from logs to food
 * items; P2-09 extends it again to refuse. Both still use the existing
 * `haul-item` designation/job pipeline unchanged: this file decides that
 * an item SHOULD be stored, then creates the same ordinary haul
 * designation a player could have created by hand.
 */
export type MaterialCategory = "organic" | "inorganic";

export interface StockpilePolicy {
  /**
   * Positive allow rules. If both allow lists are empty, every material-
   * bearing haulable item is allowed unless a forbid rule rejects it.
   */
  allowedMaterialCategories: readonly MaterialCategory[];
  allowedMaterialIds: readonly MaterialId[];
  /** Negative rules always win over positive rules. */
  forbiddenMaterialCategories: readonly MaterialCategory[];
  forbiddenMaterialIds: readonly MaterialId[];
}

export interface Stockpile {
  cells: readonly ColumnCoordinate[];
  policy: StockpilePolicy;
  status: "active" | "disabled";
}
export const StockpileComponent: ComponentType<Stockpile> = defineComponent<Stockpile>("stockpile");

export interface StockpileDebugState {
  stockpileId: EntityId;
  status: Stockpile["status"];
  cells: ColumnCoordinate[];
  policy: StockpilePolicy;
  storedItemIds: EntityId[];
  pendingHaulItemIds: EntityId[];
}

const VALID_MATERIAL_CATEGORIES: readonly MaterialCategory[] = ["organic", "inorganic"];

const MATERIAL_ID_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

function expectArray<T>(values: readonly T[], label: string): readonly T[] {
  if (!Array.isArray(values)) throw new RangeError(`${label} must be an array`);
  return values;
}

function uniqueSorted<T extends string>(values: readonly T[], label: string, valid?: readonly T[]): T[] {
  const out = new Set<T>();
  for (const value of expectArray(values, label)) {
    if (value.trim().length === 0) throw new RangeError(`${label} entries must be non-empty strings`);
    if (valid !== undefined && !valid.includes(value)) {
      throw new RangeError(`${label} must contain only ${valid.join(", ")}, got ${JSON.stringify(value)}`);
    }
    if (valid === undefined && !MATERIAL_ID_PATTERN.test(value)) {
      throw new RangeError(`${label} entries must be lowercase kebab-case material ids, got ${JSON.stringify(value)}`);
    }
    out.add(value);
  }
  return [...out].sort();
}

function normalizePolicy(policy: StockpilePolicy): StockpilePolicy {
  if (policy === null || typeof policy !== "object") throw new RangeError("stockpile policy must be an object");
  return {
    allowedMaterialCategories: uniqueSorted(policy.allowedMaterialCategories, "allowedMaterialCategories", VALID_MATERIAL_CATEGORIES),
    allowedMaterialIds: uniqueSorted(policy.allowedMaterialIds, "allowedMaterialIds"),
    forbiddenMaterialCategories: uniqueSorted(policy.forbiddenMaterialCategories, "forbiddenMaterialCategories", VALID_MATERIAL_CATEGORIES),
    forbiddenMaterialIds: uniqueSorted(policy.forbiddenMaterialIds, "forbiddenMaterialIds"),
  };
}

function normalizeCells(cells: readonly ColumnCoordinate[]): ColumnCoordinate[] {
  if (!Array.isArray(cells)) throw new RangeError("stockpile cells must be an array");
  if (cells.length === 0) throw new RangeError("stockpile must contain at least one cell");
  const seen = new Set<string>();
  const out: ColumnCoordinate[] = [];
  for (const cell of cells) {
    if (!Number.isInteger(cell.x) || !Number.isInteger(cell.z)) {
      throw new RangeError(`stockpile cell coordinates must be integers, got ${JSON.stringify(cell)}`);
    }
    const key = `${cell.x},${cell.z}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ x: cell.x, z: cell.z });
  }
  return out.sort((a, b) => a.x - b.x || a.z - b.z);
}

export function assertValidStockpile(stockpile: Stockpile): void {
  normalizeCells(stockpile.cells);
  normalizePolicy(stockpile.policy);
  if (stockpile.status !== "active" && stockpile.status !== "disabled") {
    throw new RangeError(`stockpile status must be "active" or "disabled", got ${JSON.stringify(stockpile.status)}`);
  }
}

export function setStockpile(components: ComponentStore, id: EntityId, stockpile: Stockpile): void {
  const normalized: Stockpile = {
    cells: normalizeCells(stockpile.cells),
    policy: normalizePolicy(stockpile.policy),
    status: stockpile.status,
  };
  assertValidStockpile(normalized);
  components.set(id, StockpileComponent, normalized);
}

export function getStockpile(components: ComponentStore, id: EntityId): Stockpile | undefined {
  const stockpile = components.get(id, StockpileComponent);
  if (stockpile !== undefined) assertValidStockpile(stockpile);
  return stockpile;
}

export function materialCategoriesOf(material: MaterialDefinition): MaterialCategory[] {
  return [material.organic ? "organic" : "inorganic"];
}

export function stockpileAcceptsMaterial(policy: StockpilePolicy, material: MaterialDefinition): boolean {
  const normalized = normalizePolicy(policy);
  const categories = materialCategoriesOf(material);
  if (normalized.forbiddenMaterialIds.includes(material.id)) return false;
  if (categories.some((category) => normalized.forbiddenMaterialCategories.includes(category))) return false;
  const hasPositiveRule = normalized.allowedMaterialIds.length > 0 || normalized.allowedMaterialCategories.length > 0;
  if (!hasPositiveRule) return true;
  return normalized.allowedMaterialIds.includes(material.id) || categories.some((category) => normalized.allowedMaterialCategories.includes(category));
}

export function createStockpile(world: World, cells: readonly ColumnCoordinate[], policy: StockpilePolicy): EntityId {
  const normalizedCells = normalizeCells(cells);
  for (const cell of normalizedCells) {
    if (world.grid.surfaceY(cell.x, cell.z) === undefined) {
      throw new RangeError(`stockpile cell (${cell.x}, ${cell.z}) has no real ground`);
    }
  }
  const id = world.entities.create("stockpile");
  setStockpile(world.components, id, { cells: normalizedCells, policy, status: "active" });
  return id;
}

export function setStockpilePolicy(components: ComponentStore, stockpileId: EntityId, policy: StockpilePolicy): void {
  const stockpile = getStockpile(components, stockpileId);
  if (stockpile === undefined) throw new RangeError(`entity ${stockpileId} has no Stockpile component`);
  setStockpile(components, stockpileId, { ...stockpile, policy });
}

function cellKey(cell: ColumnCoordinate): string {
  return `${cell.x},${cell.z}`;
}

function stockpileContainsColumn(stockpile: Stockpile, column: ColumnCoordinate): boolean {
  const keys = new Set(stockpile.cells.map(cellKey));
  return keys.has(cellKey(column));
}

function manhattan(a: ColumnCoordinate, b: ColumnCoordinate): number {
  return Math.abs(a.x - b.x) + Math.abs(a.z - b.z);
}

function chooseStorageCell(stockpile: Stockpile, itemColumn: ColumnCoordinate): ColumnCoordinate {
  return [...stockpile.cells].sort((a, b) => manhattan(a, itemColumn) - manhattan(b, itemColumn) || a.x - b.x || a.z - b.z)[0]!;
}

function itemColumn(world: World, itemId: EntityId): ColumnCoordinate | undefined {
  const position = world.grid.positionOf(itemId);
  return position === undefined ? undefined : { x: position.x, z: position.z };
}

function materialIdOfHaulableItem(world: World, itemId: EntityId): MaterialId | undefined {
  return getLog(world.components, itemId)?.materialId ?? getFood(world.components, itemId)?.materialId ?? getRefuse(world.components, itemId)?.materialId;
}

function liveHaulableItemIds(world: World): EntityId[] {
  return [...world.entities.liveIdsOfKind("log"), ...world.entities.liveIdsOfKind("food"), ...world.entities.liveIdsOfKind("refuse")].sort((a, b) => a - b);
}

function hasActiveHaulDesignation(world: World, itemId: EntityId): boolean {
  for (const designationId of world.entities.liveIdsOfKind("designation")) {
    const designation = getDesignation(world.components, designationId);
    if (designation === undefined) continue;
    if (designation.kind === "haul-item" && designation.status === "active" && designation.targetEntity === itemId) return true;
  }
  return false;
}

function isFreeToStockpile(world: World, itemId: EntityId): boolean {
  if (getHeld(world.components, itemId) !== undefined) return false;
  const reservation = getReservation(world.components, itemId);
  if (reservation !== undefined && world.entities.isLive(reservation.by)) return false;
  return itemColumn(world, itemId) !== undefined;
}

export function stockpileAcceptsItem(world: World, materials: MaterialRegistry, stockpileId: EntityId, itemId: EntityId): boolean {
  const stockpile = getStockpile(world.components, stockpileId);
  if (stockpile === undefined || stockpile.status !== "active") return false;
  const materialId = materialIdOfHaulableItem(world, itemId);
  if (materialId === undefined) return false;
  return stockpileAcceptsMaterial(stockpile.policy, materials.get(materialId));
}

function isStoredInAnyAcceptingStockpile(world: World, materials: MaterialRegistry, itemId: EntityId): boolean {
  const column = itemColumn(world, itemId);
  if (column === undefined) return false;
  for (const stockpileId of world.entities.liveIdsOfKind("stockpile")) {
    const stockpile = getStockpile(world.components, stockpileId);
    if (stockpile === undefined || stockpile.status !== "active") continue;
    if (stockpileContainsColumn(stockpile, column) && stockpileAcceptsItem(world, materials, stockpileId, itemId)) return true;
  }
  return false;
}

export function storedItemIds(world: World, materials: MaterialRegistry, stockpileId: EntityId): EntityId[] {
  const stockpile = getStockpile(world.components, stockpileId);
  if (stockpile === undefined) return [];
  return liveHaulableItemIds(world)
    .filter((itemId) => {
      const column = itemColumn(world, itemId);
      return column !== undefined && stockpileContainsColumn(stockpile, column) && stockpileAcceptsItem(world, materials, stockpileId, itemId);
    })
    .sort((a, b) => a - b);
}

/**
 * Scans live storage policy and emits ordinary P1-09 haul jobs for every
 * free, accepted material-bearing item not already stored. This is the
 * "automatic" part of P2-01: no worker is assigned and no item is moved
 * here; the resulting jobs still go through `JobBoard` selection,
 * `Reservation`, pathfinding, pickup, carry, and drop exactly like any
 * player-authored haul.
 */
export function generateStockpileHaulJobs(world: World, materials: MaterialRegistry, stockpileId: EntityId): EntityId[] {
  const stockpile = getStockpile(world.components, stockpileId);
  if (stockpile === undefined || stockpile.status !== "active") return [];

  const generated: EntityId[] = [];
  for (const itemId of liveHaulableItemIds(world)) {
    if (!stockpileAcceptsItem(world, materials, stockpileId, itemId)) continue;
    if (!isFreeToStockpile(world, itemId)) continue;
    if (isStoredInAnyAcceptingStockpile(world, materials, itemId)) continue;
    if (hasActiveHaulDesignation(world, itemId)) continue;
    const column = itemColumn(world, itemId)!;
    const haulDesignationId = designateHaul(world, itemId, chooseStorageCell(stockpile, column));
    const [jobId] = generateHaulJob(world, haulDesignationId);
    generated.push(jobId!);
  }
  return generated;
}

export function getStockpileDebugState(world: World, materials: MaterialRegistry, stockpileId: EntityId): StockpileDebugState {
  const stockpile = getStockpile(world.components, stockpileId);
  if (stockpile === undefined) throw new RangeError(`entity ${stockpileId} has no Stockpile component`);
  const pendingHaulItemIds: EntityId[] = [];
  for (const designationId of world.entities.liveIdsOfKind("designation")) {
    const designation = getDesignation(world.components, designationId);
    if (designation?.kind !== "haul-item" || designation.status !== "active" || designation.targetEntity === undefined) continue;
    if (stockpileContainsColumn(stockpile, designation.target)) pendingHaulItemIds.push(designation.targetEntity);
  }
  return {
    stockpileId,
    status: stockpile.status,
    cells: [...stockpile.cells],
    policy: stockpile.policy,
    storedItemIds: storedItemIds(world, materials, stockpileId),
    pendingHaulItemIds: pendingHaulItemIds.sort((a, b) => a - b),
  };
}
