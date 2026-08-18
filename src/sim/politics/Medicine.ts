import type { EntityId } from "../core/EntityId.js";
import type { World } from "../persistence/WorldSnapshot.js";
import { getGood } from "../economy/Good.js";
import { setWounds, ensureWounds } from "../creatures/Anatomy.js";
import { practiceSkill, skillLevel } from "../creatures/SkillProgression.js";
import { getInventory, setInventory } from "../creatures/Beaver.js";

/**
 * P7-12: treatment modifies wound states through PHYSICAL/BIOLOGICAL
 * mechanisms -- a treatment consumes a real material good (bark for a
 * bandage, wood for a splint, plant matter for a poultice), is applied
 * by a real healer whose real medicine skill scales the effect, and
 * directly modifies the patient's real wound state (bleeding, mobility
 * impairment, or pain) -- the same wound fields P7-10's physiology
 * already advances. No "heal button": wounds still heal at their own
 * real rate; treatment changes the wound's state, and the ordinary
 * wound tick does the rest.
 */

export type TreatmentKind = "bandage" | "splint" | "poultice";

/** The real material each treatment must be made of (a good of any kind with this material). */
export const TREATMENT_MATERIAL: Readonly<Record<TreatmentKind, string>> = Object.freeze({
  bandage: "bark",
  splint: "wood",
  poultice: "plant-matter",
});

export const TREATMENT_BASE_EFFECT = 0.5;
export const TREATMENT_SKILL_BONUS = 0.3;
export const MEDICINE_SKILL_NAME = "medicine";
export const MEDICINE_WORK_PER_TREATMENT = 1;

export type WoundStateField = "bleedingRate" | "mobilityImpairment" | "pain";

/** The wound field each treatment acts on -- bandages stop bleeding, splints stabilize limbs, poultices dull pain. */
export const TREATMENT_FIELD: Readonly<Record<TreatmentKind, WoundStateField>> = Object.freeze({
  bandage: "bleedingRate",
  splint: "mobilityImpairment",
  poultice: "pain",
});

/** Whether a real good can serve as `kind` treatment (its own material must match the treatment's requirement). */
export function usableAsTreatment(world: World, itemId: EntityId, kind: TreatmentKind): boolean {
  const good = getGood(world.components, itemId);
  return good !== undefined && good.materialId === TREATMENT_MATERIAL[kind];
}

/**
 * Applies a real treatment: validates the healer carries the material
 * good, CONSUMES it (the good entity is destroyed -- treatment costs
 * real matter), picks the patient's most severe wound (by the field the
 * treatment acts on), and reduces that field by a real factor scaled by
 * the healer's actual medicine skill (higher skill = stronger effect,
 * via `SkillProgression.ts` P2-03, unmodified). The healer's skill
 * genuinely practices. Records a real `"treatment-applied"` event
 * chained to the wound's own inflicting event. Returns the treated
 * wound's part id, or undefined when there was no wound to treat.
 */
export function applyTreatment(world: World, healerId: EntityId, patientId: EntityId, materialGoodId: EntityId, kind: TreatmentKind): string | undefined {
  if (!usableAsTreatment(world, materialGoodId, kind)) {
    throw new RangeError(`item ${materialGoodId} is not usable as a ${kind} treatment (requires material ${TREATMENT_MATERIAL[kind]})`);
  }
  const inventory = getInventory(world.components, healerId);
  if (inventory === undefined || !inventory.itemIds.includes(materialGoodId)) {
    throw new RangeError(`healer ${healerId} does not carry treatment material ${materialGoodId}`);
  }

  const wounds = ensureWounds(world.components, patientId);
  const field = TREATMENT_FIELD[kind];
  let targetIndex = -1;
  let worst = -Infinity;
  for (let i = 0; i < wounds.entries.length; i++) {
    const value = wounds.entries[i]![field];
    if (value > worst) {
      worst = value;
      targetIndex = i;
    }
  }
  if (targetIndex === -1) return undefined;

  const level = skillLevel(world.components, healerId, MEDICINE_SKILL_NAME);
  const factor = Math.max(0.1, TREATMENT_BASE_EFFECT - level * TREATMENT_SKILL_BONUS);

  const entries = wounds.entries.map((wound, index) => {
    if (index !== targetIndex) return { ...wound };
    const treated = { ...wound };
    treated[field] = Math.max(0, treated[field] * factor);
    return treated;
  });
  setWounds(world.components, patientId, { ...wounds, entries });

  // The material is physically consumed.
  setInventory(world.components, healerId, { itemIds: inventory.itemIds.filter((id) => id !== materialGoodId) });
  world.entities.destroy(materialGoodId);

  practiceSkill(world.components, healerId, MEDICINE_SKILL_NAME, MEDICINE_WORK_PER_TREATMENT);

  world.events.record({
    tick: world.clock.tick,
    eventType: "treatment-applied",
    subjectIds: [patientId],
    objectIds: [healerId, materialGoodId],
    location: world.grid.positionOf(patientId) ?? world.grid.positionOf(healerId) ?? { x: 0, y: 0, z: 0 },
    causeEventId: wounds.entries[targetIndex]!.inflictedByEventId,
  });
  return wounds.entries[targetIndex]!.partId;
}

/** The healer's real medicine skill level (0 when unpracticed). */
export function medicineSkill(world: World, healerId: EntityId): number {
  return skillLevel(world.components, healerId, MEDICINE_SKILL_NAME);
}
