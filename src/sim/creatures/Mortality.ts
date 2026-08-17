import { ComponentStore, defineComponent, type ComponentType } from "../core/ComponentStore.js";
import type { EntityId } from "../core/EntityId.js";
import type { EventId } from "../history/EventLog.js";
import type { WaterField } from "../hydrology/WaterField.js";
import type { World } from "../persistence/WorldSnapshot.js";
import { getHealth, setHealth, assertValidHealth, getInventory, type Health } from "./Beaver.js";
import { getNeeds } from "./Needs.js";
import { getBreath, setBreath, applyBreathTick, canBreatheAt } from "./Respiration.js";
import { clamp01 } from "./Needs.js";
import { drop } from "../labor/Log.js";
import { designateBurial, generateBurialJob } from "../labor/Burial.js";
import { notifyDeathForMourning } from "./Mourning.js";

/**
 * P1-16: the four "initial causes" the roadmap names, each a real,
 * continuously-derived condition (drowning/starvation/exposure) or a
 * discrete real event (trauma) -- never a scripted "if X then kill"
 * shortcut. `tickMortality` (below) is the ONLY code path that ever
 * calls `die`, and it only does so once real `Health` damage, itself
 * driven by real state (`Breath`/`Needs`), has actually brought
 * `Health.fraction` to `0` -- satisfying the roadmap's own literal
 * acceptance test ("no `DrowningEvent` is allowed to directly kill it")
 * for every cause, not just drowning.
 */
export type CauseOfDeath = "drowning" | "starvation" | "exposure" | "trauma" | "disease";

/** Real per-tick health loss once a beaver has been fully out of breath while unable to surface -- drowning is a TWO-STAGE process (breath depletes first, `Respiration.ts`; only once that's exhausted does real bodily harm begin), matching real physiology, not an instant kill the moment breath hits 0. Plausible, tunable balance data. */
export const DROWNING_DAMAGE_PER_TICK = 0.15;
/** Real per-tick health loss while `Needs.hunger` sits at its own ceiling (1, fully critical) -- starvation is slow compared to drowning, matching real physiology (a beaver survives far longer without food than without air). Plausible, tunable balance data. */
export const STARVATION_DAMAGE_PER_TICK = 0.02;
/** Real per-tick health loss while `Needs.thermalComfort` (P1-15) sits at or below this critical floor -- severe, sustained cold genuinely harms a beaver, not just its comfort. Plausible, tunable balance data. */
export const EXPOSURE_CRITICAL_THERMAL_COMFORT = 0.1;
export const EXPOSURE_DAMAGE_PER_TICK = 0.02;
/** Default one-shot health loss from a direct trauma event (`applyTrauma`) -- a real, callable mechanism for "simple trauma" (the roadmap's own fourth cause); no current system in this game yet triggers one (no combat/falling-damage/predator system exists -- AGENTS.md Law 10), but the mechanism itself is real and tested, not a stub. Plausible, tunable balance data. */
export const TRAUMA_DEFAULT_DAMAGE = 0.3;

export function applyHealthDamage(health: Health, amount: number): Health {
  assertValidHealth(health);
  return { fraction: clamp01(health.fraction - amount) };
}

/**
 * A beaver's remains -- real, physical, and left exactly where it died
 * (Law 1.6: death doesn't make the body vanish). `causeOfDeath` and
 * `deathEventId` (pointing into `World.events`, P0-08) make the corpse
 * itself a real, inspectable trace of what happened, not just a bare
 * marker. Deliberately minimal: no decay/scavenging behavior -- that
 * belongs to whichever future ecology task actually needs it (Law 10).
 * `deceasedBeaverId` (P2-15) names which beaver this corpse WAS, directly
 * -- resolvable via `EntityIdRegistry.isKnown` long after the beaver
 * itself is destroyed, the same "historical reference outlives liveness"
 * precedent `EventLog` already establishes -- so P2-15's `Burial.ts` and
 * mourning notifications never have to indirect through `deathEventId`
 * just to learn who died.
 */
export interface Corpse {
  causeOfDeath: CauseOfDeath;
  diedAtTick: number;
  deathEventId: EventId;
  deceasedBeaverId: EntityId;
}
export const CorpseComponent: ComponentType<Corpse> = defineComponent<Corpse>("corpse");

