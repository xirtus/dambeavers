import { defineComponent, type ComponentStore, type ComponentType } from "../core/ComponentStore.js";
import type { EntityId, EntityIdRegistry } from "../core/EntityId.js";
import type { WorldGrid } from "../world/WorldGrid.js";
import type { TerrainField } from "../world/TerrainField.js";
import type { WaterField, ColumnCoordinate } from "../hydrology/WaterField.js";
import type { MaterialRegistry } from "../materials/Material.js";
import { findPath, type NavigationProfile } from "../navigation/Pathfinding.js";
import { getNeeds, setNeeds, applyNeedsTick, clamp01, NEED_URGENT_THRESHOLD, type Needs } from "./Needs.js";
import { advanceTowards, type AdvanceResult } from "./BeaverLocomotion.js";
import { getPlant, setPlant } from "../ecology/Plant.js";
import { getHeld, getReservation } from "../labor/Log.js";
import { getFood } from "../labor/Food.js";
import { getConstruction } from "../labor/Construction.js";

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
 * unreserved instinct. `"seek-food"`/`"seek-water"` name a REAL target (an
 * existing tree/food entity, or a real wet column) and genuinely consume
 * on arrival (P1-13, `eatFromTree`/`eatFoodItem`/`drinkWater`).
 * `"rest"`'s own `target` (P1-14) is OPTIONAL, not because it's
 * unimplemented but because it's genuinely sometimes absent: a beaver
 * rests wherever it currently stands when no safer location exists or is
 * reachable (the roadmap's own "sleep wherever necessary"), and travels to
 * a real preferred location (today: the nearest reachable COMPLETED
 * lodge-segment construction, P1-10) only when one actually exists --
 * "prefer safer/appropriate rest locations" as a genuine, distance/
 * reachability-driven choice, not a hardcoded destination.
 */
export type NeedIntent =
  | { kind: "idle" }
  | { kind: "seek-food"; target: EntityId }
  | { kind: "seek-water"; target: ColumnCoordinate }
  | { kind: "rest"; target?: ColumnCoordinate };

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

/**
 * Nearest live, genuinely FREE `"food"` item (P1-13, `Food.ts`) -- not
 * held, and not reserved by a still-live entity (a stale reservation is no
 * obstacle, the same "discover from live state" precedent
 * `isEligibleForHaul`/`findAvailableMaterial` already established). In
 * practice nothing ever reserves a food item today (`Hauling.ts`'s own
 * `designateHaul` already structurally refuses any item without a `Log`
 * component, so a food item can never be haul-targeted), but checking
 * anyway costs nothing and keeps this consistent with every other
 * "nearest free physical resource" query in the codebase.
 */
function nearestFoodItem(entities: EntityIdRegistry, components: ComponentStore, grid: WorldGrid, from: ColumnCoordinate): EntityId | undefined {
  let best: EntityId | undefined;
  let bestDistance = Infinity;
  for (const id of entities.liveIdsOfKind("food")) {
    if (getHeld(components, id) !== undefined) continue;
    const reservation = getReservation(components, id);
    if (reservation !== undefined && entities.isLive(reservation.by)) continue;
    const position = grid.positionOf(id);
    if (position === undefined) continue;
    const distance = manhattan(from, { x: position.x, z: position.z });
    if (distance < bestDistance || (distance === bestDistance && (best === undefined || id < best))) {
      best = id;
      bestDistance = distance;
    }
  }
  return best;
}

interface HungerSource {
  targetEntity: EntityId;
  column: ColumnCoordinate;
}

/**
 * The nearer of the nearest live tree (bark/cambium, `eatFromTree`) and
 * the nearest free stored food item (`eatFoodItem`) -- the roadmap's own
 * "bark/cambium... OR stored food item" framing as a real choice driven by
 * distance, not a hardcoded preference for one over the other. Ties broken
 * by lowest `EntityId` for determinism, matching every other "nearest"
 * query in this file. `undefined` only when NEITHER exists anywhere.
 */
function nearestHungerSource(entities: EntityIdRegistry, components: ComponentStore, grid: WorldGrid, from: ColumnCoordinate): HungerSource | undefined {
  const treeId = nearestTree(entities, grid, from);
  const treePosition = treeId !== undefined ? grid.positionOf(treeId) : undefined;
  const tree: HungerSource | undefined = treePosition !== undefined ? { targetEntity: treeId!, column: { x: treePosition.x, z: treePosition.z } } : undefined;

  const foodId = nearestFoodItem(entities, components, grid, from);
  const foodPosition = foodId !== undefined ? grid.positionOf(foodId) : undefined;
  const food: HungerSource | undefined = foodPosition !== undefined ? { targetEntity: foodId!, column: { x: foodPosition.x, z: foodPosition.z } } : undefined;

  if (tree === undefined) return food;
  if (food === undefined) return tree;
  const treeDistance = manhattan(from, tree.column);
  const foodDistance = manhattan(from, food.column);
  if (foodDistance < treeDistance) return food;
  if (treeDistance < foodDistance) return tree;
  return tree.targetEntity < food.targetEntity ? tree : food;
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

/**
 * The site of the nearest live, COMPLETED `"lodge-segment"` construction
 * (P1-10) -- a real "safer/appropriate rest location," never a not-yet-
 * finished one (Law 1.6: a shelter that isn't actually built yet isn't
 * actually safer). Ties broken by lowest construction `EntityId` for
 * determinism, matching every other "nearest" query in this file.
 * `undefined` if no completed lodge exists anywhere -- the caller falls
 * back to resting in place, the roadmap's own "sleep wherever necessary."
 *
 * KNOWN LIMITATION (tracked, not a correctness bug -- the same one
 * `nearestTree`/`nearestWater` above already document): rest has no
 * `NeedFocus`-equivalent sticky commitment, so `decideIntent` recomputes
 * this fresh every tick even mid-journey. On a detour-forcing map with two
 * or more completed lodges, the chosen TARGET can flip partway there if a
 * different lodge becomes closer by raw distance, discarding partial
 * travel progress -- confirmed via a disposable probe during this task's
 * own critic review. Always still terminates (no ping-pong, no
 * unreachable-target lockup); not exercised by any current game content
 * (single-lodge scenarios), and real target-commitment semantics belong
 * to P1-07's job/reservation system, not a further patch here.
 */
function nearestCompletedLodgeSite(entities: EntityIdRegistry, components: ComponentStore, from: ColumnCoordinate): ColumnCoordinate | undefined {
  let bestId: EntityId | undefined;
  let best: ColumnCoordinate | undefined;
  let bestDistance = Infinity;
  for (const id of entities.liveIdsOfKind("construction")) {
    const construction = getConstruction(components, id);
    if (construction === undefined || construction.kind !== "lodge-segment" || construction.status !== "complete") continue;
    const distance = manhattan(from, construction.site);
    if (distance < bestDistance || (distance === bestDistance && (bestId === undefined || id < bestId))) {
      bestId = id;
      best = construction.site;
      bestDistance = distance;
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

/** Resolves hunger the same way `resolveThirst` resolves thirst -- see its doc comment. The candidate is whichever of the nearest live tree or nearest free food item (`nearestHungerSource`) is actually closer, so "bark/cambium... or a stored food item" (the roadmap's own wording) is a real, distance-driven choice. */
function resolveHunger(
  needs: Needs,
  entities: EntityIdRegistry,
  components: ComponentStore,
  grid: WorldGrid,
  terrain: TerrainField,
  water: WaterField,
  materials: MaterialRegistry,
  profile: NavigationProfile,
  position: ColumnCoordinate,
): Candidate | undefined {
  if (needs.hunger < NEED_URGENT_THRESHOLD) return undefined;
  const source = nearestHungerSource(entities, components, grid, position);
  if (source === undefined) return undefined;
  const target = source.targetEntity;
  const targetColumn = source.column;
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
  components: ComponentStore,
  grid: WorldGrid,
  terrain: TerrainField,
  water: WaterField,
  materials: MaterialRegistry,
  profile: NavigationProfile,
  position: ColumnCoordinate,
): Candidate | undefined {
  return need === "thirst"
    ? resolveThirst(needs, grid, terrain, water, materials, profile, position)
    : resolveHunger(needs, entities, components, grid, terrain, water, materials, profile, position);
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
 *    (P1-14) The rest intent's own `target` is the nearest reachable
 *    COMPLETED lodge if one exists, else omitted entirely (rest in
 *    place) -- recomputed fresh every call, so a lodge that finishes
 *    construction, or one that becomes unreachable, is reflected
 *    immediately, never a stale cached destination.
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
  components: ComponentStore,
  grid: WorldGrid,
  terrain: TerrainField,
  water: WaterField,
  materials: MaterialRegistry,
  profile: NavigationProfile,
  position: ColumnCoordinate,
): { intent: NeedIntent; nextFocus: NeedFocus["current"] } {
  if (needs.fatigue >= NEED_URGENT_THRESHOLD) {
    const preferred = nearestCompletedLodgeSite(entities, components, position);
    const reachable = preferred !== undefined && findPath(grid, terrain, water, materials, position, preferred, profile) !== undefined;
    return { intent: reachable ? { kind: "rest", target: preferred } : { kind: "rest" }, nextFocus: focus };
  }

  if (focus !== "none") {
    const sticky = resolve(focus, needs, entities, components, grid, terrain, water, materials, profile, position);
    if (sticky !== undefined) return { intent: sticky.intent, nextFocus: focus };
    // Focus's need is no longer urgent, or its target vanished/became
    // unreachable -- fall through to a fresh pick this same tick.
  }

  const candidates = [
    resolveThirst(needs, grid, terrain, water, materials, profile, position),
    resolveHunger(needs, entities, components, grid, terrain, water, materials, profile, position),
  ].filter((c): c is Candidate => c !== undefined);

  if (candidates.length === 0) return { intent: { kind: "idle" }, nextFocus: "none" };

  const winner = pickFreshFocus(candidates);
  return { intent: winner.intent, nextFocus: winner.need };
}

/** Fraction of a live tree's `Plant.health` (P0-10) one bite of bark/cambium costs -- real, not fictional: a beaver that keeps eating from the SAME tree measurably wears it down (floored at 0; nothing destroys a zero-health tree yet -- no plant-death-from-grazing system exists until a future ecology task, Law 10). Plausible, tunable balance data. */
export const EAT_TREE_HEALTH_COST = 0.02;

/**
 * Eating bark/cambium from a live tree: an effectively unlimited fallback
 * food source (unlike a stored item, which is destroyed when eaten) that
 * always fully satisfies hunger in one sitting -- the "initial foods can
 * be simple" version the roadmap explicitly invites, rather than an
 * arbitrary partial-restore magic number this task would otherwise have
 * to justify. Costs the tree a small, real amount of health per bite.
 */
function eatFromTree(components: ComponentStore, treeId: EntityId, needs: Needs): Needs {
  const plant = getPlant(components, treeId)!;
  setPlant(components, treeId, { ...plant, health: clamp01(plant.health - EAT_TREE_HEALTH_COST) });
  return { ...needs, hunger: 0 };
}

/**
 * Eating a stored food item: destroys the real physical entity (Law 1.6 --
 * a consumed resource is actually gone, not merely marked invisible) and
 * restores hunger by exactly its own `Food.nutritionValue` (which may or
 * may not fully satisfy it, unlike the tree fallback) -- giving that field
 * real, observable meaning.
 */
function eatFoodItem(entities: EntityIdRegistry, components: ComponentStore, itemId: EntityId, needs: Needs): Needs {
  const food = getFood(components, itemId)!;
  entities.destroy(itemId);
  return { ...needs, hunger: clamp01(needs.hunger - food.nutritionValue) };
}

/**
 * Drinking from accessible water: always fully satisfies thirst -- the
 * roadmap's own "accessible water" bullet implies no scarcity mechanic (a
 * single beaver's sip is negligible against any real pond's volume), so
 * unlike `eatFoodItem` this deliberately does NOT remove any volume from
 * `WaterField` (inventing a fake scarcity mechanic with no gameplay driver
 * behind it would be exactly the "smuggled story" AGENTS.md warns
 * against).
 */
function drinkWater(needs: Needs): Needs {
  return { ...needs, thirst: 0 };
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
 * movement for `"rest"`/`"idle"`), CONSUME (P1-13: `eatFromTree`/
 * `eatFoodItem`/`drinkWater`) the instant travel actually concludes at the
 * target this tick (`"arrived"` or `"already-there"` -- never `"moved"`,
 * so a beaver never eats/drinks mid-journey), then apply this tick's
 * ordinary passive need change (`applyNeedsTick`) on top of whatever
 * consumption just happened, using whatever activity actually occurred --
 * decided BEFORE decaying so this tick's decay can never retroactively
 * change the decision that produced it, and applied AFTER consumption so
 * a single tick's worth of ordinary decay is never silently skipped just
 * because a meal also happened that same tick. Persists the updated
 * `Needs` AND `NeedFocus` back onto the entity, clearing focus once a
 * pursuit concludes (arrival, consumption, or confirmed-unreachable) so
 * the next tick's `decideIntent` call re-derives instead of sticking
 * forever. Callable once per simulated tick, by a test loop today or a
 * future scheduler once one exists -- this function is the behavior, not
 * the driver.
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

  const { intent, nextFocus } = decideIntent(needs, focus.current, entities, components, grid, terrain, water, materials, profile, column);

  let movement: AdvanceResult | undefined;
  let actedOnNeeds = needs;
  if (intent.kind === "seek-food") {
    // Guaranteed defined: `decideIntent` only selects a tree or food item
    // it already confirmed has a placed position, moments ago, in this
    // same synchronous call.
    const targetPosition = grid.positionOf(intent.target)!;
    movement = advanceTowards(grid, terrain, water, materials, components, id, {
      x: targetPosition.x,
      z: targetPosition.z,
    });
    if (movement.outcome === "arrived" || movement.outcome === "already-there") {
      // `intent.target`'s kind can only be `"tree"` or `"food"` here:
      // `decideIntent` selected it from `nearestTree`/`nearestFoodItem`
      // moments ago in this same synchronous call, and the only code that
      // ran in between (`advanceTowards`, immediately above) only ever
      // reads/writes the ACTING beaver's own position -- it never touches
      // `intent.target` -- so nothing could have destroyed or reclassified
      // it in that window.
      actedOnNeeds =
        entities.kindOf(intent.target) === "tree"
          ? eatFromTree(components, intent.target, actedOnNeeds)
          : eatFoodItem(entities, components, intent.target, actedOnNeeds);
    }
  } else if (intent.kind === "seek-water") {
    movement = advanceTowards(grid, terrain, water, materials, components, id, intent.target);
    if (movement.outcome === "arrived" || movement.outcome === "already-there") {
      actedOnNeeds = drinkWater(actedOnNeeds);
    }
  } else if (intent.kind === "rest" && intent.target !== undefined) {
    // A preferred rest location exists and was confirmed reachable moments
    // ago in `decideIntent` -- travel there like any other need pursuit.
    // No `target` at all (the more common case, "sleep wherever
    // necessary") means resting in place, `movement` stays `undefined`,
    // and `wasActive` below is `false` on this branch entirely --
    // fatigue recovers starting THIS tick, exactly P1-06's original
    // in-place-rest behavior, completely unchanged when no lodge exists.
    movement = advanceTowards(grid, terrain, water, materials, components, id, intent.target);
    // Deliberately NO action here on "arrived"/"already-there": unlike
    // eating/drinking, rest doesn't destroy/mutate anything on arrival --
    // `wasActive` below already treats "already-there" as NOT active, so
    // fatigue starts recovering the very next tick once genuinely there,
    // with no separate consumption step needed.
  }

  // A pursuit CONCLUDES (clear focus so the next tick re-derives) on
  // arrival or a confirmed-unreachable route; it CONTINUES (keep focus)
  // only while still genuinely en route ("moved").
  const concluded = movement !== undefined && movement.outcome !== "moved";
  const resolvedFocus: NeedFocus["current"] = concluded ? "none" : nextFocus;

  const wasActive = movement !== undefined && (movement.outcome === "moved" || movement.outcome === "arrived");
  const updatedNeeds = applyNeedsTick(actedOnNeeds, wasActive);
  setNeeds(components, id, updatedNeeds);
  setNeedFocus(components, id, { current: resolvedFocus });

  return movement === undefined
    ? { needs: updatedNeeds, intent }
    : { needs: updatedNeeds, intent, movement };
}
