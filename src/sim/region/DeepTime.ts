import type { World } from "../persistence/WorldSnapshot.js";
import { SiteComponent, getSite, setSite } from "./Site.js";
import { tickOffscreenSiteForTicks } from "./OffscreenLOD.js";
import type { Biome } from "./Biomes.js";

/**
 * P6-13: advances the WHOLE region -- every currently-inactive site's
 * own population/food state via P6-07's real, CLOSED-FORM offscreen LOD
 * (a single formula evaluation regardless of how many ticks are being
 * skipped, never an inactive site simulated tick-by-tick -- the part
 * that would make centuries computationally infeasible). The
 * authoritative `SimulationClock` itself is still advanced through its
 * own real `advanceTicks` (P0-01, unmodified -- it internally steps
 * once per tick to keep every OTHER tick-dependent query, e.g.
 * `Seasons.ts`'s season/temperature functions, correct for the
 * intervening period); with no per-tick listeners registered on a bare
 * region-simulation clock, that loop is cheap even across a few million
 * ticks, just not literally O(1). Preserves valid references by
 * construction: this function creates no new entity kind of its own and
 * destroys nothing -- `EntityIdRegistry`'s own "ids are never reused"
 * contract and `EventLog`'s own "history resolves forever, even past
 * death" contract (both already-real, already-tested Phase 0
 * invariants) are what make "preserving valid genealogical/settlement/
 * ecological/event references" true across this advance, not a new
 * mechanism this file has to invent.
 */
export function advanceWorldTicks(world: World, totalTicks: number, biomeForSite: (regionX: number, regionZ: number) => Biome, fertilityByBiome: Readonly<Record<Biome, number>>): void {
  if (!Number.isInteger(totalTicks) || totalTicks < 0) throw new RangeError(`totalTicks must be a non-negative integer, got ${totalTicks}`);
  for (const siteId of world.components.query(SiteComponent).sort((a, b) => a - b)) {
    const site = getSite(world.components, siteId);
    if (site === undefined || site.active) continue;
    const biome = biomeForSite(site.regionX, site.regionZ);
    const advanced = tickOffscreenSiteForTicks(site, fertilityByBiome[biome], totalTicks);
    setSite(world.components, siteId, advanced);
  }
  world.clock.advanceTicks(totalTicks);
}