export function assertValidCorpse(corpse: Corpse): void {
  const validCauses = ["drowning", "starvation", "exposure", "trauma", "disease"];
  if (!validCauses.includes(corpse.causeOfDeath)) {
    throw new RangeError(`corpse causeOfDeath must be one of ${validCauses.join(", ")}, got ${JSON.stringify(corpse.causeOfDeath)}`);
  }
  if (!Number.isInteger(corpse.diedAtTick) || corpse.diedAtTick < 0) {
    throw new RangeError(`corpse diedAtTick must be a non-negative integer, got ${corpse.diedAtTick}`);
  }
  if (!Number.isInteger(corpse.deathEventId) || corpse.deathEventId < 1) {
    throw new RangeError(`corpse deathEventId must be a positive integer, got ${corpse.deathEventId}`);
  }
  if (!Number.isInteger(corpse.deceasedBeaverId) || corpse.deceasedBeaverId < 1) {
    throw new RangeError(`corpse deceasedBeaverId must be a positive integer, got ${corpse.deceasedBeaverId}`);
  }
}

export function setCorpse(components: ComponentStore, id: EntityId, corpse: Corpse): void {
  assertValidCorpse(corpse);
  components.set(id, CorpseComponent, corpse);
}

export function getCorpse(components: ComponentStore, id: EntityId): Corpse | undefined {
  const corpse = components.get(id, CorpseComponent);
  if (corpse !== undefined) assertValidCorpse(corpse);
  return corpse;
}

/**
 * Kills `beaverId`: records a real historical event (P0-08's `EventLog`
 * -- a DESCRIPTION of what already happened, e.g. `"drowning-death"`,
 * never itself the trigger; `tickMortality`/`applyTrauma` below are the
 * only callers, and both only call this AFTER `Health.fraction` has
 * already reached `0` through real, systemic damage), leaves a real
 * physical `"corpse"` entity at the beaver's last position (Law 1.6 --
 * the body doesn't vanish), drops any items it was physically carrying at
 * that same spot (see below), and destroys the beaver entity. The
 * recorded event is the roadmap's own "relationship consequence hook": a
 * real, queryable fact (`subjectIds: [beaverId]`) a future relationships
 * system (P1-19) can react to without this task inventing that system now
 * (Law 10) -- no separate hook mechanism is needed since `EventLog`
 * already IS the project's general "something happened that other
 * systems can react to" mechanism (P0-08).
 *
 * Held items are dropped BEFORE the beaver is destroyed, reusing
 * `Log.ts`'s own generic `drop` -- this is the fix P1-09's own
 * `Hauling.ts` doc comment named by number as needing a real death system
 * to resolve ("the honest answer until a real death/inventory system,
 * most naturally P1-16... exists to decide what happens to a dead
 * beaver's held items"): `entities.destroy()` fires `ComponentStore`'s
 * own `onDestroy`-triggered cleanup SYNCHRONOUSLY, registered at
 * world-construction time, long before any labor-type module could hook
 * in -- so a held item's `Held`/`Inventory` linkage would already be
 * unrecoverable by the time anything reacted to the beaver's destruction.
 * Calling `drop` HERE, before `destroy`, is what avoids that: `Inventory`
 * is still genuinely intact at this point, so each held item gets a real
 * `WorldGrid` position back and its `Held` component cleared, exactly as
 * if the beaver had set it down deliberately -- never left floating in a
 * position-less, held-by-nothing-live limbo (Law 1.6).
 *
 * P2-15 exercises exactly the "relationship consequence hook" named
 * above: `notifyDeathForMourning` (`Mourning.ts`) and
 * `designateBurial`/`generateBurialJob` (`Burial.ts`) are real,
 * synchronous, automatic byproducts of this one moment -- death itself
 * creating body-handling work and relationship-sensitive social
 * consequences, the roadmap's own literal P2-15 wording -- not a second
 * "reaction" pass some future scheduler has to remember to run.
 */
export function die(world: World, beaverId: EntityId, cause: CauseOfDeath): EntityId {
  if (!world.entities.isLive(beaverId) || world.entities.kindOf(beaverId) !== "beaver") {
    throw new RangeError(`entity ${beaverId} is not a live beaver -- cannot mark it dead`);
  }
  const position = world.grid.positionOf(beaverId);
  if (position === undefined) {
    throw new RangeError(`beaver ${beaverId} has no position -- cannot record where it died`);
  }
  const tick = world.clock.tick;

  const deathEventId = world.events.record({
    tick,
    eventType: `${cause}-death`,
    subjectIds: [beaverId],
    location: position,
  });

  const corpseId = world.entities.create("corpse");
  world.grid.setEntityPosition(corpseId, position.x, position.y, position.z);
  setCorpse(world.components, corpseId, { causeOfDeath: cause, diedAtTick: tick, deathEventId, deceasedBeaverId: beaverId });

  // P2-15: death itself is what CREATES body-handling work and
  // relationship-sensitive social consequences -- both real, automatic,
  // synchronous byproducts of this one real event, not something a
  // player has to notice and manually request. `notifyDeathForMourning`
  // records nothing if no living beaver had any relationship with the
  // deceased (a genuine absence of consequence, not a fabricated one).
  notifyDeathForMourning(world, beaverId, position);
  const burialDesignationId = designateBurial(world, corpseId);
  generateBurialJob(world, burialDesignationId, cause, beaverId);

  const inventory = getInventory(world.components, beaverId);
  if (inventory !== undefined) {
    for (const itemId of inventory.itemIds) {
      drop(world.components, world.grid, itemId, { x: position.x, z: position.z });
    }
  }

  world.entities.destroy(beaverId);
  return corpseId;
}

