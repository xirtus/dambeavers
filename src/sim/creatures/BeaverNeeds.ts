import { defineComponent, type ComponentStore, type ComponentType } from "../core/ComponentStore.js";
import type { EntityId, EntityIdRegistry } from "../core/EntityId.js";
import type { WorldGrid } from "../world/WorldGrid.js";
import type { TerrainField } from "../world/TerrainField.js";
import type { WaterField, ColumnCoordinate } from "../hydrology/WaterField.js";
import type { MaterialRegistry } from "../materials/Material.js";
import { findPath, type NavigationProfile } from "../navigation/Pathfinding.js";
import { getNeeds, setNeeds, applyNeedsTick, NEED_URGENT_THRESHOLD, type Needs } from "./Needs.js";
import { advanceTowards, type AdvanceResult } from "./BeaverLocomotion.js";

/**
 * What a beaver's own survival drives want it to do RIGHT NOW -- decided
 * fresh from current `Needs` + live world state, but WITH one piece of
 * persistent memory (`NeedFocus`, below): never cached across a whole
 * journey (a route re-verifies every tick, matching P1-04/P1-05's own
 * discipline), but a commitment that isn't re-litigated from scratch
 * every single tick either. This is deliberately NOT a job/order (P1-07's
 * `JobActor`, not yet built): there is no designation, eligibility check,
 * reservation, or cancellation semantics here, and nothing stops two
 * hungry beavers from independently targeting the same tree -- P1-07 owns
 * resolving contention between agents; this is one beaver's own,
 * unreserved instinct. `"seek-food"`/`"seek-water"` name a REAL target
 * (an existing tree entity, or a real wet column) but do not yet model
 * eating or drinking (P1-13's job) -- arriving just stops the travel.
 */
export type NeedIntent =
  | { kind: "idle" }
  | { kind: "seek-food"; target: EntityId }
  | { kind: "seek-water"; target: ColumnCoordinate }
  | { kind: "rest" };

/**
 * Which of hunger/thirst this beaver is currently committed to pursuing,
 * if either -- persistent, single-agent memory, NOT a job/order queue
 * (see `NeedIntent`'s own doc comment on why this isn't P1-07 territory).
 *
 * This exists because a memoryless "recompute the single best choice
 * every tick from current need values alone" rule provably fails once
 * hunger and thirst can never be reduced (no consumption system exists
 * until P1-13): whichever need's target the beaver hasn't reached yet
 * would look perpetually more attractive than one already reached, so a
 * beaver could tick-by-tick reverse itself every time it took even one
 * step away from an already-visited resource toward a not-yet-visited
 * one -- real oscillation between two nearby resources, confirmed via a
 * disposable probe during this task's own development. `NeedFocus` fixes
 * this the way real hysteresis/utility-AI systems do: once committed to a
 * need, KEEP pursuing it (re-verifying reachability fresh every tick, so
 * a route that becomes blocked is still discovered immediately) until
 * that pursuit genuinely CONCLUDES -- arrival, or confirmed
 * unreachability -- rather than re-deciding from raw magnitude on every
 * single tick.
 */
export interface NeedFocus {
  current: "hunger" | "thirst" | "none";
}
export const NeedFocusComponent: ComponentType<NeedFocus> = defineComponent<NeedFocus>("need-focus");
export const BASELINE_NEED_FOCUS: Readonly<NeedFocus> = Object.freeze({ current: "none" });

export function assertValidNeedFocus(focus: NeedFocus): void {
  if (focus.current !== "hunger" && focus.current !== "thirst" && focus.current !== "none") {
    throw new RangeError(`need focus current must be "hunger", "thirst", or "none", got ${JSON.stringify(focus.current)}`);
  }
}

export function setNeedFocus(components: ComponentStore, id: EntityId, focus: NeedFocus): void {
  assertValidNeedFocus(focus);
  components.set(id, NeedFocusComponent, focus);
}

export function getNeedFocus(components: ComponentStore, id: EntityId): NeedFocus | undefined {
  const focus = components.get(id, NeedFocusComponent);
  if (focus !== undefined) assertValidNeedFocus(focus);
  return focus;
}

function manhattan(a: ColumnCoordinate, b: ColumnCoordinate): number {
  return Math.abs(a.x - b.x) + Math.abs(a.z - b.z);
}

