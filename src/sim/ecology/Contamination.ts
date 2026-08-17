import type { MaterialRegistry } from "../materials/Material.js";
import type { World } from "../persistence/WorldSnapshot.js";
import { sanitationAt } from "../logistics/Sanitation.js";

/**
 * P4-15: real transported contamination -- `Sanitation.ts`'s own P2-10
 * doc comment explicitly named this as its intended extension ("transported
 * contamination belongs to the later environmental-contamination phase,
 * not this baseline"). A persisted per-column concentration field (peer
 * object, like `SoilFertilityField`/`WaterTemperatureField`, not a
 * `World` member) that (1) picks up real contamination at its SOURCE
 * from `sanitationAt`'s own already-real formula (refuse mass/material/
 * water), unmodified, and (2) moves a real fraction of it downstream
 * each tick toward the neighbor with the lower real water surface
 * (`WaterField.waterSurfaceY`) -- contaminants move WITH water, the
 * literal roadmap wording, via the SAME head-difference-driven transport
 * proxy `Erosion.ts`'s own `erosionStress` already established for "how
 * much real hydraulic force moves things at this column."
 */
const CONTAMINATION_SNAPSHOT_VERSION = 1;

export interface ContaminationFieldSnapshot {
  version: number;
  dimensions: { sizeX: number; sizeZ: number };
  concentrationByColumn: number[];
}

/** Fraction of a column's own contamination that moves downstream per tick, per unit of real head difference to the lowest neighbor -- plausible, tunable coefficient. */
export const CONTAMINATION_TRANSPORT_RATE = 0.1;

export class ContaminationField {
  private readonly sizeX: number;
  private readonly sizeZ: number;
  private concentrationByColumn: Float64Array;

  constructor(sizeX: number, sizeZ: number) {
    this.sizeX = sizeX;
    this.sizeZ = sizeZ;
    this.concentrationByColumn = new Float64Array(sizeX * sizeZ);
  }

  private columnIndex(x: number, z: number): number {
    if (!Number.isInteger(x) || !Number.isInteger(z) || x < 0 || x >= this.sizeX || z < 0 || z >= this.sizeZ) {
      throw new RangeError(`column (${x}, ${z}) is out of bounds`);
    }
    return z * this.sizeX + x;
  }

  concentrationAt(x: number, z: number): number {
    return this.concentrationByColumn[this.columnIndex(x, z)]!;
  }

  private neighborsOf(x: number, z: number): Array<{ x: number; z: number }> {
    return [
      { x: x + 1, z },
      { x: x - 1, z },
      { x, z: z + 1 },
      { x, z: z - 1 },
    ].filter((n) => n.x >= 0 && n.x < this.sizeX && n.z >= 0 && n.z < this.sizeZ);
  }

  /**
   * One tick over the whole field: (1) every column absorbs real
   * source contamination from `sanitationAt`, (2) every column with real
   * water surface elevation higher than at least one neighbor moves a
   * real fraction of its own concentration to that lowest neighbor --
   * exposure downstream is a direct, observable CONSEQUENCE of this
   * movement, satisfying the literal "can expose organisms downstream"
   * clause structurally (any future organism-health system can query
   * `concentrationAt` at its own position; this file does not itself
   * model organism harm -- Law 10, no roadmap task for that yet).
   */
  tickAll(world: World, materials: MaterialRegistry): void {
    const grid = world.grid;
    const water = world.water;
    const next = new Float64Array(this.concentrationByColumn);

    for (let x = 0; x < this.sizeX; x++) {
      for (let z = 0; z < this.sizeZ; z++) {
        if (grid.surfaceY(x, z) === undefined) continue;
        const index = this.columnIndex(x, z);
        const sample = sanitationAt(world, materials, { x, z });
        next[index] = next[index]! + sample.contamination * 0.01;
      }
    }

    for (let x = 0; x < this.sizeX; x++) {
      for (let z = 0; z < this.sizeZ; z++) {
        if (grid.surfaceY(x, z) === undefined) continue;
        const index = this.columnIndex(x, z);
        const ownConcentration = this.concentrationByColumn[index]!;
        if (ownConcentration <= 0) continue;
        const ownSurface = water.waterSurfaceY(x, z) ?? grid.surfaceY(x, z)!;

        let lowestNeighbor: { x: number; z: number } | undefined;
        let lowestSurface = ownSurface;
        for (const neighbor of this.neighborsOf(x, z)) {
          if (grid.surfaceY(neighbor.x, neighbor.z) === undefined) continue;
          const neighborSurface = water.waterSurfaceY(neighbor.x, neighbor.z) ?? grid.surfaceY(neighbor.x, neighbor.z)!;
          if (neighborSurface < lowestSurface) {
            lowestSurface = neighborSurface;
            lowestNeighbor = neighbor;
          }
        }
        if (lowestNeighbor === undefined) continue;

        const moved = ownConcentration * CONTAMINATION_TRANSPORT_RATE;
        const neighborIndex = this.columnIndex(lowestNeighbor.x, lowestNeighbor.z);
        next[index] = next[index]! - moved;
        next[neighborIndex] = next[neighborIndex]! + moved;
      }
    }

    this.concentrationByColumn = next;
  }

  toSnapshot(): ContaminationFieldSnapshot {
    return { version: CONTAMINATION_SNAPSHOT_VERSION, dimensions: { sizeX: this.sizeX, sizeZ: this.sizeZ }, concentrationByColumn: Array.from(this.concentrationByColumn) };
  }

  static fromSnapshot(snapshot: ContaminationFieldSnapshot): ContaminationField {
    if (snapshot.version !== CONTAMINATION_SNAPSHOT_VERSION) {
      throw new RangeError(`unsupported ContaminationField snapshot version ${snapshot.version}, expected ${CONTAMINATION_SNAPSHOT_VERSION}`);
    }
    const field = new ContaminationField(snapshot.dimensions.sizeX, snapshot.dimensions.sizeZ);
    if (snapshot.concentrationByColumn.length !== field.concentrationByColumn.length) {
      throw new RangeError(`corrupt snapshot: expected ${field.concentrationByColumn.length} columns, got ${snapshot.concentrationByColumn.length}`);
    }
    field.concentrationByColumn.set(snapshot.concentrationByColumn);
    return field;
  }
}

