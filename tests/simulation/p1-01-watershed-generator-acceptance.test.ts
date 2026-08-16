/**
 * Headless acceptance test for P1-01 — Watershed map generator.
 *
 * Roadmap acceptance test (DAMN_BEAVERS_MASTER_ROADMAP.md, P1-01):
 *   "100 seeds all generate at least one traversable bank and a connected
 *   downhill stream path across the map."
 *
 * "Traversable" and "connected downhill" describe TERRAIN GEOMETRY here --
 * no navigation (P1-04) or hydrology (P1-02/P1-03) exists yet. A path is
 * "connected" if it has a defined column for every z across the map
 * (there is no gap), "downhill" if elevation never increases along it,
 * and "traversable" if no single step's elevation change exceeds 1 cell
 * (a standard walkable-step threshold used here purely as a description
 * of the generated shape, not a claim about a real pathfinder).
 */
import { describe, expect, it } from "vitest";
import { createWorld } from "../../src/sim/runtime/SimulationRunner.js";
import { generateWatershed } from "../../src/sim/worldgen/WatershedGenerator.js";
import { PlantSpeciesRegistry } from "../../src/sim/ecology/PlantSpecies.js";
import { registerStandardPlantSpecies } from "../../src/sim/ecology/standardPlantSpecies.js";

const DIMS = { sizeX: 41, sizeY: 14, sizeZ: 61 };
const SEED_COUNT = 100;
const MAX_TRAVERSABLE_STEP = 1;
/** A fixed lateral offset from the meandering centerline, landing inside the "bank" classification band (dist in (2, 5]) for every z -- see WatershedGenerator's doc comment for why a path held at constant lateral distance from the centerline is downhill/bounded-step by construction. */
const BANK_PATH_OFFSET = 4;

describe("P1-01 acceptance: 100 seeds all produce a traversable bank and a connected downhill stream", () => {
  it("holds for seeds 0 through 99", () => {
    const species = new PlantSpeciesRegistry();
    registerStandardPlantSpecies(species);

    for (let seed = 0; seed < SEED_COUNT; seed++) {
      const world = createWorld({ seed, dimensions: DIMS });
      const layout = generateWatershed(world, { species });

      // -- connected downhill stream path: defined for every z, never increases --
      let previousChannelY = Number.POSITIVE_INFINITY;
      for (let z = 0; z < DIMS.sizeZ; z++) {
        const x = layout.channelCenterlineX[z]!;
        const y = world.grid.surfaceY(x, z);
        expect(y, `seed ${seed}: no surface at channel column (${x}, ${z})`).toBeDefined();
        expect(y!, `seed ${seed}: channel rose from ${previousChannelY} to ${y} at z=${z}`).toBeLessThanOrEqual(
          previousChannelY,
        );
        previousChannelY = y!;
      }

      // -- at least one traversable bank: a bank-classified path, connected across z, with every step <= 1 cell --
      let previousBankY: number | undefined;
      let bankColumnCount = 0;
      for (let z = 0; z < DIMS.sizeZ; z++) {
        const x = layout.channelCenterlineX[z]! + BANK_PATH_OFFSET;
        expect(x, `seed ${seed}: bank path left the map bounds at z=${z}`).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThan(DIMS.sizeX);
        expect(layout.classify(x, z), `seed ${seed}: bank path column (${x},${z}) is not classified as bank`).toBe(
          "bank",
        );
        const y = world.grid.surfaceY(x, z)!;
        bankColumnCount++;
        if (previousBankY !== undefined) {
          const step = Math.abs(y - previousBankY);
          expect(step, `seed ${seed}: bank path step too large at z=${z}: ${previousBankY} -> ${y}`).toBeLessThanOrEqual(
            MAX_TRAVERSABLE_STEP,
          );
        }
        previousBankY = y;
      }
      expect(bankColumnCount).toBe(DIMS.sizeZ); // connected across the entire map, not just a fragment

      // -- the map genuinely contains the roadmap's other required content, for every seed --
      expect(layout.treeIds.length, `seed ${seed}: no trees generated`).toBeGreaterThan(0);
      const classifications = new Set<string>();
      for (let x = 0; x < DIMS.sizeX; x += 2) {
        for (let z = 0; z < DIMS.sizeZ; z += 2) {
          classifications.add(layout.classify(x, z));
        }
      }
      expect(classifications.has("bank"), `seed ${seed}: no bank columns found`).toBe(true);
      expect(classifications.has("floodplain"), `seed ${seed}: no floodplain columns found`).toBe(true);
    }
  });
});
