import { describe, expect, it } from "vitest";
import { EntityIdRegistry } from "../../src/sim/core/EntityId.js";
import { WorldGrid } from "../../src/sim/world/WorldGrid.js";
import { TerrainField } from "../../src/sim/world/TerrainField.js";
import { MaterialRegistry } from "../../src/sim/materials/Material.js";
import { registerStandardMaterials } from "../../src/sim/materials/standardMaterials.js";
import { WaterField } from "../../src/sim/hydrology/WaterField.js";
import {
  DAY_LENGTH_TICKS,
  DAWN_PHASE,
  DUSK_PHASE,
  dayNightPhase,
  dayNumber,
  isDaytime,
  ambientTemperature,
  AMBIENT_TEMPERATURE_MIDPOINT,
  AMBIENT_TEMPERATURE_AMPLITUDE,
  Weather,
  PRECIPITATION_RATE_BY_CONDITION,
  applyPrecipitation,
  type WeatherCondition,
} from "../../src/sim/weather/Weather.js";

function buildFlatGrid(sizeX = 6, sizeZ = 6, floor = 2): { grid: WorldGrid; water: WaterField } {
  const entities = new EntityIdRegistry();
  const grid = new WorldGrid({ sizeX, sizeY: 8, sizeZ }, entities);
  const materials = new MaterialRegistry();
  registerStandardMaterials(materials);
  const terrain = new TerrainField(grid, materials);
  for (let x = 0; x < sizeX; x++) {
    for (let z = 0; z < sizeZ; z++) {
      for (let y = 0; y <= floor; y++) terrain.setMaterial(x, y, z, "soil");
    }
  }
  const water = new WaterField(grid);
  return { grid, water };
}

describe("dayNightPhase / dayNumber", () => {
  it("is 0 at the start of a day and approaches 1 at its end", () => {
    expect(dayNightPhase(0)).toBe(0);
    expect(dayNightPhase(DAY_LENGTH_TICKS - 1)).toBeCloseTo(1, 3);
  });

  it("wraps around to a new day", () => {
    expect(dayNightPhase(DAY_LENGTH_TICKS)).toBe(0);
    expect(dayNightPhase(DAY_LENGTH_TICKS + 10)).toBeCloseTo(10 / DAY_LENGTH_TICKS, 10);
  });

  it("dayNumber counts whole days elapsed", () => {
    expect(dayNumber(0)).toBe(0);
    expect(dayNumber(DAY_LENGTH_TICKS - 1)).toBe(0);
    expect(dayNumber(DAY_LENGTH_TICKS)).toBe(1);
    expect(dayNumber(DAY_LENGTH_TICKS * 3 + 5)).toBe(3);
  });

  it("rejects a negative or non-integer tick", () => {
    expect(() => dayNightPhase(-1)).toThrow(RangeError);
    expect(() => dayNightPhase(1.5)).toThrow(RangeError);
    expect(() => dayNumber(-1)).toThrow(RangeError);
  });
});

describe("isDaytime", () => {
  it("is false just before dawn and true just after", () => {
    const justBeforeDawn = Math.floor(DAWN_PHASE * DAY_LENGTH_TICKS) - 1;
    const justAfterDawn = Math.floor(DAWN_PHASE * DAY_LENGTH_TICKS);
    expect(isDaytime(justBeforeDawn)).toBe(false);
    expect(isDaytime(justAfterDawn)).toBe(true);
  });

  it("is true just before dusk and false just after", () => {
    const justBeforeDusk = Math.floor(DUSK_PHASE * DAY_LENGTH_TICKS) - 1;
    const justAfterDusk = Math.floor(DUSK_PHASE * DAY_LENGTH_TICKS);
    expect(isDaytime(justBeforeDusk)).toBe(true);
    expect(isDaytime(justAfterDusk)).toBe(false);
  });

  it("is false at solar midnight (tick 0)", () => {
    expect(isDaytime(0)).toBe(false);
  });
});

describe("ambientTemperature", () => {
  it("peaks at solar noon", () => {
    const noonTick = Math.round(0.5 * DAY_LENGTH_TICKS);
    expect(ambientTemperature(noonTick)).toBeCloseTo(AMBIENT_TEMPERATURE_MIDPOINT + AMBIENT_TEMPERATURE_AMPLITUDE, 6);
  });

  it("troughs at solar midnight", () => {
    expect(ambientTemperature(0)).toBeCloseTo(AMBIENT_TEMPERATURE_MIDPOINT - AMBIENT_TEMPERATURE_AMPLITUDE, 6);
  });

  it("is strictly warmer at noon than at midnight", () => {
    const noonTick = Math.round(0.5 * DAY_LENGTH_TICKS);
    expect(ambientTemperature(noonTick)).toBeGreaterThan(ambientTemperature(0));
  });

  it("is continuous -- adjacent ticks never jump discontinuously", () => {
    const midTick = Math.round(0.25 * DAY_LENGTH_TICKS);
    const delta = Math.abs(ambientTemperature(midTick + 1) - ambientTemperature(midTick));
    expect(delta).toBeLessThan(0.01);
  });
});

