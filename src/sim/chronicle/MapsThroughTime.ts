import type { EntityId } from "../core/EntityId.js";
import type { World } from "../persistence/WorldSnapshot.js";
import type { RegionMap } from "../region/RegionMap.js";
import { getTerritoryClaim, claimCells, TerritoryClaimComponent } from "../politics/Territory.js";
import { getSite, SiteComponent } from "../region/Site.js";

/**
 * P8-07: maps through time -- the political map (which settlements claim
 * which region cells) at ANY past date, reconstructed from recorded
 * history, never from a stored per-tick snapshot. The reconstruction
 * rules are exactly the real claim semantics:
 *  - a claim exists on the map from its own `sinceTick` (the claim
 *    entity records when it was made),
 *  - a cession REMOVES cells from the losing claim at the cession's
 *    tick -- `War.endWar` records the exact ceded cells and the exact
 *    rewritten claim ids in the `territory-ceded` event's data payload
 *    (P8's recording amendment), so a claim's shape at date T is "its
 *    current shape plus every cell ceded from it after T",
 *  - a settlement appears only from its recorded founding tick.
 * Events that predate the `data` payloads carry no cell list; such a
 * cession is honestly reported as un-reconstructible for its cells
 * (the claim's current shape is still used -- which is exact for any
 * query date AFTER that cession).
 */

export interface MapCell {
  regionX: number;
  regionZ: number;
  /** Claiming settlement ids, ascending -- real overlap is possible and preserved. */
  claimants: EntityId[];
}

function foundingTickOf(world: World, siteId: EntityId): number | undefined {
  const event = world.events.eventsOfType("site-founded").find((e) => e.subjectIds.includes(siteId));
  return event?.tick;
}

/** Every settlement that existed at `tick` (its recorded founding tick is <= tick). */
export function sitesAt(world: World, tick: number): EntityId[] {
  if (!Number.isInteger(tick) || tick < 0) throw new RangeError(`tick must be a non-negative integer, got ${tick}`);
  const siteIds: EntityId[] = [];
  for (const siteId of world.components.query(SiteComponent)) {
    const founded = foundingTickOf(world, siteId);
    if (founded !== undefined && founded <= tick) siteIds.push(siteId);
  }
  return siteIds.sort((a, b) => a - b);
}

interface CessionRecord {
  tick: number;
  cells: Array<{ regionX: number; regionZ: number }>;
  claimIds: EntityId[];
}

function cessionRecords(world: World): CessionRecord[] {
  const records: CessionRecord[] = [];
  for (const event of world.events.eventsOfType("territory-ceded")) {
    const rawCells = event.data?.cells;
    const rawClaimIds = event.data?.claimIds;
    const cells: Array<{ regionX: number; regionZ: number }> = [];
    const claimIds: EntityId[] = [];
    if (Array.isArray(rawCells)) {
      for (const cell of rawCells as unknown[]) {
        if (
          cell !== null &&
          typeof cell === "object" &&
          Number.isInteger((cell as { regionX?: unknown }).regionX) &&
          Number.isInteger((cell as { regionZ?: unknown }).regionZ)
        ) {
          const { regionX, regionZ } = cell as { regionX: number; regionZ: number };
          cells.push({ regionX, regionZ });
        }
      }
    }
    if (Array.isArray(rawClaimIds)) {
      for (const id of rawClaimIds as unknown[]) {
        if (Number.isInteger(id) && (id as number) >= 1) claimIds.push(id as EntityId);
      }
    }
    records.push({ tick: event.tick, cells, claimIds });
  }
  return records.sort((a, b) => a.tick - b.tick);
}

/**
 * The claim's shape at `tick`: its current cells plus every cell that
 * was ceded from it after `tick` (a cell ceded at tick C was still the
 * claim's at any T < C). Claims are never deleted, so the entity's
 * current shape plus recorded cessions is the complete reconstruction.
 */
