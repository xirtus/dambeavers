import { ComponentStore, defineComponent, type ComponentType } from "../core/ComponentStore.js";
import type { EntityId } from "../core/EntityId.js";
import type { CellCoordinate } from "../world/WorldGrid.js";
import type { MaterialId, MaterialRegistry } from "../materials/Material.js";
import type { World } from "../persistence/WorldSnapshot.js";
import { assertValidSkillName } from "../creatures/Beaver.js";
import { getInventory } from "../creatures/Beaver.js";
import { getHeld } from "./Log.js";

/**
 * P2-04's minimal equipment model: tools are ordinary persistent item
 * entities, physically on the map or held through P1-09's existing
 * `Held`/`Inventory` relation. This file owns tool identity/capability
 * metadata only; pickup/drop, reservation, and item location remain the
 * generic item mechanisms that already exist.
 *
 * `materialId`/`quality` (P3-06) are optional: a tool with neither is a
 * capability-only gate (P2-04's original contract, unchanged) with a
 * neutral 1x work multiplier. A tool WITH them lets `toolWorkMultiplier`
 * (below) derive real efficiency from the tool's own physical material
 * hardness (a formula over `MaterialProperties`, ARCHITECTURE_CONTRACT
 * §7 -- never a hardcoded per-material-name table) and crafted quality.
 */
export interface Tool {
  toolKind: string;
  laborKinds: readonly string[];
  materialId?: MaterialId;
  quality?: number;
}
export const ToolComponent: ComponentType<Tool> = defineComponent<Tool>("tool");

export interface RequiredTool {
  toolKind: string;
}
export const RequiredToolComponent: ComponentType<RequiredTool> = defineComponent<RequiredTool>("required-tool");

function uniqueSortedKinds(kinds: readonly string[], label: string): string[] {
  if (!Array.isArray(kinds)) throw new RangeError(`${label} must be an array`);
  const out = new Set<string>();
  for (const kind of kinds) {
    assertValidSkillName(kind, label);
    out.add(kind);
  }
  return [...out].sort();
}

export function assertValidTool(tool: Tool): void {
  if (tool === null || typeof tool !== "object") throw new RangeError("tool must be an object");
  assertValidSkillName(tool.toolKind, "tool kind");
  uniqueSortedKinds(tool.laborKinds, "tool laborKinds");
  if (tool.materialId !== undefined && tool.materialId.trim().length === 0) {
    throw new RangeError("tool materialId must be non-empty when present");
  }
  if (tool.quality !== undefined && !(Number.isFinite(tool.quality) && tool.quality >= 0 && tool.quality <= 1)) {
    throw new RangeError(`tool quality must be between 0 and 1 when present, got ${tool.quality}`);
  }
}

export function setTool(components: ComponentStore, itemId: EntityId, tool: Tool): void {
  assertValidTool(tool);
  const normalized: Tool = { toolKind: tool.toolKind, laborKinds: uniqueSortedKinds(tool.laborKinds, "tool laborKinds") };
  if (tool.materialId !== undefined) normalized.materialId = tool.materialId;
  if (tool.quality !== undefined) normalized.quality = tool.quality;
  components.set(itemId, ToolComponent, normalized);
}

export function getTool(components: ComponentStore, itemId: EntityId): Tool | undefined {
  const tool = components.get(itemId, ToolComponent);
  if (tool !== undefined) assertValidTool(tool);
  return tool;
}

export function assertValidRequiredTool(required: RequiredTool): void {
  if (required === null || typeof required !== "object") throw new RangeError("required tool must be an object");
  assertValidSkillName(required.toolKind, "required tool kind");
}

export function setRequiredTool(components: ComponentStore, jobId: EntityId, required: RequiredTool): void {
  assertValidRequiredTool(required);
  components.set(jobId, RequiredToolComponent, required);
}

export function getRequiredTool(components: ComponentStore, jobId: EntityId): RequiredTool | undefined {
  const required = components.get(jobId, RequiredToolComponent);
  if (required !== undefined) assertValidRequiredTool(required);
  return required;
}

export function createTool(world: World, tool: Tool, position: CellCoordinate): EntityId {
  const toolId = world.entities.create("tool");
  world.grid.setEntityPosition(toolId, position.x, position.y, position.z);
  setTool(world.components, toolId, tool);
  return toolId;
}

export function heldToolIdsForLabor(components: ComponentStore, beaverId: EntityId, laborKind: string): EntityId[] {
  assertValidSkillName(laborKind, "labor kind");
  const inventory = getInventory(components, beaverId);
  if (inventory === undefined) return [];
  return inventory.itemIds
    .filter((itemId) => getHeld(components, itemId)?.by === beaverId)
    .filter((itemId) => {
      const tool = getTool(components, itemId);
      return tool !== undefined && tool.laborKinds.includes(laborKind);
    })
    .sort((a, b) => a - b);
}

export function hasHeldToolKindForLabor(components: ComponentStore, beaverId: EntityId, laborKind: string, toolKind: string): boolean {
  assertValidSkillName(toolKind, "tool kind");
  return heldToolIdsForLabor(components, beaverId, laborKind).some((itemId) => getTool(components, itemId)!.toolKind === toolKind);
}

export function hasRequiredToolForJob(components: ComponentStore, beaverId: EntityId, jobId: EntityId, laborKind: string): boolean {
  const required = getRequiredTool(components, jobId);
  return required === undefined || hasHeldToolKindForLabor(components, beaverId, laborKind, required.toolKind);
}

/**
 * P3-06: the work-rate multiplier a beaver's best-held tool for
 * `laborKind` grants, >= 1 (a bare-handed beaver, or one holding a tool
 * with no `materialId`/`quality`, gets a neutral `1`). Derived from the
 * tool material's real `hardness` (ARCHITECTURE_CONTRACT §7 -- a formula
 * over `MaterialProperties`, never a per-material-name table) and the
 * tool's own crafted `quality` (P3-17): a harder, better-made tool works
 * measurably faster, capped so no tool can ever be worse than working
 * bare-handed. When a beaver holds several qualifying tools, the single
 * best multiplier wins.
 */
export function toolWorkMultiplier(materials: MaterialRegistry, components: ComponentStore, beaverId: EntityId, laborKind: string): number {
  let best = 1;
  for (const itemId of heldToolIdsForLabor(components, beaverId, laborKind)) {
    const tool = getTool(components, itemId)!;
    if (tool.materialId === undefined || !materials.has(tool.materialId)) continue;
    const hardness = materials.get(tool.materialId).hardness;
    const quality = tool.quality ?? 0.5;
    const multiplier = 1 + hardness * 0.1 * (0.5 + quality);
    if (multiplier > best) best = multiplier;
  }
  return best;
}
