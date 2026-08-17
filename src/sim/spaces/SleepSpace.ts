import { defineComponent, type ComponentType } from "../core/ComponentStore.js";
import type { EntityId } from "../core/EntityId.js";
import type { ColumnCoordinate } from "../hydrology/WaterField.js";
import type { MaterialRegistry } from "../materials/Material.js";
import { findPath, type NavigationProfile } from "../navigation/Pathfinding.js";
import type { World } from "../persistence/WorldSnapshot.js";
import { tickBeaverNeeds, type NeedsTickResult } from "../creatures/BeaverNeeds.js";
import { recognizeFunctionalSpace } from "./FunctionalSpace.js";

/**
 * P2-06's ownership/preference layer for sleeping. A sleep space is a real
 * persistent entity placed on the grid inside a recognized P2-05 lodge
 * room; claims are ordinary component state on beavers, not direct control
 * over where they teleport or sleep. Fatigue behavior still moves through
 * P1-14/P1-05 navigation; this module only supplies a preferred rest
 * target when the claim/preference is currently valid and reachable.
 */
export type SleepSpaceKind = "nest" | "bed";

export interface SleepSpace {
  zoneId: EntityId;
  kind: SleepSpaceKind;
}
export const SleepSpaceComponent: ComponentType<SleepSpace> = defineComponent<SleepSpace>("sleep-space");

export interface SleepClaim {
  spaceId: EntityId;
}
export const SleepClaimComponent: ComponentType<SleepClaim> = defineComponent<SleepClaim>("sleep-claim");

const SLEEP_SPACE_KINDS: readonly SleepSpaceKind[] = ["nest", "bed"];

