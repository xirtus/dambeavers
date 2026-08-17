import type { EntityId } from "../core/EntityId.js";
import type { RecordedEvent } from "../history/EventLog.js";
import type { World } from "../persistence/WorldSnapshot.js";
import { getNeeds } from "./Needs.js";
import { assertSocialStateNotFromFuture, getSocialState } from "./SocialInteraction.js";
import { getWorldTraits, BASELINE_TRAITS, type Traits } from "./Traits.js";
import { relationshipWith, type KinRelation } from "./Relationships.js";
import { MOURNED_EVENT_TYPE } from "./Mourning.js";

/**
 * P2-14's mood: a READ-ONLY derivation over already-authoritative state
 * (P1-06 needs, P2-13 social state, the P0-08 event log, and P2-14's own
 * persistent `Traits`), never a parallel emotion grid of its own -- there
 * is no `MoodComponent`, nothing to register in `ALL_COMPONENT_TYPES` for
 * this file, and nothing that can desync from the facts it's computed
 * from. Recomputed fresh on every call (the same discipline
 * `Sanitation.ts`'s derived-not-stored precedent already established), so
 * P2-15's grief work can consume this as a real, inspectable, live signal
 * rather than a special-cased parallel mechanism.
 *
 * The entire "same event, different reaction" acceptance test lives in
 * this one shared formula: every term below is fed by `traits`, which
 * differs per beaver, but the FORMULA itself never branches on which
 * beaver it is. No per-event random roll and no authored per-beaver
 * script anywhere in this file.
 */

/** [-1, 1] output range for every contribution and the final mood -- 0 neutral, matching `RelationshipEdge.affinity`'s own signed-range precedent. Normalizes `-0` to `0` so a fully-neutral (e.g. 0-sociability) contribution compares and serializes as the same value every other neutral contribution does. */
function clampSigned(value: number): number {
  const clamped = Math.min(1, Math.max(-1, value));
  return Object.is(clamped, -0) ? 0 : clamped;
}

/** How much a beaver's own `resilience` can flatten a contribution's magnitude -- at `resilience === 1` a contribution is still felt at 40% strength, never fully numbed. Plausible, tunable balance data. */
const RESILIENCE_DAMPING = 0.6;

function resilienceMultiplier(resilience: number): number {
  return 1 - RESILIENCE_DAMPING * resilience;
}

/**
 * How far a beaver's current needs sit from perfectly satisfied --
 * `(1 - hunger) + (1 - thirst) + (1 - fatigue) + thermalComfort`, averaged
 * and re-centered so "everything satisfied" is +1 and "everything maxed
 * out" is -1, then damped by `resilience`. `undefined` `Needs` (a non-
 * beaver entity, or one this system never applies to) contributes 0 rather
 * than throwing -- mood is meant to be safely computable for any live
 * beaver, not a hard requirement every caller must first satisfy.
 */
function needsContribution(world: World, beaverId: EntityId, resilience: number): number {
  const needs = getNeeds(world.components, beaverId);
  if (needs === undefined) return 0;
  const satisfaction = (1 - needs.hunger) + (1 - needs.thirst) + (1 - needs.fatigue) + needs.thermalComfort;
  const raw = (satisfaction / 4 - 0.5) * 2;
  return clampSigned(raw * resilienceMultiplier(resilience));
}

/**
 * How lonely vs. recently connected a beaver currently is
 * (`SocialState.socialNeed`, P2-13), scaled by `sociability` -- a highly
 * social beaver's mood moves much more with this than a loner's does.
 * `undefined` `SocialState` (no social scheduling ever applied to this
 * beaver) contributes 0, same reasoning as `needsContribution`.
 */
function socialContribution(world: World, beaverId: EntityId, sociability: number): number {
  const social = getSocialState(world.components, beaverId);
  if (social === undefined) return 0;
  // Same read-boundary discipline `getWorldTraits` already applies to
  // `Traits` -- a corrupted-but-JSON-legal restored `lastInteractionTick`
  // from the future must be rejected here too, not just inside
  // `SocialInteraction.ts`'s own callers.
  assertSocialStateNotFromFuture(world, social);
  const raw = (0.5 - social.socialNeed) * 2;
  return clampSigned(raw * sociability);
}

/**
 * Only events within this many ticks of `world.clock.tick` still move
 * mood -- an old event's emotional charge fades, matching every other
 * "recent"-qualified window in this codebase being real, bounded, tunable
 * balance data rather than an unbounded lifetime sum.
 */
export const MOOD_RECENT_EVENT_WINDOW_TICKS = 500;

/**
 * Known event types' base emotional charge for a beaver who is a
 * subject/object of them (`EventLog.eventsInvolving`, P0-12), `[-1, 1]`.
 * Deliberately a small, open table keyed by the SAME `eventType` strings
 * every event-recording system already uses (`EventLog.ts`'s own "open,
 * kebab-case string, not a fixed enum" precedent) -- a future event type
 * with real per-beaver emotional relevance is a one-line addition here,
 * not a new mechanism. Event types with no entry here (most of them --
 * e.g. `"tree-felled"`, `"log-hauled"`) simply contribute nothing; this is
 * not meant to be an exhaustive emotional model of every event in the
 * game.
 */
