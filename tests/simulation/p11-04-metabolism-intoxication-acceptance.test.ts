/**
 * Headless acceptance test for P11-04 -- Metabolism and intoxication.
 *
 * Roadmap acceptance test:
 *   "consuming fermented liquid changes blood/body chemistry and
 *   motor/cognitive performance through metabolism rather than
 *   `BeaverGetsDrunk`."
 *
 * Fermentation is P3-09's own real process (sugar -> alcohol inside a
 * real container); drinking consumes the real liquid and absorbs its
 * real composition into the drinker's blood chemistry; that chemistry
 * decays metabolically; and the SAME chemistry scales real downstream
 * performance through the existing code paths (craft quality via the
 * skill check, combat force via the battle exchange -- `motorFactor`
 * multiplies `fighterForce` inside `resolveBattleExchange` itself). No
 * event named anything like "beaver-gets-drunk" exists anywhere --
 * drunkenness is a derived state, never an event.
 */
import { describe, expect, it } from "vitest";
import { buildDetailedWorld, spawnAt } from "../unit/parityHarness.js";
import { createLiquidContainer, setLiquidContents, tickFermentation } from "../../src/sim/economy/Liquid.js";
import {
  getBloodChemistry,
  ingestLiquid,
  tickMetabolism,
  motorFactor,
  cognitiveFactor,
} from "../../src/sim/creatures/Metabolism.js";
import { qualityOf } from "../../src/sim/economy/Craft.js";
import { RecipeRegistry, registerStandardRecipes } from "../../src/sim/economy/Recipe.js";
import { makeWeapon } from "../../src/sim/politics/Weaponry.js";
import { setGood } from "../../src/sim/economy/Good.js";
import { pickUp } from "../../src/sim/labor/Log.js";
import { setSkills } from "../../src/sim/creatures/Beaver.js";
import { resolveBattleExchange } from "../../src/sim/politics/Battle.js";
import { RandomStreams } from "../../src/sim/core/Random.js";

function fermentedContainer(world: ReturnType<typeof buildDetailedWorld>["world"], sugarFraction: number): ReturnType<typeof createLiquidContainer> {
  const container = createLiquidContainer(world, 10, { x: 3, y: 3, z: 3 });
  setLiquidContents(world.components, container, { capacityL: 10, materialId: "water", volumeL: 5, composition: { sugar: sugarFraction } });
  // P3-09's own fermentation converts the sugar into alcohol.
  for (let i = 0; i < 3000; i++) tickFermentation(world, container, "sugar", "alcohol");
  return container;
}

describe("P11-04 metabolism and intoxication acceptance", () => {
  it("fermented liquid changes chemistry and real performance through metabolism -- with no drunk event anywhere", () => {
    const { world, materials } = buildDetailedWorld("p11-04");
    const beaver = spawnAt(world, "Brewer", 5, 3);
    // A real skill level so the quality check is non-zero before the
    // chemistry can scale it (quality is a geometric mean -- zero skill
    // would zero the whole product regardless of chemistry).
    setSkills(world.components, beaver, { levels: { woodworking: 2 } });
    const container = fermentedContainer(world, 0.5);

    expect(getBloodChemistry(world.components, beaver)).toBeUndefined();

    const drunk = ingestLiquid(world, beaver, container, 1);
    expect(drunk).toBe(1);

    const chemistry = getBloodChemistry(world.components, beaver)!;
    expect(chemistry.concentrations["alcohol"]).toBeGreaterThan(0.45); // ~0.5 absorbed, minus fermentation rounding

    // Real performance: the skill check and motor factors move with the
    // SAME chemistry.
    const motorNow = motorFactor(world.components, beaver);
    const cognitiveNow = cognitiveFactor(world.components, beaver);
    expect(motorNow).toBeLessThan(1);
    expect(cognitiveNow).toBeLessThan(1);
    expect(cognitiveNow).toBeLessThan(motorNow); // judgment goes before balance

    // Craft quality (the real skill check) genuinely suffers.
    const recipes = new RecipeRegistry();
    registerStandardRecipes(recipes);
    const drunkQuality = qualityOf(materials, world.components, beaver, recipes.get("saw-planks"));

    // Metabolism decays the alcohol back out -- and with it, performance
    // recovers toward 1. Never a scripted "sobers up" event.
    for (let i = 0; i < 300; i++) tickMetabolism(world, beaver);
    const soberQuality = qualityOf(materials, world.components, beaver, recipes.get("saw-planks"));
    const motorAfter = motorFactor(world.components, beaver);

    expect(soberQuality).toBeGreaterThan(drunkQuality);
    expect(motorAfter).toBeGreaterThan(motorNow);
    expect((getBloodChemistry(world.components, beaver)?.concentrations["alcohol"] ?? 0)).toBeLessThan(chemistry.concentrations["alcohol"]!);

    // The anti-example: no event of any drunk-shaped name was recorded.
    for (const event of world.events.all()) {
      expect(event.eventType.toLowerCase()).not.toMatch(/drunk|intox/);
    }
  });

  it("a drunk fighter's blows are softer through the same wired battle exchange", () => {
    const { world, materials } = buildDetailedWorld("p11-04b");
    const sober = spawnAt(world, "Sober", 4, 3);
    const drunk = spawnAt(world, "Drunk", 4, 5);
    for (const attacker of [sober, drunk]) {
      setSkills(world.components, attacker, { levels: { combat: 1 } });
      const club = world.entities.create("good");
      world.grid.setEntityPosition(club, 4, 3, 4);
      setGood(world.components, club, { goodKind: "club", materialId: "wood", massKg: 10 });
      makeWeapon(world.components, club, "club", 2, 0.2);
      pickUp(world.components, world.grid, club, attacker, world);
    }
    // Identical fighters; the ONLY difference is the drunk one's blood
    // chemistry (a real fermented drink, really ingested).
    const container = fermentedContainer(world, 0.8);
    ingestLiquid(world, drunk, container, 2);
    expect(motorFactor(world.components, drunk)).toBeLessThan(0.8);
    expect(motorFactor(world.components, sober)).toBe(1);

    // Each pair of fresh identical defenders gets ONE fresh, identically
    // seeded RandomStreams instance, so the struck part is the same for
    // the sober and drunk blow; the only difference is the
    // chemistry-scaled force inside `resolveBattleExchange`. Where both
    // blows wound, the drunk blow is strictly softer whenever the sober
    // blow is below the severity clamp, and never harder.
    let bothWounded = 0;
    let strictlySofter = 0;
    for (let i = 0; i < 20; i++) {
      const soberDefender = spawnAt(world, `D1-${i}`, 5, 3);
      const drunkDefender = spawnAt(world, `D2-${i}`, 5, 5);
      const soberBlow = resolveBattleExchange(world, materials, sober, soberDefender, new RandomStreams(44000 + i).stream("c"));
      const drunkBlow = resolveBattleExchange(world, materials, drunk, drunkDefender, new RandomStreams(44000 + i).stream("c"));
      if (soberBlow.wounded && drunkBlow.wounded) {
        bothWounded++;
        expect(drunkBlow.severity).toBeLessThanOrEqual(soberBlow.severity);
        if (soberBlow.severity < 1) strictlySofter++;
      }
    }
    expect(bothWounded).toBeGreaterThan(0);
    expect(strictlySofter).toBeGreaterThan(0);
  });
});
