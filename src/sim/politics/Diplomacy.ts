import { ComponentStore, defineComponent, type ComponentType } from "../core/ComponentStore.js";
import type { EntityId } from "../core/EntityId.js";
import type { World } from "../persistence/WorldSnapshot.js";
import type { EventId, RecordedEvent } from "../history/EventLog.js";

/**
 * P7-06: group relations change from ACTUAL interactions -- the standing
 * between two settlements is a real, DERIVED query over the events they
 * have actually shared (harms: raids/battles with casualties, territorial
 * grabs; aid: delivered trade, gifts; interests: overlapping claims),
 * never a stored score that could drift from what really happened. The
 * same "derive from live state, never cache" discipline
 * `Reputation.ts` (P5-13) already established for individuals, applied
 * to settlements.
 *
 * Treaties are real, persistent `"treaty"` entities (data: parties,
 * kind, status) signed/broken through real recorded events -- a standing
 * change must come from a real treaty event or a real interaction event,
 * never from a "set standing" call.
 */

/** Real weight per shared event type -- which recorded interactions between two settlements count as harms, which as aid, and how much. */
export const DIPLOMATIC_EVENT_WEIGHT: Readonly<Record<string, number>> = Object.freeze({
  "trade-goods-delivered": 0.05,
  "treaty-signed": 0.3,
  "raid-arrived": -0.35,
  "raid-looted": -0.3,
  "battle-began": -0.2,
  "battle-ended": -0.15,
  "territory-claimed": -0.1,
  "war-declared": -0.5,
  "war-ended": -0.1,
  "treaty-broken": -0.4,
  "civilization-founded": 0.2,
});

export type TreatyKind = "peace" | "alliance" | "tribute";

export interface Treaty {
  partyIds: readonly EntityId[];
  kind: TreatyKind;
  status: "active" | "broken";
  signedEventId: EventId;
  brokenEventId?: EventId;
}
export const TreatyComponent: ComponentType<Treaty> = defineComponent<Treaty>("treaty");

const TREATY_KINDS: readonly TreatyKind[] = ["peace", "alliance", "tribute"];

export function assertValidTreaty(treaty: Treaty): void {
  if (treaty.partyIds.length < 2) throw new RangeError(`treaty must name at least two parties, got ${treaty.partyIds.length}`);
  if (new Set(treaty.partyIds).size !== treaty.partyIds.length) throw new RangeError(`treaty partyIds must be unique, got ${JSON.stringify(treaty.partyIds)}`);
  for (const partyId of treaty.partyIds) {
    if (!Number.isInteger(partyId) || partyId < 1) throw new RangeError(`treaty party id must be a positive integer, got ${partyId}`);
  }
  if (!TREATY_KINDS.includes(treaty.kind)) throw new RangeError(`treaty kind must be one of ${TREATY_KINDS.join(", ")}, got ${JSON.stringify(treaty.kind)}`);
  if (treaty.status !== "active" && treaty.status !== "broken") throw new RangeError(`treaty status must be "active" or "broken", got ${JSON.stringify(treaty.status)}`);
  if (!Number.isInteger(treaty.signedEventId) || treaty.signedEventId < 1) {
    throw new RangeError(`treaty signedEventId must be a positive integer, got ${treaty.signedEventId}`);
  }
  if (treaty.status === "broken" && (treaty.brokenEventId === undefined || !Number.isInteger(treaty.brokenEventId) || treaty.brokenEventId < 1)) {
    throw new RangeError(`a broken treaty must carry a positive brokenEventId, got ${treaty.brokenEventId}`);
  }
  if (treaty.status === "active" && treaty.brokenEventId !== undefined) {
    throw new RangeError(`an active treaty must not carry a brokenEventId, got ${treaty.brokenEventId}`);
  }
}

export function setTreaty(components: ComponentStore, treatyId: EntityId, treaty: Treaty): void {
  assertValidTreaty(treaty);
  const normalized: Treaty = {
    partyIds: [...treaty.partyIds],
    kind: treaty.kind,
    status: treaty.status,
    signedEventId: treaty.signedEventId,
  };
  if (treaty.brokenEventId !== undefined) normalized.brokenEventId = treaty.brokenEventId;
  components.set(treatyId, TreatyComponent, normalized);
}

export function getTreaty(components: ComponentStore, treatyId: EntityId): Treaty | undefined {
  const treaty = components.get(treatyId, TreatyComponent);
  if (treaty !== undefined) assertValidTreaty(treaty);
  return treaty;
}

