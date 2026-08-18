import { ComponentStore, defineComponent, type ComponentType } from "../core/ComponentStore.js";
import type { EntityId } from "../core/EntityId.js";
import type { World } from "../persistence/WorldSnapshot.js";
import type { RegionCoordinate } from "../region/RegionMap.js";
import type { RegionMap } from "../region/RegionMap.js";
import { getSite } from "../region/Site.js";
import { getPoliticalEntity, setPoliticalEntity } from "./PoliticalEntity.js";

/**
 * P7-07: territory is a real, persistent, OVERLAPPABLE claim -- a
 * `"territory-claim"` entity naming its owning settlement (a real P6-06
 * `Site`) and the exact region cells it claims. Two settlements claiming
 * the same cell is deliberately NOT an error: overlap is real state,
 * which is exactly what lets it "become a cause of conflict" (P7-06's
 * diplomacy and P7-16's wars both read `territoryTension`/`overlap` from
 * here -- no claim script decides anything about conflict itself).
 *
 * Claims are stored as plain parallel coordinate arrays (JSON-plain,
 * snapshot-friendly) rather than a nested object per cell.
 */

export interface TerritoryClaim {
  ownerSiteId: EntityId;
  regionXs: readonly number[];
  regionZs: readonly number[];
  sinceTick: number;
  claimEventId: number;
}
export const TerritoryClaimComponent: ComponentType<TerritoryClaim> = defineComponent<TerritoryClaim>("territory-claim");

export function assertValidTerritoryClaim(claim: TerritoryClaim): void {
  if (!Number.isInteger(claim.ownerSiteId) || claim.ownerSiteId < 1) {
    throw new RangeError(`territory-claim ownerSiteId must be a positive integer, got ${claim.ownerSiteId}`);
  }
  if (claim.regionXs.length === 0 || claim.regionXs.length !== claim.regionZs.length) {
    throw new RangeError(`territory-claim must have a non-empty, equal-length pair of regionXs/regionZs arrays, got ${claim.regionXs.length}/${claim.regionZs.length}`);
  }
  const seen = new Set<string>();
  for (let i = 0; i < claim.regionXs.length; i++) {
    const x = claim.regionXs[i]!;
    const z = claim.regionZs[i]!;
    if (!Number.isInteger(x) || x < 0 || !Number.isInteger(z) || z < 0) {
      throw new RangeError(`territory-claim cell ${i} must be non-negative integers, got (${x}, ${z})`);
    }
    const key = `${x},${z}`;
    if (seen.has(key)) throw new RangeError(`territory-claim cell (${x}, ${z}) appears twice`);
    seen.add(key);
  }
  if (!Number.isInteger(claim.sinceTick) || claim.sinceTick < 0) {
    throw new RangeError(`territory-claim sinceTick must be a non-negative integer, got ${claim.sinceTick}`);
  }
  if (!Number.isInteger(claim.claimEventId) || claim.claimEventId < 1) {
    throw new RangeError(`territory-claim claimEventId must be a positive integer, got ${claim.claimEventId}`);
  }
}

export function setTerritoryClaim(components: ComponentStore, claimId: EntityId, claim: TerritoryClaim): void {
  assertValidTerritoryClaim(claim);
  components.set(claimId, TerritoryClaimComponent, {
    ownerSiteId: claim.ownerSiteId,
    regionXs: [...claim.regionXs],
    regionZs: [...claim.regionZs],
    sinceTick: claim.sinceTick,
    claimEventId: claim.claimEventId,
  });
}

export function getTerritoryClaim(components: ComponentStore, claimId: EntityId): TerritoryClaim | undefined {
  const claim = components.get(claimId, TerritoryClaimComponent);
  if (claim !== undefined) assertValidTerritoryClaim(claim);
  return claim;
}

/** The claim cells as coordinate pairs, derived fresh (never a cached parallel truth). */
export function claimCells(claim: TerritoryClaim): RegionCoordinate[] {
  const cells: RegionCoordinate[] = [];
  for (let i = 0; i < claim.regionXs.length; i++) cells.push({ regionX: claim.regionXs[i]!, regionZ: claim.regionZs[i]! });
  return cells;
}

