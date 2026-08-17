import type { WorldGrid } from "../world/WorldGrid.js";
import type { TerrainField } from "../world/TerrainField.js";
import type { WaterField, ColumnCoordinate } from "./WaterField.js";
import type { WaterTemperatureField } from "./WaterTemperature.js";

/**
 * P4-12: freezing/thawing as an ordinary real material-state change --
 * `Dam.ts`/`Gate.ts`'s own "raise/remove real `TerrainField` material,
 * `Flow.ts`'s existing sill/permeability formula and `WorldGrid.surfaceY`-
 * based pathfinding do the rest" pattern applied to water itself. A real
 * body of water below `FREEZE_TEMPERATURE` (P4-11's own persisted
 * `WaterTemperatureField`) converts exactly `ICE_LAYER_THICKNESS` of its
 * own real depth into a real solid `"ice"` cap at the surface (walkable,
 * near-impermeable -- both real consequences of `"ice"`'s own material
 * properties, `standardMaterials.ts`, never a special-cased "ice blocks
 * things" rule). Thawing reverses EXACTLY that conversion (never more,
 * never less -- Law 1.6 conservation), which is why freezing only ever
 * triggers when at least `ICE_LAYER_THICKNESS` of real depth is present:
 * a shallow puddle below that threshold doesn't form a walkable cap in
 * this model (a real, documented simplification -- without it, thawing
 * would have to remember a variable amount per column, which no other
 * real state here currently tracks).
 */
export const FREEZE_TEMPERATURE = 0.15;
export const THAW_TEMPERATURE = 0.25;
export const ICE_LAYER_THICKNESS = 1;

export type IceOutcome = "froze" | "thawed" | "unchanged";

export function tickFreeze(grid: WorldGrid, terrain: TerrainField, water: WaterField, waterTemperature: WaterTemperatureField, site: ColumnCoordinate): IceOutcome {
  const topSolidY = grid.surfaceY(site.x, site.z);
  if (topSolidY === undefined) return "unchanged";
  const temperature = waterTemperature.temperatureAt(site.x, site.z);
  const alreadyIce = terrain.materialAt(site.x, topSolidY, site.z) === "ice";

  if (!alreadyIce && temperature < FREEZE_TEMPERATURE && water.depthAt(site.x, site.z) >= ICE_LAYER_THICKNESS) {
    // The ice cap forms at the water's own CURRENT surface (not directly
    // atop the lakebed) -- real liquid water can and does remain below
    // it, up to the new, lower surface `addVolume` produces.
    const surfaceY = water.waterSurfaceY(site.x, site.z)!;
    water.addVolume(site.x, site.z, -ICE_LAYER_THICKNESS);
    terrain.setMaterial(site.x, Math.floor(surfaceY), site.z, "ice");
    return "froze";
  }
  if (alreadyIce && temperature >= THAW_TEMPERATURE) {
    terrain.excavate(site.x, topSolidY, site.z);
    water.addVolume(site.x, site.z, ICE_LAYER_THICKNESS);
    return "thawed";
  }
  return "unchanged";
}

export function tickAllFreeze(grid: WorldGrid, terrain: TerrainField, water: WaterField, waterTemperature: WaterTemperatureField): void {
  const { sizeX, sizeZ } = grid.dims;
  for (let x = 0; x < sizeX; x++) {
    for (let z = 0; z < sizeZ; z++) {
      if (grid.surfaceY(x, z) === undefined) continue;
      tickFreeze(grid, terrain, water, waterTemperature, { x, z });
    }
  }
}