/** Whether a recorded event names BOTH settlements among its subjects/objects -- the real "these two groups actually interacted" test. */
function eventInvolvesBoth(event: RecordedEvent, siteAId: EntityId, siteBId: EntityId): boolean {
  const involved = new Set([...event.subjectIds, ...event.objectIds]);
  return involved.has(siteAId) && involved.has(siteBId);
}

/**
 * The real diplomatic standing between two settlements in `[-1, 1]`:
 * the weighted sum of every recorded event they have actually shared,
 * plus the active-treaty bonus, clamped. Unshared history contributes
 * nothing -- relations ARE the history (the literal acceptance clause
 * "change from actual interactions"). Recompute fresh every call.
 */
export function diplomaticStanding(world: World, siteAId: EntityId, siteBId: EntityId): number {
  let score = 0;
  const seen = new Set<number>();
  for (const eventType of Object.keys(DIPLOMATIC_EVENT_WEIGHT)) {
    for (const event of world.events.eventsOfType(eventType)) {
      if (eventInvolvesBoth(event, siteAId, siteBId) && !seen.has(event.id)) {
        seen.add(event.id);
        score += DIPLOMATIC_EVENT_WEIGHT[eventType]!;
      }
    }
  }
  for (const treatyId of world.components.query(TreatyComponent)) {
    const treaty = getTreaty(world.components, treatyId);
    if (treaty === undefined || treaty.status !== "active") continue;
    if (treaty.partyIds.includes(siteAId) && treaty.partyIds.includes(siteBId)) {
      score += treaty.kind === "alliance" ? 0.4 : treaty.kind === "peace" ? 0.2 : 0.1;
    }
  }
  return Math.min(1, Math.max(-1, score));
}

/**
 * Signs a real treaty between `partyIds` -- a persistent entity plus a
 * real `"treaty-signed"` event chained to `causeEventId` (the
 * negotiation's own history: the war it ended, the aid that motivated
 * it, ...). Returns the treaty entity id.
 */
export function signTreaty(world: World, partyIds: readonly EntityId[], kind: TreatyKind, causeEventId?: EventId): EntityId {
  const treatyId = world.entities.create("treaty");
  const signedEventId = world.events.record({
    tick: world.clock.tick,
    eventType: "treaty-signed",
    subjectIds: [...partyIds],
    objectIds: [treatyId],
    location: { x: 0, y: 0, z: 0 },
    ...(causeEventId !== undefined ? { causeEventId } : {}),
  });
  setTreaty(world.components, treatyId, { partyIds: [...partyIds], kind, status: "active", signedEventId });
  return treatyId;
}

/**
 * Breaks an active treaty through a real `"treaty-broken"` event chained
 * to `causeEventId` (the raid, battle, or declaration that broke it).
 * The treaty entity persists with status `"broken"` -- real history,
 * not a deleted record.
 */
export function breakTreaty(world: World, treatyId: EntityId, causeEventId: EventId): void {
  const treaty = getTreaty(world.components, treatyId);
  if (treaty === undefined) throw new RangeError(`unknown treaty ${treatyId}`);
  if (treaty.status === "broken") return;
  const brokenEventId = world.events.record({
    tick: world.clock.tick,
    eventType: "treaty-broken",
    subjectIds: [...treaty.partyIds],
    objectIds: [treatyId],
    location: { x: 0, y: 0, z: 0 },
    causeEventId,
  });
  setTreaty(world.components, treatyId, { ...treaty, status: "broken", brokenEventId });
}

/** Every ACTIVE treaty naming `siteId` as a party, sorted by id. */
export function activeTreatiesOf(world: World, siteId: EntityId): EntityId[] {
  const treaties: EntityId[] = [];
  for (const treatyId of world.components.query(TreatyComponent)) {
    const treaty = getTreaty(world.components, treatyId);
    if (treaty !== undefined && treaty.status === "active" && treaty.partyIds.includes(siteId)) treaties.push(treatyId);
  }
  return treaties.sort((a, b) => a - b);
}

/** The strongest real relationship label between two settlements, derived from standing + treaties (data for decision systems, never a decision itself). */
export function relationKind(world: World, siteAId: EntityId, siteBId: EntityId): "allied" | "peaceful" | "neutral" | "hostile" | "at-war" {
  const standing = diplomaticStanding(world, siteAId, siteBId);
  for (const treatyId of activeTreatiesOf(world, siteAId)) {
    const treaty = getTreaty(world.components, treatyId);
    if (treaty !== undefined && treaty.partyIds.includes(siteBId) && treaty.kind === "alliance") return "allied";
  }
  if (standing >= 0.4) return "peaceful";
  if (standing <= -0.4) return "hostile";
  return "neutral";
}
