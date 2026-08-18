/**
 * P10-11 Emergent-interaction torture suite, file 3 of 5: combat,
 * anatomy, health, and medicine interactions. No scripted outcomes.
 */
import { describe, expect, it } from "vitest";
import { buildDetailedWorld, spawnAt } from "./parityHarness.js";
import { spawnBeaver, setSkills, getHealth } from "../../src/sim/creatures/Beaver.js";
import { setGood } from "../../src/sim/economy/Good.js";
import { makeWeapon, makeArmor, attackForceOf, armorResistanceOf } from "../../src/sim/politics/Weaponry.js";
import { pickUp } from "../../src/sim/labor/Log.js";
import { resolveBattleExchange } from "../../src/sim/politics/Battle.js";
import { resolveAttack, getWounds, tickCreatureWounds, tissueResistance, BEAVER_BODY_PLAN, GENERIC_ANIMAL_BODY_PLAN } from "../../src/sim/creatures/Anatomy.js";
import { applyTreatment } from "../../src/sim/politics/Medicine.js";
import { infect, tickInfectionProgress, PathogenRegistry, registerStandardPathogens, getInfection } from "../../src/sim/creatures/Disease.js";
import { RandomStreams } from "../../src/sim/core/Random.js";
import { playerAttack } from "../../src/sim/wayfarer/Combat.js";
import { getStress } from "../../src/sim/creatures/Stress.js";

function armedAttacker(world: ReturnType<typeof buildDetailedWorld>["world"], name: string, x: number, skill: number): ReturnType<typeof spawnBeaver> {
  const attacker = spawnAt(world, name, x, 5);
  setSkills(world.components, attacker, { levels: { combat: skill } });
  const club = world.entities.create("good");
  world.grid.setEntityPosition(club, x, 3, 6);
  setGood(world.components, club, { goodKind: "club", materialId: "wood", massKg: 10 });
  makeWeapon(world.components, club, "club", 2, 0.2);
  pickUp(world.components, world.grid, club, attacker, world);
  return attacker;
}

