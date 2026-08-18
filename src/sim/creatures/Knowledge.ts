import { ComponentStore, defineComponent, type ComponentType } from "../core/ComponentStore.js";
import type { EntityId } from "../core/EntityId.js";
import type { EventId } from "../history/EventLog.js";
import type { World } from "../persistence/WorldSnapshot.js";
import { recordMemory } from "./Memory.js";

/**
 * P11-06: knowledge propagation -- WHO knows WHAT and HOW they learned
 * it, as a real per-beaver ledger. Knowledge is distinct from
 * `Memory.ts`'s emotional memory (valence/strength): a KnowledgeEntry
 * names a real `EventId` plus the real acquisition ROUTE -- observation
 * (proximity-gated at the event), conversation (the speaker must
 * themselves know it), records (the chronicle), or evidence (a live
 * physical trace of the event within reach). An unwitnessed event is
 * simply not known by anyone who was not there, until knowledge spreads
 * through one of those real routes -- the roadmap's own acceptance
 * sentence, satisfied structurally rather than by a global-awareness
 * flag.
 */

export type KnowledgeSource = "observation" | "conversation" | "records" | "evidence";

export interface KnowledgeEntry {
  eventId: EventId;
  source: KnowledgeSource;
  acquiredTick: number;
}

export interface Knowledge {
  entries: KnowledgeEntry[];
}
export const KnowledgeComponent: ComponentType<Knowledge> = defineComponent<Knowledge>("knowledge");

const VALID_SOURCES: readonly KnowledgeSource[] = ["observation", "conversation", "records", "evidence"];

export function assertValidKnowledge(knowledge: Knowledge): void {
  if (!Array.isArray(knowledge.entries)) throw new RangeError("knowledge entries must be an array");
  for (const entry of knowledge.entries) {
    if (!Number.isInteger(entry.eventId) || entry.eventId < 1) throw new RangeError(`knowledge eventId must be a positive integer, got ${entry.eventId}`);
    if (!VALID_SOURCES.includes(entry.source)) throw new RangeError(`knowledge source must be one of ${VALID_SOURCES.join("/")}, got ${JSON.stringify(entry.source)}`);
    if (!Number.isInteger(entry.acquiredTick) || entry.acquiredTick < 0) throw new RangeError(`knowledge acquiredTick must be a non-negative integer, got ${entry.acquiredTick}`);
  }
}

export function setKnowledge(components: ComponentStore, beaverId: EntityId, knowledge: Knowledge): void {
  assertValidKnowledge(knowledge);
  components.set(beaverId, KnowledgeComponent, knowledge);
}

export function getKnowledge(components: ComponentStore, beaverId: EntityId): Knowledge | undefined {
  const knowledge = components.get(beaverId, KnowledgeComponent);
  if (knowledge !== undefined) assertValidKnowledge(knowledge);
  return knowledge;
}

/** How close (Chebyshev, columns) a beaver must be to an event's recorded location to have plausibly witnessed it. Plausible, tunable balance data. */
export const WITNESS_RADIUS = 8;

/** Does `beaverId` genuinely know `eventId`? Derived fresh, never cached. */
export function knowsEvent(world: World, beaverId: EntityId, eventId: EventId): boolean {
  return getKnowledge(world.components, beaverId)?.entries.some((entry) => entry.eventId === eventId) ?? false;
}

/** Every beaver who knows `eventId`, with how they learned it -- the "who knows what" query. */
export function knowledgeHolders(world: World, eventId: EventId): Array<{ beaverId: EntityId; source: KnowledgeSource; acquiredTick: number }> {
  const holders: Array<{ beaverId: EntityId; source: KnowledgeSource; acquiredTick: number }> = [];
  for (const beaverId of world.entities.liveIdsOfKind("beaver").sort((a: EntityId, b: EntityId) => a - b)) {
    const entry = getKnowledge(world.components, beaverId)?.entries.find((e) => e.eventId === eventId);
    if (entry !== undefined) holders.push({ beaverId, source: entry.source, acquiredTick: entry.acquiredTick });
  }
  return holders;
}