/**
 * Nearest live tree entity to `from`, or `undefined` if none exists (or
 * none has a placed position) in the whole world. Ties broken by lowest
 * `EntityId` for determinism, independent of `liveIdsOfKind`'s iteration
 * order. Linear scan over live trees -- fine at this project's scale
 * (matches `EntityIdRegistry.liveIdsOfKind`'s own documented precedent).
 *
 * KNOWN LIMITATION (tracked, not a correctness bug): this ranks purely by
 * raw Manhattan distance from the beaver's CURRENT position, recomputed
 * fresh every tick `resolveHunger` is consulted -- including while a
 * sticky `NeedFocus` pursuit of hunger is already underway. `findPath`'s
 * actual route cost (terrain/slope/water, not raw distance) can differ
 * from Manhattan ranking, so a detour-forcing map with two-or-more live
 * trees could see the "nearest" candidate flip mid-journey even though
 * the STICKY NEED itself (hunger) never changes -- `NeedFocus` pins which
 * need a beaver is committed to, not which specific tree. Confirmed via a
 * disposable probe during a P1-06 critic re-review: this can discard
 * partial travel progress toward a tree the beaver was already close to,
 * but always still terminates (no ping-pong, no non-termination) and
 * doesn't reproduce the original starvation bug this file's `NeedFocus`
 * design was built to fix. Not exercised by any current game content
 * (single tree/pond scenarios), and pinning a specific TARGET ENTITY
 * (not just a need category) is arguably P1-07 Job/order architecture's
 * job (real reservation/commitment semantics), not a P1-06 fix.
 */
function nearestTree(entities: EntityIdRegistry, grid: WorldGrid, from: ColumnCoordinate): EntityId | undefined {
  let best: EntityId | undefined;
  let bestDistance = Infinity;
  for (const id of entities.liveIdsOfKind("tree")) {
    const position = grid.positionOf(id);
    if (position === undefined) continue; // not yet placed -- not a valid destination
    const distance = manhattan(from, { x: position.x, z: position.z });
    if (distance < bestDistance || (distance === bestDistance && (best === undefined || id < best))) {
      best = id;
      bestDistance = distance;
    }
  }
  return best;
}

/** Nearest column with any standing water (`WaterField.depthAt > 0`) to `from`, or `undefined` if the whole map is currently dry. Ties broken lexicographically by (x, z) for determinism. O(map area) -- fine at this project's one-watershed scale. Same known limitation as `nearestTree` above regarding mid-journey candidate drift under a sticky focus. */
function nearestWater(grid: WorldGrid, water: WaterField, from: ColumnCoordinate): ColumnCoordinate | undefined {
  const dims = grid.dims;
  let best: ColumnCoordinate | undefined;
  let bestDistance = Infinity;
  for (let x = 0; x < dims.sizeX; x++) {
    for (let z = 0; z < dims.sizeZ; z++) {
      if (water.depthAt(x, z) <= 0) continue;
      const distance = manhattan(from, { x, z });
      if (distance < bestDistance || (distance === bestDistance && (best === undefined || x < best.x || (x === best.x && z < best.z)))) {
        best = { x, z };
        bestDistance = distance;
      }
    }
  }
  return best;
}

interface Candidate {
  need: "thirst" | "hunger";
  value: number;
  alreadyThere: boolean;
  intent: NeedIntent;
}

/**
 * Resolves thirst to a concrete, CURRENTLY-REACHABLE candidate, or
 * `undefined` if thirst isn't urgent, no water exists anywhere, or the
 * nearest water is not currently reachable for this beaver's own
 * `NavigationProfile` (real `findPath` reachability, not merely "a wet
 * column exists somewhere"). Excluding an unreachable target here --
 * rather than merely deprioritizing it -- is what stops a beaver from
 * ever getting stuck perpetually re-selecting a target it can never
 * actually reach (confirmed as a real failure mode via a disposable
 * probe during this task's own development: without this check, an
 * unreachable need would win every re-derivation forever once the OTHER
 * need had already been reached, since "not yet reached" alone doesn't
 * distinguish "blocked" from "just not visited yet").
 */
function resolveThirst(
  needs: Needs,
  grid: WorldGrid,
  terrain: TerrainField,
  water: WaterField,
  materials: MaterialRegistry,
  profile: NavigationProfile,
  position: ColumnCoordinate,
): Candidate | undefined {
  if (needs.thirst < NEED_URGENT_THRESHOLD) return undefined;
  const target = nearestWater(grid, water, position);
  if (target === undefined) return undefined;
  if (findPath(grid, terrain, water, materials, position, target, profile) === undefined) return undefined;
  return {
    need: "thirst",
    value: needs.thirst,
    alreadyThere: target.x === position.x && target.z === position.z,
    intent: { kind: "seek-water", target },
  };
}