const EVENT_MOOD_VALENCE: Readonly<Record<string, number>> = Object.freeze({
  "social-interaction": 0.6,
});

/**
 * P2-15's relationship-sensitive grief: the base valence for the ONE
 * currently relationship-sensitive event type (`Mourning.ts`'s
 * `"beaver-mourned"`) isn't a flat table lookup like every other event
 * type above -- it's derived from the REACTING beaver's own
 * `RelationshipEdge` toward the specific deceased beaver named in the
 * event's `objectIds[0]`. `Mourning.ts` only ever records this event with
 * subjectIds limited to beavers who already hold a real edge toward the
 * deceased (see its own doc comment), so `edge` here is never `undefined`
 * in practice for a correctly-authored event -- but a hand-corrupted
 * snapshot could still name a subject with no such edge, so this stays a
 * real `undefined` check, not a non-null assertion.
 */
const GRIEF_BASE_VALENCE = -1;
const GRIEF_KIN_BONUS: Readonly<Record<KinRelation, number>> = Object.freeze({
  unrelated: 0,
  sibling: 0.3,
  parent: 0.5,
  child: 0.5,
  mate: 0.6,
});

function griefValence(world: World, beaverId: EntityId, event: RecordedEvent): number | undefined {
  const deceasedId = event.objectIds[0];
  if (deceasedId === undefined) return undefined;
  const edge = relationshipWith(world.components, beaverId, deceasedId);
  if (edge === undefined) return undefined;
  const strength = Math.min(1, edge.familiarity + GRIEF_KIN_BONUS[edge.kin]);
  return GRIEF_BASE_VALENCE * strength;
}

/** The base `[-1, 1]` emotional charge `event` carries for `beaverId` specifically, or `undefined` if this event type carries none. Almost always the flat `EVENT_MOOD_VALENCE` table; `"beaver-mourned"` is the one relationship-sensitive exception (`griefValence`, above). */
function eventValence(world: World, beaverId: EntityId, event: RecordedEvent): number | undefined {
  if (event.eventType === MOURNED_EVENT_TYPE) return griefValence(world, beaverId, event);
  return EVENT_MOOD_VALENCE[event.eventType];
}

/**
 * Sums the (recent, known, damped) emotional charge of every event this
 * beaver was a subject/object of -- INCLUDING events where OTHER beavers
 * were also involved. This is the literal mechanism behind "two beavers
 * exposed to the SAME event can react differently": both participants of
 * one recorded `"social-interaction"` (same `EventId`, same base valence)
 * each read their OWN `sociability`/`resilience` here, so the same shared
 * event produces two different numbers -- never a random roll per beaver,
 * never a branch on beaver identity. `"beaver-mourned"` extends this the
 * same way: one shared death event, but each mourner's own relationship
 * strength toward the deceased (via `eventValence`) AND own traits shape
 * the reaction, so a grieving mate and a distant acquaintance feel two
 * genuinely different things from the same recorded event.
 */
function eventContribution(world: World, beaverId: EntityId, traits: Traits): number {
  let total = 0;
  for (const event of world.events.eventsInvolving(beaverId)) {
    // NOT dead defensive code: `EventLog.record`/`fromSnapshot` (P0-08)
    // validate `tick` is a non-negative integer and, when linked, that a
    // cause precedes its effect -- neither ever compares against
    // `world.clock.tick`. Without this check, a corrupted-but-JSON-legal
    // restored snapshot with an event tick ahead of the restored clock
    // would make `world.clock.tick - event.tick` negative, silently
    // defeating the recency window check right below it.
    if (event.tick > world.clock.tick) continue;
    if (world.clock.tick - event.tick > MOOD_RECENT_EVENT_WINDOW_TICKS) continue;
    const valence = eventValence(world, beaverId, event);
    if (valence === undefined) continue;
    total += valence * traits.sociability * resilienceMultiplier(traits.resilience);
  }
  return clampSigned(total);
}

/**
 * Full inspectable computation, not just the final scalar -- this IS
 * P2-14's debug observability function (P0-12's precedent: a plain
 * function call, no debugger needed, non-aliased authoritative data). A
 * beaver with no assigned `Traits` (see `Traits.ts`'s own doc comment)
 * falls back to `BASELINE_TRAITS` so mood stays computable everywhere,
 * though real variation requires real traits.
 */
export interface MoodBreakdown {
  beaverId: EntityId;
  mood: number;
  needsContribution: number;
  socialContribution: number;
  eventContribution: number;
  traits: Traits;
}

function assertLiveBeaver(world: World, beaverId: EntityId): void {
  if (!world.entities.isLive(beaverId) || world.entities.kindOf(beaverId) !== "beaver") {
    throw new RangeError(`mood entity ${beaverId} is not a live beaver`);
  }
}

export function deriveMood(world: World, beaverId: EntityId): MoodBreakdown {
  assertLiveBeaver(world, beaverId);
  const traits = getWorldTraits(world, beaverId) ?? BASELINE_TRAITS;
  const needs = needsContribution(world, beaverId, traits.resilience);
  const social = socialContribution(world, beaverId, traits.sociability);
  const events = eventContribution(world, beaverId, traits);
  return {
    beaverId,
    mood: clampSigned(needs + social + events),
    needsContribution: needs,
    socialContribution: social,
    eventContribution: events,
    traits,
  };
}
