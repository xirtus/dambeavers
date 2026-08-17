/**
 * Headless acceptance test for P4-01 -- Seasons.
 *
 * Roadmap acceptance test: "seasonal parameters alter temperature,
 * precipitation, plant state, and animal behavior."
 *
 * `currentSeason` is a pure function of tick; each of the four seasonal
 * parameters is a real per-season formula, and winter genuinely differs
 * from spring for all four -- temperature (annual sinusoid layered over
 * the unmodified daily one), precipitation, plant growth, and animal
 * activity.
 */
import { describe, expect, it } from "vitest";
import {
  currentSeason,
  yearPhase,
  seasonalAmbientTemperature,
  seasonalPrecipitationMultiplier,
  seasonalGrowthMultiplier,
  seasonalActivityMultiplier,
} from "../../src/sim/weather/Seasons.js";

const DAY = 2400;
const YEAR = DAY * 20;

describe("P4-01 -- Seasons", () => {
  it("seasonal parameters alter temperature, precipitation, plant state, and animal behavior", () => {
    const springTick = 0; // yearPhase 0 -> spring
    const summerTick = Math.round(YEAR * 0.25);
    const autumnTick = Math.round(YEAR * 0.5);
    const winterTick = Math.round(YEAR * 0.75);

    expect(currentSeason(springTick)).toBe("spring");
    expect(currentSeason(summerTick)).toBe("summer");
    expect(currentSeason(autumnTick)).toBe("autumn");
    expect(currentSeason(winterTick)).toBe("winter");
    expect(yearPhase(springTick)).toBe(0);
    expect(yearPhase(YEAR)).toBe(0); // the year is periodic

    // Temperature: the annual sinusoid makes winter genuinely colder than summer.
    expect(seasonalAmbientTemperature(winterTick)).toBeLessThan(seasonalAmbientTemperature(summerTick));

    // Precipitation: a real per-season table, not a constant.
    expect(seasonalPrecipitationMultiplier(springTick)).toBeGreaterThan(seasonalPrecipitationMultiplier(winterTick));
    expect(seasonalPrecipitationMultiplier(summerTick)).not.toBe(seasonalPrecipitationMultiplier(autumnTick));

    // Plant state: winter dormancy is near-zero growth, spring is active.
    expect(seasonalGrowthMultiplier(springTick)).toBeGreaterThan(seasonalGrowthMultiplier(autumnTick));
    expect(seasonalGrowthMultiplier(autumnTick)).toBeGreaterThan(seasonalGrowthMultiplier(winterTick));

    // Animal behavior: winter scarcity slows activity, spring raises it.
    expect(seasonalActivityMultiplier(springTick)).toBeGreaterThan(seasonalActivityMultiplier(winterTick));
  });
});
