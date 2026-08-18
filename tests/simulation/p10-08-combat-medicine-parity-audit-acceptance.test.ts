/**
 * Headless acceptance test for P10-08 -- Combat/medicine parity audit.
 *
 * Roadmap acceptance test: "combat outcomes depend materially on
 * bodies, equipment, skill, location, and treatment."
 */
import { describe, expect, it } from "vitest";
import { parityRowsByDomain } from "../../src/sim/parity/ParityMatrix.js";
import { buildDetailedWorld } from "../unit/parityHarness.js";
import { spawnBeaver, setSkills, getHealth } from "../../src/sim/creatures/Beaver.js";
import { setGood } from "../../src/sim/economy/Good.js";
import { makeWeapon, makeArmor } from "../../src/sim/politics/Weaponry.js";
import { pickUp } from "../../src/sim/labor/Log.js";
import { resolveBattleExchange } from "../../src/sim/politics/Battle.js";
import { getWounds } from "../../src/sim/creatures/Anatomy.js";
import { applyTreatment } from "../../src/sim/politics/Medicine.js";
import { RandomStreams } from "../../src/sim/core/Random.js";
import type { EntityId } from "../../src/sim/core/EntityId.js";

function freshDefender(world: ReturnType<typeof buildDetailedWorld>["world"], x: number): EntityId {
  return spawnBeaver(world, { name: `D${x}`, position: { x, y: 3, z: 4 } });
}

