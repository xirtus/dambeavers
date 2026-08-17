import type { EntityId } from "../core/EntityId.js";
import type { WorldGrid } from "../world/WorldGrid.js";
import type { WaterField, ColumnCoordinate } from "../hydrology/WaterField.js";
import type { World } from "../persistence/WorldSnapshot.js";
import { setPlant, type Plant } from "./Plant.js";
import type { PlantSpeciesProperties } from "./PlantSpecies.js";

/**
 * P1-17's "minimal ecology response" -- the roadmap's own five-item list,
 * each a real, derived mechanism over EXISTING data (`WaterField`, P1-02/
 * 03; `Plant`/`PlantSpeciesProperties`, P0-10) rather than a new parallel
 * bookkeeping system:
 *
 * - plant moisture preference / flooding tolerance: BOTH derived from
 *   `PlantSpeciesProperties.moisturePreference` -- one real number, not
 *   two independently-tunable ones (a wetland-adapted species tolerating
 *   flooding well and a dry-adapted one tolerating it poorly are the
 *   SAME underlying fact).
 * - tree growth baseline: `applyPlantGrowthTick` -- real, continuous
 *   `Plant.ageTicks` advancement, already the exact quantity
 *   `PlantSpecies.ts`'s `growthFraction`/`trunkVolumeM3` derive size from
 *   (P0-10); nothing new to store.
 * - regrowth baseline: `plantSapling` -- a real, callable "a new plant
 *   exists here now" mechanism (the actual primitive regrowth needs),
 *   with no automatic trigger yet (no system currently decides WHEN a
 *   felled/dead tree should regrow -- AGENTS.md Law 10), similar in
 *   SHAPE to `Mortality.ts`'s `applyTrauma` ("a real mechanism, not yet
 *   wired to an automatic driver") but weaker in one honest respect:
 *   `Mortality.ts`'s own `die` leaves a real, persistent trace (a
 *   `Corpse` entity plus an `EventLog` record) a future system could key
 *   an automatic reaction off of, while `TreeCutting.ts`'s `fellTree`
 *   destroys a tree with NO trace at all (no stump, no event) --
 *   confirmed by reading it directly. A future "regrow where a tree was
 *   felled" system would need `TreeCutting.ts` itself extended to leave
 *   such a marker first; `plantSapling` alone only ever gives that future
 *   system a way to CREATE a new plant once it already knows WHERE and
 *   WHEN to, not a way to discover that on its own. Flagged honestly
 *   here (raised during this task's own critic review) rather than
 *   overclaiming full parity with the corpse precedent; extending
 *   `fellTree` to leave a stump/event is real, in-scope-sounding work for
 *   whichever future task actually needs regrowth to trigger
 *   automatically, not this one (Law 10 -- this task's own literal
 *   acceptance wording never requires felled trees to regrow).
 * - wetland vegetation state: not a new field -- a plant's own current
 *   `Plant.health` (driven by `applyVegetationHealthTick`, below) IS the
 *   observable "how is this vegetation doing here" state, exactly the
 *   same way `Health.fraction` already serves as a beaver's own general
 *   wellbeing signal (P1-16) rather than a separate "condition" enum.
 * - simple fish/wetland animal presence: `isFishHabitat`/`spawnFish` --
 *   real habitat-suitability derivation plus a real, physical (Law 1.6)
 *   presence entity; deliberately no behavior/AI (the roadmap's own word
 *   is "presence," not "simulation").
 */

/** Depth (in `WaterField`'s own cell-height units) at which a column reads as "fully wet" for vegetation-fitness purposes -- plausible, tunable balance data. */
export const WETNESS_REFERENCE_DEPTH = 1;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** A real, continuous `[0, 1]` wetness signal derived from actual standing water depth (`WaterField.depthAt`, P1-02/03) -- `0` bone dry, saturating toward `1` as real depth increases past `WETNESS_REFERENCE_DEPTH`. */
export function currentWetness(water: WaterField, x: number, z: number): number {
  return clamp01(water.depthAt(x, z) / WETNESS_REFERENCE_DEPTH);
}

/**
 * How well a species tolerates being flooded -- literally the SAME number
 * as its moisture preference. This deliberately collapses the roadmap's
 * two separately-named bullets ("plant moisture preference" and "flooding
 * tolerance") into ONE tunable number rather than two independent ones --
 * a real, documented scope choice (raised and left as-is during this
 * task's own critic review), not an oversight: some real riparian species
 * genuinely DO separate these (preferring moderate moisture while
 * tolerating full submersion far beyond what that preference alone would
 * predict), which this minimal model cannot express. Splitting them
 * would need a second per-species number and a redesigned fitness
 * formula below -- deferred as unneeded complexity for this project's
 * current two-species (aspen/willow), clearly-opposite-preference scope
 * (AGENTS.md Law 10); a future task adding a THIRD species with a
 * genuinely different preference/tolerance split is the natural trigger
 * to revisit this, not something to speculatively build now. Exported as
 * its own named function anyway (rather than callers reading
 * `species.moisturePreference` directly for this purpose) so "flooding
 * tolerance," the roadmap's own named concept, has a real, documented,
 * greppable home to migrate to a real second field from, later.
 */
export function floodTolerance(species: PlantSpeciesProperties): number {
  return species.moisturePreference;
}

/** How much of the gap between current health and current site fitness closes per tick -- plausible, tunable balance data, kept small enough that only SUSTAINED (the roadmap's own word, "persistently") mismatched conditions produce a LARGE, obvious decline/gain (the drift is a genuine exponential convergence, so even a brief mismatch produces a proportionally small, real change -- "persistently" is a matter of degree here, not a hard gate, matching every other rate constant in this codebase, e.g. `HUNGER_DECAY_PER_TICK`). */
export const VEGETATION_HEALTH_DRIFT_RATE = 0.01;