export interface MortalityResult {
  died: boolean;
  cause?: CauseOfDeath;
  corpseId?: EntityId;
}

/** Applies `amount` of health damage unless already dead (health already at 0 -- no further damage to apply, no double-death), reporting whether THIS application is what crossed zero. */
function tryApplyDamage(health: Health, amount: number): { health: Health; crossed: boolean } {
  if (health.fraction <= 0) return { health, crossed: false };
  const next = applyHealthDamage(health, amount);
  return { health: next, crossed: next.fraction <= 0 };
}

/**
 * One simulated tick of mortality for `beaverId`: advances `Breath`
 * (`Respiration.ts`, from the beaver's real live position) and applies
 * real `Health` damage for EVERY condition currently true (drowning,
 * starvation, exposure -- genuine, honest compounding: a beaver that's
 * simultaneously drowning AND starving takes damage from BOTH the same
 * tick, not just whichever is "worse"), checked in priority order
 * (drowning, then starvation, then exposure) ONLY to decide which cause
 * gets CREDITED if `Health.fraction` actually reaches `0` this tick --
 * the first one whose own application crosses zero. Once that happens,
 * no further damage is applied this tick (an already-dead beaver isn't
 * driven further negative by whichever conditions were checked after).
 * Calls `die` exactly once, only if some cause's damage actually brought
 * `Health.fraction` to `0`. Callable once per simulated tick, by a test
 * loop today or a future scheduler once one exists -- like
 * `tickBeaverBehavior`, this is a primitive, not itself the scheduler
 * (composition with needs/job ticking is the caller's job).
 */
export function tickMortality(world: World, water: WaterField, beaverId: EntityId): MortalityResult {
  const health = getHealth(world.components, beaverId);
  const needs = getNeeds(world.components, beaverId);
  const breath = getBreath(world.components, beaverId);
  if (health === undefined || needs === undefined || breath === undefined) {
    throw new RangeError(`entity ${beaverId} is missing Health/Needs/Breath -- cannot tick mortality`);
  }
  const position = world.grid.positionOf(beaverId);
  if (position === undefined) {
    throw new RangeError(`entity ${beaverId} has no position -- cannot tick mortality`);
  }

  const breathable = canBreatheAt(world.grid, water, position.x, position.y, position.z);
  const updatedBreath = applyBreathTick(breath, breathable);
  setBreath(world.components, beaverId, updatedBreath);

  let currentHealth = health;
  let cause: CauseOfDeath | undefined;

  if (!breathable && updatedBreath.fraction <= 0) {
    const result = tryApplyDamage(currentHealth, DROWNING_DAMAGE_PER_TICK);
    currentHealth = result.health;
    if (result.crossed) cause = "drowning";
  }
  if (cause === undefined && needs.hunger >= 1) {
    const result = tryApplyDamage(currentHealth, STARVATION_DAMAGE_PER_TICK);
    currentHealth = result.health;
    if (result.crossed) cause = "starvation";
  }
  if (cause === undefined && needs.thermalComfort <= EXPOSURE_CRITICAL_THERMAL_COMFORT) {
    const result = tryApplyDamage(currentHealth, EXPOSURE_DAMAGE_PER_TICK);
    currentHealth = result.health;
    if (result.crossed) cause = "exposure";
  }

  setHealth(world.components, beaverId, currentHealth);

  if (cause !== undefined) {
    const corpseId = die(world, beaverId, cause);
    return { died: true, cause, corpseId };
  }
  return { died: false };
}

/**
 * "Simple trauma" (the roadmap's fourth cause): a real, directly-callable
 * one-shot damage application, for whatever future system (a predator, a
 * fall, an accident -- none exist yet, Law 10) eventually needs to
 * trigger it. Not part of `tickMortality`'s own per-tick loop since
 * trauma isn't a continuously-true condition to re-check every tick, it's
 * a discrete event.
 */
export function applyTrauma(world: World, beaverId: EntityId, amount: number = TRAUMA_DEFAULT_DAMAGE): MortalityResult {
  const health = getHealth(world.components, beaverId);
  if (health === undefined) {
    throw new RangeError(`entity ${beaverId} has no Health component -- cannot apply trauma`);
  }
  const result = tryApplyDamage(health, amount);
  setHealth(world.components, beaverId, result.health);
  if (result.crossed) {
    const corpseId = die(world, beaverId, "trauma");
    return { died: true, cause: "trauma", corpseId };
  }
  return { died: false };
}