/** Resolves hunger the same way `resolveThirst` resolves thirst -- see its doc comment. */
function resolveHunger(
  needs: Needs,
  entities: EntityIdRegistry,
  grid: WorldGrid,
  terrain: TerrainField,
  water: WaterField,
  materials: MaterialRegistry,
  profile: NavigationProfile,
  position: ColumnCoordinate,
): Candidate | undefined {
  if (needs.hunger < NEED_URGENT_THRESHOLD) return undefined;
  const target = nearestTree(entities, grid, position);
  if (target === undefined) return undefined;
  const targetPosition = grid.positionOf(target)!; // guaranteed defined -- nearestTree only returns placed trees
  const targetColumn: ColumnCoordinate = { x: targetPosition.x, z: targetPosition.z };
  if (findPath(grid, terrain, water, materials, position, targetColumn, profile) === undefined) return undefined;
  return {
    need: "hunger",
    value: needs.hunger,
    alreadyThere: targetColumn.x === position.x && targetColumn.z === position.z,
    intent: { kind: "seek-food", target },
  };
}

function resolve(
  need: "thirst" | "hunger",
  needs: Needs,
  entities: EntityIdRegistry,
  grid: WorldGrid,
  terrain: TerrainField,
  water: WaterField,
  materials: MaterialRegistry,
  profile: NavigationProfile,
  position: ColumnCoordinate,
): Candidate | undefined {
  return need === "thirst"
    ? resolveThirst(needs, grid, terrain, water, materials, profile, position)
    : resolveHunger(needs, entities, grid, terrain, water, materials, profile, position);
}

/**
 * Picks a FRESH focus among hunger/thirst (used when there is no current
 * sticky commitment to continue). Among reachable, urgent candidates,
 * prefers whichever has NOT yet been reached over one that HAS --
 * otherwise, whichever of hunger/thirst happens to accumulate faster (or
 * simply reaches 1.0 first) would win this comparison every time it ever
 * recurs, since arriving never reduces a need without P1-13's consumption
 * -- permanently starving the other from ever being picked even once.
 * Falls back to raw magnitude only once neither/both are already-there,
 * where the choice no longer changes any OBSERVABLE behavior (arriving
 * again is a no-op either way).
 */
function pickFreshFocus(candidates: Candidate[]): Candidate {
  const notYetThere = candidates.filter((c) => !c.alreadyThere);
  const pool = notYetThere.length > 0 ? notYetThere : candidates;
  let winner = pool[0]!;
  for (const c of pool.slice(1)) {
    if (c.value > winner.value) winner = c;
  }
  return winner;
}

/**
 * Which single need (if any) is urgent enough to act on, what doing so
 * means concretely, and the focus commitment to carry into the next tick.
 * `thermalComfort` never drives an intent -- see `Needs`'s own doc
 * comment for why it has no real driver yet.
 *
 * 1. Fatigue, if urgent, ALWAYS wins outright and returns `"rest"` --
 *    unlike hunger/thirst, resting requires no travel and is immediately
 *    fully actionable, and physiologically an exhausted beaver shouldn't
 *    be trekking cross-map on errands. The current `focus` (if any) is
 *    left untouched so the SAME pursuit resumes once fatigue passes,
 *    rather than being re-litigated from scratch after every rest break.
 * 2. Otherwise, if `focus` names a need that is still urgent AND still
 *    resolves to a reachable candidate, KEEP pursuing it -- this is what
 *    prevents tick-by-tick oscillation between two nearby resources (see
 *    `NeedFocus`'s own doc comment).
 * 3. Otherwise (no focus, or it just concluded/became invalid), pick a
 *    fresh focus via `pickFreshFocus`.
 * 4. If nothing is urgent and resolvable at all, `"idle"` with no focus.
 *
 * The caller (`tickBeaverNeeds`) is responsible for CLEARING focus once a
 * pursuit concludes (arrival or confirmed-unreachable) so the next tick's
 * call to this function re-derives rather than sticking forever.
 */
