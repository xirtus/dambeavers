import { ComponentStore, defineComponent, type ComponentType } from "../core/ComponentStore.js";
import type { EntityId } from "../core/EntityId.js";
import type { World } from "../persistence/WorldSnapshot.js";
import type { EventId } from "../history/EventLog.js";
import type { WorldSnapshot } from "../persistence/WorldSnapshot.js";
import { RegionMap } from "./RegionMap.js";

/**
 * P6-06: a real, permanent `"site"` entity (P0-02 identity) with a
 * persistent region location, a summary population/structure count, and
 * a real link into P5-16's own history machinery -- `foundedEventId`
 * names the real recorded `"site-founded"` event, so `EventLog.
 * eventsInvolving(siteId)`/`SettlementHistory.ts`'s composed queries
 * already give this site a genuine queryable history with zero new
 * history mechanism. `active` distinguishes a currently-detailed-
 * simulated site (P6-08) from an abstracted one (P6-07); population/
 * `storedFoodKg` are the real summary state an inactive site's own
 * offscreen LOD advances.
 */
export interface Site {
  regionX: number;
  regionZ: number;
  active: boolean;
  populationCount: number;
  storedFoodKg: number;
  /** Optional (P6-06's own "structures" clause): the site's real built-structure count as summarized from its detailed world. Absent means 0 -- no fake count invented. */
  structureCount?: number;
  /** Optional (P11-11): the structure count BROKEN DOWN by kind, recorded when the site's detailed world deactivates -- the physical memory later populations encounter as ruins. Absent means no abandoned structures were recorded. */
  abandonedStructures?: Record<string, number>;
  /**
   * Optional (P11-14): the site's own detailed world, persisted AT
   * deactivation so the NEXT activation restores the SAME entities (same
   * ids, same continuous event history) instead of reconstructing fresh
   * ones from the summary. Absent means this site has never been
   * activated (first activation still reconstructs from the summary --
   * there is no prior detailed state to preserve).
   */
  persistedWorld?: WorldSnapshot;
  householdId?: EntityId;
  foundedEventId: EventId;
}
export const SiteComponent: ComponentType<Site> = defineComponent<Site>("site");

export function assertValidSite(site: Site): void {
  if (!Number.isInteger(site.regionX) || site.regionX < 0) throw new RangeError(`site regionX must be a non-negative integer, got ${site.regionX}`);
  if (!Number.isInteger(site.regionZ) || site.regionZ < 0) throw new RangeError(`site regionZ must be a non-negative integer, got ${site.regionZ}`);
  if (typeof site.active !== "boolean") throw new RangeError("site active must be a boolean");
  if (!Number.isInteger(site.populationCount) || site.populationCount < 0) {
    throw new RangeError(`site populationCount must be a non-negative integer, got ${site.populationCount}`);
  }
  if (!(site.storedFoodKg >= 0 && Number.isFinite(site.storedFoodKg))) {
    throw new RangeError(`site storedFoodKg must be a non-negative finite number, got ${site.storedFoodKg}`);
  }
  if (site.structureCount !== undefined && (!Number.isInteger(site.structureCount) || site.structureCount < 0)) {
    throw new RangeError(`site structureCount must be a non-negative integer when present, got ${site.structureCount}`);
  }
  if (site.abandonedStructures !== undefined) {
    for (const [kind, count] of Object.entries(site.abandonedStructures)) {
      if (kind.trim().length === 0) throw new RangeError("site abandonedStructures kinds must be non-empty");
      if (!Number.isInteger(count) || count < 0) throw new RangeError(`site abandonedStructures count for "${kind}" must be a non-negative integer, got ${count}`);
    }
  }
  if (site.householdId !== undefined && (!Number.isInteger(site.householdId) || site.householdId < 1)) {
    throw new RangeError(`site householdId must be a positive integer when present, got ${site.householdId}`);
  }
  if (!Number.isInteger(site.foundedEventId) || site.foundedEventId < 1) {
    throw new RangeError(`site foundedEventId must be a positive integer, got ${site.foundedEventId}`);
  }
}

export function setSite(components: ComponentStore, siteId: EntityId, site: Site): void {
  assertValidSite(site);
  const normalized: Site = {
    regionX: site.regionX,
    regionZ: site.regionZ,
    active: site.active,
    populationCount: site.populationCount,
    storedFoodKg: site.storedFoodKg,
    foundedEventId: site.foundedEventId,
  };
  if (site.householdId !== undefined) normalized.householdId = site.householdId;
  if (site.structureCount !== undefined) normalized.structureCount = site.structureCount;
  if (site.abandonedStructures !== undefined) normalized.abandonedStructures = { ...site.abandonedStructures };
  // Persisted world is kept when present AND cleared when explicitly
  // undefined (P11-14's extinction seam rule) -- an omitted field and an
  // explicit undefined both normalize to absent.
  if (site.persistedWorld !== undefined) normalized.persistedWorld = site.persistedWorld;
  components.set(siteId, SiteComponent, normalized);
}

export function getSite(components: ComponentStore, siteId: EntityId): Site | undefined {
  const site = components.get(siteId, SiteComponent);
  if (site !== undefined) assertValidSite(site);
  return site;
}

/** Instantiates a real, permanent site at region cell `(regionX, regionZ)` -- claims the cell via `RegionMap.placeSite` (throws if already occupied), records a real `"site-founded"` event, and starts inactive with the given initial population/food (and optional initial structure count). */
export function createSite(
  world: World,
  regionMap: RegionMap,
  regionX: number,
  regionZ: number,
  initialPopulation: number,
  initialStoredFoodKg: number,
  initialStructureCount = 0,
): EntityId {
  const siteId = world.entities.create("site");
  regionMap.placeSite(regionX, regionZ, siteId);
  const foundedEventId = world.events.record({
    tick: world.clock.tick,
    eventType: "site-founded",
    subjectIds: [siteId],
    location: { x: 0, y: 0, z: 0 },
    // P8-04: the founding state is recorded at the moment it happens so
    // a site's population/food/structure history is reconstructible from
    // recorded history alone.
    data: { initialPopulation, initialStoredFoodKg, structureCount: initialStructureCount },
  });
  setSite(world.components, siteId, {
    regionX,
    regionZ,
    active: false,
    populationCount: initialPopulation,
    storedFoodKg: initialStoredFoodKg,
    structureCount: initialStructureCount,
    foundedEventId,
  });
  return siteId;
}
