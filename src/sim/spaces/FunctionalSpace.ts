import { ComponentStore, defineComponent, type ComponentType } from "../core/ComponentStore.js";
import type { EntityId } from "../core/EntityId.js";
import type { ColumnCoordinate } from "../hydrology/WaterField.js";
import type { World } from "../persistence/WorldSnapshot.js";
import { getConstruction, type ConstructionKind } from "../labor/Construction.js";

/**
 * P2-05's first room/zone layer. A zone is a player/system-defined set of
 * ground columns; room recognition is derived fresh from live completed
 * construction geometry around and inside that zone. This does not create
 * a parallel building model: P1-10 `Construction` remains the source of
 * built contents and wall boundary state.
 */
export type ZoneDeclaredFunction = "general-zone" | "work-yard";
export type RecognizedSpaceFunction = ZoneDeclaredFunction | "empty-room" | "lodge-room";

export interface Zone {
  cells: readonly ColumnCoordinate[];
  declaredFunction: ZoneDeclaredFunction;
}
export const ZoneComponent: ComponentType<Zone> = defineComponent<Zone>("zone");

const ZONE_FUNCTIONS: readonly ZoneDeclaredFunction[] = ["general-zone", "work-yard"];

function coordKey(cell: ColumnCoordinate): string {
  return `${cell.x},${cell.z}`;
}

function assertColumn(cell: unknown, label: string): asserts cell is ColumnCoordinate {
  if (cell === null || typeof cell !== "object") {
    throw new RangeError(`${label} must have integer coordinates, got ${JSON.stringify(cell)}`);
  }
  const candidate = cell as Partial<ColumnCoordinate>;
  if (!Number.isInteger(candidate.x) || !Number.isInteger(candidate.z)) {
    throw new RangeError(`${label} must have integer coordinates, got ${JSON.stringify(cell)}`);
  }
}

function normalizeCells(cells: readonly ColumnCoordinate[]): ColumnCoordinate[] {
  if (!Array.isArray(cells)) throw new RangeError("zone cells must be an array");
  const byKey = new Map<string, ColumnCoordinate>();
  for (const cell of cells) {
    assertColumn(cell, "zone cell");
    byKey.set(coordKey(cell), { x: cell.x, z: cell.z });
  }
  if (byKey.size === 0) throw new RangeError("zone must contain at least one cell");
  return [...byKey.values()].sort((a, b) => a.x - b.x || a.z - b.z);
}

export function assertValidZone(zone: Zone): void {
  if (zone === null || typeof zone !== "object") throw new RangeError("zone must be an object");
  if (!ZONE_FUNCTIONS.includes(zone.declaredFunction)) {
    throw new RangeError(`zone declaredFunction must be one of ${ZONE_FUNCTIONS.join(", ")}, got ${JSON.stringify(zone.declaredFunction)}`);
  }
  normalizeCells(zone.cells);
}

function assertCellsHaveRealGround(world: World, cells: readonly ColumnCoordinate[]): void {
  for (const cell of cells) {
    if (world.grid.surfaceY(cell.x, cell.z) === undefined) {
      throw new RangeError(`zone cell (${cell.x}, ${cell.z}) must reference a real ground column`);
    }
  }
}

export function setZone(components: ComponentStore, zoneId: EntityId, zone: Zone): void {
  assertValidZone(zone);
  components.set(zoneId, ZoneComponent, {
    cells: normalizeCells(zone.cells),
    declaredFunction: zone.declaredFunction,
  });
}

export function getZone(components: ComponentStore, zoneId: EntityId): Zone | undefined {
  const zone = components.get(zoneId, ZoneComponent);
  if (zone !== undefined) assertValidZone(zone);
  return zone;
}

export function createZone(world: World, zone: Zone): EntityId {
  assertValidZone(zone);
  const cells = normalizeCells(zone.cells);
  assertCellsHaveRealGround(world, cells);
  const zoneId = world.entities.create("zone");
  setZone(world.components, zoneId, { cells, declaredFunction: zone.declaredFunction });
  return zoneId;
}

function completedConstructionAt(world: World, cell: ColumnCoordinate, kind?: ConstructionKind): EntityId | undefined {
  for (const id of world.entities.liveIdsOfKind("construction")) {
    const construction = getConstruction(world.components, id);
    if (construction === undefined || construction.status !== "complete") continue;
    if (kind !== undefined && construction.kind !== kind) continue;
    if (construction.site.x === cell.x && construction.site.z === cell.z) return id;
  }
  return undefined;
}

function completedContents(world: World, cells: readonly ColumnCoordinate[]): EntityId[] {
  const cellKeys = new Set(cells.map(coordKey));
  return world.entities
    .liveIdsOfKind("construction")
    .filter((id) => {
      const construction = getConstruction(world.components, id);
      return construction !== undefined && construction.status === "complete" && cellKeys.has(coordKey(construction.site));
    })
    .sort((a, b) => a - b);
}

function requiredBoundaryColumns(cells: readonly ColumnCoordinate[]): ColumnCoordinate[] {
  const inside = new Set(cells.map(coordKey));
  const out = new Map<string, ColumnCoordinate>();
  for (const cell of cells) {
    for (const neighbor of [
      { x: cell.x - 1, z: cell.z },
      { x: cell.x + 1, z: cell.z },
      { x: cell.x, z: cell.z - 1 },
      { x: cell.x, z: cell.z + 1 },
    ]) {
      if (!inside.has(coordKey(neighbor))) out.set(coordKey(neighbor), neighbor);
    }
  }
  return [...out.values()].sort((a, b) => a.x - b.x || a.z - b.z);
}

export interface RecognizedFunctionalSpace {
  zoneId: EntityId;
  cells: ColumnCoordinate[];
  enclosed: boolean;
  recognizedFunction: RecognizedSpaceFunction;
  missingBoundaryCells: ColumnCoordinate[];
  boundaryConstructionIds: EntityId[];
  contentConstructionIds: EntityId[];
}

export function recognizeFunctionalSpace(world: World, zoneId: EntityId): RecognizedFunctionalSpace {
  const zone = getZone(world.components, zoneId);
  if (zone === undefined) throw new RangeError(`entity ${zoneId} has no Zone component -- cannot recognize functional space`);
  const cells = normalizeCells(zone.cells);
  assertCellsHaveRealGround(world, cells);
  const boundaryConstructionIds: EntityId[] = [];
  const missingBoundaryCells: ColumnCoordinate[] = [];
  for (const boundaryCell of requiredBoundaryColumns(cells)) {
    const wallId = completedConstructionAt(world, boundaryCell, "wall");
    if (wallId === undefined) missingBoundaryCells.push(boundaryCell);
    else boundaryConstructionIds.push(wallId);
  }
  const enclosed = missingBoundaryCells.length === 0;
  const contentConstructionIds = completedContents(world, cells);
  const hasCompletedLodgeSegment = contentConstructionIds.some((id) => getConstruction(world.components, id)!.kind === "lodge-segment");
  const recognizedFunction: RecognizedSpaceFunction = enclosed ? (hasCompletedLodgeSegment ? "lodge-room" : "empty-room") : zone.declaredFunction;
  return {
    zoneId,
    cells,
    enclosed,
    recognizedFunction,
    missingBoundaryCells,
    boundaryConstructionIds: boundaryConstructionIds.sort((a, b) => a - b),
    contentConstructionIds,
  };
}

export function getZoneDebugState(world: World, zoneId: EntityId): RecognizedFunctionalSpace {
  return recognizeFunctionalSpace(world, zoneId);
}
