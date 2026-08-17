import type { EntityId } from "../core/EntityId.js";
import type { WorldGrid } from "../world/WorldGrid.js";
import type { ColumnCoordinate } from "../hydrology/WaterField.js";
import type { MaterialRegistry, MaterialId } from "../materials/Material.js";

/**
 * P3-10/P3-11: pure, generic structural-support and stress/wear
 * formulas over real geometry and real material properties -- no
 * component of its own, no dependency on `Construction.ts`/`Dam.ts`/
 * `Bridge.ts` (avoiding an import cycle with them, since they're the
 * ones that call INTO this file, not the other way around). This is
 * exactly the roadmap's own "support/strength rules rather than
 * construction type scripts" (P3-10's literal acceptance test): every
 * caller (`Dam.ts`, `Bridge.ts`) hands this file a plain, kind-agnostic
 * `StructuralSegmentView` list and asks the SAME question -- is this
 * segment grounded, or chained (through other live segments) to ground
 * within its own material's real `strength`-derived span -- regardless
 * of whether the segment happens to be a dam or a bridge.
 */
export interface StructuralSegmentView {
  id: EntityId;
  site: ColumnCoordinate;
  y: number;
  materialId: MaterialId;
}

function neighborsOf(site: ColumnCoordinate): ColumnCoordinate[] {
  return [
    { x: site.x + 1, z: site.z },
    { x: site.x - 1, z: site.z },
    { x: site.x, z: site.z + 1 },
    { x: site.x, z: site.z - 1 },
  ];
}

/**
 * True if `target` is grounded (real solid terrain directly beneath it)
 * or chain-connected, hop by hop through other live segments in
 * `allSegments` at the SAME height, to a grounded segment -- within a
 * maximum chain length derived from `target`'s own material `strength`
 * (a harder/stronger material can span further unsupported, a real,
 * tunable formula over `MaterialProperties`, never a hardcoded per-kind
 * span table). BFS, not a single-hop check, so a bridge/dam made of
 * several segments in a row is supported end-to-end from its two
 * grounded ends, not just the segment touching ground itself.
 */
export function isSupported(grid: WorldGrid, materials: MaterialRegistry, allSegments: readonly StructuralSegmentView[], target: StructuralSegmentView): boolean {
  const maxSpan = Math.max(1, Math.round(materials.get(target.materialId).strength));
  const byLocation = new Map<string, StructuralSegmentView[]>();
  for (const segment of allSegments) {
    const key = `${segment.site.x},${segment.y},${segment.site.z}`;
    const bucket = byLocation.get(key);
    if (bucket === undefined) byLocation.set(key, [segment]);
    else bucket.push(segment);
  }

  const visited = new Set<EntityId>([target.id]);
  let frontier: Array<{ site: ColumnCoordinate; y: number; hops: number }> = [{ site: target.site, y: target.y, hops: 0 }];
  while (frontier.length > 0) {
    const next: typeof frontier = [];
    for (const node of frontier) {
      if (grid.isSolid(node.site.x, node.y - 1, node.site.z)) return true;
      if (node.hops >= maxSpan) continue;
      for (const neighborSite of neighborsOf(node.site)) {
        const bucket = byLocation.get(`${neighborSite.x},${node.y},${neighborSite.z}`);
        if (bucket === undefined) continue;
        for (const neighbor of bucket) {
          if (visited.has(neighbor.id)) continue;
          visited.add(neighbor.id);
          next.push({ site: neighborSite, y: node.y, hops: node.hops + 1 });
        }
      }
    }
    frontier = next;
  }
  return false;
}

/** Real hydraulic force at a site -- deep, fast-moving water stresses a structure more than a shallow pool. Deliberately a formula over `WaterField.depthAt`'s own already-real depth, not a fabricated "damage per tick" constant. Plausible, tunable coefficient. */
export const HYDRAULIC_STRESS_COEFFICIENT = 0.0002;

export function hydraulicStress(waterDepth: number): number {
  return Math.max(0, waterDepth) * HYDRAULIC_STRESS_COEFFICIENT;
}

/** Applies `stressAmount` of wear to `currentIntegrity`, clamped to `[0, 1]` -- P3-11's own "repeated stress can weaken a structure progressively" made literal: called every tick a segment is under real hydraulic load, integrity trends toward 0 over real, accumulated exposure, never a single scripted "this structure type eventually breaks" event. */
export function stressedIntegrity(currentIntegrity: number, stressAmount: number): number {
  return Math.max(0, Math.min(1, currentIntegrity - stressAmount));
}
