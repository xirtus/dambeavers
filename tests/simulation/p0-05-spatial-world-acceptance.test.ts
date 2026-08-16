/**
 * Headless acceptance test for P0-05 — Spatial world representation.
 *
 * Roadmap acceptance test (DAMN_BEAVERS_MASTER_ROADMAP.md, P0-05):
 *   "entities can exist above, below, inside, and adjacent to terrain
 *   volumes and can be queried correctly."
 *
 * WorldGrid itself has no concept of "terrain" semantics yet (that's
 * P0-09) -- for this test, "terrain volume" is simply a block of solid
 * cells, which is exactly the generic substrate P0-09 will later attach
 * soil/rock material identity to.
 */
import { describe, expect, it } from "vitest";
import { WorldGrid } from "../../src/sim/world/WorldGrid.js";
import { EntityIdRegistry } from "../../src/sim/core/EntityId.js";

describe("P0-05 acceptance: entities above, below, inside, and adjacent to terrain volumes", () => {
  it("correctly represents and queries all four spatial relationships", () => {
    const registry = new EntityIdRegistry();
    const grid = new WorldGrid({ sizeX: 5, sizeY: 5, sizeZ: 5 }, registry);

    // A terrain volume: a solid ground block two cells tall (y=0,1) under
    // the entire map, air above -- a minimal stand-in for a riverbank
    // cross-section, without pre-empting P0-09's actual terrain generator.
    for (let x = 0; x < 5; x++) {
      for (let z = 0; z < 5; z++) {
        grid.setSolid(x, 0, z, true);
        grid.setSolid(x, 1, z, true);
      }
    }
    expect(grid.surfaceY(2, 2)).toBe(1);

    const onSurface = registry.create("beaver");
    grid.setEntityPosition(onSurface, 2, 2, 2); // one cell above the surface

    const insideTerrain = registry.create("root"); // e.g. a buried root system
    grid.setEntityPosition(insideTerrain, 2, 1, 2); // occupies a SOLID cell

    const flyer = registry.create("bird");
    grid.setEntityPosition(flyer, 2, 3, 2); // one cell above onSurface

    const neighbor = registry.create("beaver");
    grid.setEntityPosition(neighbor, 3, 2, 2); // horizontally adjacent to onSurface

    // -- inside a terrain volume --
    const insideCell = grid.positionOf(insideTerrain)!;
    expect(grid.isSolid(insideCell.x, insideCell.y, insideCell.z)).toBe(true);
    expect(grid.entitiesAt(insideCell.x, insideCell.y, insideCell.z)).toEqual([insideTerrain]);

    // -- below another entity, and specifically below the terrain surface's air layer --
    const surfaceCell = grid.positionOf(onSurface)!;
    expect(grid.isSolid(surfaceCell.x, surfaceCell.y, surfaceCell.z)).toBe(false);
    expect(grid.below(surfaceCell.x, surfaceCell.y, surfaceCell.z)).toEqual(insideCell);
    expect(grid.isAdjacent(surfaceCell, insideCell)).toBe(true);

    // -- above another entity --
    const flyerCell = grid.positionOf(flyer)!;
    expect(grid.above(surfaceCell.x, surfaceCell.y, surfaceCell.z)).toEqual(flyerCell);
    expect(grid.isAdjacent(surfaceCell, flyerCell)).toBe(true);

    // -- adjacent to another entity (horizontally) --
    const neighborCell = grid.positionOf(neighbor)!;
    expect(grid.isAdjacent(surfaceCell, neighborCell)).toBe(true);

    // Cross-check via the grid's own neighbor enumeration: an interior
    // cell has 6 orthogonal neighbors, exactly 3 of which are occupied by
    // the other three entities placed above/below/adjacent to it.
    const surfaceNeighbors = grid.neighbors6(surfaceCell.x, surfaceCell.y, surfaceCell.z);
    expect(surfaceNeighbors).toHaveLength(6);
    const occupiedNeighborEntities = surfaceNeighbors.flatMap((c) => grid.entitiesAt(c.x, c.y, c.z));
    expect(occupiedNeighborEntities.sort()).toEqual([insideTerrain, flyer, neighbor].sort());

    // Not adjacent to something two cells away, and not solid where it stands.
    const farAway = { x: 0, y: 4, z: 0 };
    expect(grid.isAdjacent(surfaceCell, farAway)).toBe(false);
  });
});
