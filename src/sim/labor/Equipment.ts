import { ComponentStore, defineComponent, type ComponentType } from "../core/ComponentStore.js";
import type { EntityId } from "../core/EntityId.js";
import type { CellCoordinate } from "../world/WorldGrid.js";
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
 */
export interface Tool {
  toolKind: string;
  laborKinds: readonly string[];
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
}

export function setTool(components: ComponentStore, itemId: EntityId, tool: Tool): void {
  assertValidTool(tool);
  components.set(itemId, ToolComponent, {
    toolKind: tool.toolKind,
    laborKinds: uniqueSortedKinds(tool.laborKinds, "tool laborKinds"),
  });
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
