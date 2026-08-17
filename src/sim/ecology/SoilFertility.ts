import type { WorldGrid } from "../world/WorldGrid.js";
import type { WaterField } from "../hydrology/WaterField.js";
import { currentWetness } from "./EcologyResponse.js";

/**
 * P4-09: real, PERSISTED per-column soil moisture memory -- deliberately
 * NOT a `World` member (mirrors `MaterialRegistry`/`PlantSpeciesRegistry`'s
 * own "peer object, constructed once, passed to whichever functions need
 * it" precedent rather than growing `World`'s own interface, which every
 * existing test in this codebase constructs by hand). `moisture` drifts
 * slowly toward the column's REAL current wetness (`EcologyResponse.ts`'s
 * `currentWetness`, unmodified) rather than snapping to it -- so a
 * column that floods briefly and dries doesn't instantly forget the
 * flood, and a column that's been dry for a long time doesn't instantly
 * "remember" a single wet tick. This IS the roadmap's own "soil state"
 * that flooding/drying changes.
 */
const SOIL_FERTILITY_SNAPSHOT_VERSION = 1;

export interface SoilFertilityFieldSnapshot {
  version: number;
  dimensions: { sizeX: number; sizeZ: number };
  moistureByColumn: number[];
}

/** How much of the gap between stored moisture and current real wetness closes per tick -- plausible, tunable balance data, kept small so moisture is genuinely a slow-moving memory, not an instant mirror of `currentWetness`. */
export const SOIL_MOISTURE_DRIFT_RATE = 0.01;

export class SoilFertilityField {
  private readonly sizeX: number;
  private readonly sizeZ: number;
  private readonly moistureByColumn: Float64Array;

  constructor(sizeX: number, sizeZ: number) {
    this.sizeX = sizeX;
    this.sizeZ = sizeZ;
    this.moistureByColumn = new Float64Array(sizeX * sizeZ);
  }

  private columnIndex(x: number, z: number): number {
    if (!Number.isInteger(x) || !Number.isInteger(z) || x < 0 || x >= this.sizeX || z < 0 || z >= this.sizeZ) {
      throw new RangeError(`column (${x}, ${z}) is out of bounds`);
    }
    return z * this.sizeX + x;
  }

  moistureAt(x: number, z: number): number {
    return this.moistureByColumn[this.columnIndex(x, z)]!;
  }

  /** Real per-tick moisture memory update -- drifts toward `currentWetness` at `SOIL_MOISTURE_DRIFT_RATE`, driven by the actual `WaterField` state, never a scripted "it rained so moisture = 1" assignment. */
  tick(water: WaterField, x: number, z: number): void {
    const index = this.columnIndex(x, z);
    const wetness = currentWetness(water, x, z);
    const current = this.moistureByColumn[index]!;
    this.moistureByColumn[index] = current + (wetness - current) * SOIL_MOISTURE_DRIFT_RATE;
  }

  tickAll(grid: WorldGrid, water: WaterField): void {
    for (let x = 0; x < this.sizeX; x++) {
      for (let z = 0; z < this.sizeZ; z++) {
        if (grid.surfaceY(x, z) === undefined) continue;
        this.tick(water, x, z);
      }
    }
  }

  toSnapshot(): SoilFertilityFieldSnapshot {
    return { version: SOIL_FERTILITY_SNAPSHOT_VERSION, dimensions: { sizeX: this.sizeX, sizeZ: this.sizeZ }, moistureByColumn: Array.from(this.moistureByColumn) };
  }

  static fromSnapshot(snapshot: SoilFertilityFieldSnapshot): SoilFertilityField {
    if (snapshot.version !== SOIL_FERTILITY_SNAPSHOT_VERSION) {
      throw new RangeError(`unsupported SoilFertilityField snapshot version ${snapshot.version}, expected ${SOIL_FERTILITY_SNAPSHOT_VERSION}`);
    }
    const field = new SoilFertilityField(snapshot.dimensions.sizeX, snapshot.dimensions.sizeZ);
    if (snapshot.moistureByColumn.length !== field.moistureByColumn.length) {
      throw new RangeError(`corrupt snapshot: expected ${field.moistureByColumn.length} columns, got ${snapshot.moistureByColumn.length}`);
    }
    field.moistureByColumn.set(snapshot.moistureByColumn);
    return field;
  }
}

/** Real fertility `[0, 1]` derived from remembered soil moisture -- peaks at a moderate moisture (real soil science: waterlogged and bone-dry soil are both LESS fertile than moderately moist soil), never a flat "wetter is always better" curve. `IDEAL_MOISTURE` is deliberately mid-range, distinct from any one plant species' own `moisturePreference` (this is a property of the SOIL, not of any species growing on it). */
export const IDEAL_SOIL_MOISTURE = 0.4;

export function soilFertility(field: SoilFertilityField, x: number, z: number): number {
  const moisture = field.moistureAt(x, z);
  return Math.max(0, 1 - Math.abs(moisture - IDEAL_SOIL_MOISTURE) / IDEAL_SOIL_MOISTURE);
}