export function decideIntent(
  needs: Needs,
  focus: NeedFocus["current"],
  entities: EntityIdRegistry,
  grid: WorldGrid,
  terrain: TerrainField,
  water: WaterField,
  materials: MaterialRegistry,
  profile: NavigationProfile,
  position: ColumnCoordinate,
): { intent: NeedIntent; nextFocus: NeedFocus["current"] } {
  if (needs.fatigue >= NEED_URGENT_THRESHOLD) return { intent: { kind: "rest" }, nextFocus: focus };

  if (focus !== "none") {
    const sticky = resolve(focus, needs, entities, grid, terrain, water, materials, profile, position);
    if (sticky !== undefined) return { intent: sticky.intent, nextFocus: focus };
    // Focus's need is no longer urgent, or its target vanished/became
    // unreachable -- fall through to a fresh pick this same tick.
  }

  const candidates = [
    resolveThirst(needs, grid, terrain, water, materials, profile, position),
    resolveHunger(needs, entities, grid, terrain, water, materials, profile, position),
  ].filter((c): c is Candidate => c !== undefined);

  if (candidates.length === 0) return { intent: { kind: "idle" }, nextFocus: "none" };

  const winner = pickFreshFocus(candidates);
  return { intent: winner.intent, nextFocus: winner.need };
}

export interface NeedsTickResult {
  needs: Needs;
  intent: NeedIntent;
  /** Only present when `intent` required travel this tick (`"seek-food"`/`"seek-water"`). */
  movement?: AdvanceResult;
}

/**
 * One simulated tick of a beaver's survival drives: decide what's urgent
 * (`decideIntent`, including sticky-focus continuation), act on it (real
 * navigation via `advanceTowards` for `"seek-food"`/`"seek-water"`; no
 * movement for `"rest"`/`"idle"`), then apply this tick's need change
 * (`applyNeedsTick`) using whatever activity actually happened -- decided
 * BEFORE decaying so this tick's decay can never retroactively change the
 * decision that produced it. Persists the updated `Needs` AND `NeedFocus`
 * back onto the entity, clearing focus once a pursuit concludes (arrival
 * or confirmed-unreachable) so the next tick's `decideIntent` call
 * re-derives instead of sticking forever. Callable once per simulated
 * tick, by a test loop today or a future scheduler once one exists --
 * this function is the behavior, not the driver.
 */
export function tickBeaverNeeds(
  grid: WorldGrid,
  terrain: TerrainField,
  water: WaterField,
  materials: MaterialRegistry,
  entities: EntityIdRegistry,
  components: ComponentStore,
  id: EntityId,
  profile: NavigationProfile,
): NeedsTickResult {
  const needs = getNeeds(components, id);
  if (needs === undefined) {
    throw new RangeError(`entity ${id} has no Needs component -- cannot tick`);
  }
  const focus = getNeedFocus(components, id);
  if (focus === undefined) {
    throw new RangeError(`entity ${id} has no NeedFocus component -- cannot tick`);
  }
  const position = grid.positionOf(id);
  if (position === undefined) {
    throw new RangeError(`entity ${id} has no position in the grid -- cannot tick`);
  }
  const column: ColumnCoordinate = { x: position.x, z: position.z };

  const { intent, nextFocus } = decideIntent(needs, focus.current, entities, grid, terrain, water, materials, profile, column);

  let movement: AdvanceResult | undefined;
  if (intent.kind === "seek-food") {
    // Guaranteed defined: `decideIntent` only selects a tree it already
    // confirmed has a placed position, moments ago, in this same
    // synchronous call.
    const targetPosition = grid.positionOf(intent.target)!;
    movement = advanceTowards(grid, terrain, water, materials, components, id, {
      x: targetPosition.x,
      z: targetPosition.z,
    });
  } else if (intent.kind === "seek-water") {
    movement = advanceTowards(grid, terrain, water, materials, components, id, intent.target);
  }

  // A pursuit CONCLUDES (clear focus so the next tick re-derives) on
  // arrival or a confirmed-unreachable route; it CONTINUES (keep focus)
  // only while still genuinely en route ("moved").
  const concluded = movement !== undefined && movement.outcome !== "moved";
  const resolvedFocus: NeedFocus["current"] = concluded ? "none" : nextFocus;

  const wasActive = movement !== undefined && (movement.outcome === "moved" || movement.outcome === "arrived");
  const updatedNeeds = applyNeedsTick(needs, wasActive);
  setNeeds(components, id, updatedNeeds);
  setNeedFocus(components, id, { current: resolvedFocus });

  return movement === undefined
    ? { needs: updatedNeeds, intent }
    : { needs: updatedNeeds, intent, movement };
}
