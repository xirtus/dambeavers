/**
 * Headless acceptance test for P11-02 -- Ecological engineering model.
 *
 * Roadmap acceptance test:
 *   "beaver construction can produce habitat mosaics with measurable
 *   knock-on effects across multiple species."
 *
 * One beaver dam genuinely changes the water field; the habitat mosaic
 * is reclassified from live state (water depth + fertility); and THREE
 * different species' own real response functions -- trout (P4-06's
 * aquatic habitat suitability), rabbit (its own wading depth), and
 * aspen (P4-15's real flood tolerance) -- all move at the same flooded
 * columns from the same reclassification. No per-species script knows
 * a dam exists.
 */
import { describe, expect, it } from "vitest";
import { buildDetailedWorld } from "../unit/parityHarness.js";
import { applyDamSegment } from "../../src/sim/hydrology/Dam.js";
import { setConstruction } from "../../src/sim/labor/Construction.js";
import { fillBasin } from "../../src/sim/hydrology/WaterField.js";
import {
  classifyHabitatColumn,
  habitatMosaic,
  mosaicClassCounts,
  speciesHabitatSuitability,
  plantMosaicHealth,
} from "../../src/sim/ecology/HabitatMosaic.js";
import { PlantSpeciesRegistry } from "../../src/sim/ecology/PlantSpecies.js";
import { registerStandardPlantSpecies } from "../../src/sim/ecology/standardPlantSpecies.js";
import { AnimalSpeciesRegistry } from "../../src/sim/creatures/AnimalSpecies.js";
import { registerStandardAnimalSpecies } from "../../src/sim/creatures/AnimalSpecies.js";

const FERTILE: (x: number, z: number) => number = () => 0.7;

describe("P11-02 ecological engineering acceptance", () => {
  it("one dam produces a habitat mosaic with knock-on effects across multiple species", () => {
    const { world } = buildDetailedWorld("p11-02");
    const plantSpecies = new PlantSpeciesRegistry();
    registerStandardPlantSpecies(plantSpecies);
    const animalSpecies = new AnimalSpeciesRegistry();
    registerStandardAnimalSpecies(animalSpecies);

    // A dry meadow depression (floor 1) below the surrounding flat land
    // (floor 2).
    for (const x of [5, 6, 7]) {
      for (const z of [4, 5, 6]) {
        world.terrain.excavate(x, 2, z);
      }
    }
    // The beaver construction: a dam RING around the basin, raised to
    // floor 3 -- the thing that will actually hold the pond above the
    // flat-land rim.
    const ring: Array<{ x: number; z: number }> = [
      { x: 4, z: 4 }, { x: 4, z: 5 }, { x: 4, z: 6 },
      { x: 8, z: 4 }, { x: 8, z: 5 }, { x: 8, z: 6 },
      { x: 5, z: 3 }, { x: 6, z: 3 }, { x: 7, z: 3 },
      { x: 5, z: 7 }, { x: 6, z: 7 }, { x: 7, z: 7 },
    ];
    for (const site of ring) {
      const construction = world.entities.create("construction");
      setConstruction(world.components, construction, {
        designationId: construction,
        kind: "dam-segment",
        site,
        requiredMaterialId: "wood",
        requiredMassKg: 1,
        workDone: 1,
        workRequired: 1,
        status: "complete",
      });
      applyDamSegment(world, construction);
    }

    // CONTROL: the same meadow, the same volume, but NO dam ring -- the
    // water spills across the flat land. The pond is genuinely held BY
    // the construction, not by the test's wishes.
    const control = buildDetailedWorld("p11-02-control");
    for (const x of [5, 6, 7]) {
      for (const z of [4, 5, 6]) {
        control.world.terrain.excavate(x, 2, z);
      }
    }
    expect(() => fillBasin(control.world.water, { x: 5, z: 5 }, 17)).toThrow();

    // BEFORE: the meadow is dry land; the mosaic says so; the species
    // respond to dry land.
    expect(classifyHabitatColumn(world, FERTILE, 5, 5)).toBe("dry-land");
    const troutBefore = speciesHabitatSuitability(world, animalSpecies, FERTILE, "trout", 5, 5);
    const rabbitBefore = speciesHabitatSuitability(world, animalSpecies, FERTILE, "rabbit", 5, 5);
    const aspenBefore = plantMosaicHealth(world, plantSpecies, "aspen", 5, 5);
    expect(troutBefore).toBe(0);
    expect(rabbitBefore).toBe(1);
    expect(aspenBefore).toBe(1);

    // THE CAUSE: the dam holds the pond (without the dam row this same
    // volume would spill across the open east side; the surface settles
    // just below the raised dam floor).
    fillBasin(world.water, { x: 5, z: 5 }, 17);

    // AFTER: the same columns are open water; the mosaic reclassified;
    // and three species moved at once from the same reclassification.
    expect(classifyHabitatColumn(world, FERTILE, 5, 5)).toBe("open-water");
    const counts = mosaicClassCounts(habitatMosaic(world, FERTILE));
    expect(counts["open-water"]).toBeGreaterThanOrEqual(3);

    const troutAfter = speciesHabitatSuitability(world, animalSpecies, FERTILE, "trout", 5, 5);
    const rabbitAfter = speciesHabitatSuitability(world, animalSpecies, FERTILE, "rabbit", 5, 5);
    const aspenAfter = plantMosaicHealth(world, plantSpecies, "aspen", 5, 5);
    expect(troutAfter).toBeGreaterThan(troutBefore);
    expect(rabbitAfter).toBeLessThan(rabbitBefore);
    expect(aspenAfter).toBeLessThan(aspenBefore);

    // The pond is genuinely held BY the dam: the dam columns are the
    // dry rim and the water surface sits at their raised floor.
    expect(world.water.depthAt(8, 5)).toBe(0);
    expect(world.water.depthAt(5, 5)).toBeGreaterThan(0);
  });

  it("the mosaic is a real classification of live state, not a fixed map", () => {
    const { world } = buildDetailedWorld("p11-02b");
    const before = classifyHabitatColumn(world, FERTILE, 10, 10);
    expect(before).toBe("dry-land");
    world.water.setDepth(10, 10, 0.3);
    expect(classifyHabitatColumn(world, FERTILE, 10, 10)).toBe("wetland");
    world.water.setDepth(10, 10, 1.0);
    expect(classifyHabitatColumn(world, FERTILE, 10, 10)).toBe("open-water");
    // A dry column next to the water reads damp edge when its soil is
    // fertile enough to hold the moisture.
    expect(classifyHabitatColumn(world, FERTILE, 11, 10)).toBe("damp-edge");
    world.water.setDepth(10, 10, 0);
    expect(classifyHabitatColumn(world, FERTILE, 11, 10)).toBe("dry-land");
  });
});
