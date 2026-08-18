import type { EntityId } from "../core/EntityId.js";
import type { EventId, RecordedEvent } from "../history/EventLog.js";
import type { World } from "../persistence/WorldSnapshot.js";
import { nameOf, recordedNameOf } from "../creatures/Naming.js";

/**
 * P8-08: the causal history view -- for a major disaster or conflict,
 * the upstream causal chain AS RECORDED. Every step is a real
 * `RecordedEvent` from `traceBack` (P0-08), displayed oldest-first, with
 * a plain-text description assembled ONLY from that event's own real
 * fields (type, tick, location, participant names). "Where recorded" is
 * honest: if the recording systems never linked a cause (a disaster
 * event carries no causeEventId today), the view shows exactly the one
 * recorded event and says so -- it never fabricates an upstream chain.
 */

export interface CausalParticipant {
  id: EntityId;
  name?: string;
  kind: string;
}

export interface CausalHistoryStep {
  event: RecordedEvent;
  description: string;
  participants: CausalParticipant[];
}

export interface CausalHistory {
  outcomeEvent: RecordedEvent;
  /** Origin first -- the same display convention the rest of the codebase uses. */
  upstream: CausalHistoryStep[];
  /** How many causeEventId links were actually recorded (0 = the outcome has no recorded cause). */
  recordedDepth: number;
}

function humanize(eventType: string): string {
  return eventType.replace(/-/g, " ");
}

function describe(world: World, id: EntityId): string {
  const name = recordedNameOf(world, id);
  return name !== undefined ? `"${name}" (#${id})` : `#${id} (${world.entities.isKnown(id) ? world.entities.kindOf(id) : "unknown kind"})`;
}

function stepOf(world: World, event: RecordedEvent): CausalHistoryStep {
  const participants: CausalParticipant[] = [...new Set([...event.subjectIds, ...event.objectIds])].map((id) => {
    const name = recordedNameOf(world, id);
    return {
      id,
      ...(name !== undefined ? { name } : {}),
      kind: world.entities.isKnown(id) ? world.entities.kindOf(id) : "unknown",
    };
  });
  const who = participants.length > 0 ? participants.map((p) => describe(world, p.id)).join(", ") : "no recorded participants";
  const cause = event.causeEventId !== undefined ? ` (caused by event #${event.causeEventId})` : "";
  return {
    event,
    description: `"${humanize(event.eventType)}" on tick ${event.tick} at (${event.location.x}, ${event.location.y}, ${event.location.z}); participants: ${who}${cause}.`,
    participants,
  };
}

/** The full recorded causal chain for `eventId`, oldest first, with the outcome itself as the final step. */
export function causalHistoryOf(world: World, eventId: EventId): CausalHistory {
  const outcome = world.events.get(eventId);
  const chain = world.events.traceBack(eventId);
  const upstream = [...chain].reverse().map((event) => stepOf(world, event));
  return { outcomeEvent: outcome, upstream, recordedDepth: chain.length - 1 };
}

/** Major recorded disasters (world-*) and conflicts (war/battle events) -- the roadmap's own "major disasters/conflicts" candidates. */
export function majorRecordedEvents(world: World): RecordedEvent[] {
  const majorTypes = new Set([
    "world-drought",
    "world-flood",
    "world-wildfire",
    "war-declared",
    "war-ended",
    "battle-began",
    "battle-ended",
    "raid-arrived",
    "raid-looted",
  ]);
  return world
    .events
    .all()
    .filter((event) => majorTypes.has(event.eventType))
    .sort((a, b) => a.tick - b.tick || a.id - b.id);
}

/** The causal view for every major recorded disaster/conflict, oldest first. */
export function majorCausalHistories(world: World): CausalHistory[] {
  return majorRecordedEvents(world).map((event) => causalHistoryOf(world, event.id));
}
