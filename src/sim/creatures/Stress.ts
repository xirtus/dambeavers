import { ComponentStore, defineComponent, type ComponentType } from "../core/ComponentStore.js";
import type { EntityId } from "../core/EntityId.js";
import type { World } from "../persistence/WorldSnapshot.js";
import { getNeeds, NEED_URGENT_THRESHOLD } from "./Needs.js";
import { memoryInfluence } from "./Memory.js";
import { getTraits, traitOrDefault } from "./Traits.js";

/**
 * P5-03: chronic (not merely momentary) psychological state -- a real,
 * accumulated `[0,1]` `level` that rises under SUSTAINED adverse
 * conditions (urgent survival needs, a negative real `memoryInfluence`,
 * P5-02) and falls under sustained good ones, rather than a per-tick
 * live reading like `Mood.ts`'s own `deriveMood`. This is deliberately
 * the accumulator `Mood.ts` doesn't have: mood answers "how do I feel
 * right now," stress answers "how worn down am I from a while of this."
 */
export interface Stress {
  level: number;
}
export const StressComponent: ComponentType<Stress> = defineComponent<Stress>("stress");

export function assertValidStress(stress: Stress): void {
  if (!(stress.level >= 0 && stress.level <= 1)) throw new RangeError(`stress level must be in [0, 1], got ${stress.level}`);
}

export function setStress(components: ComponentStore, beaverId: EntityId, stress: Stress): void {
  assertValidStress(stress);
  components.set(beaverId, StressComponent, stress);
}

export function getStress(components: ComponentStore, beaverId: EntityId): Stress | undefined {
  const stress = components.get(beaverId, StressComponent);
  if (stress !== undefined) assertValidStress(stress);
  return stress;
}

/** Real per-tick stress accumulation while ANY need sits at/above `NEED_URGENT_THRESHOLD`, OR real remembered valence (`memoryInfluence`) is negative -- each a genuine "chronic adverse condition," never a scripted stressor list. Damped by `resilience`, matching `Mood.ts`'s own damping precedent. Plausible, tunable balance data. */
export const STRESS_RISE_PER_TICK = 0.01;
/** Real recovery rate while conditions are NOT adverse -- slower than the rise, matching real psychology (stress accumulates faster than it heals). */
export const STRESS_RECOVERY_PER_TICK = 0.005;

function hasUrgentNeed(components: ComponentStore, beaverId: EntityId): boolean {
  const needs = getNeeds(components, beaverId);
  if (needs === undefined) return false;
  return needs.hunger >= NEED_URGENT_THRESHOLD || needs.thirst >= NEED_URGENT_THRESHOLD || needs.fatigue >= NEED_URGENT_THRESHOLD;
}

/** One simulated tick of stress accumulation/recovery for `beaverId`. */
export function tickStress(world: World, beaverId: EntityId): void {
  const current = getStress(world.components, beaverId) ?? { level: 0 };
  const traits = getTraits(world.components, beaverId);
  const resilience = traits?.resilience ?? 0.5;
  const memoryValence = memoryInfluence(world.components, beaverId);
  const adverse = hasUrgentNeed(world.components, beaverId) || memoryValence < -0.2;

  const delta = adverse ? STRESS_RISE_PER_TICK * (1 - resilience * 0.5) : -STRESS_RECOVERY_PER_TICK;
  const level = Math.max(0, Math.min(1, current.level + delta));
  setStress(world.components, beaverId, { level });
}

/** Real work-rate penalty from chronic stress -- `[0.6, 1]`x, never below 0.6 (a stressed beaver is slower, not incapacitated). Consumed by any labor driver wanting to reflect emotional state in output, mirroring `toolWorkMultiplier`'s own "real multiplier over real state" shape. */
export function stressWorkMultiplier(components: ComponentStore, beaverId: EntityId): number {
  const stress = getStress(components, beaverId);
  return stress === undefined ? 1 : 1 - stress.level * 0.4;
}

/** Real conflict-proneness contribution from chronic stress -- scales with both stress level and this beaver's own possessiveness (a stressed, possessive beaver is a likelier participant in a dispute), consumed by `Conflict.ts` (P5-14). */
export function conflictProneness(components: ComponentStore, beaverId: EntityId): number {
  const stress = getStress(components, beaverId);
  const possessiveness = traitOrDefault(getTraits(components, beaverId), "possessiveness");
  return (stress?.level ?? 0) * (0.5 + possessiveness);
}

/** Drives stress accumulation/recovery for every live beaver once. */
export function tickAllStress(world: World): void {
  for (const beaverId of world.entities.liveIdsOfKind("beaver").sort((a: EntityId, b: EntityId) => a - b)) {
    tickStress(world, beaverId);
  }
}
