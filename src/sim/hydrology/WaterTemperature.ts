import type { WorldGrid } from "../world/WorldGrid.js";
import type { WaterField } from "./WaterField.js";
import { seasonalAmbientTemperature } from "../weather/Seasons.js";

/**
 * P4-11: real, PERSISTED per-column water temperature -- a peer object
 * (like `SoilFertilityField`, P4-09), not a `World` member. Drifts slowly
 * toward the real current seasonal ambient temperature (`Seasons.ts`,
 * P4-01, unmodified) rather than snapping to it -- real thermal inertia:
 * a deep pond stays cold into early summer and warm into early winter,
 * exactly like real water. Dry columns hold their last real temperature
 * (nothing to warm/cool once the water is gone, and a column that refills
 * later should not have silently reset to some default).
 */
const WATER_TEMPERATURE_SNAPSHOT_VERSION = 1;

export interface WaterTemperatureFieldSnapshot {
  version: number;
  dimensions: { sizeX: number; sizeZ: number };
  temperatureByColumn: number[];
}

/** How much of the gap between stored water temperature and the current real ambient temperature closes per tick -- deliberately SLOWER than `SoilFertilityField`'s own drift rate (water has more thermal mass than topsoil). Plausible, tunable balance data. */
export const WATER_THERMAL_DRIFT_RATE = 0.002;

export class WaterTemperatureField {
  private readonly sizeX: number;
  private readonly sizeZ: number;
  private readonly temperatureByColumn: Float64Array;

  constructor(sizeX: number, sizeZ: number, initialTemperature = 0.5) {
    this.sizeX = sizeX;
    this.sizeZ = sizeZ;
    this.temperatureByColumn = new Float64Array(sizeX * sizeZ).fill(initialTemperature);
  }

  private columnIndex(x: number, z: number): number {
    if (!Number.isInteger(x) || !Number.isInteger(z) || x < 0 || x >= this.sizeX || z < 0 || z >= this.sizeZ) {
      throw new RangeError(`column (${x}, ${z}) is out of bounds`);
    }
    return z * this.sizeX + x;
  }

  temperatureAt(x: number, z: number): number {
    return this.temperatureByColumn[this.columnIndex(x, z)]!;
  }

  /** Real per-tick drift toward `seasonalAmbientTemperature(tick)`, but only for columns that actually hold real water right now (`WaterField.depthAt > 0`) -- a dry column's temperature is frozen (in the "unchanged" sense) at whatever it last was, never drifting toward air temperature it isn't actually exposed to as a body of water. */
  tick(water: WaterField, tick: number, x: number, z: number): void {
    if (water.depthAt(x, z) <= 0) return;
    const index = this.columnIndex(x, z);
    const target = seasonalAmbientTemperature(tick);
    const current = this.temperatureByColumn[index]!;
    this.temperatureByColumn[index] = current + (target - current) * WATER_THERMAL_DRIFT_RATE;
  }

  tickAll(grid: WorldGrid, water: WaterField, tick: number): void {
    for (let x = 0; x < this.sizeX; x++) {
      for (let z = 0; z < this.sizeZ; z++) {
        if (grid.surfaceY(x, z) === undefined) continue;
        this.tick(water, tick, x, z);
      }
    }
  }

  toSnapshot(): WaterTemperatureFieldSnapshot {
    return { version: WATER_TEMPERATURE_SNAPSHOT_VERSION, dimensions: { sizeX: this.sizeX, sizeZ: this.sizeZ }, temperatureByColumn: Array.from(this.temperatureByColumn) };
  }

  static fromSnapshot(snapshot: WaterTemperatureFieldSnapshot): WaterTemperatureField {
    if (snapshot.version !== WATER_TEMPERATURE_SNAPSHOT_VERSION) {
      throw new RangeError(`unsupported WaterTemperatureField snapshot version ${snapshot.version}, expected ${WATER_TEMPERATURE_SNAPSHOT_VERSION}`);
    }
    const field = new WaterTemperatureField(snapshot.dimensions.sizeX, snapshot.dimensions.sizeZ);
    if (snapshot.temperatureByColumn.length !== field.temperatureByColumn.length) {
      throw new RangeError(`corrupt snapshot: expected ${field.temperatureByColumn.length} columns, got ${snapshot.temperatureByColumn.length}`);
    }
    field.temperatureByColumn.set(snapshot.temperatureByColumn);
    return field;
  }
}