/**
 * One simulated tick of P1-17's core mechanism: `Plant.health` drifts
 * toward `siteFitness` -- `1 - |wetness - species.moisturePreference|`,
 * how well the site's CURRENT real wetness matches this species' own
 * preference -- at `VEGETATION_HEALTH_DRIFT_RATE`. `siteFitness` only
 * reaches its maximum of `1` when wetness EXACTLY equals
 * `moisturePreference` -- which is exactly why `standardPlantSpecies.ts`
 * gives aspen and willow the EXACT extremes (`0` and `1`) rather than
 * merely "low"/"high" values: a species' own genuinely-ideal habitat must
 * be a real, reachable wetness value, or even a perfectly healthy
 * specimen standing in its own best possible conditions would decay
 * forever with no floor (a real bug this task's own critic review caught
 * and this file's doc comments now warn against for any FUTURE species
 * data). Given correct data, a dry-adapted species (`moisturePreference`
 * low) sitting in persistently deep water has a LOW site fitness, so
 * health drifts DOWN (the roadmap's own "declines"); a wetland species
 * (`moisturePreference` high) in that same water has a HIGH site fitness,
 * so health drifts UP toward it (the roadmap's own "gains viability") --
 * one shared formula produces BOTH halves of the roadmap's literal
 * acceptance sentence, never two separately-scripted outcomes. Note that
 * a plant already at `health: 1` (every current spawn path's own
 * default, `WatershedGenerator.ts`/`plantSapling`) can only ever hold
 * steady or decline, never "gain" further -- there is nowhere left to
 * gain TO; the roadmap's own "gains viability" is only observable
 * starting from a plant already below full health, which is exactly what
 * this file's own tests and the P1-17 acceptance test start from.
 * A pure function of its inputs (AGENTS.md Law 8), exactly like
 * `applyThermalExposure`/`applyNeedsTick`.
 */
export function applyVegetationHealthTick(plant: Plant, species: PlantSpeciesProperties, water: WaterField, x: number, z: number): Plant {
  const wetness = currentWetness(water, x, z);
  const siteFitness = 1 - Math.abs(wetness - species.moisturePreference);
  const delta = (siteFitness - plant.health) * VEGETATION_HEALTH_DRIFT_RATE;
  return { ...plant, health: clamp01(plant.health + delta) };
}

/** One simulated tick of growth -- `Plant.ageTicks` advances by exactly one tick, the same quantity `PlantSpecies.ts`'s own `growthFraction`/`trunkVolumeM3` already derive size from (P0-10). A pure function, matching every other per-tick primitive in this codebase. */
export function applyPlantGrowthTick(plant: Plant): Plant {
  return { ...plant, ageTicks: plant.ageTicks + 1 };
}

/**
 * P1-17's regrowth primitive: creates a real, brand-new `"tree"` entity
 * (age `0`, full health) at `at` -- the actual mechanism a future system
 * (deciding WHEN a felled stump or a dead plant should regrow) would call,
 * not itself that system (Law 10). Throws if `at` has no real ground.
 */
export function plantSapling(world: World, speciesId: string, at: ColumnCoordinate): EntityId {
  const floor = world.grid.surfaceY(at.x, at.z);
  if (floor === undefined) {
    throw new RangeError(`site (${at.x}, ${at.z}) has no ground -- cannot plant a sapling there`);
  }
  const id = world.entities.create("tree");
  world.grid.setEntityPosition(id, at.x, floor + 1, at.z);
  setPlant(world.components, id, { speciesId, ageTicks: 0, health: 1 });
  return id;
}

/** Real, tunable minimum standing-water depth for a column to count as fish/wetland-animal habitat -- deep enough to distinguish genuine open water from a shallow, temporary puddle. */
export const FISH_HABITAT_MIN_DEPTH = 1;

/** Whether column `(x, z)` currently has enough real standing water (`WaterField.depthAt`) to support fish/wetland animal presence -- derived fresh from live hydrology every call, never a separately-tracked flag that could drift out of sync with the water actually there. */
export function isFishHabitat(water: WaterField, x: number, z: number): boolean {
  return water.depthAt(x, z) >= FISH_HABITAT_MIN_DEPTH;
}

/**
 * Places a real, physical `"fish"` entity (Law 1.6) at a genuinely
 * suitable wet column -- "simple presence," deliberately with no behavior/
 * movement/AI component attached (the roadmap's own word is "presence,"
 * not "simulation"; a future task can layer real fish behavior on top of
 * this same entity kind without this function needing to change). Throws
 * if the column isn't real fish habitat right now.
 */
export function spawnFish(world: World, water: WaterField, at: ColumnCoordinate): EntityId {
  if (!isFishHabitat(water, at.x, at.z)) {
    throw new RangeError(`column (${at.x}, ${at.z}) is not deep enough water to be fish habitat -- cannot place a fish there`);
  }
  const floor = world.grid.surfaceY(at.x, at.z);
  if (floor === undefined) {
    // Not actually reachable in practice (real standing water always sits
    // on real generated ground -- `WaterField.setDepth` is only ever
    // called against a column `applyHeightfield`/watershed generation has
    // already filled), but not something to assert away with `!`: fail
    // honestly rather than trust an invariant this function can't itself
    // enforce.
    throw new RangeError(`column (${at.x}, ${at.z}) has no ground -- cannot place a fish there`);
  }
  const id = world.entities.create("fish");
  world.grid.setEntityPosition(id, at.x, floor + 1, at.z);
  return id;
}
