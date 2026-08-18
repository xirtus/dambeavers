import type { EventId } from "../history/EventLog.js";
import { snapshotWorld, restoreWorld, type World, type WorldRestoreContext } from "../persistence/WorldSnapshot.js";

/**
 * P11-13: counterfactual replay/debugging -- fork a saved deterministic
 * state, alter exactly ONE recorded decision/input at the fork point,
 * replay forward, and diff the two runs' causal output. The mechanism
 * is honest by construction: both forks restore from the SAME snapshot
 * (P0-08's persistence, including the seeded `RandomStreams` state), so
 * two unaltered forks stepped by the same step function are
 * bit-identical; any divergence after an alteration is therefore
 * CAUSED by that alteration -- P0-04's own determinism guarantee is the
 * correctness backbone, reused rather than re-proven.
 */

export interface CounterfactualOutcome {
  /** Both runs were bit-identical (same event sequence) for every tick strictly before the fork. */
  identicalBeforeFork: boolean;
  /** The first tick at which the runs' event logs differ, when they do. */
  divergenceTick?: number;
  /** The forked run's events that the original run does not have (recorded at or after the fork). */
  divergedEventIds: EventId[];
}

/**
 * Forks `world` into an independent deep copy via P0-08's own
 * snapshot/restore (same ids, same clock, same random-stream state, same
 * history). Both worlds are then stepped by the CALLER's step function
 * -- this module never presumes what a tick means.
 */
export function forkWorld(world: World, context: WorldRestoreContext): World {
  return restoreWorld(snapshotWorld(world), context);
}

/**
 * The full counterfactual replay:
 *
 * 1. Fork `world` at its current state.
 * 2. Step BOTH worlds identically (`step`, the caller's ordinary
 *    per-tick advance -- colony loop, hydrology, whatever the run is
 *    replaying) until `forkTick`.
 * 3. Verify the runs are still identical (they must be -- same snapshot,
 *    same step function, P0-04 determinism).
 * 4. Apply `mutate` ONCE to the fork (the one altered decision/input).
 * 5. Step both worlds for `spanTicks` more.
 * 6. Diff the event logs: everything before the fork is identical;
 *    divergences after it are the alteration's real causal
 *    consequences.
 *
 * The original `world` is left advanced (the replay IS the simulation
 * continuing) -- the fork is the discarded hypothetical.
 */
export function counterfactualReplay(
  world: World,
  fork: World,
  forkTick: number,
  mutate: (fork: World) => void,
  step: (w: World) => void,
  spanTicks: number,
): CounterfactualOutcome {
  if (!Number.isInteger(forkTick) || forkTick < 0) throw new RangeError(`forkTick must be a non-negative integer, got ${forkTick}`);
  if (!Number.isInteger(spanTicks) || spanTicks < 0) throw new RangeError(`spanTicks must be a non-negative integer, got ${spanTicks}`);

  for (let tick = 0; tick < forkTick; tick++) {
    step(world);
    step(fork);
  }
  const originalCountAtFork = world.events.count;
  const forkCountAtFork = fork.events.count;
  const identicalBeforeFork = eventPrefixIdentical(world, fork, Math.min(originalCountAtFork, forkCountAtFork));

  mutate(fork);
  for (let tick = 0; tick < spanTicks; tick++) {
    step(world);
    step(fork);
  }

  const divergedEventIds = divergedEvents(world, fork);
  const divergenceTick =
    divergedEventIds.length > 0 ? fork.events.get(divergedEventIds[0]!)?.tick : undefined;
  return { identicalBeforeFork, ...(divergenceTick !== undefined ? { divergenceTick } : {}), divergedEventIds };
}

function sameEvent(a: { tick: number; eventType: string; subjectIds: readonly number[]; objectIds: readonly number[]; data?: unknown }, b: { tick: number; eventType: string; subjectIds: readonly number[]; objectIds: readonly number[]; data?: unknown }): boolean {
  return (
    a.tick === b.tick &&
    a.eventType === b.eventType &&
    JSON.stringify(a.subjectIds) === JSON.stringify(b.subjectIds) &&
    JSON.stringify(a.objectIds) === JSON.stringify(b.objectIds) &&
    JSON.stringify(a.data ?? null) === JSON.stringify(b.data ?? null)
  );
}

/** Are the two runs' first `count` events identical? Both runs issue event ids in lockstep (identical registries from the same snapshot), so the k-th event of each run is the correct pair to compare. */
function eventPrefixIdentical(a: World, b: World, count: number): boolean {
  if (a.events.count < count || b.events.count < count) return false;
  const aAll = a.events.all();
  const bAll = b.events.all();
  for (let i = 0; i < count; i++) {
    if (!sameEvent(aAll[i]!, bAll[i]!)) return false;
  }
  return true;
}

/**
 * The alteration's causal footprint: fork events whose aligned
 * counterpart in the original run differs or does not exist. Ids are
 * NOT compared across runs (both registries legitimately reuse the same
 * id numbers for DIFFERENT post-fork events) -- the aligned index is
 * the real pairing, exactly the same comparison the prefix check uses.
 */
function divergedEvents(original: World, fork: World): EventId[] {
  const aAll = original.events.all();
  const bAll = fork.events.all();
  const diverged: EventId[] = [];
  for (let i = 0; i < bAll.length; i++) {
    const counterpart = aAll[i];
    if (counterpart === undefined || !sameEvent(counterpart, bAll[i]!)) diverged.push(bAll[i]!.id);
  }
  return diverged;
}