function assertPositiveEntityId(id: unknown, label: string): asserts id is EntityId {
  if (!Number.isInteger(id) || (id as number) < 1) {
    throw new RangeError(`${label} must be a positive entity id, got ${JSON.stringify(id)}`);
  }
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

function coordKey(cell: ColumnCoordinate): string {
  return `${cell.x},${cell.z}`;
}

export function assertValidSleepSpace(space: SleepSpace): void {
  if (space === null || typeof space !== "object") throw new RangeError("sleep space must be an object");
  assertPositiveEntityId(space.zoneId, "sleep space zoneId");
  if (!SLEEP_SPACE_KINDS.includes(space.kind)) {
    throw new RangeError(`sleep space kind must be one of ${SLEEP_SPACE_KINDS.join(", ")}, got ${JSON.stringify(space.kind)}`);
  }
}

export function setSleepSpace(world: World, spaceId: EntityId, space: SleepSpace): void {
  assertValidSleepSpace(space);
  world.components.set(spaceId, SleepSpaceComponent, space);
}

export function getSleepSpace(world: World, spaceId: EntityId): SleepSpace | undefined {
  const space = world.components.get(spaceId, SleepSpaceComponent);
  if (space !== undefined) assertValidSleepSpace(space);
  return space;
}

export function assertValidSleepClaim(claim: SleepClaim): void {
  if (claim === null || typeof claim !== "object") throw new RangeError("sleep claim must be an object");
  assertPositiveEntityId(claim.spaceId, "sleep claim spaceId");
}

export function setSleepClaim(world: World, residentId: EntityId, claim: SleepClaim): void {
  assertValidSleepClaim(claim);
  world.components.set(residentId, SleepClaimComponent, claim);
}

export function getSleepClaim(world: World, residentId: EntityId): SleepClaim | undefined {
  const claim = world.components.get(residentId, SleepClaimComponent);
  if (claim !== undefined) assertValidSleepClaim(claim);
  return claim;
}

export interface SleepSpacePlacement {
  spaceId: EntityId;
  zoneId: EntityId;
  kind: SleepSpaceKind;
  cell: ColumnCoordinate;
}

function cellIsInside(cell: ColumnCoordinate, cells: readonly ColumnCoordinate[]): boolean {
  const key = coordKey(cell);
  return cells.some((candidate) => coordKey(candidate) === key);
}

function sleepSpacePlacement(world: World, spaceId: EntityId): SleepSpacePlacement | undefined {
  const space = getSleepSpace(world, spaceId);
  if (space === undefined) return undefined;
  if (!world.entities.isLive(spaceId) || world.entities.kindOf(spaceId) !== "sleep-space") {
    throw new RangeError(`entity ${spaceId} has SleepSpace data but is not a live sleep-space entity`);
  }
  const position = world.grid.positionOf(spaceId);
  if (position === undefined) {
    throw new RangeError(`sleep space ${spaceId} has no grid position`);
  }
  const cell = { x: position.x, z: position.z };
  const recognized = recognizeFunctionalSpace(world, space.zoneId);
  if (recognized.recognizedFunction !== "lodge-room") return undefined;
  if (!cellIsInside(cell, recognized.cells)) return undefined;
  return { spaceId, zoneId: space.zoneId, kind: space.kind, cell };
}

export function createSleepSpace(world: World, options: SleepSpace & { cell: ColumnCoordinate }): EntityId {
  assertValidSleepSpace(options);
  assertColumn(options.cell, "sleep space cell");
  const recognized = recognizeFunctionalSpace(world, options.zoneId);
  if (recognized.recognizedFunction !== "lodge-room") {
    throw new RangeError(`zone ${options.zoneId} is not a recognized lodge-room -- cannot create a sleep space there`);
  }
  if (!cellIsInside(options.cell, recognized.cells)) {
    throw new RangeError(`sleep space cell (${options.cell.x}, ${options.cell.z}) is not inside zone ${options.zoneId}`);
  }
  const floor = world.grid.surfaceY(options.cell.x, options.cell.z);
  if (floor === undefined) {
    throw new RangeError(`sleep space cell (${options.cell.x}, ${options.cell.z}) has no real ground`);
  }
  for (const existingId of world.entities.liveIdsOfKind("sleep-space")) {
    const existing = sleepSpacePlacement(world, existingId);
    if (existing !== undefined && existing.zoneId === options.zoneId && existing.cell.x === options.cell.x && existing.cell.z === options.cell.z) {
      throw new RangeError(`zone ${options.zoneId} already has sleep space ${existingId} at (${options.cell.x}, ${options.cell.z})`);
    }
  }
  const spaceId = world.entities.create("sleep-space");
  world.grid.setEntityPosition(spaceId, options.cell.x, floor + 1, options.cell.z);
  setSleepSpace(world, spaceId, { zoneId: options.zoneId, kind: options.kind });
  return spaceId;
}

export function sleepSpaceClaimedBy(world: World, spaceId: EntityId): EntityId | undefined {
  const claimants = world.components
    .query(SleepClaimComponent)
    .filter((residentId) => {
      const claim = getSleepClaim(world, residentId)!;
      if (!world.entities.isLive(residentId)) return false;
      if (world.entities.kindOf(residentId) !== "beaver") {
        throw new RangeError(`entity ${residentId} has SleepClaim data but is not a live beaver resident`);
      }
      return claim.spaceId === spaceId && world.entities.isLive(residentId);
    })
    .sort((a, b) => a - b);
  if (claimants.length > 1) {
    throw new RangeError(`sleep space ${spaceId} is claimed by multiple live residents: ${claimants.join(", ")}`);
  }
  return claimants[0];
}

function assertLiveBeaver(world: World, residentId: EntityId): void {
  if (!world.entities.isLive(residentId) || world.entities.kindOf(residentId) !== "beaver") {
    throw new RangeError(`entity ${residentId} is not a live beaver resident`);
  }
}

export function claimSleepSpace(world: World, residentId: EntityId, spaceId: EntityId): void {
  assertLiveBeaver(world, residentId);
  const placement = sleepSpacePlacement(world, spaceId);
  if (placement === undefined) {
    throw new RangeError(`sleep space ${spaceId} is not currently usable`);
  }
  const claimedBy = sleepSpaceClaimedBy(world, spaceId);
  if (claimedBy !== undefined && claimedBy !== residentId) {
    throw new RangeError(`sleep space ${spaceId} is already claimed by resident ${claimedBy}`);
  }
  setSleepClaim(world, residentId, { spaceId });
}

export interface SleepSpaceChoice extends SleepSpacePlacement {
  reason: "claimed" | "preferred";
}

function isReachable(world: World, materials: MaterialRegistry, profile: NavigationProfile, from: ColumnCoordinate, to: ColumnCoordinate): boolean {
  return findPath(world.grid, world.terrain, world.water, materials, from, to, profile) !== undefined;
}

function kindRank(kind: SleepSpaceKind): number {
  return kind === "bed" ? 2 : 1;
}

function chooseBetter(a: SleepSpacePlacement, b: SleepSpacePlacement, from: ColumnCoordinate): SleepSpacePlacement {
  const rankA = kindRank(a.kind);
  const rankB = kindRank(b.kind);
  if (rankA !== rankB) return rankA > rankB ? a : b;
  const distanceA = Math.abs(a.cell.x - from.x) + Math.abs(a.cell.z - from.z);
  const distanceB = Math.abs(b.cell.x - from.x) + Math.abs(b.cell.z - from.z);
  if (distanceA !== distanceB) return distanceA < distanceB ? a : b;
  return a.spaceId < b.spaceId ? a : b;
}

export function preferredSleepSpace(world: World, materials: MaterialRegistry, residentId: EntityId, profile: NavigationProfile): SleepSpaceChoice | undefined {
  assertLiveBeaver(world, residentId);
  const position = world.grid.positionOf(residentId);
  if (position === undefined) throw new RangeError(`resident ${residentId} has no grid position`);
  const from = { x: position.x, z: position.z };

  const claim = getSleepClaim(world, residentId);
  if (claim !== undefined) {
    const claimed = sleepSpacePlacement(world, claim.spaceId);
    const claimedBy = sleepSpaceClaimedBy(world, claim.spaceId);
    if (claimed !== undefined && (claimedBy === undefined || claimedBy === residentId) && isReachable(world, materials, profile, from, claimed.cell)) {
      return { ...claimed, reason: "claimed" };
    }
  }

  let best: SleepSpacePlacement | undefined;
  for (const spaceId of world.entities.liveIdsOfKind("sleep-space")) {
    const placement = sleepSpacePlacement(world, spaceId);
    if (placement === undefined) continue;
    const claimedBy = sleepSpaceClaimedBy(world, spaceId);
    if (claimedBy !== undefined && claimedBy !== residentId) continue;
    if (!isReachable(world, materials, profile, from, placement.cell)) continue;
    best = best === undefined ? placement : chooseBetter(best, placement, from);
  }
  return best === undefined ? undefined : { ...best, reason: "preferred" };
}

export function claimPreferredSleepSpace(world: World, materials: MaterialRegistry, residentId: EntityId, profile: NavigationProfile): SleepSpaceChoice | undefined {
  const choice = preferredSleepSpace(world, materials, residentId, profile);
  if (choice === undefined) return undefined;
  claimSleepSpace(world, residentId, choice.spaceId);
  return { ...choice, reason: "claimed" };
}

export function tickBeaverNeedsWithSleepPreferences(world: World, materials: MaterialRegistry, residentId: EntityId, profile: NavigationProfile): NeedsTickResult {
  const choice = preferredSleepSpace(world, materials, residentId, profile);
  return tickBeaverNeeds(world.grid, world.terrain, world.water, materials, world.entities, world.components, residentId, profile, choice?.cell, { world });
}

export interface SleepSpaceDebugState {
  spaceId: EntityId;
  usable: boolean;
  placement?: SleepSpacePlacement;
  claimedBy?: EntityId;
}

export function getSleepSpaceDebugState(world: World, spaceId: EntityId): SleepSpaceDebugState {
  const placement = sleepSpacePlacement(world, spaceId);
  const claimedBy = sleepSpaceClaimedBy(world, spaceId);
  return {
    spaceId,
    usable: placement !== undefined,
    ...(placement === undefined ? {} : { placement }),
    ...(claimedBy === undefined ? {} : { claimedBy }),
  };
}
