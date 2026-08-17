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
 *  - `industriousness` (P5-01): scales labor priority -- a highly
 *    industrious beaver weights work more heavily against competing
 *    demands (`LaborPreferences.ts`'s own priority formula).
 *  - `courage` (P5-01): how willing this beaver is to remain near real
 *    danger (fire, a predator) rather than flee -- consumed by whichever
 *    danger-response check reads it (Law 10: the trait itself is real
 *    now; a dedicated danger-avoidance decision system is a future,
 *    narrower task).
 *  - `possessiveness` (P5-01): scales how strongly this beaver reacts to
 *    ownership disputes (P5-06/P5-14) -- a real input those systems
 *    consume, not itself a dispute mechanism.
 *  - `playfulness` (P5-01): scales this beaver's own preference for
 *    recreational/social activity over idle rest when neither is urgent.
 * Each of these five dials is a real, independent `[0,1]` input consumed
 * by a DIFFERENT downstream system (work/social life/danger/possessions/
 * recreation, the roadmap's own literal five-item list) -- one shared
 * personality record, never five separate authored behavior scripts.
 */
export interface Traits {
  sociability: number;
  resilience: number;
  /**
   * `industriousness`/`courage`/`possessiveness`/`playfulness` are
   * OPTIONAL (P5-01, added after P2-14 shipped) -- every existing
   * `Traits` literal across this codebase's own Phase 2 tests only ever
   * set `sociability`/`resilience`/`assignedTick`, and making these four
   * required would have broken over thirty already-shipped, already-
   * critic-reviewed call sites for no behavioral gain. `traitOrDefault`
   * (below) is the one place that resolves "absent" to the same neutral
   * `0.5` `BASELINE_TRAITS` already uses for a beaver with no `Traits`
   * component at all -- callers never see the optionality directly.
   */
  industriousness?: number;
  courage?: number;
  possessiveness?: number;
  playfulness?: number;
  /** Tick these traits were assigned -- world-aware writes reject a value after the current tick, the same repeat-critic-finding class caught in P2-12/P2-13. */
  assignedTick: number;
}
export const TraitsComponent: ComponentType<Traits> = defineComponent<Traits>("traits");

/** Neutral value substituted for any of the P5-01 optional dials when absent -- see `Traits`'s own doc comment. */
export const NEUTRAL_TRAIT_VALUE = 0.5;

export function traitOrDefault(traits: Traits | undefined, field: "industriousness" | "courage" | "possessiveness" | "playfulness"): number {
  return traits?.[field] ?? NEUTRAL_TRAIT_VALUE;
}

/** Neutral fallback for a beaver that was never assigned real traits (e.g. a hand-built test beaver): keeps `Mood.ts` always computable without fabricating variation that doesn't exist. */
export const BASELINE_TRAITS: Readonly<Traits> = Object.freeze({
  sociability: 0.5,
  resilience: 0.5,
  industriousness: 0.5,
  courage: 0.5,
  possessiveness: 0.5,
  playfulness: 0.5,
  assignedTick: 0,
});

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
  if (traits.industriousness !== undefined) assertUnitRange(traits.industriousness, "traits industriousness");
  if (traits.courage !== undefined) assertUnitRange(traits.courage, "traits courage");
  if (traits.possessiveness !== undefined) assertUnitRange(traits.possessiveness, "traits possessiveness");
  if (traits.playfulness !== undefined) assertUnitRange(traits.playfulness, "traits playfulness");
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
    industriousness: random.nextFloat(),
    courage: random.nextFloat(),
    possessiveness: random.nextFloat(),
    playfulness: random.nextFloat(),
    assignedTick: world.clock.tick,
  };
  setWorldTraits(world, beaverId, traits);
  return traits;
}
