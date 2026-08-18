import { ComponentStore, defineComponent, type ComponentType } from "../core/ComponentStore.js";
import type { EntityId } from "../core/EntityId.js";
import type { EventId } from "../history/EventLog.js";
import type { World } from "../persistence/WorldSnapshot.js";
import type { RandomStream } from "../core/Random.js";
import { getHealth, setHealth, getLocomotion, setLocomotion } from "./Beaver.js";
import { applyHealthDamage, die } from "./Mortality.js";
import { getAnimal, dieAnimal } from "./Animal.js";
import { getStress, setStress } from "./Stress.js";

/**
 * P7-10: combat anatomy is DATA over ordinary creatures -- a body plan
 * (parts, each with real tissue properties and a hit weight) plus
 * per-creature persistent wounds. An attack is a force applied to ONE
 * body part (chosen by real weighted chance, deterministic under a
 * seeded stream); tissue thickness/hardness and any armor resistance
 * determine penetration; the SAME attack to different body regions
 * produces mechanically different consequences because the PARTS differ:
 * vital parts (head, torso) bleed and cost real health, limbs impair
 * real locomotion (the same `Locomotion.speed` every movement system
 * already reads), and all wounds bring real pain (stress) and bleed
 * over time until they heal. No separate combat creature model, no
 * "hit points" that bypass ordinary health/death machinery.
 */

export type BodyPartId = "head" | "torso" | "left-forelimb" | "right-forelimb" | "hindquarters" | "tail";

export interface BodyPart {
  id: BodyPartId;
  /** Relative chance this part is struck (parts sum to 1 across the plan). */
  hitWeight: number;
  /** Tissue thickness (how much force the part's own flesh absorbs). */
  tissueThickness: number;
  /** Tissue hardness (resistance per unit thickness). */
  tissueHardness: number;
  /** Vital parts convert severity into real health damage and heavy bleeding. */
  vital: boolean;
  /** How much a severe wound to this part impairs locomotion (limbs high, head none). */
  mobilityShare: number;
}

export interface BodyPlan {
  speciesLabel: string;
  parts: readonly BodyPart[];
}

/** The beaver's real body plan -- balance data, same class of tunable constant as every other plan table in this codebase. */
export const BEAVER_BODY_PLAN: BodyPlan = Object.freeze({
  speciesLabel: "beaver",
  parts: Object.freeze([
    Object.freeze({ id: "head", hitWeight: 0.15, tissueThickness: 2, tissueHardness: 1.5, vital: true, mobilityShare: 0 }),
    Object.freeze({ id: "torso", hitWeight: 0.4, tissueThickness: 3, tissueHardness: 1.2, vital: true, mobilityShare: 0 }),
    Object.freeze({ id: "left-forelimb", hitWeight: 0.1, tissueThickness: 1.5, tissueHardness: 1, vital: false, mobilityShare: 0.35 }),
    Object.freeze({ id: "right-forelimb", hitWeight: 0.1, tissueThickness: 1.5, tissueHardness: 1, vital: false, mobilityShare: 0.35 }),
    Object.freeze({ id: "hindquarters", hitWeight: 0.2, tissueThickness: 2.5, tissueHardness: 1, vital: false, mobilityShare: 0.3 }),
    Object.freeze({ id: "tail", hitWeight: 0.05, tissueThickness: 1, tissueHardness: 0.8, vital: false, mobilityShare: 0 }),
  ]),
});

/** The generic four-limbed animal plan (P4-05's framework animals) -- same part vocabulary, different tissue data. */
export const GENERIC_ANIMAL_BODY_PLAN: BodyPlan = Object.freeze({
  speciesLabel: "animal",
  parts: Object.freeze([
    Object.freeze({ id: "head", hitWeight: 0.2, tissueThickness: 2, tissueHardness: 1.3, vital: true, mobilityShare: 0 }),
    Object.freeze({ id: "torso", hitWeight: 0.45, tissueThickness: 3.5, tissueHardness: 1, vital: true, mobilityShare: 0 }),
    Object.freeze({ id: "left-forelimb", hitWeight: 0.08, tissueThickness: 1.5, tissueHardness: 1, vital: false, mobilityShare: 0.3 }),
    Object.freeze({ id: "right-forelimb", hitWeight: 0.08, tissueThickness: 1.5, tissueHardness: 1, vital: false, mobilityShare: 0.3 }),
    Object.freeze({ id: "hindquarters", hitWeight: 0.16, tissueThickness: 2.5, tissueHardness: 1, vital: false, mobilityShare: 0.4 }),
    Object.freeze({ id: "tail", hitWeight: 0.03, tissueThickness: 0.8, tissueHardness: 0.7, vital: false, mobilityShare: 0 }),
  ]),
});

