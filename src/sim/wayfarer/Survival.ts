import type { EntityId } from "../core/EntityId.js";
import type { World } from "../persistence/WorldSnapshot.js";
import type { ColonyLoopDeps } from "../runtime/ColonyLoop.js";
import { getNeeds, setNeeds, applyNeedsTick } from "../creatures/Needs.js";
import { applyThermalTick } from "../creatures/BeaverNeeds.js";
import { getHealth } from "../creatures/Beaver.js";
import { getBreath } from "../creatures/Respiration.js";
import { tickCreatureWounds, getWounds } from "../creatures/Anatomy.js";
import { getStress } from "../creatures/Stress.js";

/**
 * P9-05: the survival adventure loop -- food, sleep, weather, injury,
 * water, and danger remain the SAME mechanics as colony mode, because
 * the controlled character is an ordinary beaver ticking through the
 * SAME functions. This module owns nothing new; it composes the
 * identical primitives the colony loop already uses (`applyNeedsTick`,
 * `applyThermalTick`, `tickMortality`, `tickCreatureWounds` -- the same
 * per-creature body extracted from the world-wide wound tick) and
 * provides a derived survival report for the player. The acceptance
 * tests prove the parity directly: hunger/thirst decay at the identical
 * rate, drowning uses the identical two-stage breath/health machinery,
 * wounds bleed/heal identically, weather exposure is the same thermal
 * function, and predators/raids attack the controlled beaver through
 * the ordinary world systems, never a special "player" path.
 */

export interface WayfarerSurvivalReport {
  hunger: number;
  thirst: number;
  fatigue: number;
  thermalComfort: number;
  health: number;
  breath: number;
  woundCount: number;
  totalBleedingRate: number;
  stress: number;
  drowningRisk: boolean;
}

/** A derived, real-time survival report for the player character -- every field is live component state. */
export function wayfarerSurvivalReport(world: World, beaverId: EntityId): WayfarerSurvivalReport {
  const needs = getNeeds(world.components, beaverId) ?? { hunger: 0, thirst: 0, fatigue: 0, thermalComfort: 1 };
  const health = getHealth(world.components, beaverId)?.fraction ?? 1;
  const breath = getBreath(world.components, beaverId)?.fraction ?? 1;
  const wounds = getWounds(world.components, beaverId);
  const stress = getStress(world.components, beaverId)?.level ?? 0;
  const position = world.grid.positionOf(beaverId);
  let drowningRisk = false;
  if (position !== undefined) {
    drowningRisk = world.water.depthAt(position.x, position.z) > 0 && breath <= 0;
  }
  return {
    hunger: needs.hunger,
    thirst: needs.thirst,
    fatigue: needs.fatigue,
    thermalComfort: needs.thermalComfort,
    health,
    breath,
    woundCount: wounds?.entries.length ?? 0,
    totalBleedingRate: wounds?.entries.reduce((sum, wound) => sum + wound.bleedingRate, 0) ?? 0,
    stress,
    drowningRisk,
  };
}

/**
 * One tick of the controlled character's own survival body -- the SAME
 * primitives the colony loop runs for every other beaver: needs decay
 * with activity, thermal exposure from the real medium, and the
 * identical wound physiology. Mortality is DELIBERATELY NOT here: it is
 * the colony loop's own post-beaver pass (P9-01's contract -- every
 * body system ticks the controlled beaver through the loop, unchanged),
 * and including it here would double-tick the body whenever a caller
 * composes both. Callers compose the loop's post-beaver passes (social,
 * aging, animals, weather, mortality) exactly as they always do.
 */
export function tickWayfarerSurvival(deps: ColonyLoopDeps, world: World, beaverId: EntityId, wasActive: boolean): void {
  const needs = getNeeds(world.components, beaverId);
  if (needs !== undefined) {
    setNeeds(world.components, beaverId, applyNeedsTick(needs, wasActive));
  }
  const position = world.grid.positionOf(beaverId);
  if (position !== undefined) {
    applyThermalTick(deps.water, deps.materials, deps.components, beaverId, { x: position.x, z: position.z });
  }
  tickCreatureWounds(world, beaverId);
}
