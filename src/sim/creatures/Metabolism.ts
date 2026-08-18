import { ComponentStore, defineComponent, type ComponentType } from "../core/ComponentStore.js";
import type { EntityId } from "../core/EntityId.js";
import type { World } from "../persistence/WorldSnapshot.js";
import { consumeLiquid, getLiquidContents } from "../economy/Liquid.js";

/**
 * P11-04: metabolism and intoxication -- consuming a real liquid changes
 * the drinker's OWN blood chemistry through a real metabolic process
 * (absorbed doses, per-substance decay), and that chemistry changes
 * real motor/cognitive performance through formulas consumed by
 * existing code paths (labor work-rate, combat force, craft quality
 * checks). There is NO `BeaverGetsDrunk` event anywhere: drunkenness is
 * never an event, it is a derived state of the chemistry component --
 * the roadmap's own named anti-example, satisfied by construction.
 */

export interface BloodChemistry {
  /** Absorbed dose per substance, in arbitrary dose units -- decays over time (metabolism). Never negative. */
  concentrations: Readonly<Record<string, number>>;
}
export const BloodChemistryComponent: ComponentType<BloodChemistry> = defineComponent<BloodChemistry>("blood-chemistry");

export function assertValidBloodChemistry(chemistry: BloodChemistry): void {
  for (const [key, value] of Object.entries(chemistry.concentrations)) {
    if (!(Number.isFinite(value) && value >= 0)) {
      throw new RangeError(`blood concentration for "${key}" must be a non-negative finite number, got ${value}`);
    }
  }
}

export function setBloodChemistry(components: ComponentStore, beaverId: EntityId, chemistry: BloodChemistry): void {
  assertValidBloodChemistry(chemistry);
  components.set(beaverId, BloodChemistryComponent, { concentrations: { ...chemistry.concentrations } });
}

export function getBloodChemistry(components: ComponentStore, beaverId: EntityId): BloodChemistry | undefined {
  const chemistry = components.get(beaverId, BloodChemistryComponent);
  if (chemistry !== undefined) assertValidBloodChemistry(chemistry);
  return chemistry;
}

/** Fraction of the drunk liquid's own composition absorbed into the blood per unit volume -- plausible, tunable balance data (a real drink is mostly water; the dissolved substances cross into blood at a bounded rate). */
export const ABSORPTION_FRACTION = 1;

/** Per-substance metabolic decay per tick (the fraction REMAINING after one tick) -- alcohol clears slowly, toxins/pathogens faster (the body actively fights them). Plausible, tunable balance data. */
export const SUBSTANCE_DECAY_PER_TICK: Readonly<Record<string, number>> = {
  alcohol: 0.985,
  toxins: 0.99,
  pathogens: 0.995,
  nutrients: 0.95,
  salt: 0.97,
  silt: 0.995,
  "organic-matter": 0.98,
};

/** Below this dose a substance is cleared from the blood entirely (keeps the record tidy). */
export const METABOLIC_CLEARANCE = 0.001;

/** Motor impairment per unit of blood alcohol -- the performance formula's slope. Plausible, tunable balance data. */
export const ALCOHOL_MOTOR_IMPAIRMENT = 0.15;
/** Cognitive impairment per unit of blood alcohol -- slightly steeper than motor (judgment goes before balance). */
export const ALCOHOL_COGNITIVE_IMPAIRMENT = 0.25;
/** Toxins impair motor function too, at their own slope. */
export const TOXIN_MOTOR_IMPAIRMENT = 0.1;
/** Maximum performance loss from any impairment -- a heavily drunk beaver still moves, just badly. */
export const MAX_IMPAIRMENT = 0.85;

/**
 * Drinks up to `volumeL` of the container's real liquid: the volume
 * genuinely leaves the container (`Liquid.ts`'s own `consumeLiquid`),
 * and each dissolved component enters the blood at
 * `ABSORPTION_FRACTION` scaled by the drunk volume -- the blood
 * chemistry is a direct, conserved consequence of the liquid's real
 * composition, never a per-liquid-name script.
 */
export function ingestLiquid(world: World, beaverId: EntityId, containerId: EntityId, volumeL: number): number {
  const liquid = getLiquidContents(world.components, containerId);
  if (liquid === undefined) throw new RangeError(`entity ${containerId} has no LiquidContents component`);
  const consumed = consumeLiquid(world.components, containerId, volumeL);
  if (consumed.consumedL <= 0) return 0;
  const existing = getBloodChemistry(world.components, beaverId)?.concentrations ?? {};
  const concentrations: Record<string, number> = { ...existing };
  for (const [substance, fraction] of Object.entries(consumed.composition)) {
    const dose = consumed.consumedL * fraction * ABSORPTION_FRACTION;
    if (dose > 0) concentrations[substance] = (concentrations[substance] ?? 0) + dose;
  }
  setBloodChemistry(world.components, beaverId, { concentrations });
  return consumed.consumedL;
}

/** One metabolic tick: every blood concentration decays by its substance's own rate; sub-`METABOLIC_CLEARANCE` doses are cleared. No-op for a beaver with no chemistry. */
export function tickMetabolism(world: World, beaverId: EntityId): void {
  const chemistry = getBloodChemistry(world.components, beaverId);
  if (chemistry === undefined) return;
  const concentrations: Record<string, number> = {};
  for (const [substance, dose] of Object.entries(chemistry.concentrations)) {
    const decay = SUBSTANCE_DECAY_PER_TICK[substance] ?? 0.98;
    const next = dose * decay;
    if (next >= METABOLIC_CLEARANCE) concentrations[substance] = next;
  }
  setBloodChemistry(world.components, beaverId, { concentrations });
}

/** Aggregate impairment from the drinker's own chemistry -- every impairing substance contributes its own slope; capped at `MAX_IMPAIRMENT`. */
function impairmentFrom(components: ComponentStore, beaverId: EntityId, motor: boolean): number {
  const chemistry = getBloodChemistry(components, beaverId);
  if (chemistry === undefined) return 0;
  const alcohol = chemistry.concentrations["alcohol"] ?? 0;
  const toxins = chemistry.concentrations["toxins"] ?? 0;
  const raw = motor
    ? alcohol * ALCOHOL_MOTOR_IMPAIRMENT + toxins * TOXIN_MOTOR_IMPAIRMENT
    : alcohol * ALCOHOL_COGNITIVE_IMPAIRMENT + toxins * TOXIN_MOTOR_IMPAIRMENT;
  return Math.min(MAX_IMPAIRMENT, raw);
}

/** Motor performance factor `(0.15..1]` -- multiplies real work-rate and combat force in the existing labor/combat code paths (a drunk beaver works slower and hits softer, through chemistry, not an event). */
export function motorFactor(components: ComponentStore, beaverId: EntityId): number {
  return 1 - impairmentFrom(components, beaverId, true);
}

/** Cognitive performance factor `(0.15..1]` -- multiplies real skill-derived quality (a drunk beaver's craft is worse, through the same chemistry). */
export function cognitiveFactor(components: ComponentStore, beaverId: EntityId): number {
  return 1 - impairmentFrom(components, beaverId, false);
}

/** Drives metabolism for every live beaver once -- the colony loop's single hook. */
export function tickAllMetabolism(world: World): void {
  for (const beaverId of world.entities.liveIdsOfKind("beaver").sort((a: EntityId, b: EntityId) => a - b)) {
    tickMetabolism(world, beaverId);
  }
}