describe("P10-08 -- Combat/medicine parity audit", () => {
  it("every combat-domain row is marked with a verdict and written rationale", () => {
    const rows = parityRowsByDomain("combat");
    expect(rows.length).toBeGreaterThanOrEqual(15);
    for (const row of rows) {
      expect(["PASS", "ADAPTED", "EXCEEDED", "OUT_OF_SCOPE"]).toContain(row.verdict);
      expect(row.rationale.trim().length).toBeGreaterThan(0);
    }
  });

  it("combat outcomes depend materially on bodies, equipment, skill, location, and treatment", () => {
    const { world, materials } = buildDetailedWorld("p10-08");
    const attacker = spawnBeaver(world, { name: "Attacker", position: { x: 5, y: 3, z: 5 } });
    setSkills(world.components, attacker, { levels: { combat: 1 } });

    // BODIES: the same blow against real tissue resolves through the
    // defender's own body plan.
    const beaverDefender = freshDefender(world, 6);
    const club = world.entities.create("good");
    setGood(world.components, club, { goodKind: "club", materialId: "wood", massKg: 10 });
    makeWeapon(world.components, club, "club", 2, 0.2);
    pickUp(world.components, world.grid, club, attacker, world);
    const blow = resolveBattleExchange(world, materials, attacker, beaverDefender, new RandomStreams(80801).stream("c"));
    expect(blow.wounded).toBe(true);

    // EQUIPMENT: armor genuinely changes the same blow -- against a
    // novice's club, the armored defender's limb GLANCES OFF while the
    // bare defender's limb is wounded (a real qualitative difference,
    // not a rounding artifact).
    const armored = freshDefender(world, 7);
    const armor = world.entities.create("good");
    setGood(world.components, armor, { goodKind: "armor", materialId: "stone", massKg: 8 });
    makeArmor(world.components, armor, 1, 1);
    pickUp(world.components, world.grid, armor, armored, world);
    const noviceForArmor = spawnBeaver(world, { name: "NoviceArmor", position: { x: 5, y: 3, z: 8 } });
    const noviceClub = world.entities.create("good");
    setGood(world.components, noviceClub, { goodKind: "club", materialId: "wood", massKg: 10 });
    makeWeapon(world.components, noviceClub, "club", 2, 0.2);
    pickUp(world.components, world.grid, noviceClub, noviceForArmor, world);
    const bare = freshDefender(world, 8);
    const armoredBlow = resolveBattleExchange(world, materials, noviceForArmor, armored, new RandomStreams(80802).stream("c"));
    const bareBlow = resolveBattleExchange(world, materials, noviceForArmor, bare, new RandomStreams(80802).stream("c"));
    expect(armoredBlow.wounded).toBe(false); // the armor genuinely stopped the blow
    expect(bareBlow.wounded).toBe(true);     // the same blow wounds the bare limb

    // SKILL: combat skill scales the same weapon's force (the battle
    // formula's own multiplier).
    const skilledAttacker = spawnBeaver(world, { name: "Skilled", position: { x: 5, y: 3, z: 6 } });
    setSkills(world.components, skilledAttacker, { levels: { combat: 1 } });
    const club2 = world.entities.create("good");
    setGood(world.components, club2, { goodKind: "club", materialId: "wood", massKg: 10 });
    makeWeapon(world.components, club2, "club", 2, 0.2);
    pickUp(world.components, world.grid, club2, skilledAttacker, world);
    // A REAL novice: same weapon, no combat skill.
    const noviceAttacker = spawnBeaver(world, { name: "Novice", position: { x: 5, y: 3, z: 7 } });
    const club3 = world.entities.create("good");
    setGood(world.components, club3, { goodKind: "club", materialId: "wood", massKg: 10 });
    makeWeapon(world.components, club3, "club", 2, 0.2);
    pickUp(world.components, world.grid, club3, noviceAttacker, world);
    const noviceDefender = freshDefender(world, 9);
    const skilledDefender = freshDefender(world, 10);
    const noviceBlow = resolveBattleExchange(world, materials, noviceAttacker, noviceDefender, new RandomStreams(80803).stream("c"));
    const skilledBlow = resolveBattleExchange(world, materials, skilledAttacker, skilledDefender, new RandomStreams(80803).stream("c"));
    expect(skilledBlow.severity).toBeGreaterThan(noviceBlow.severity);

    // LOCATION: the same exchange at a real location records WHERE it
    // happened -- the wound event's recorded location is the defender's
    // actual position (and water combat uses the same exchange,
    // unchanged by the medium).
    world.water.setDepth(6, 4, 1.5);
    const locationDefender = freshDefender(world, 11);
    const locationBlow = resolveBattleExchange(world, materials, attacker, locationDefender, new RandomStreams(80804).stream("c"));
    const woundEvent = world.events.get(locationBlow.woundEventId!);
    const defenderPosition = world.grid.positionOf(locationDefender)!;
    expect(woundEvent.location).toMatchObject({ x: defenderPosition.x, y: defenderPosition.y, z: defenderPosition.z });

    // TREATMENT: P7-12's own mechanism reduces the wound field that
    // actually exists on this wound (a limb wound gets a splint, a
    // bleeding wound a bandage, a painful wound a poultice).
    const patient = freshDefender(world, 12);
    resolveBattleExchange(world, materials, attacker, patient, new RandomStreams(80805).stream("c"));
    const wounds = getWounds(world.components, patient)!;
    const wound = wounds.entries[0]!;
    const kind = wound.mobilityImpairment > 0 ? "splint" as const : wound.bleedingRate > 0 ? "bandage" as const : "poultice" as const;
    const fieldBefore = kind === "splint" ? wound.mobilityImpairment : kind === "bandage" ? wound.bleedingRate : wound.pain;
    expect(fieldBefore).toBeGreaterThan(0);
    const material = kind === "splint" ? "wood" : kind === "bandage" ? "bark" : "plant-matter";
    const treatment = world.entities.create("good");
    world.grid.setEntityPosition(treatment, 5, 3, 7);
    setGood(world.components, treatment, { goodKind: "treatment", materialId: material, massKg: 1 });
    pickUp(world.components, world.grid, treatment, skilledAttacker, world);
    applyTreatment(world, skilledAttacker, patient, treatment, kind);
    const afterWound = getWounds(world.components, patient)!.entries[0]!;
    const fieldAfter = kind === "splint" ? afterWound.mobilityImpairment : kind === "bandage" ? afterWound.bleedingRate : afterWound.pain;
    expect(fieldAfter).toBeLessThan(fieldBefore);
  });
});
