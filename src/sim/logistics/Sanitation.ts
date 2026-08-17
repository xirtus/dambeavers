import type { EntityId } from "../core/EntityId.js";
import type { ColumnCoordinate } from "../hydrology/WaterField.js";
import type { MaterialRegistry } from "../materials/Material.js";
import type { World } from "../persistence/WorldSnapshot.js";
import { getRefuse } from "./Refuse.js";

/**
 * P2-10's sanitation baseline is a live-derived environmental quality
 * query, not a second persistent contamination grid. The authoritative
 * facts are already persistent: physical refuse entities, their material
 * and mass, their real `WorldGrid` positions, and local `WaterField`
 * depth. This module composes those facts into a measurable local quality
 * variable for debug/tests/future needs, so save/reload cannot make a
 * derived sanitation field drift from the objects that caused it.
 */

export interface SanitationSample {
  column: ColumnCoordinate;
  refuseItemIds: EntityId[];
  refuseMassKg: number;
  waterDepth: number;
  contamination: number;
  environmentalQuality: number;
}

export interface SanitationDebugState {
  contaminatedColumns: SanitationSample[];
}

/** Base contamination added per kg of refuse at the sampled column. */
export const REFUSE_CONTAMINATION_PER_KG = 0.08;

/**
 * Standing water leaches waste into the local environment. This is a
 * local multiplier only; transported contamination belongs to the later
 * environmental-contamination phase, not this baseline.
 */
export const WATER_LEACH_MULTIPLIER_PER_DEPTH = 1;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function materialContaminationFactor(materialDecayResistance: number): number {
  return 1 - materialDecayResistance;
}

export function sanitationAt(world: World, materials: MaterialRegistry, column: ColumnCoordinate): SanitationSample {
  const waterDepth = world.water.depthAt(column.x, column.z);
  const refuseItemIds: EntityId[] = [];
  let weightedMassKg = 0;
  let refuseMassKg = 0;

  for (const refuseId of world.entities.liveIdsOfKind("refuse").sort((a, b) => a - b)) {
    const position = world.grid.positionOf(refuseId);
    if (position === undefined || position.x !== column.x || position.z !== column.z) continue;
    const refuse = getRefuse(world.components, refuseId);
    if (refuse === undefined) continue;
    refuseItemIds.push(refuseId);
    refuseMassKg += refuse.massKg;
    weightedMassKg += refuse.massKg * materialContaminationFactor(materials.get(refuse.materialId).decayResistance);
  }

  const waterMultiplier = 1 + waterDepth * WATER_LEACH_MULTIPLIER_PER_DEPTH;
  const contamination = weightedMassKg * REFUSE_CONTAMINATION_PER_KG * waterMultiplier;
  return {
    column: { x: column.x, z: column.z },
    refuseItemIds,
    refuseMassKg,
    waterDepth,
    contamination,
    environmentalQuality: clamp01(1 - contamination),
  };
}

export function getSanitationDebugState(world: World, materials: MaterialRegistry): SanitationDebugState {
  const contaminatedColumns: SanitationSample[] = [];
  const { sizeX, sizeZ } = world.grid.dims;
  for (let x = 0; x < sizeX; x++) {
    for (let z = 0; z < sizeZ; z++) {
      const sample = sanitationAt(world, materials, { x, z });
      if (sample.contamination > 0) contaminatedColumns.push(sample);
    }
  }
  return { contaminatedColumns };
}
