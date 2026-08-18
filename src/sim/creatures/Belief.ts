import { ComponentStore, defineComponent, type ComponentType } from "../core/ComponentStore.js";
import type { EntityId } from "../core/EntityId.js";
import type { EventId } from "../history/EventLog.js";
import type { World } from "../persistence/WorldSnapshot.js";
import type { RandomStream } from "../core/Random.js";

/**
 * P5-08: a real, permanent `"belief"` entity (P0-02 identity, mirroring
 * `Job`/`Designation`'s own "durable non-physical concept gets real
 * identity" precedent) whose `originEventId` names an ACTUAL recorded
 * `EventLog` event -- a myth about a real disaster, birth, or death that
 * really happened in this world, never an authored, disconnected legend.
 * `heldByHouseholdIds` is which households currently hold/pass down this
 * belief; `performRitual` is a real, callable act referencing it (a
 * genuine consequence-free hook today -- Law 10, no roadmap task yet
 * requires ritual to DO anything beyond being a real, recorded act).
 */
export interface Belief {
  originEventId: EventId;
  heldByHouseholdIds: EntityId[];
  formedTick: number;
}
export const BeliefComponent: ComponentType<Belief> = defineComponent<Belief>("belief");

export function assertValidBelief(belief: Belief): void {
  if (!Number.isInteger(belief.originEventId) || belief.originEventId < 1) {
    throw new RangeError(`belief originEventId must be a positive integer, got ${belief.originEventId}`);
  }
  if (!Array.isArray(belief.heldByHouseholdIds)) throw new RangeError("belief heldByHouseholdIds must be an array");
  for (const householdId of belief.heldByHouseholdIds) {
    if (!Number.isInteger(householdId) || householdId < 1) {
      throw new RangeError(`belief heldByHouseholdIds entries must be positive integers, got ${JSON.stringify(householdId)}`);
    }
  }
  if (!Number.isInteger(belief.formedTick) || belief.formedTick < 0) {
    throw new RangeError(`belief formedTick must be a non-negative integer, got ${belief.formedTick}`);
  }
}

export function setBelief(components: ComponentStore, beliefId: EntityId, belief: Belief): void {
  assertValidBelief(belief);
  components.set(beliefId, BeliefComponent, belief);
}

export function getBelief(components: ComponentStore, beliefId: EntityId): Belief | undefined {
  const belief = components.get(beliefId, BeliefComponent);
  if (belief !== undefined) assertValidBelief(belief);
  return belief;
}

/** Forms a new belief referencing a real, already-recorded event -- throws if the event id isn't real. `householdId` is the founding household that first holds it. */
export function formBelief(world: World, originEventId: EventId, householdId: EntityId): EntityId {
  if (!world.events.has(originEventId)) {
    throw new RangeError(`event ${originEventId} does not exist -- cannot found a belief on it`);
  }
  const beliefId = world.entities.create("belief");
  setBelief(world.components, beliefId, { originEventId, heldByHouseholdIds: [householdId], formedTick: world.clock.tick });
  return beliefId;
}

/** A real household adopts an existing belief -- households pass beliefs to one another/its members hold beliefs formed elsewhere, without re-founding it on the same origin event. Idempotent. */
export function adoptBelief(world: World, beliefId: EntityId, householdId: EntityId): void {
  const belief = getBelief(world.components, beliefId);
  if (belief === undefined) throw new RangeError(`entity ${beliefId} has no Belief component`);
  if (belief.heldByHouseholdIds.includes(householdId)) return;
  setBelief(world.components, beliefId, { ...belief, heldByHouseholdIds: [...belief.heldByHouseholdIds, householdId] });
}

/** Performs a real ritual referencing `beliefId` -- records a genuine `"ritual-performed"` event naming the participants and the belief, causally linked back to the belief's own origin event. */
export function performRitual(world: World, beliefId: EntityId, participantIds: readonly EntityId[]): EventId {
  const belief = getBelief(world.components, beliefId);
  if (belief === undefined) throw new RangeError(`entity ${beliefId} has no Belief component`);
  const location = world.grid.positionOf(participantIds[0]!) ?? { x: 0, y: 0, z: 0 };
  return world.events.record({
    tick: world.clock.tick,
    eventType: "ritual-performed",
    subjectIds: [...participantIds],
    objectIds: [beliefId],
    location,
    causeEventId: belief.originEventId,
  });
}

/** Every belief `householdId` currently holds -- discovered fresh, never cached. */
export function beliefsOf(world: World, householdId: EntityId): EntityId[] {
  return world.entities
    .liveIdsOfKind("belief")
    .filter((id) => getBelief(world.components, id)?.heldByHouseholdIds.includes(householdId) ?? false);
}

/** Chance a household drops one held belief at a generational turnover -- narratives fade when nobody retells them (P11-08's "narratives drift" clause). Plausible, tunable balance data. */
export const BELIEF_DROP_CHANCE = 0.15;

/**
 * P11-08: one generational turnover of narrative holdings -- each held
 * belief has a real chance of being dropped (no longer passed down).
 * Combined with `driftNormProfile`'s value drift and P11-07's rumor
 * distortion, a population's culture (norms AND narratives) genuinely
 * evolves across generations rather than being a frozen founding fact.
 */
export function driftBeliefHoldings(world: World, householdId: EntityId, random: RandomStream): void {
  for (const beliefId of beliefsOf(world, householdId)) {
    if (!random.nextBool(BELIEF_DROP_CHANCE)) continue;
    const belief = getBelief(world.components, beliefId)!;
    setBelief(world.components, beliefId, {
      ...belief,
      heldByHouseholdIds: belief.heldByHouseholdIds.filter((id) => id !== householdId),
    });
  }
}