/** The plan a creature's body actually follows -- beavers get the beaver plan, framework animals the generic one (their real species marker decides, P4-05). */
export function bodyPlanFor(components: ComponentStore, creatureId: EntityId): BodyPlan {
  return getAnimal(components, creatureId) !== undefined ? GENERIC_ANIMAL_BODY_PLAN : BEAVER_BODY_PLAN;
}

export interface Wound {
  partId: BodyPartId;
  /** 0..1 -- how severe the wound is. */
  severity: number;
  /** Health fraction lost per tick while bleeding. */
  bleedingRate: number;
  /** 0..1 pain -- feeds stress. */
  pain: number;
  /** 0..1 locomotion impairment -- multiplied into the creature's real speed while wounded. */
  mobilityImpairment: number;
  /** The real event that inflicted it (causal chain back to the battle/raid/attack). */
  inflictedByEventId: EventId;
}

export interface Wounds {
  entries: readonly Wound[];
  /** The locomotion factor this component last applied (1 - impairment), so healing can restore intrinsic speed without a stored copy. */
  speedFactor: number;
}
export const WoundsComponent: ComponentType<Wounds> = defineComponent<Wounds>("wounds");

const BODY_PART_IDS: readonly BodyPartId[] = ["head", "torso", "left-forelimb", "right-forelimb", "hindquarters", "tail"];

export function assertValidWounds(wounds: Wounds): void {
  for (const wound of wounds.entries) {
    if (!BODY_PART_IDS.includes(wound.partId)) throw new RangeError(`wound partId must be a real body part, got ${JSON.stringify(wound.partId)}`);
    if (!(Number.isFinite(wound.severity) && wound.severity > 0 && wound.severity <= 1)) throw new RangeError(`wound severity must be in (0, 1], got ${wound.severity}`);
    if (!(Number.isFinite(wound.bleedingRate) && wound.bleedingRate >= 0 && wound.bleedingRate <= 1)) throw new RangeError(`wound bleedingRate must be in [0, 1], got ${wound.bleedingRate}`);
    if (!(Number.isFinite(wound.pain) && wound.pain >= 0 && wound.pain <= 1)) throw new RangeError(`wound pain must be in [0, 1], got ${wound.pain}`);
    if (!(Number.isFinite(wound.mobilityImpairment) && wound.mobilityImpairment >= 0 && wound.mobilityImpairment <= 1)) {
      throw new RangeError(`wound mobilityImpairment must be in [0, 1], got ${wound.mobilityImpairment}`);
    }
    if (!Number.isInteger(wound.inflictedByEventId) || wound.inflictedByEventId < 1) throw new RangeError(`wound inflictedByEventId must be a positive integer, got ${wound.inflictedByEventId}`);
  }
  if (!(Number.isFinite(wounds.speedFactor) && wounds.speedFactor > 0 && wounds.speedFactor <= 1)) {
    throw new RangeError(`wounds speedFactor must be in (0, 1], got ${wounds.speedFactor}`);
  }
}

export function setWounds(components: ComponentStore, creatureId: EntityId, wounds: Wounds): void {
  assertValidWounds(wounds);
  components.set(creatureId, WoundsComponent, {
    entries: wounds.entries.map((wound) => ({ ...wound })),
    speedFactor: wounds.speedFactor,
  });
}

export function getWounds(components: ComponentStore, creatureId: EntityId): Wounds | undefined {
  const wounds = components.get(creatureId, WoundsComponent);
  if (wounds !== undefined) assertValidWounds(wounds);
  return wounds;
}