function claimCellsAt(world: World, claimId: EntityId, tick: number, cessions: CessionRecord[]): Array<{ regionX: number; regionZ: number }> {
  const claim = getTerritoryClaim(world.components, claimId);
  if (claim === undefined) return [];
  const cells = claimCells(claim);
  const keys = new Set(cells.map((cell) => `${cell.regionX},${cell.regionZ}`));
  const restored: Array<{ regionX: number; regionZ: number }> = [];
  for (const cession of cessions) {
    if (cession.tick <= tick) continue;
    if (!cession.claimIds.includes(claimId)) continue;
    for (const cell of cession.cells) {
      const key = `${cell.regionX},${cell.regionZ}`;
      if (!keys.has(key)) {
        keys.add(key);
        restored.push(cell);
      }
    }
  }
  return [...cells, ...restored];
}

/**
 * The full political map at `tick`: for every region cell, the
 * settlements claiming it at that date. Deterministic (cells in row-
 * major order, claimants ascending). Pure -- no state is mutated.
 */
export function politicalMapAt(world: World, regionMap: RegionMap, tick: number): MapCell[] {
  if (!Number.isInteger(tick) || tick < 0) throw new RangeError(`tick must be a non-negative integer, got ${tick}`);
  const cessions = cessionRecords(world);
  const claimantsByCell = new Map<string, Set<EntityId>>();
  for (const claimId of world.components.query(TerritoryClaimComponent)) {
    const claim = getTerritoryClaim(world.components, claimId);
    if (claim === undefined || claim.sinceTick > tick) continue;
    const founded = foundingTickOf(world, claim.ownerSiteId);
    if (founded === undefined || founded > tick) continue;
    for (const cell of claimCellsAt(world, claimId, tick, cessions)) {
      if (!regionMap.inBounds(cell.regionX, cell.regionZ)) continue;
      const key = `${cell.regionX},${cell.regionZ}`;
      let set = claimantsByCell.get(key);
      if (set === undefined) {
        set = new Set();
        claimantsByCell.set(key, set);
      }
      set.add(claim.ownerSiteId);
    }
  }
  const map: MapCell[] = [];
  for (let z = 0; z < regionMap.sizeZ; z++) {
    for (let x = 0; x < regionMap.sizeX; x++) {
      const set = claimantsByCell.get(`${x},${z}`);
      if (set === undefined || set.size === 0) continue;
      map.push({ regionX: x, regionZ: z, claimants: [...set].sort((a, b) => a - b) });
    }
  }
  return map;
}

export interface MapChange {
  regionX: number;
  regionZ: number;
  before: EntityId[];
  after: EntityId[];
}

/** Every region cell whose claimant set differs between `fromTick` and `toTick` (the map's changes across a span of history). */
export function mapChangesBetween(world: World, regionMap: RegionMap, fromTick: number, toTick: number): MapChange[] {
  if (!Number.isInteger(fromTick) || fromTick < 0) throw new RangeError(`fromTick must be a non-negative integer, got ${fromTick}`);
  if (!Number.isInteger(toTick) || toTick < 0) throw new RangeError(`toTick must be a non-negative integer, got ${toTick}`);
  if (fromTick > toTick) throw new RangeError(`fromTick (${fromTick}) must not exceed toTick (${toTick})`);
  const before = new Map(politicalMapAt(world, regionMap, fromTick).map((cell) => [`${cell.regionX},${cell.regionZ}`, cell.claimants]));
  const after = politicalMapAt(world, regionMap, toTick);
  const changes: MapChange[] = [];
  for (const cell of after) {
    const key = `${cell.regionX},${cell.regionZ}`;
    const previous = before.get(key) ?? [];
    const same = previous.length === cell.claimants.length && previous.every((id, i) => id === cell.claimants[i]);
    if (!same) changes.push({ regionX: cell.regionX, regionZ: cell.regionZ, before: previous, after: cell.claimants });
    before.delete(key);
  }
  for (const [key, previous] of before) {
    const [regionX, regionZ] = key.split(",").map((part) => Number(part));
    changes.push({ regionX: regionX!, regionZ: regionZ!, before: previous, after: [] });
  }
  return changes.sort((a, b) => a.regionZ - b.regionZ || a.regionX - b.regionX);
}

/** One cell's claimants at `tick` (empty when nobody claims it). */
export function claimantsAt(world: World, regionMap: RegionMap, regionX: number, regionZ: number, tick: number): EntityId[] {
  return politicalMapAt(world, regionMap, tick).find((cell) => cell.regionX === regionX && cell.regionZ === regionZ)?.claimants ?? [];
}
