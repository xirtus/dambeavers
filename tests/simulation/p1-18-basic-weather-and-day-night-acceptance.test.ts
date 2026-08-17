/**
 * Headless acceptance test for P1-18 — Basic weather and day/night.
 *
 * Roadmap acceptance test (DAMN_BEAVERS_MASTER_ROADMAP.md, P1-18):
 *   "rainfall measurably adds water to the watershed through the
 *   hydrology system."
 *
 * "Through the hydrology system" is the load-bearing phrase: precipitation
 * must add water via the SAME `WaterField`/`addVolume` primitive P1-02/
 * P1-03's own machinery already operates on (never a separate, parallel
 * rainfall counter), and the added water must then be genuinely subject to
 * P1-03's real `stepFlow` -- redistributing downhill exactly like water
 * from any other source, not sitting inertly wherever it happened to fall.
 * A real, sloped channel terrain (mirroring P1-03's own acceptance test)
 * starts completely bone dry; a real storm rains on it every tick,
 * interleaved with real `stepFlow` ticks, unmodified.
 */
import { describe, expect, it } from "vitest";
import { EntityIdRegistry } from "../../src/sim/core/EntityId.js";
import { WorldGrid } from "../../src/sim/world/WorldGrid.js";
import { TerrainField, applyHeightfield, type StrataLayer } from "../../src/sim/world/TerrainField.js";
import { MaterialRegistry } from "../../src/sim/materials/Material.js";
import { registerStandardMaterials } from "../../src/sim/materials/standardMaterials.js";
import { WaterField } from "../../src/sim/hydrology/WaterField.js";
import { stepFlow } from "../../src/sim/hydrology/Flow.js";
import { Weather, applyPrecipitation } from "../../src/sim/weather/Weather.js";

const SIZE_X = 5;
const SIZE_Y = 10;
const SIZE_Z = 16;

function buildSlopedChannel(): { grid: WorldGrid; terrain: TerrainField; materials: MaterialRegistry; water: WaterField } {
  const entities = new EntityIdRegistry();
  const grid = new WorldGrid({ sizeX: SIZE_X, sizeY: SIZE_Y, sizeZ: SIZE_Z }, entities);
  const materials = new MaterialRegistry();
  registerStandardMaterials(materials);
  const terrain = new TerrainField(grid, materials);
  const strata: StrataLayer[] = [
    { materialId: "soil", depth: 2 },
    { materialId: "stone", depth: 1000 },
  ];
  applyHeightfield(terrain, (_x, z) => 5 - (z / (SIZE_Z - 1)) * 3, strata); // gentle downhill slope, high z=0 to low z=SIZE_Z-1
  const water = new WaterField(grid);
  return { grid, terrain, materials, water };
}

describe("P1-18 acceptance: rainfall measurably adds water to the watershed through the hydrology system", () => {
  it("a real, sustained storm over a real sloped channel adds and redistributes real water", () => {
    const { grid, terrain, materials, water } = buildSlopedChannel();
    const weather = new Weather("storm");

    // Bone dry before any rain falls.
    expect(water.getDebugState().totalVolume).toBe(0);

    const dt = 1;
    const ticks = 40;
    for (let tick = 0; tick < ticks; tick++) {
      applyPrecipitation(water, grid, weather, dt); // the SAME WaterField stepFlow operates on -- no parallel counter
      stepFlow(water, terrain, materials, dt, { conductance: 0.6 });
    }

    // Rainfall genuinely added water to the watershed.
    const totalVolume = water.getDebugState().totalVolume;
    expect(totalVolume).toBeGreaterThan(0);

    // "Through the hydrology system": the rain didn't just sit wherever it
    // fell -- real stepFlow redistributed it downhill, so the low
    // downstream end has measurably more depth than the high upstream end,
    // exactly the same downhill behavior P1-03's own acceptance test
    // exercises for a constant point-source inflow.
    let upstreamDepth = 0;
    let downstreamDepth = 0;
    for (let x = 0; x < SIZE_X; x++) {
      upstreamDepth += water.depthAt(x, 0);
      downstreamDepth += water.depthAt(x, SIZE_Z - 1);
    }
    expect(downstreamDepth).toBeGreaterThan(upstreamDepth);
  });

  it("no rain falls, and no water appears, while weather stays clear", () => {
    const { grid, water } = buildSlopedChannel();
    const weather = new Weather("clear");
    for (let tick = 0; tick < 20; tick++) {
      applyPrecipitation(water, grid, weather, 1);
    }
    expect(water.getDebugState().totalVolume).toBe(0);
  });
});
