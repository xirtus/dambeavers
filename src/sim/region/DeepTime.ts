import type { World } from "../persistence/WorldSnapshot.js";
import { SiteComponent, getSite, setSite } from "./Site.js";
import { tickOffscreenSiteForTicks } from "./OffscreenLOD.js";
import type { Biome } from "./Biomes.js";
import { carryingCapacityFor, type RegionalWildlifeField } from "./WorldWildlife.js";

/** Optional ecosystem layer `advanceWorldTicks` can also advance across the same span -- P6-11's real regional wildlife, grown by the SAME closed-form logistic step a site's own offscreen LOD uses, so "persistent settlements AND ecosystems across centuries" (the Phase 6 gate's own wording) is genuinely one operation. */
export interface DeepTimeEcosystem {
  wildlife: RegionalWildlifeField;
  biomeForCell: (regionX: number, regionZ: number) => Biome;
}

/**
 * P6-13: advances the WHOLE region -- every currently-inactive site's
 * own population/food state via P6-07's real, CLOSED-FORM offscreen LOD
 * (a single formula evaluation regardless of how many ticks are being
 * skipped, never an inactive site simulated tick-by-tick -- the part
 * that would make centuries computationally infeasible), plus (when a
 * `DeepTimeEcosystem` is supplied) every tracked wildlife population via
 * `WorldWildlife`'s own closed-form logistic step. The authoritative
 * `SimulationClock` itself is still advanced through its own real
 * `advanceTicks` (P0-01, unmodified -- it internally steps once per tick
 * to keep every OTHER tick-dependent query, e.g. `Seasons.ts`'s season/
 * temperature functions, correct for the intervening period); with no
 * per-tick listeners registered on a bare region-simulation clock, that
 * loop is cheap even across a few million ticks, just not literally
 * O(1). Preserves valid references by construction: this function
 * creates no new entity kind of its own and destroys nothing --
 * `EntityIdRegistry`'s own "ids are never reused" contract and
 * `EventLog`'s own "history resolves forever, even past death" contract
 * (both already-real, already-tested Phase 0 invariants) are what make
 * "preserving valid genealogical/settlement/ecological/event
 * references" true across this advance, not a new mechanism this file
 * has to invent.
 */
export function advanceWorldTicks(
  world: World,
  totalTicks: number,
  biomeForSite: (regionX: number, regionZ: number) => Biome,
  fertilityByBiome: Readonly<Record<Biome, number>>,
  ecosystem?: DeepTimeEcosystem,
): void {
  if (!Number.isInteger(totalTicks) || totalTicks < 0) throw new RangeError(`totalTicks must be a non-negative integer, got ${totalTicks}`);
  for (const siteId of world.components.query(SiteComponent).sort((a, b) => a - b)) {
    const site = getSite(world.components, siteId);
    if (site === undefined || site.active) continue;
    const biome = biomeForSite(site.regionX, site.regionZ);
    const advanced = tickOffscreenSiteForTicks(site, fertilityByBiome[biome], totalTicks);
    // P11-14/P11-11 seam rule: population extinction ends the society's
    // continuity -- the persisted detailed world is cleared (its
    // inhabitants are gone), while the abandoned-structure record
    // REMAINS as the physical memory the next (different) population
    // encounters as ruins. A surviving population keeps its persisted
    // world (the P11-14 entity-continuity contract).
    if (advanced.populationCount <= 0 && advanced.persistedWorld !== undefined) {
      // Omit the key entirely (exactOptionalPropertyTypes: an explicit
      // undefined is not an absent field).
      const { persistedWorld: _cleared, ...abandoned } = advanced;
      void _cleared;
      setSite(world.components, siteId, abandoned);
    } else {
      setSite(world.components, siteId, advanced);
    }
  }
  if (ecosystem !== undefined) {
    for (let x = 0; x < ecosystem.wildlife.sizeX; x++) {
      for (let z = 0; z < ecosystem.wildlife.sizeZ; z++) {
        const capacity = carryingCapacityFor(ecosystem.biomeForCell(x, z));
        for (const speciesId of ecosystem.wildlife.trackedSpeciesIds) {
          ecosystem.wildlife.tickGrowthForTicks(x, z, speciesId, capacity, totalTicks);
        }
      }
    }
  }
  world.clock.advanceTicks(totalTicks);
}