/**
 * A real territorial claim: `siteId` claims every region cell within
 * Chebyshev radius `radius` of its own region cell that is in bounds --
 * real geometry over the region map, not an authored cell list. Records
 * a real `"territory-claimed"` event. Returns the new claim entity id.
 */
export function claimTerritory(world: World, regionMap: RegionMap, siteId: EntityId, radius: number): EntityId {
  if (!Number.isInteger(radius) || radius < 0) throw new RangeError(`territory radius must be a non-negative integer, got ${radius}`);
  const site = getSite(world.components, siteId);
  if (site === undefined) throw new RangeError(`unknown site ${siteId}`);
  const regionXs: number[] = [];
  const regionZs: number[] = [];
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      const x = site.regionX + dx;
      const z = site.regionZ + dz;
      if (regionMap.inBounds(x, z)) {
        regionXs.push(x);
        regionZs.push(z);
      }
    }
  }
  const claimId = world.entities.create("territory-claim");
  const claimEventId = world.events.record({
    tick: world.clock.tick,
    eventType: "territory-claimed",
    subjectIds: [siteId, claimId],
    location: { x: 0, y: 0, z: 0 },
  });
  setTerritoryClaim(world.components, claimId, {
    ownerSiteId: siteId,
    regionXs,
    regionZs,
    sinceTick: world.clock.tick,
    claimEventId,
  });
  registerClaimWithPolity(world, siteId, claimId);
  return claimId;
}

/** Every live territory claim owned by `siteId`, sorted by id. */
export function claimsOfSite(world: World, siteId: EntityId): EntityId[] {
  const claims: EntityId[] = [];
  for (const claimId of world.components.query(TerritoryClaimComponent)) {
    const claim = getTerritoryClaim(world.components, claimId);
    if (claim !== undefined && claim.ownerSiteId === siteId) claims.push(claimId);
  }
  return claims.sort((a, b) => a - b);
}

/** All cells currently claimed by `siteId` across all its live claims (duplicates removed). */
export function claimedCellsOfSite(world: World, siteId: EntityId): RegionCoordinate[] {
  const seen = new Set<string>();
  const cells: RegionCoordinate[] = [];
  for (const claimId of claimsOfSite(world, siteId)) {
    for (const cell of claimCells(getTerritoryClaim(world.components, claimId)!)) {
      const key = `${cell.regionX},${cell.regionZ}`;
      if (!seen.has(key)) {
        seen.add(key);
        cells.push(cell);
      }
    }
  }
  return cells;
}

/** The real overlap between two settlements' current claims -- the exact cells both claim. */
/**
 * Keeps the polity's own declared claim list in step when a claim is
 * created (the same entity's real claims -- one authoritative list, the
 * polity's component field mirrors its claim entities).
 */
export function registerClaimWithPolity(world: World, siteId: EntityId, claimId: EntityId): void {
  const entity = getPoliticalEntity(world.components, siteId);
  if (entity === undefined || entity.territoryClaimIds.includes(claimId)) return;
  setPoliticalEntity(world.components, siteId, { ...entity, territoryClaimIds: [...entity.territoryClaimIds, claimId] });
}

export function overlappingClaimCells(world: World, siteAId: EntityId, siteBId: EntityId): RegionCoordinate[] {
  const a = new Set(claimedCellsOfSite(world, siteAId).map((cell) => `${cell.regionX},${cell.regionZ}`));
  return claimedCellsOfSite(world, siteBId).filter((cell) => a.has(`${cell.regionX},${cell.regionZ}`));
}

/** A real `[0, 1]` territorial tension score between two settlements: the fraction of the SMALLER side's claimed cells the other also claims (overlap scaled by stake, never a flat authored number). 0 = no overlap. */
export function territoryTension(world: World, siteAId: EntityId, siteBId: EntityId): number {
  const aCells = claimedCellsOfSite(world, siteAId);
  const bCells = claimedCellsOfSite(world, siteBId);
  if (aCells.length === 0 || bCells.length === 0) return 0;
  const bSet = new Set(bCells.map((cell) => `${cell.regionX},${cell.regionZ}`));
  const overlap = aCells.filter((cell) => bSet.has(`${cell.regionX},${cell.regionZ}`)).length;
  const smallerStake = Math.min(aCells.length, bCells.length);
  return overlap / smallerStake;
}
