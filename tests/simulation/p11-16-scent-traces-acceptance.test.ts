/**
 * Headless acceptance test for P11-16 -- Scent/chemical traces.
 *
 * Roadmap acceptance test:
 *   "a creature can locate or avoid something using a transported
 *   environmental trace rather than omniscient AI."
 *
 * A predator locates prey by following a REAL deposited, decaying,
 * water-transported scent field (P11-16's gradient walk), and loses it
 * when the trail is disrupted or has aged out -- while the omniscient
 * nearest-prey query still "knows" the prey is right there. The two
 * paths genuinely differ: scent is the non-omniscient one.
 */
import { describe, expect, it } from "vitest";
import { buildDetailedWorld } from "../unit/parityHarness.js";
import { ScentField, followScentGradient, SCENT_MIN_CONCENTRATION } from "../../src/sim/ecology/ScentField.js";
import { spawnAnimal, getAnimal } from "../../src/sim/creatures/Animal.js";
import { AnimalSpeciesRegistry, registerStandardAnimalSpecies } from "../../src/sim/creatures/AnimalSpecies.js";
import { nearestLivePrey, preyByScent, tickPredationByScent, nextScentStep } from "../../src/sim/creatures/Predation.js";
import { setNeeds } from "../../src/sim/creatures/Needs.js";
import type { EntityId } from "../../src/sim/core/EntityId.js";

function hungryFox(world: ReturnType<typeof buildDetailedWorld>["world"], animalSpecies: AnimalSpeciesRegistry, x: number, z: number): EntityId {
  const foxId = spawnAnimal(world, animalSpecies, "fox", { x, y: 3, z });
  setNeeds(world.components, foxId, { hunger: 1, thirst: 0, fatigue: 0, thermalComfort: 1 });
  return foxId;
}

/** A real deposited trail: strongest at the prey, fading with distance -- what a moving prey leaves behind. */
function depositTrail(scent: ScentField, preyX: number, preyZ: number, predatorX: number): void {
  const concentrations = [1.0, 0.8, 0.6, 0.4, 0.25, 0.15, 0.08];
  for (let i = 0; i < concentrations.length; i++) {
    const x = preyX - i;
    if (x < predatorX) break;
    scent.deposit(x, preyZ, concentrations[i]!);
  }
}

describe("P11-16 scent traces acceptance", () => {
  it("a predator finds prey along a real deposited trail -- and loses it when the trail is disrupted or aged out", () => {
    const { world, materials } = buildDetailedWorld("p11-16");
    const animalSpecies = new AnimalSpeciesRegistry();
    registerStandardAnimalSpecies(animalSpecies);
    const scent = new ScentField(world.grid.dims.sizeX, world.grid.dims.sizeZ);

    const preyId = spawnAnimal(world, animalSpecies, "rabbit", { x: 10, y: 3, z: 5 });
    const predatorId = hungryFox(world, animalSpecies, 4, 5);
    depositTrail(scent, 10, 5, 4);

    // The trail genuinely leads to the prey.
    const trailEnd = followScentGradient(scent, { x: 4, z: 5 });
    expect(trailEnd).toBeDefined();
    expect(trailEnd!.x).toBeGreaterThanOrEqual(9);

    // The non-omniscient path locates the prey through the trail; the
    // omniscient query also finds it (sanity: the prey really exists).
    expect(preyByScent(world, scent, predatorId, "rabbit")).toBe(preyId);
    expect(nearestLivePrey(world.entities, world.components, world.grid, animalSpecies, predatorId)).toBe(preyId);

    // Real pursuit: tick by tick the predator follows the gradient and
    // eventually hunts.
    let outcome: string = "idle";
    for (let tick = 0; tick < 20 && outcome !== "hunted"; tick++) {
      world.clock.advanceTicks(1);
      outcome = tickPredationByScent(world.grid, world.terrain, world.water, materials, world.entities, world.components, animalSpecies, world, predatorId, scent, "rabbit");
      scent.tickAll(world);
    }
    expect(outcome).toBe("hunted");
    expect(getAnimal(world.components, preyId)).toBeUndefined(); // really killed
  });

  it("a disrupted trail hides prey the omniscient query still sees", () => {
    const { world } = buildDetailedWorld("p11-16b");
    const animalSpecies = new AnimalSpeciesRegistry();
    registerStandardAnimalSpecies(animalSpecies);
    const scent = new ScentField(world.grid.dims.sizeX, world.grid.dims.sizeZ);

    const preyId = spawnAnimal(world, animalSpecies, "rabbit", { x: 10, y: 3, z: 5 });
    const predatorId = hungryFox(world, animalSpecies, 4, 5);
    depositTrail(scent, 10, 5, 4);
    expect(preyByScent(world, scent, predatorId, "rabbit")).toBe(preyId);

    // DISRUPT the middle of the trail (rain, a stream crossing, other
    // traffic -- whatever wiped the trace): the gradient no longer
    // connects the predator to the prey.
    for (let x = 6; x <= 8; x++) scent.setConcentration(x, 5, 0);
    expect(preyByScent(world, scent, predatorId, "rabbit")).toBeUndefined();
    // The omniscient path still "knows" -- the difference IS the point.
    expect(nearestLivePrey(world.entities, world.components, world.grid, animalSpecies, predatorId)).toBe(preyId);
    // The predator can still take ONE step onto the trail's surviving
    // edge -- and then the gradient dies at the gap: the trail leads
    // nowhere near the prey.
    const oneStep = nextScentStep(world, scent, predatorId);
    expect(oneStep).toEqual({ x: 5, z: 5 });
    const deadEnd = followScentGradient(scent, { x: 5, z: 5 });
    expect(deadEnd).toEqual({ x: 5, z: 5 });
  });

  it("an aged-out trail is gone -- decay genuinely erases it", () => {
    const { world } = buildDetailedWorld("p11-16c");
    const scent = new ScentField(world.grid.dims.sizeX, world.grid.dims.sizeZ);
    depositTrail(scent, 10, 5, 4);
    for (let tick = 0; tick < 600; tick++) {
      world.clock.advanceTicks(1);
      scent.tickAll(world);
    }
    // Every cell is below the minimum: nothing left to follow.
    let maxConcentration = 0;
    for (let x = 4; x <= 10; x++) maxConcentration = Math.max(maxConcentration, scent.concentrationAt(x, 5));
    expect(maxConcentration).toBeLessThan(SCENT_MIN_CONCENTRATION);
  });
});