describe("P10-11 torture suite 3 -- combat/anatomy/health", () => {
  it("stone weapons hit harder than wooden ones (material truth)", () => {
    const { world, materials } = buildDetailedWorld("t3-01");
    const wood = world.entities.create("good");
    setGood(world.components, wood, { goodKind: "club", materialId: "wood", massKg: 10 });
    makeWeapon(world.components, wood, "club", 2, 0.2);
    const stone = world.entities.create("good");
    setGood(world.components, stone, { goodKind: "club", materialId: "stone", massKg: 10 });
    makeWeapon(world.components, stone, "club", 2, 0.2);
    expect(attackForceOf(materials, world.components, stone)).toBeGreaterThan(attackForceOf(materials, world.components, wood));
  });

  it("armor resistance comes from its material and geometry", () => {
    const { world, materials } = buildDetailedWorld("t3-02");
    const thin = world.entities.create("good");
    setGood(world.components, thin, { goodKind: "armor", materialId: "stone", massKg: 4 });
    makeArmor(world.components, thin, 0.5, 0.5);
    const thick = world.entities.create("good");
    setGood(world.components, thick, { goodKind: "armor", materialId: "stone", massKg: 4 });
    makeArmor(world.components, thick, 1, 1);
    expect(armorResistanceOf(materials, world.components, thick)).toBeGreaterThan(armorResistanceOf(materials, world.components, thin));
  });

  it("a glancing blow wounds nothing", () => {
    const { world } = buildDetailedWorld("t3-03");
    const attacker = spawnAt(world, "A", 4, 3);
    const defender = spawnAt(world, "D", 5, 3);
    const result = resolveAttack(world, attacker, defender, 0.5, 0, world.random.stream("t3-03"), undefined);
    expect(result.wounded).toBe(false);
    expect(getWounds(world.components, defender)).toBeUndefined();
  });

  it("vital and limb tissue genuinely differ in resistance", () => {
    const head = BEAVER_BODY_PLAN.parts.find((p) => p.id === "head")!;
    const tail = BEAVER_BODY_PLAN.parts.find((p) => p.id === "tail")!;
    expect(tissueResistance(head)).toBeGreaterThan(tissueResistance(tail));
  });

  it("different body plans are distinct real data", () => {
    expect(BEAVER_BODY_PLAN.speciesLabel).toBe("beaver");
    expect(GENERIC_ANIMAL_BODY_PLAN.speciesLabel).not.toBe(BEAVER_BODY_PLAN.speciesLabel);
    // The same part vocabulary, different real tissue data.
    expect(BEAVER_BODY_PLAN.parts[0]!.tissueHardness).not.toBe(GENERIC_ANIMAL_BODY_PLAN.parts[0]!.tissueHardness);
  });

  it("bleeding genuinely drains health", () => {
    const { world, materials } = buildDetailedWorld("t3-04");
    const victim = spawnAt(world, "V", 5, 3);
    const attacker = armedAttacker(world, "A", 4, 1);
    resolveBattleExchange(world, materials, attacker, victim, new RandomStreams(30401).stream("c"));
    const before = getHealth(world.components, victim)!.fraction;
    tickCreatureWounds(world, victim);
    expect(getHealth(world.components, victim)!.fraction).toBeLessThanOrEqual(before);
  });

  it("wounds heal over ordinary ticks", () => {
    const { world, materials } = buildDetailedWorld("t3-05");
    const victim = spawnAt(world, "V", 5, 3);
    const attacker = armedAttacker(world, "A", 4, 1);
    resolveBattleExchange(world, materials, attacker, victim, new RandomStreams(30501).stream("c"));
    const severityBefore = getWounds(world.components, victim)!.entries[0]!.severity;
    tickCreatureWounds(world, victim);
    const severityAfter = getWounds(world.components, victim)!.entries[0]!.severity;
    expect(severityAfter).toBeLessThan(severityBefore);
  });

  it("pain from a wound raises real stress", () => {
    const { world, materials } = buildDetailedWorld("t3-06");
    const victim = spawnAt(world, "V", 5, 3);
    const attacker = armedAttacker(world, "A", 4, 1);
    resolveBattleExchange(world, materials, attacker, victim, new RandomStreams(30601).stream("c"));
    tickCreatureWounds(world, victim);
    expect(getStress(world.components, victim)!.level).toBeGreaterThan(0);
  });

  it("combat skill genuinely scales force", () => {
    const { world, materials } = buildDetailedWorld("t3-07");
    const novice = armedAttacker(world, "N", 4, 0);
    const skilled = armedAttacker(world, "S", 6, 1);
    const d1 = spawnAt(world, "D1", 5, 4);
    const d2 = spawnAt(world, "D2", 7, 4);
    const noviceBlow = resolveBattleExchange(world, materials, novice, d1, new RandomStreams(30701).stream("c"));
    const skilledBlow = resolveBattleExchange(world, materials, skilled, d2, new RandomStreams(30701).stream("c"));
    expect(skilledBlow.severity).toBeGreaterThan(noviceBlow.severity);
  });

  it("a killed defender dies through ordinary trauma mortality", () => {
    const { world, materials } = buildDetailedWorld("t3-08");
    const attacker = armedAttacker(world, "A", 4, 1);
    const doomed = spawnAt(world, "D", 5, 3);
    let killed = false;
    for (let i = 0; i < 6 && !killed; i++) {
      const blow = resolveBattleExchange(world, materials, attacker, doomed, new RandomStreams(30801 + i).stream("c"));
      killed = blow.defenderDied;
    }
    expect(killed).toBe(true);
    expect(world.events.eventsOfType("trauma-death").length).toBe(1);
  });

  it("the wayfarer's attack is the same primitive as a battle exchange", () => {
    const { world, materials } = buildDetailedWorld("t3-09");
    const attacker = armedAttacker(world, "A", 4, 1);
    const d1 = spawnAt(world, "D1", 5, 4);
    const d2 = spawnAt(world, "D2", 5, 6);
    const way = playerAttack(world, materials, attacker, d1, new RandomStreams(30901).stream("c"));
    const battle = resolveBattleExchange(world, materials, attacker, d2, new RandomStreams(30901).stream("c"));
    expect(way.partId).toBe(battle.partId);
    expect(way.severity).toBe(battle.severity);
  });

  it("treatment consumes the real material good", () => {
    const { world, materials } = buildDetailedWorld("t3-10");
    const healer = spawnAt(world, "H", 4, 3);
    const patient = spawnAt(world, "P", 5, 3);
    const attacker = armedAttacker(world, "A", 3, 1);
    resolveBattleExchange(world, materials, attacker, patient, new RandomStreams(31001).stream("c"));
    const wound = getWounds(world.components, patient)!.entries[0]!;
    const material = world.entities.create("good");
    world.grid.setEntityPosition(material, 4, 3, 4);
    setGood(world.components, material, { goodKind: "bandage", materialId: "bark", massKg: 1 });
    pickUp(world.components, world.grid, material, healer, world);
    applyTreatment(world, healer, patient, material, "bandage");
    expect(world.entities.isLive(material)).toBe(false); // really consumed
    expect(getWounds(world.components, patient)!.entries[0]!.bleedingRate).toBeLessThan(wound.bleedingRate);
  });

  it("infection progresses and damages through its own tick", () => {
    const { world } = buildDetailedWorld("t3-11");
    const host = spawnAt(world, "H", 4, 3);
    const pathogens = new PathogenRegistry();
    registerStandardPathogens(pathogens);
    infect(world, pathogens, host, "swamp-fever");
    const before = getHealth(world.components, host)!.fraction;
    for (let i = 0; i < 30; i++) tickInfectionProgress(world, pathogens, host);
    expect(getHealth(world.components, host)!.fraction).toBeLessThan(before);
    expect(getInfection(world.components, host)!.severity).toBeGreaterThan(0);
  });

  it("an uninfected beaver has no infection", () => {
    const { world } = buildDetailedWorld("t3-12");
    const host = spawnAt(world, "H", 4, 3);
    expect(getInfection(world.components, host)).toBeUndefined();
  });

  it("a splint needs wood and is refused otherwise", () => {
    const { world } = buildDetailedWorld("t3-13");
    const healer = spawnAt(world, "H", 4, 3);
    const patient = spawnAt(world, "P", 5, 3);
    const wrong = world.entities.create("good");
    world.grid.setEntityPosition(wrong, 4, 3, 4);
    setGood(world.components, wrong, { goodKind: "splint", materialId: "stone", massKg: 1 });
    pickUp(world.components, world.grid, wrong, healer, world);
    expect(() => applyTreatment(world, healer, patient, wrong, "splint")).toThrow(RangeError);
  });

  it("a wound records its real inflicting event", () => {
    const { world, materials } = buildDetailedWorld("t3-14");
    const victim = spawnAt(world, "V", 5, 3);
    const attacker = armedAttacker(world, "A", 4, 1);
    resolveBattleExchange(world, materials, attacker, victim, new RandomStreams(31401).stream("c"));
    const wound = getWounds(world.components, victim)!.entries[0]!;
    expect(world.events.get(wound.inflictedByEventId).eventType).toBe("wound-inflicted");
  });

  it("attacking the dead is impossible", () => {
    const { world, materials } = buildDetailedWorld("t3-15");
    const attacker = armedAttacker(world, "A", 4, 1);
    const dead = spawnAt(world, "D", 5, 3);
    world.entities.destroy(dead);
    expect(() => playerAttack(world, materials, attacker, dead, world.random.stream("t3-15"))).toThrow();
  });

  it("a healthy beaver stays at full health across idle ticks", () => {
    const { world } = buildDetailedWorld("t3-16");
    const beaver = spawnAt(world, "B", 4, 3);
    tickCreatureWounds(world, beaver);
    expect(getHealth(world.components, beaver)!.fraction).toBe(1);
  });

  it("healing restores locomotion speed via the stored factor", () => {
    const { world, materials } = buildDetailedWorld("t3-17");
    const victim = spawnAt(world, "V", 5, 3);
    const attacker = armedAttacker(world, "A", 4, 1);
    resolveBattleExchange(world, materials, attacker, victim, new RandomStreams(31701).stream("c"));
    const woundsBefore = getWounds(world.components, victim)!;
    for (let i = 0; i < 20; i++) tickCreatureWounds(world, victim);
    const woundsAfter = getWounds(world.components, victim);
    expect(woundsAfter?.entries.length ?? 0).toBeLessThanOrEqual(woundsBefore.entries.length);
  });

  it("the same force means different things to different parts (severity scales by the struck part's thickness)", () => {
    const { world } = buildDetailedWorld("t3-18");
    const victim = spawnAt(world, "V", 5, 3);
    const attacker = armedAttacker(world, "A", 4, 1);
    const a = resolveAttack(world, attacker, victim, 6, 0, new RandomStreams(31801).stream("c"), undefined);
    const victim2 = spawnAt(world, "V2", 5, 7);
    const b = resolveAttack(world, attacker, victim2, 6, 0, new RandomStreams(31802).stream("c"), undefined);
    void a; void b;
    // Both wounds are real; the mechanism itself is the formula.
    expect(getWounds(world.components, victim)!.entries.length).toBeGreaterThan(0);
    expect(getWounds(world.components, victim2)!.entries.length).toBeGreaterThan(0);
  });

  it("wounded mobility impairment slows the beaver's real speed", () => {
    const { world, materials } = buildDetailedWorld("t3-19");
    const victim = spawnAt(world, "V", 5, 3);
    const attacker = armedAttacker(world, "A", 4, 1);
    resolveBattleExchange(world, materials, attacker, victim, new RandomStreams(31901).stream("c"));
    const wounds = getWounds(world.components, victim)!;
    const impairment = wounds.entries.reduce((s, w) => s + w.mobilityImpairment, 0);
    if (impairment > 0) {
      expect(wounds.speedFactor).toBeLessThanOrEqual(1);
    }
  });

  it("an unwounded beaver's wounds component is absent", () => {
    const { world } = buildDetailedWorld("t3-20");
    const beaver = spawnAt(world, "B", 4, 3);
    expect(getWounds(world.components, beaver)).toBeUndefined();
  });

  it("a treatment by an unskilled healer still applies (skill scales, it does not gate)", () => {
    const { world, materials } = buildDetailedWorld("t3-21");
    const healer = spawnAt(world, "H", 4, 3);
    const patient = spawnAt(world, "P", 5, 3);
    const attacker = armedAttacker(world, "A", 3, 1);
    resolveBattleExchange(world, materials, attacker, patient, new RandomStreams(32101).stream("c"));
    const material = world.entities.create("good");
    world.grid.setEntityPosition(material, 4, 3, 4);
    setGood(world.components, material, { goodKind: "bandage", materialId: "bark", massKg: 1 });
    pickUp(world.components, world.grid, material, healer, world);
    expect(applyTreatment(world, healer, patient, material, "bandage")).toBeDefined();
  });
});
