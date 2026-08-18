/** Headless mesher tests: face culling, edge handling, AO darkening. */
import { describe, expect, it } from "vitest";
import { meshChunk, type CellSampler } from "../../src/render3d/world/terrain/voxel-mesher.js";

function samplerFor(solid: ReadonlySet<string>): CellSampler {
  return {
    isSolid: (x, y, z) => (y < 0 ? true : solid.has(`${x},${y},${z}`)),
    colorAt: (x, y, z) => (solid.has(`${x},${y},${z}`) ? [0.5, 0.5, 0.5] as const : undefined),
  };
}

describe("voxel mesher", () => {
  it("a single ground cell emits 5 faces (floor below seals the bottom)", () => {
    const mesh = meshChunk(samplerFor(new Set(["0,0,0"])), 0, 0, 1, 1, 1);
    expect(mesh.quadCount).toBe(5);
    expect(mesh.positions.length).toBe(5 * 4 * 3);
    expect(mesh.indices.length).toBe(5 * 6);
  });

  it("shared faces between adjacent cells are culled", () => {
    const mesh = meshChunk(samplerFor(new Set(["0,0,0", "1,0,0"])), 0, 0, 2, 1, 1);
    expect(mesh.quadCount).toBe(8); // 5+5-2 shared
  });

  it("a cell stacked on top hides the lower top face and upper bottom face", () => {
    const mesh = meshChunk(samplerFor(new Set(["0,0,0", "0,1,0"])), 0, 0, 1, 2, 1);
    // lower cell: 4 sides (floor seals bottom, upper cell hides top);
    // upper cell: 4 sides + its top = 5. Shared faces gone.
    expect(mesh.quadCount).toBe(9);
  });

  it("AO darkens a vertex hemmed in by neighbors vs an open one", () => {
    // A 3x3 pad at y=0 with a pillar at center top: the pillar's bottom
    // vertices sit inside a corner formed by the pad -> some AO < 1.
    const solid = new Set<string>();
    for (let x = 0; x < 3; x++) for (let z = 0; z < 3; z++) solid.add(`${x},0,${z}`);
    solid.add("1,1,1");
    const mesh = meshChunk(samplerFor(solid), 0, 0, 3, 2, 3);
    const minAo = Math.min(...mesh.ao);
    const maxAo = Math.max(...mesh.ao);
    expect(maxAo).toBe(1);
    expect(minAo).toBeLessThan(1);
  });

  it("deterministic: same input -> identical buffers", () => {
    const solid = new Set(["0,0,0", "1,0,0", "0,1,0"]);
    const a = meshChunk(samplerFor(solid), 0, 0, 2, 2, 1);
    const b = meshChunk(samplerFor(solid), 0, 0, 2, 2, 1);
    expect(Buffer.from(a.positions.buffer).equals(Buffer.from(b.positions.buffer))).toBe(true);
    expect(Buffer.from(a.indices.buffer).equals(Buffer.from(b.indices.buffer))).toBe(true);
  });
});
