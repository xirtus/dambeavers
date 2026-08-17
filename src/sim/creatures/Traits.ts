import { defineComponent, type ComponentStore, type ComponentType } from "../core/ComponentStore.js";
import type { EntityId } from "../core/EntityId.js";
import type { RandomStream } from "../core/Random.js";
import type { World } from "../persistence/WorldSnapshot.js";

/**
 * P2-14's persistent per-beaver personality: real `ComponentStore` data
 * (P0-03, P0-06), not a per-event dice roll and not an authored per-beaver
 * script. `Mood.ts` reads these values (plus live needs/social/event
 * state) to compute a beaver's current mood, so "two beavers exposed to
 * the same event can react differently" (the roadmap's own literal
 * acceptance wording) falls out of one shared formula fed two different
 * trait inputs -- never a branch on which specific beaver it is.
 *
 * Deliberately a small, closed set of `[0, 1]` dials, mirroring
 * `RelationshipEdge.familiarity`'s own precedent for a bounded personality-
 * adjacent number: `Relationships.ts` doesn't build a "deep psychology"
 * system, and neither does this file.
 *
 *  - `sociability`: how strongly this beaver's own social state (loneliness
 *    or recent contact) and social events move its mood. A highly social
 *    beaver feels isolation more sharply and a good interaction more
 *    strongly; a low-sociability "loner" barely reacts either way.
 *  - `resilience`: how strongly this beaver's mood swings at all, in either
 *    direction, from unmet needs and recent events. A resilient beaver
 *    stays comparatively even-keeled; a low-resilience beaver's mood moves
 *    more with the same underlying facts.
 */
export interface Traits {
  sociability: number;
  resilience: number;
  /** Tick these traits were assigned -- world-aware writes reject a value after the current tick, the same repeat-critic-finding class caught in P2-12/P2-13. */
  assignedTick: number;
}
export const TraitsComponent: ComponentType<Traits> = defineComponent<Traits>("traits");

/** Neutral fallback for a beaver that was never assigned real traits (e.g. a hand-built test beaver): keeps `Mood.ts` always computable without fabricating variation that doesn't exist. */
export const BASELINE_TRAITS: Readonly<Traits> = Object.freeze({ sociability: 0.5, resilience: 0.5, assignedTick: 0 });

function assertUnitRange(value: unknown, label: string): asserts value is number {
  if (!(typeof value === "number" && value >= 0 && value <= 1)) {
    throw new RangeError(`${label} must be in [0, 1], got ${JSON.stringify(value)}`);
  }
}

function assertNonNegativeInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new RangeError(`${label} must be a non-negative integer, got ${JSON.stringify(value)}`);
  }
}

export function assertValidTraits(traits: Traits): void {
  if (traits === null || typeof traits !== "object") throw new RangeError("traits must be an object");
  assertUnitRange(traits.sociability, "traits sociability");
  assertUnitRange(traits.resilience, "traits resilience");
  assertNonNegativeInteger(traits.assignedTick, "traits assignedTick");
}

export function setTraits(components: ComponentStore, beaverId: EntityId, traits: Traits): void {
  assertValidTraits(traits);
  components.set(beaverId, TraitsComponent, traits);
}

export function getTraits(components: ComponentStore, beaverId: EntityId): Traits | undefined {
  const traits = components.get(beaverId, TraitsComponent);
  if (traits !== undefined) assertValidTraits(traits);
  return traits;
}

function assertLiveBeaver(world: World, beaverId: EntityId): void {
  if (!world.entities.isLive(beaverId) || world.entities.kindOf(beaverId) !== "beaver") {
    throw new RangeError(`traits entity ${beaverId} is not a live beaver`);
  }
}

function assertTraitsNotFromFuture(world: World, traits: Traits): void {
  if (traits.assignedTick > world.clock.tick) {
    throw new RangeError(`traits assignedTick ${traits.assignedTick} is after current world tick ${world.clock.tick}`);
  }
}

export function setWorldTraits(world: World, beaverId: EntityId, traits: Traits): void {
  assertLiveBeaver(world, beaverId);
  assertTraitsNotFromFuture(world, traits);
  setTraits(world.components, beaverId, traits);
}

export function getWorldTraits(world: World, beaverId: EntityId): Traits | undefined {
  assertLiveBeaver(world, beaverId);
  const traits = getTraits(world.components, beaverId);
  if (traits !== undefined) assertTraitsNotFromFuture(world, traits);
  return traits;
}

/**
 * Rolls and persists a fresh set of traits for `beaverId` from `random` --
 * a caller-supplied stream so callers control which named substream
 * (P0-04) draws these numbers, keeping trait assignment from ever
 * perturbing another subsystem's draw sequence. Deterministic for a given
 * world seed and stable across save/reload: the roll happens once, here,
 * and the RESULT is what persists -- reloading a save never re-rolls it.
 */
export function assignTraits(world: World, beaverId: EntityId, random: RandomStream): Traits {
  const traits: Traits = {
    sociability: random.nextFloat(),
    resilience: random.nextFloat(),
    assignedTick: world.clock.tick,
  };
  setWorldTraits(world, beaverId, traits);
  return traits;
}