export function ensureWounds(components: ComponentStore, creatureId: EntityId): Wounds {
  const existing = getWounds(components, creatureId);
  if (existing !== undefined) return existing;
  const fresh: Wounds = { entries: [], speedFactor: 1 };
  components.set(creatureId, WoundsComponent, fresh);
  return fresh;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** How much force the part's own tissue absorbs before any wound forms. */
export function tissueResistance(part: BodyPart): number {
  return part.tissueHardness * part.tissueThickness;
}

/** Penetration is force minus tissue resistance minus armor resistance; severity scales it against the part's own thickness. */
export const PENETRATION_SEVERITY_SCALE = 2;

export interface AttackResolution {
  partId: BodyPartId;
  severity: number;
  penetration: number;
  woundEventId?: EventId;
  /** Whether the attack produced a real wound (vs. glancing off). */
  wounded: boolean;
}

/**
 * Resolves ONE real attack: `force` (unarmed strength or a weapon's
 * computed force, P7-11) against `defenderId`, reduced first by any
 * armor resistance and then by the struck part's own tissue. The struck
 * part is chosen by REAL weighted chance from the defender's own body
 * plan (deterministic under `random`). A non-positive penetration
 * glances off (no wound, no event -- armor and tissue genuinely worked).
 * A real wound is recorded on the defender (merged into any existing
 * wound on that part) with real per-part consequences, and a
 * `"wound-inflicted"` event records the causal fact.
 */
export function resolveAttack(
  world: World,
  attackerId: EntityId,
  defenderId: EntityId,
  force: number,
  armorResistance: number,
  random: RandomStream,
  causeEventId?: EventId,
): AttackResolution {
  const plan = bodyPlanFor(world.components, defenderId);
  const totalWeight = plan.parts.reduce((sum, part) => sum + part.hitWeight, 0);
  let roll = random.nextFloat() * totalWeight;
  let struckPart: BodyPart = plan.parts[plan.parts.length - 1]!;
  for (const part of plan.parts) {
    roll -= part.hitWeight;
    if (roll <= 0) {
      struckPart = part;
      break;
    }
  }

  const penetration = force - armorResistance - tissueResistance(struckPart);
  if (penetration <= 0) return { partId: struckPart.id, severity: 0, penetration, wounded: false };

  const severity = clamp01(penetration / (struckPart.tissueThickness * PENETRATION_SEVERITY_SCALE));

  // Real per-part consequences -- the SAME force means different things
  // to different parts (the literal acceptance clause).
  const bleedingRate = clamp01(severity * (struckPart.vital ? 0.04 : 0.015));
  const pain = clamp01(severity * 0.9);
  const mobilityImpairment = clamp01(severity * struckPart.mobilityShare);

  const woundEventId = world.events.record({
    tick: world.clock.tick,
    eventType: "wound-inflicted",
    subjectIds: [defenderId],
    objectIds: [attackerId],
    location: world.grid.positionOf(defenderId) ?? world.grid.positionOf(attackerId) ?? { x: 0, y: 0, z: 0 },
    ...(causeEventId !== undefined ? { causeEventId } : {}),
  });

  const existing = ensureWounds(world.components, defenderId);
  const newWound: Wound = { partId: struckPart.id, severity, bleedingRate, pain, mobilityImpairment, inflictedByEventId: woundEventId };
  const entries = [...existing.entries];
  const samePartIndex = entries.findIndex((wound) => wound.partId === struckPart.id);
  if (samePartIndex >= 0) {
    const old = entries[samePartIndex]!;
    entries[samePartIndex] = {
      ...old,
      severity: Math.max(old.severity, newWound.severity),
      bleedingRate: Math.min(1, old.bleedingRate + newWound.bleedingRate),
      pain: Math.max(old.pain, newWound.pain),
      mobilityImpairment: Math.max(old.mobilityImpairment, newWound.mobilityImpairment),
      inflictedByEventId: newWound.inflictedByEventId,
    };
  } else {
    entries.push(newWound);
  }
  setWounds(world.components, defenderId, { ...existing, entries });

  // Vital wounds genuinely threaten life; even non-vital wounds cost real
  // health (a mangled limb is a real injury) -- so battles are decisive
  // rather than grind forever at the round cap.
  const healthDamage = severity * (struckPart.vital ? 0.6 : 0.2);
  setHealth(world.components, defenderId, applyHealthDamage(getHealth(world.components, defenderId) ?? { fraction: 1 }, healthDamage));
  return { partId: struckPart.id, severity, penetration, woundEventId, wounded: true };
}

/** Total real locomotion impairment across all wounds, clamped to 1. */
export function totalMobilityImpairment(world: World, creatureId: EntityId): number {
  const wounds = getWounds(world.components, creatureId);
  if (wounds === undefined) return 0;
  return Math.min(1, wounds.entries.reduce((sum, wound) => sum + wound.mobilityImpairment, 0));
}

export const WOUND_HEAL_RATE = 0.002;
export const WOUND_PAIN_STRESS_RATE = 0.3;
export const LOCOMOTION_IMPAIRMENT_FACTOR = 0.75;

/**
 * One tick of every wounded creature's real wound physiology: wounds
 * bleed (real health damage through the ordinary `Health` component --
 * a creature that bleeds out dies through the ordinary mortality
 * machinery, beaver or animal), pain raises real stress, wounds heal at
 * a real rate (disappearing when fully healed), and the creature's
 * locomotion speed tracks its current impairment -- restored exactly as
 * wounds heal (the `speedFactor` bookkeeping keeps the intrinsic speed
 * recoverable without storing a parallel copy).
 */
export function tickAllWounds(world: World): void {
  for (const creatureId of world.components.query(WoundsComponent).sort((a, b) => a - b)) {
    const wounds = getWounds(world.components, creatureId);
    if (wounds === undefined) continue;
    if (!world.entities.isLive(creatureId)) continue;

    const health = getHealth(world.components, creatureId);
    if (health === undefined) continue;

    // Bleeding: real health damage; death through the ordinary per-kind machinery.
    const bleed = wounds.entries.reduce((sum, wound) => sum + wound.bleedingRate, 0);
    if (bleed > 0) {
      const damaged = applyHealthDamage(health, Math.min(health.fraction, bleed));
      setHealth(world.components, creatureId, damaged);
      if (damaged.fraction <= 0) {
        if (getAnimal(world.components, creatureId) !== undefined) {
          dieAnimal(world, creatureId, "trauma", "animal-tissue");
        } else {
          die(world, creatureId, "trauma");
        }
        continue;
      }
    }

    // Pain: real stress pressure.
    const pain = Math.max(...wounds.entries.map((wound) => wound.pain), 0);
    if (pain > 0) {
      const stress = getStress(world.components, creatureId);
      const level = Math.min(1, (stress?.level ?? 0) + pain * WOUND_PAIN_STRESS_RATE);
      setStress(world.components, creatureId, { level });
    }

    // Healing: severity decays; fully-healed wounds vanish.
    const entries = wounds.entries
      .map((wound) => ({ ...wound, severity: wound.severity - WOUND_HEAL_RATE }))
      .filter((wound) => wound.severity > 0);

    // Locomotion: intrinsic speed recovered via the stored factor, then re-applied.
    const factor = Math.max(0.05, 1 - totalMobilityImpairment(world, creatureId) * LOCOMOTION_IMPAIRMENT_FACTOR);
    const locomotion = getLocomotion(world.components, creatureId);
    if (locomotion !== undefined && wounds.speedFactor > 0) {
      const intrinsic = locomotion.speed / wounds.speedFactor;
      setLocomotion(world.components, creatureId, { speed: Math.round(intrinsic * factor * 100) / 100 });
    }
    setWounds(world.components, creatureId, { entries, speedFactor: factor });
  }
}

/** Convenience: the creature's real current wound state (empty when unwounded). */
export function woundsOf(world: World, creatureId: EntityId): Wound[] {
  return [...(getWounds(world.components, creatureId)?.entries ?? [])];
}