describe("Weather", () => {
  it("defaults to clear", () => {
    const weather = new Weather();
    expect(weather.condition).toBe("clear");
    expect(weather.precipitationRate).toBe(0);
  });

  it("derives precipitationRate purely from condition, never independently settable", () => {
    const weather = new Weather();
    for (const condition of Object.keys(PRECIPITATION_RATE_BY_CONDITION) as WeatherCondition[]) {
      weather.setCondition(condition);
      expect(weather.precipitationRate).toBe(PRECIPITATION_RATE_BY_CONDITION[condition]);
    }
  });

  it("rain and storm have a real positive rate; clear has none", () => {
    expect(PRECIPITATION_RATE_BY_CONDITION.clear).toBe(0);
    expect(PRECIPITATION_RATE_BY_CONDITION.rain).toBeGreaterThan(0);
    expect(PRECIPITATION_RATE_BY_CONDITION.storm).toBeGreaterThan(PRECIPITATION_RATE_BY_CONDITION.rain);
  });

  it("rejects an unknown condition", () => {
    const weather = new Weather();
    expect(() => weather.setCondition("blizzard" as WeatherCondition)).toThrow(RangeError);
  });

  it("REGRESSION (critic-found Moderate): rejects inherited Object.prototype keys, not just unrecognized strings", () => {
    // `PRECIPITATION_RATE_BY_CONDITION` is a plain object literal --
    // `Object.freeze` only freezes OWN properties, so the `in` operator
    // (unlike `Object.hasOwn`) matches inherited Object.prototype keys
    // too. A validation check using `in` would silently accept
    // "constructor"/"toString"/"hasOwnProperty" as if they were real
    // conditions.
    const weather = new Weather();
    for (const poisoned of ["constructor", "toString", "hasOwnProperty", "valueOf", "__proto__"]) {
      expect(() => weather.setCondition(poisoned as WeatherCondition)).toThrow(RangeError);
      expect(() => Weather.fromSnapshot({ version: 1, condition: poisoned as WeatherCondition })).toThrow(RangeError);
    }
  });

  it("round-trips through toSnapshot/fromSnapshot", () => {
    const weather = new Weather("storm");
    const restored = Weather.fromSnapshot(weather.toSnapshot());
    expect(restored.condition).toBe("storm");
    expect(restored.precipitationRate).toBe(PRECIPITATION_RATE_BY_CONDITION.storm);
  });

  it("rejects a corrupt snapshot version or condition", () => {
    expect(() => Weather.fromSnapshot({ version: 999, condition: "clear" })).toThrow(RangeError);
    expect(() => Weather.fromSnapshot({ version: 1, condition: "blizzard" as WeatherCondition })).toThrow(RangeError);
  });
});

describe("applyPrecipitation", () => {
  it("does nothing while clear", () => {
    const { grid, water } = buildFlatGrid();
    const weather = new Weather("clear");
    applyPrecipitation(water, grid, weather, 10);
    expect(water.getDebugState().totalVolume).toBe(0);
  });

  it("adds real volume to every real-ground column while raining", () => {
    const { grid, water } = buildFlatGrid(4, 4);
    const weather = new Weather("rain");
    applyPrecipitation(water, grid, weather, 10);
    const expectedPerColumn = PRECIPITATION_RATE_BY_CONDITION.rain * 10;
    for (let x = 0; x < 4; x++) {
      for (let z = 0; z < 4; z++) {
        expect(water.depthAt(x, z)).toBeCloseTo(expectedPerColumn, 10);
      }
    }
  });

  it("storm adds more volume than rain for the same duration", () => {
    const rainWorld = buildFlatGrid(4, 4);
    applyPrecipitation(rainWorld.water, rainWorld.grid, new Weather("rain"), 10);
    const stormWorld = buildFlatGrid(4, 4);
    applyPrecipitation(stormWorld.water, stormWorld.grid, new Weather("storm"), 10);
    expect(stormWorld.water.getDebugState().totalVolume).toBeGreaterThan(rainWorld.water.getDebugState().totalVolume);
  });

  it("skips ungenerated columns with no real ground", () => {
    const entities = new EntityIdRegistry();
    const grid = new WorldGrid({ sizeX: 4, sizeY: 8, sizeZ: 4 }, entities);
    // No terrain placed anywhere -- every column has no ground.
    const water = new WaterField(grid);
    applyPrecipitation(water, grid, new Weather("storm"), 10);
    expect(water.getDebugState().totalVolume).toBe(0);
  });

  it("scales linearly with dtSeconds", () => {
    const short = buildFlatGrid(3, 3);
    applyPrecipitation(short.water, short.grid, new Weather("rain"), 5);
    const long = buildFlatGrid(3, 3);
    applyPrecipitation(long.water, long.grid, new Weather("rain"), 10);
    expect(long.water.getDebugState().totalVolume).toBeCloseTo(short.water.getDebugState().totalVolume * 2, 6);
  });

  it("rejects a negative dtSeconds", () => {
    const { grid, water } = buildFlatGrid();
    expect(() => applyPrecipitation(water, grid, new Weather("rain"), -1)).toThrow(RangeError);
  });
});
