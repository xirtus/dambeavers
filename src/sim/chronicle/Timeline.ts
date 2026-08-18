import type { EntityId } from "../core/EntityId.js";
import type { RecordedEvent } from "../history/EventLog.js";
import type { World } from "../persistence/WorldSnapshot.js";

/**
 * P8-02: the timeline browser -- chronological recorded events, from
 * world scale (every event) down to one individual (every event naming
 * them), with real windowing (tick range, type filter, pagination) so a
 * player-facing browser can page through history without ever loading a
 * parallel cache. Pure derived reads over `EventLog` (P0-08): the
 * chronological order is authoritative insertion order broken by
 * (tick, id) -- deterministic, exactly like every other history query
 * in this codebase.
 */

export interface TimelineWindow {
  /** Only events at or after this tick. */
  sinceTick?: number;
  /** Only events at or before this tick (inclusive). */
  untilTick?: number;
  /** Only these event types (validated by EventLog's own kebab-case rule). */
  eventTypes?: readonly string[];
  /** Only events naming this entity as subject or object. */
  entityId?: EntityId;
  /** Skip this many matching events (pagination). */
  offset?: number;
  /** Return at most this many matching events (pagination). */
  limit?: number;
}

function sorted(events: RecordedEvent[]): RecordedEvent[] {
  return [...events].sort((a, b) => a.tick - b.tick || a.id - b.id);
}

/** Every recorded event in the world, oldest first -- the world-scale timeline. */
export function worldTimeline(world: World): RecordedEvent[] {
  return sorted(world.events.all());
}

/** Every recorded event naming `entityId`, oldest first -- one individual's/object's/site's own timeline. */
export function entityTimeline(world: World, entityId: EntityId): RecordedEvent[] {
  return sorted(world.events.eventsInvolving(entityId));
}

/**
 * A windowed, filtered, paginated slice of the world timeline. The
 * window shrinks from world scale (`entityId` absent) down to one
 * individual (`entityId` present); every other filter narrows it
 * further. Deterministic: matching events are always ordered by
 * (tick, id), and `offset`/`limit` page over that fixed order.
 */
export function timelineWindow(world: World, window: TimelineWindow = {}): RecordedEvent[] {
  if (window.sinceTick !== undefined && (!Number.isInteger(window.sinceTick) || window.sinceTick < 0)) {
    throw new RangeError(`timeline sinceTick must be a non-negative integer, got ${window.sinceTick}`);
  }
  if (window.untilTick !== undefined && (!Number.isInteger(window.untilTick) || window.untilTick < 0)) {
    throw new RangeError(`timeline untilTick must be a non-negative integer, got ${window.untilTick}`);
  }
  if (window.sinceTick !== undefined && window.untilTick !== undefined && window.sinceTick > window.untilTick) {
    throw new RangeError(`timeline sinceTick (${window.sinceTick}) must not exceed untilTick (${window.untilTick})`);
  }
  if (window.offset !== undefined && (!Number.isInteger(window.offset) || window.offset < 0)) {
    throw new RangeError(`timeline offset must be a non-negative integer, got ${window.offset}`);
  }
  if (window.limit !== undefined && (!Number.isInteger(window.limit) || window.limit < 0)) {
    throw new RangeError(`timeline limit must be a non-negative integer, got ${window.limit}`);
  }
  const eventTypes = window.eventTypes === undefined ? undefined : new Set(window.eventTypes);
  const matching: RecordedEvent[] = [];
  for (const event of sorted(world.events.all())) {
    if (window.sinceTick !== undefined && event.tick < window.sinceTick) continue;
    if (window.untilTick !== undefined && event.tick > window.untilTick) continue;
    if (eventTypes !== undefined && !eventTypes.has(event.eventType)) continue;
    if (window.entityId !== undefined && !event.subjectIds.includes(window.entityId) && !event.objectIds.includes(window.entityId)) continue;
    matching.push(event);
  }
  const offset = window.offset ?? 0;
  return matching.slice(offset, window.limit === undefined ? undefined : offset + window.limit);
}
