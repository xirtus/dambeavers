/**
 * Headless acceptance test for P10-03 -- Creature/anatomy parity audit.
 *
 * Roadmap acceptance test: "representative multi-system injury scenarios
 * resolve without special-case death scripts."
 */
import { describe, expect, it } from "vitest";
import { parityRowsByDomain } from "../../src/sim/parity/ParityMatrix.js";
import { buildDetailedWorld } from "../unit/parityHarness.js";
import { spawnBeaver, getHealth, setHealth } from "../../src/sim/creatures/Beaver.js";
import { resolveAttack, getWounds, tickCreatureWounds } from "../../src/sim/creatures/Anatomy.js";
import { infect, tickInfectionProgress, PathogenRegistry, registerStandardPathogens } from "../../src/sim/creatures/Disease.js";
import { setNeeds, getNeeds } from "../../src/sim/creatures/Needs.js";
import { tickMortality } from "../../src/sim/creatures/Mortality.js";

describe("P10-03 -- Creature/anatomy parity audit", () => {
  it("every creature-domain row is marked with a verdict and written rationale", () => {
    const rows = parityRowsByDomain("creatures");
    expect(rows.length).toBeGreaterThanOrEqual(10);
    for (const row of rows) {
      expect(["PASS", "ADAPTED", "EXCEEDED", "OUT_OF_SCOPE"]).toContain(row.verdict);
      expect(row.rationale.trim().length).toBeGreaterThan(0);
    }
  });

  it("a multi-system injury (wound + infection + starvation) resolves through ordinary mechanisms with no special-case death script", () => {
    const { world } = buildDetailedWorld("p10-03");
    const victim = spawnBeaver(world, { name: "Victim", position: { x: 4, y: 3, z: 4 } });
    const attacker = spawnBeaver(world, { name: "Attacker", position: { x: 5, y: 3, z: 4 } });

    // Wound (anatomy), infection (disease), and starvation (needs) all
    // apply simultaneously -- three real systems, one body.
    const resolution = resolveAttack(world, attacker, victim, 5, 0, world.random.stream("p10-03"), undefined);
    expect(resolution.wounded).toBe(true);
    const wound = getWounds(world.components, victim)!.entries[0]!;
    expect(wound.bleedingRate).toBeGreaterThan(0);
    const pathogens = new PathogenRegistry();
    registerStandardPathogens(pathogens);
    infect(world, pathogens, victim, "swamp-fever");
    setNeeds(world.components, victim, { hunger: 1, thirst: 0.2, fatigue: 0.1, thermalComfort: 1 });

    // The three systems compound through ORDINARY ticks -- and whatever
    // death occurs is an ordinary mortality cause, never a scripted one.
    let deathEventType: string | undefined;
    for (let tick = 0; tick < 600 && world.entities.isLive(victim); tick++) {
      tickCreatureWounds(world, victim);
      tickInfectionProgress(world, pathogens, victim);
      if (world.entities.isLive(victim)) {
        world.clock.advanceTicks(1);
        tickMortality(world, world.water, victim);
      }
    }
    expect(world.entities.isLive(victim)).toBe(false);
    for (const event of world.events.eventsInvolving(victim)) {
      if (event.eventType.endsWith("-death")) deathEventType = event.eventType;
    }
    // The ordinary causes: bleeding out (trauma), infection (disease),
    // or starvation -- all real mechanisms, none a scripted outcome.
    expect(["trauma-death", "disease-death", "starvation-death"]).toContain(deathEventType);

    // The ordinary single-cause paths also work with no script:
    const doomed = spawnBeaver(world, { name: "Doomed", position: { x: 8, y: 3, z: 8 } });
    setHealth(world.components, doomed, { fraction: 0.001 });
    setNeeds(world.components, doomed, { hunger: 1, thirst: 0, fatigue: 0, thermalComfort: 1 });
    world.clock.advanceTicks(1);
    const result = tickMortality(world, world.water, doomed);
    expect(result.died).toBe(true);
    expect(result.cause).toBe("starvation"); // the credited cause is the real one
  });
});
