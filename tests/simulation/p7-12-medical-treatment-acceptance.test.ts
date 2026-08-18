/**
 * Headless acceptance test for P7-12 -- Medical treatment.
 *
 * Roadmap acceptance test: "treatment modifies wound states through
 * physical/biological mechanisms."
 */
import { describe, expect, it } from "vitest";
import { EntityIdRegistry, type EntityId } from "../../src/sim/core/EntityId.js";
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
import { spawnBeaver } from "../../src/sim/creatures/Beaver.js";
import { setGood } from "../../src/sim/economy/Good.js";
import { pickUp } from "../../src/sim/labor/Log.js";
import { resolveAttack, woundsOf, getWounds } from "../../src/sim/creatures/Anatomy.js";
import { applyTreatment, usableAsTreatment, medicineSkill } from "../../src/sim/politics/Medicine.js";
import { skillLevel } from "../../src/sim/creatures/SkillProgression.js";

function buildWorld(): World {
  const entities = new EntityIdRegistry();
  const components = new ComponentStore(entities);
  const grid = new WorldGrid({ sizeX: 20, sizeY: 10, sizeZ: 20 }, entities);
  const materials = new MaterialRegistry();
  registerStandardMaterials(materials);
  const terrain = new TerrainField(grid, materials);
  for (let x = 0; x < 20; x++) for (let z = 0; z < 20; z++) for (let y = 0; y <= 2; y++) terrain.setMaterial(x, y, z, "soil");
  const water = new WaterField(grid);
  const weather = new Weather();
  const clock = new SimulationClock({ tickRateHz: 20 });
  const random = new RandomStreams(712);
  const events = new EventLog(entities);
  return { clock, random, entities, components, grid, terrain, events, water, weather };
}

function materialGood(world: World, materialId: string, massKg: number, x: number, z: number): EntityId {
  const itemId = world.entities.create("good");
  setGood(world.components, itemId, { goodKind: "material", materialId, massKg });
  world.grid.setEntityPosition(itemId, x, 3, z);
  return itemId;
}

describe("P7-12 -- Medical treatment", () => {
  it("treatment modifies wound states through physical/biological mechanisms", () => {
    const world = buildWorld();
    const healer = spawnBeaver(world, { name: "Healer", position: { x: 5, y: 3, z: 5 } });
    const patient = spawnBeaver(world, { name: "Patient", position: { x: 5, y: 3, z: 6 } });
    const attacker = spawnBeaver(world, { name: "Attacker", position: { x: 5, y: 3, z: 7 } });

    // A real wound with real bleeding.
    let resolution = resolveAttack(world, attacker, patient, 10, 0, world.random.stream("wound"));
    let tries = 0;
    while (!resolution.wounded && tries < 8) {
      resolution = resolveAttack(world, attacker, patient, 10, 0, world.random.stream(`wound-${tries}`));
      tries++;
    }
    expect(resolution.wounded).toBe(true);
    const before = woundsOf(world, patient).find((w) => w.partId === resolution.partId)!;
    expect(before.bleedingRate).toBeGreaterThan(0);

    // Treatment material: bark bandage, physically carried by the healer.
    const bark = materialGood(world, "bark", 1, 4, 4);
    const wrongMaterial = materialGood(world, "stone", 1, 4, 5);
    expect(usableAsTreatment(world, bark, "bandage")).toBe(true);
    expect(usableAsTreatment(world, wrongMaterial, "bandage")).toBe(false);
    pickUp(world.components, world.grid, bark, healer);
    // A healer who doesn't carry the material cannot treat.
    expect(() => applyTreatment(world, healer, patient, wrongMaterial, "bandage")).toThrow(RangeError);

    // The treatment genuinely modifies the wound state (bleeding down),
    // consumes the real material, and practices the real medicine skill.
    const bleedingBefore = getWounds(world.components, patient)!.entries.find((w) => w.partId === resolution.partId)!.bleedingRate;
    const treatedPart = applyTreatment(world, healer, patient, bark, "bandage");
    expect(treatedPart).toBe(resolution.partId);
    const after = getWounds(world.components, patient)!.entries.find((w) => w.partId === resolution.partId)!;
    expect(after.bleedingRate).toBeLessThan(bleedingBefore);
    expect(world.entities.isLive(bark)).toBe(false); // physically consumed
    expect(skillLevel(world.components, healer, "medicine")).toBeGreaterThan(0);
    expect(medicineSkill(world, healer)).toBeGreaterThan(0);

    // The treatment event chains to the wound's own inflicting event.
    const treatmentEvents = world.events.eventsOfType("treatment-applied");
    expect(treatmentEvents.length).toBe(1);
    expect(treatmentEvents[0]!.subjectIds).toContain(patient);
    expect(treatmentEvents[0]!.causeEventId).toBe(resolution.woundEventId);

    // Splints and poultices act on their own real fields.
    const limping = spawnBeaver(world, { name: "Limping", position: { x: 8, y: 3, z: 8 } });
    let limbHit = resolveAttack(world, attacker, limping, 10, 0, world.random.stream("limb"));
    let limbTries = 0;
    while ((!limbHit.wounded || woundsOf(world, limping).find((w) => w.partId === limbHit.partId)!.mobilityImpairment === 0) && limbTries < 8) {
      limbHit = resolveAttack(world, attacker, limping, 10, 0, world.random.stream(`limb-${limbTries}`));
      limbTries++;
    }
    const limbWoundBefore = woundsOf(world, limping).find((w) => w.partId === limbHit.partId)!;
    expect(limbWoundBefore.mobilityImpairment).toBeGreaterThan(0);
    const splint = materialGood(world, "wood", 1, 9, 8);
    pickUp(world.components, world.grid, splint, healer);
    applyTreatment(world, healer, limping, splint, "splint");
    const limbWoundAfter = woundsOf(world, limping).find((w) => w.partId === limbHit.partId)!;
    expect(limbWoundAfter.mobilityImpairment).toBeLessThan(limbWoundBefore.mobilityImpairment);

    const pained = spawnBeaver(world, { name: "Pained", position: { x: 8, y: 3, z: 9 } });
    let headHit = resolveAttack(world, attacker, pained, 10, 0, world.random.stream("head"));
    let headTries = 0;
    while ((!headHit.wounded || woundsOf(world, pained).find((w) => w.partId === headHit.partId)!.pain === 0) && headTries < 8) {
      headHit = resolveAttack(world, attacker, pained, 10, 0, world.random.stream(`head-${headTries}`));
      headTries++;
    }
    const painBefore = woundsOf(world, pained).find((w) => w.partId === headHit.partId)!.pain;
    const poultice = materialGood(world, "plant-matter", 1, 9, 9);
    pickUp(world.components, world.grid, poultice, healer);
    applyTreatment(world, healer, pained, poultice, "poultice");
    const painAfter = woundsOf(world, pained).find((w) => w.partId === headHit.partId)!.pain;
    expect(painAfter).toBeLessThan(painBefore);
  });
});
