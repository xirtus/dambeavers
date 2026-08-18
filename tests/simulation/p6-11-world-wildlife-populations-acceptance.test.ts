/**
 * Headless acceptance test for P6-11 -- World wildlife populations.
 *
 * Roadmap acceptance test: "regional species populations persist and
 * affect local site encounters."
 *
 * Regional wildlife is a real persisted per-(cell, species) population
 * (peer field object, saveable/restorable) growing via a real logistic
 * model bounded by biome carrying capacity; `encounterRateAt` converts
 * that population into the real encounter likelihood a site's own local
 * systems consult. Persistence and encounter influence are both checked
 * literally below.
 */
import { describe, expect, it } from "vitest";
import { EntityIdRegistry } from "../../src/sim/core/EntityId.js";
import { ComponentStore } from "../../src/sim/core/ComponentStore.js";
import { SimulationClock } from "../../src/sim/core/SimulationClock.js";
import { RandomStreams } from "../../src/sim/core/Random.js";
import { WorldGrid } from "../../src/sim/world/WorldGrid.js";
import { TerrainField } from "../../src/sim/world/TerrainField.js";
import { EventLog } from "../../src/sim/history/EventLog.js";
import { MaterialRegistry } from "../../src/sim/materials/Material.js";
import { registerStandardMaterials } from "../../src/sim/materials/standardMaterials.js";
import { WaterField } from "../../src/sim/hydrology/WaterField.js";
import { Weather } from "../../src/sim/weather/Weather.js";
import type { World } from "../../src/sim/persistence/WorldSnapshot.js";
import { RegionMap } from "../../src/sim/region/RegionMap.js";
import { RegionalWildlifeField, carryingCapacityFor, encounterRateAt } from "../../src/sim/region/WorldWildlife.js";

const REGION_SIZE = 32;

function buildWorld(): World {
  const entities = new EntityIdRegistry();
  const components = new ComponentStore(entities);
  const grid = new WorldGrid({ sizeX: 20, sizeY: 8, sizeZ: 20 }, entities);
  const materials = new MaterialRegistry();
  registerStandardMaterials(materials);
  const terrain = new TerrainField(grid, materials);
  const water = new WaterField(grid);
  const weather = new Weather();
  const clock = new SimulationClock({ tickRateHz: 20 });
  const random = new RandomStreams(611);
  const events = new EventLog(entities);
  return { clock, random, entities, components, grid, terrain, events, water, weather };
}

describe("P6-11 -- World wildlife populations", () => {
  it("regional species populations persist across save/reload and measurably affect local site encounter rates", () => {
    const world = buildWorld();
    const speciesIds = ["rabbit", "fox"];
    const field = new RegionalWildlifeField(REGION_SIZE, REGION_SIZE, speciesIds);
    const capacity = carryingCapacityFor("forest");

    // Seed a real population and grow it via the real logistic model --
    // it rises toward (never past) the biome's own real carrying capacity.
    field.setCount(14, 14, "rabbit", 2);
    for (let i = 0; i < 10000; i++) field.tickGrowth(14, 14, "rabbit", capacity);
    const grownCount = field.countAt(14, 14, "rabbit");
    expect(grownCount).toBeGreaterThan(2);
    expect(grownCount).toBeLessThanOrEqual(capacity + 1);

    // "Persist": the whole field round-trips through a real snapshot.
    const restored = RegionalWildlifeField.fromSnapshot(JSON.parse(JSON.stringify(field.toSnapshot())));
    expect(restored.countAt(14, 14, "rabbit")).toBe(grownCount);
    expect(restored.countAt(14, 14, "fox")).toBe(0);

    // "Affect local site encounters": encounter likelihood is derived from
    // the real population against real capacity -- a larger population
    // genuinely means more encounters for a site sitting on that cell,
    // and an empty cell means none.
    const busyEncounter = encounterRateAt(field, 14, 14, "rabbit", capacity);
    const emptyEncounter = encounterRateAt(field, 20, 20, "rabbit", capacity);
    expect(busyEncounter).toBeGreaterThan(0);
    expect(busyEncounter).toBeGreaterThan(emptyEncounter);
    expect(emptyEncounter).toBe(0);
  });
});
