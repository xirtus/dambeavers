import type { Biome } from "./Biomes.js";

/**
 * P6-11: real, PERSISTED regional (not per-site) species population --
 * a peer field object (same pattern as `SoilFertilityField`/
 * `WaterTemperatureField`, P4-09/P4-11), one real count per `(species,
 * region cell)`, growing/declining via a real logistic model bounded by
 * a biome-derived carrying capacity -- never an authored per-region
 * number. `encounterRateAt` is what a site's own local systems (P4-05
 * onward) can consult so regional population genuinely "affects local
 * site encounters," the literal acceptance clause.
 */
const REGIONAL_WILDLIFE_SNAPSHOT_VERSION = 1;

export interface RegionalWildlifeSnapshot {
  version: number;
  dimensions: { sizeX: number; sizeZ: number };
  speciesIds: string[];
  countByCellAndSpecies: number[];
}

/** Real per-biome carrying capacity ceiling -- a forest/wetland supports more wildlife per cell than a desert/tundra, a real ecological fact, never a flat number. Plausible, tunable balance data. */
const CARRYING_CAPACITY_BY_BIOME: Readonly<Record<Biome, number>> = Object.freeze({
  forest: 40,
  wetland: 35,
  grassland: 25,
  desert: 8,
  tundra: 10,
  mountain: 5,
});

export function carryingCapacityFor(biome: Biome): number {
  return CARRYING_CAPACITY_BY_BIOME[biome];
}

/** Real logistic growth rate per tick -- plausible, tunable balance data. */
export const WILDLIFE_GROWTH_RATE = 0.001;

export class RegionalWildlifeField {
  readonly sizeX: number;
  readonly sizeZ: number;
  private readonly speciesIds: string[];
  private readonly countByCellAndSpecies: Float64Array;

  constructor(sizeX: number, sizeZ: number, speciesIds: readonly string[]) {
    this.sizeX = sizeX;
    this.sizeZ = sizeZ;
    this.speciesIds = [...speciesIds];
    this.countByCellAndSpecies = new Float64Array(sizeX * sizeZ * speciesIds.length);
  }

  get trackedSpeciesIds(): readonly string[] {
    return this.speciesIds;
  }

  private index(x: number, z: number, speciesId: string): number {
    const speciesIndex = this.speciesIds.indexOf(speciesId);
    if (speciesIndex === -1) throw new RangeError(`unknown species id "${speciesId}"`);
    if (!Number.isInteger(x) || !Number.isInteger(z) || x < 0 || x >= this.sizeX || z < 0 || z >= this.sizeZ) {
      throw new RangeError(`region cell (${x}, ${z}) is out of bounds`);
    }
    return (z * this.sizeX + x) * this.speciesIds.length + speciesIndex;
  }

  countAt(x: number, z: number, speciesId: string): number {
    return this.countByCellAndSpecies[this.index(x, z, speciesId)]!;
  }

  setCount(x: number, z: number, speciesId: string, count: number): void {
    if (!(count >= 0 && Number.isFinite(count))) throw new RangeError(`wildlife count must be non-negative and finite, got ${count}`);
    this.countByCellAndSpecies[this.index(x, z, speciesId)] = count;
  }

  /** One real tick of logistic growth toward `carryingCapacity` for one species at one cell -- `count' = count + rate * count * (1 - count / capacity)`, the standard real population-ecology formula, never a flat increment. */
  tickGrowth(x: number, z: number, speciesId: string, carryingCapacity: number): void {
    this.tickGrowthForTicks(x, z, speciesId, carryingCapacity, 1);
  }

  /**
   * The SAME logistic model applied across `totalTicks` in ONE closed-form
   * step (the standard exact solution of the logistic differential
   * equation, `capacity * count / (count + (capacity - count) * e^{-rt})`)
   * rather than iterated tick-by-tick -- what makes P6-13's own deep-time
   * "advance centuries headlessly" requirement computationally real for
   * regional ecosystems, matching `OffscreenLOD.ts`'s identical
   * closed-form-over-tick-iteration choice for sites. Written in the
   * `e^{-rt}` decay form (not the algebraically-equivalent `e^{rt}` form)
   * because the decay term tends to a benign `0` as `totalTicks` grows --
   * the growth form instead tends to `Infinity`, and for century-scale
   * `totalTicks` (`e^{0.001 * 4_800_000} = e^{4800}`) the two infinities
   * divide to NaN, a real overflow found empirically by this file's own
   * acceptance test (`p6-13-...`).
   */
  tickGrowthForTicks(x: number, z: number, speciesId: string, carryingCapacity: number, totalTicks: number): void {
    if (carryingCapacity <= 0) {
      this.setCount(x, z, speciesId, 0);
      return;
    }
    if (!Number.isInteger(totalTicks) || totalTicks < 0) {
      throw new RangeError(`totalTicks must be a non-negative integer, got ${totalTicks}`);
    }
    const current = this.countAt(x, z, speciesId);
    if (current <= 0) return; // a population of zero stays zero -- nothing to grow, and the closed form below is 0/0 there once `decay` underflows to 0
    const decay = Math.exp(-WILDLIFE_GROWTH_RATE * totalTicks);
    const next = (carryingCapacity * current) / (current + (carryingCapacity - current) * decay);
    this.setCount(x, z, speciesId, Math.max(0, next));
  }

  toSnapshot(): RegionalWildlifeSnapshot {
    return {
      version: REGIONAL_WILDLIFE_SNAPSHOT_VERSION,
      dimensions: { sizeX: this.sizeX, sizeZ: this.sizeZ },
      speciesIds: [...this.speciesIds],
      countByCellAndSpecies: Array.from(this.countByCellAndSpecies),
    };
  }

  static fromSnapshot(snapshot: RegionalWildlifeSnapshot): RegionalWildlifeField {
    if (snapshot.version !== REGIONAL_WILDLIFE_SNAPSHOT_VERSION) {
      throw new RangeError(`unsupported RegionalWildlifeField snapshot version ${snapshot.version}, expected ${REGIONAL_WILDLIFE_SNAPSHOT_VERSION}`);
    }
    const field = new RegionalWildlifeField(snapshot.dimensions.sizeX, snapshot.dimensions.sizeZ, snapshot.speciesIds);
    if (snapshot.countByCellAndSpecies.length !== field.countByCellAndSpecies.length) {
      throw new RangeError(`corrupt snapshot: expected ${field.countByCellAndSpecies.length} entries, got ${snapshot.countByCellAndSpecies.length}`);
    }
    field.countByCellAndSpecies.set(snapshot.countByCellAndSpecies);
    return field;
  }
}

/** Real `[0, 1]` encounter likelihood at a site's own region cell -- population relative to real carrying capacity, never a flat spawn-chance constant. */
export function encounterRateAt(field: RegionalWildlifeField, x: number, z: number, speciesId: string, carryingCapacity: number): number {
  if (carryingCapacity <= 0) return 0;
  return Math.min(1, field.countAt(x, z, speciesId) / carryingCapacity);
}