function chebyshev(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
}

/** Records knowledge with a real route -- idempotent (an already-known event keeps its EARLIEST route; how you first learned it is the honest record). */
function recordKnowledge(world: World, beaverId: EntityId, eventId: EventId, source: KnowledgeSource, valence: number): void {
  if (!world.events.has(eventId)) throw new RangeError(`event ${eventId} does not exist -- knowledge must reference a real event`);
  const existing = getKnowledge(world.components, beaverId) ?? { entries: [] };
  if (existing.entries.some((entry) => entry.eventId === eventId)) return;
  const entries = [...existing.entries, { eventId, source, acquiredTick: world.clock.tick }];
  setKnowledge(world.components, beaverId, { entries });
  // Knowledge and emotional memory stay coherent: learning a fact is
  // itself a mild memory (P5-02's own mechanism, low valence).
  recordMemory(world, beaverId, eventId, valence);
}

/**
 * Learning by OBSERVATION: the beaver must have been within
 * `WITNESS_RADIUS` of the event's recorded location when it happened.
 * The event itself carries its location (P0-08), and the caller passes
 * the beaver's position at that moment -- the gate is the distance
 * between those two real positions, never a global flag.
 */
export function learnByObservation(world: World, beaverId: EntityId, eventId: EventId, beaverPosition: { x: number; z: number }): boolean {
  const event = world.events.get(eventId);
  if (event === undefined) throw new RangeError(`event ${eventId} does not exist`);
  const distance = chebyshev(beaverPosition, { x: event.location.x, z: event.location.z });
  if (distance > WITNESS_RADIUS) return false;
  recordKnowledge(world, beaverId, eventId, "observation", 0.4);
  return true;
}

/**
 * Learning by CONVERSATION: the speaker must genuinely know the event
 * (their own Knowledge ledger), and both must be adjacent (a real
 * conversation happens between two beavers at the same place). The
 * listener gains a knowledge entry with source "conversation".
 */
export function learnByConversation(world: World, speakerId: EntityId, listenerId: EntityId, eventId: EventId): boolean {
  if (!knowsEvent(world, speakerId, eventId)) return false;
  const speakerPosition = world.grid.positionOf(speakerId);
  const listenerPosition = world.grid.positionOf(listenerId);
  if (speakerPosition === undefined || listenerPosition === undefined) return false;
  if (chebyshev(speakerPosition, listenerPosition) > 1) return false;
  recordKnowledge(world, listenerId, eventId, "conversation", 0.25);
  return true;
}

/**
 * Learning from RECORDS: consulting the chronicle (P8's read layer over
 * the same EventLog) is a real route -- any beaver can learn any
 * recorded event this way, but ONLY through this explicit act, never
 * automatically (that is exactly why unwitnessed events are not
 * globally known by default).
 */
export function learnFromRecords(world: World, beaverId: EntityId, eventId: EventId): boolean {
  if (!world.events.has(eventId)) throw new RangeError(`event ${eventId} does not exist`);
  recordKnowledge(world, beaverId, eventId, "records", 0.1);
  return true;
}

/**
 * Learning from EVIDENCE: the event must have left a LIVE physical
 * trace -- one of its objectIds is still a live entity within
 * `WITNESS_RADIUS` of the beaver (a corpse, a dam, an artifact). A
 * beaver who stumbles on the evidence learns of the event through it.
 */
export function learnFromEvidence(world: World, beaverId: EntityId, eventId: EventId): boolean {
  const event = world.events.get(eventId);
  if (event === undefined) throw new RangeError(`event ${eventId} does not exist`);
  const beaverPosition = world.grid.positionOf(beaverId);
  if (beaverPosition === undefined) return false;
  for (const objectId of event.objectIds) {
    if (!world.entities.isLive(objectId)) continue;
    const position = world.grid.positionOf(objectId);
    if (position === undefined) continue;
    if (chebyshev(beaverPosition, position) <= WITNESS_RADIUS) {
      recordKnowledge(world, beaverId, eventId, "evidence", 0.3);
      return true;
    }
  }
  return false;
}
