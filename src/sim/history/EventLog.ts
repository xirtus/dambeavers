import { type EntityId, type EntityIdRegistry } from "../core/EntityId.js";
import type { CellCoordinate } from "../world/WorldGrid.js";

const EVENT_TYPE_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/**
 * Globally unique, permanent, never-reused identity for a recorded event --
 * the same collision-safety shape as `EntityId` (EntityId.ts), but a
 * distinct branded type: events are immutable append-only history records,
 * not simulation entities (no components, no live/destroyed state), so
 * conflating the two id spaces would blur two different concepts for no
 * benefit.
 */
export type EventId = number & { readonly __eventIdBrand: unique symbol };

/**
 * One structured, state-changing event, per AGENTS.md §1.4 ("causality
 * must be inspectable") and ARCHITECTURE_CONTRACT §9 (the causal graph).
 * Fields follow P0-08's roadmap entry exactly:
 *
 *  - `tick`: the authoritative `SimulationClock` tick this happened at --
 *    NOT wall-clock time (ARCHITECTURE_CONTRACT §17 forbids wall-clock as
 *    authoritative). `EventLog` takes this as a plain number from the
 *    caller rather than holding its own `SimulationClock` reference, to
 *    stay a generic, independently-testable foundation the way
 *    `ComponentStore` doesn't hold a clock either.
 *  - `eventType`: an open, kebab-case string (mirrors `EntityKind`), not a
 *    fixed enum -- domain features (tree-felling, dam-building, injury,
 *    ...) define their own event type names as data. This file never
 *    branches on a specific type string; see `MaterialProperties`'s doc
 *    comment for why identity-branching in a foundation is a smell this
 *    project avoids on principle.
 *  - `subjectIds`/`objectIds`: participating entities, validated against
 *    an `EntityIdRegistry` at record time -- but only that the id is
 *    *known*, not *live*: a "beaver died" event must keep resolving to
 *    that beaver's kind forever after, exactly as EntityIdRegistry's own
 *    doc comment promises ("history/event references must keep resolving
 *    after death").
 *  - `location`: where it happened. Required (not optional) per the
 *    roadmap's exact field list -- only "parent cause/event" is called
 *    optional there. Not bounds-validated against any particular
 *    `WorldGrid` (`EventLog` isn't grid-bound), just shape-checked as
 *    integer coordinates. Every event type built on Phase 0/1 so far has a
 *    real cell to report. A later system with no natural single location
 *    (e.g. a relationship change between two beavers in different places,
 *    or a world-wide weather shift) would have to invent a placeholder
 *    coordinate rather than honestly report "no location" -- if and when
 *    that need appears, revisit this field (e.g. make it optional) rather
 *    than inventing a fake coordinate to satisfy the schema.
 *  - `causeEventId`: the roadmap lists "direct cause" and "optional parent
 *    cause/event" as two bullets; with no command/action system yet built
 *    (that would be inventing a system ahead of its dependencies -- see
 *    AGENTS.md on not building ahead), the only concrete "direct cause"
 *    this project can honestly express today is a link to the event that
 *    caused this one. The two roadmap bullets are therefore represented as
 *    this single optional field. A future command/order system, if it
 *    needs its own distinct reference, can add a field for it without
 *    disturbing this one.
 */
export interface RecordedEvent {
  readonly id: EventId;
  readonly tick: number;
  readonly eventType: string;
  readonly subjectIds: readonly EntityId[];
  readonly objectIds: readonly EntityId[];
  readonly location: CellCoordinate;
  readonly causeEventId?: EventId;
}

export interface RecordEventInput {
  tick: number;
  eventType: string;
  subjectIds?: readonly EntityId[];
  objectIds?: readonly EntityId[];
  location: CellCoordinate;
  /** Must already be a recorded event id in this log -- causes are always recorded before their effects, so this can never form a cycle by construction (see `record()`). */
  causeEventId?: EventId;
}

export interface EventLogDebugState {
  eventCount: number;
  eventTypeCounts: Array<{ eventType: string; count: number }>;
}

const EVENT_LOG_SNAPSHOT_VERSION = 1;

export interface EventLogSnapshot {
  version: number;
  nextValue: number;
  events: RecordedEvent[];
}

function isNonNegativeInt(n: number): boolean {
  return Number.isInteger(n) && n >= 0;
}

function assertValidEventType(eventType: string): void {
  if (!EVENT_TYPE_PATTERN.test(eventType)) {
    throw new RangeError(
      `event type must be non-empty lowercase kebab-case (e.g. "tree-felled", "log-hauled"), got ${JSON.stringify(eventType)}`,
    );
  }
}

function assertValidLocation(location: CellCoordinate): void {
  if (!Number.isInteger(location.x) || !Number.isInteger(location.y) || !Number.isInteger(location.z)) {
    throw new RangeError(`event location must have integer coordinates, got ${JSON.stringify(location)}`);
  }
}

/**
 * Append-only structured event history. Every recorded event gets a
 * permanent, never-reused `EventId` (same collision-safety discipline as
 * `EntityIdRegistry`) and, optionally, a link to the event that directly
 * caused it -- `traceBack()` walks that link backward, which is the
 * mechanism P0-08's acceptance test (and the future player-facing "Why?"
 * system AGENTS.md §1.4 anticipates) is built from.
 *
 * Deliberately minimal: no forward child-index ("what did this event
 * cause") since nothing requires it yet and it would be speculative
 * bookkeeping (AGENTS.md: don't build for hypothetical future
 * requirements) -- the backward chain is what the roadmap's acceptance
 * test actually asks for. No event-type-specific fields or branching:
 * this is a generic causal record, not a union of scripted outcome types.
 */
export class EventLog {
  private readonly entities: EntityIdRegistry;
  private nextValue = 1;
  private readonly eventsById = new Map<EventId, RecordedEvent>();
  private readonly order: EventId[] = [];

  constructor(entities: EntityIdRegistry) {
    this.entities = entities;
  }

  /**
   * Records a new event and returns its permanent id. Validates every
   * entity reference against this log's registry, that `causeEventId` (if
   * given) already exists in this log, and that the cause's own `tick` is
   * `<=` this event's `tick` -- a cause cannot be recorded as happening
   * strictly after its effect. This is a real ordering guarantee, not just
   * id-recency: two events can be recorded in either order and carry any
   * ticks when NOT causally linked, but a `causeEventId` link specifically
   * asserts "this happened because of that," and AGENTS.md §1.4's demand
   * that causality be inspectable would be actively misleading if the
   * data could assert a cause occurring after its own effect.
   */
  record(input: RecordEventInput): EventId {
    if (!isNonNegativeInt(input.tick)) {
      throw new RangeError(`event tick must be a non-negative integer, got ${input.tick}`);
    }
    assertValidEventType(input.eventType);
    assertValidLocation(input.location);
    const subjectIds = input.subjectIds ?? [];
    const objectIds = input.objectIds ?? [];
    for (const id of [...subjectIds, ...objectIds]) {
      if (!this.entities.isKnown(id)) {
        throw new RangeError(`event references entity id ${id}, which is not known to this log's registry`);
      }
    }
    if (input.causeEventId !== undefined) {
      const cause = this.eventsById.get(input.causeEventId);
      if (cause === undefined) {
        throw new RangeError(`event references causeEventId ${input.causeEventId}, which is not a recorded event in this log`);
      }
      if (cause.tick > input.tick) {
        throw new RangeError(
          `event at tick ${input.tick} cannot be caused by event ${input.causeEventId} at tick ${cause.tick} -- a cause cannot happen after its effect`,
        );
      }
    }

    const id = this.nextValue as EventId;
    this.nextValue++;
    const event: RecordedEvent = {
      id,
      tick: input.tick,
      eventType: input.eventType,
      subjectIds: [...subjectIds],
      objectIds: [...objectIds],
      location: { ...input.location },
      ...(input.causeEventId !== undefined ? { causeEventId: input.causeEventId } : {}),
    };
    this.eventsById.set(id, event);
    this.order.push(id);
    return id;
  }

  get(id: EventId): RecordedEvent {
    const event = this.eventsById.get(id);
    if (event === undefined) {
      throw new RangeError(`unknown event id ${id}`);
    }
    return event;
  }

  has(id: EventId): boolean {
    return this.eventsById.has(id);
  }

  get count(): number {
    return this.order.length;
  }

  /**
   * Every recorded event where `entityId` appears as a subject or object,
   * oldest first. O(event count) -- a linear scan, fine for an on-demand
   * debug inspection (P0-12, "click an entity, see its event chains") or
   * test assertions; do not call this from a per-tick hot path once event
   * counts grow large, mirroring every other O(n) debug-scan method in
   * this codebase (`WorldGrid.getDebugState()`, `ComponentStore.getDebugState()`,
   * `TerrainField.getDebugState()`). This is a flat membership scan, NOT
   * the forward causal child-index ("what did this event cause") this
   * class's own doc comment deliberately omits as speculative -- finding
   * events BY PARTICIPANT is a different, narrower need P0-12 actually
   * requires, not a reversal of that earlier scope decision.
   */
  eventsInvolving(entityId: EntityId): RecordedEvent[] {
    const result: RecordedEvent[] = [];
    for (const id of this.order) {
      const event = this.eventsById.get(id)!;
      if (event.subjectIds.includes(entityId) || event.objectIds.includes(entityId)) {
        result.push(event);
      }
    }
    return result;
  }

  /**
   * Walks backward from `id` through `causeEventId` links. Returns
   * `[event, its direct cause, its cause's cause, ...]` -- outcome first,
   * originating action last -- matching the roadmap's own phrasing
   * ("traversed backward from outcome to originating action"). A cycle is
   * structurally impossible via `record()` (a cause must already be
   * recorded, hence strictly smaller in id, before it can be referenced),
   * but `fromSnapshot()` re-validates this for restored data, so this loop
   * never needs its own cycle guard.
   */
  traceBack(id: EventId): RecordedEvent[] {
    const chain: RecordedEvent[] = [];
    let current: EventId | undefined = id;
    while (current !== undefined) {
      const event = this.get(current);
      chain.push(event);
      current = event.causeEventId;
    }
    return chain;
  }

  /** O(event count) -- scans every event. Fine for an on-demand debug UI (P0-12); do not call from a per-tick hot path once event counts grow large. */
  getDebugState(): EventLogDebugState {
    const counts = new Map<string, number>();
    for (const id of this.order) {
      const event = this.eventsById.get(id)!;
      counts.set(event.eventType, (counts.get(event.eventType) ?? 0) + 1);
    }
    const eventTypeCounts = [...counts.entries()]
      .map(([eventType, count]) => ({ eventType, count }))
      .sort((a, b) => a.eventType.localeCompare(b.eventType));
    return { eventCount: this.order.length, eventTypeCounts };
  }

  toSnapshot(): EventLogSnapshot {
    return {
      version: EVENT_LOG_SNAPSHOT_VERSION,
      nextValue: this.nextValue,
      events: this.order.map((id) => this.eventsById.get(id)!),
    };
  }

  /**
   * Reconstructs a log against `entities`, re-validating everything
   * `record()` would have: each event's entity references are known to
   * `entities` (historical references to now-destroyed entities are
   * expected and allowed -- `isKnown`, not `isLive`), and each
   * `causeEventId` refers to a DIFFERENT event already present in the
   * snapshot with a strictly smaller id -- the same "cause must precede
   * effect" invariant `record()` enforces structurally, re-checked
   * explicitly here since a hand-edited snapshot has no such structural
   * guarantee and could otherwise smuggle in a self-reference or a cycle
   * that would make `traceBack()` loop forever.
   */
  static fromSnapshot(snapshot: EventLogSnapshot, entities: EntityIdRegistry): EventLog {
    if (snapshot.version !== EVENT_LOG_SNAPSHOT_VERSION) {
      throw new RangeError(
        `unsupported EventLog snapshot version ${snapshot.version}, expected ${EVENT_LOG_SNAPSHOT_VERSION}`,
      );
    }
    if (!Number.isInteger(snapshot.nextValue) || snapshot.nextValue < 1) {
      throw new RangeError(`corrupt snapshot: nextValue must be a positive integer, got ${snapshot.nextValue}`);
    }

    const log = new EventLog(entities);
    const seenIds = new Set<EventId>();
    let maxId = 0;
    for (const event of snapshot.events) {
      if (!Number.isInteger(event.id) || event.id < 1) {
        throw new RangeError(`corrupt snapshot: event id must be a positive integer, got ${event.id}`);
      }
      if (seenIds.has(event.id)) {
        throw new RangeError(`corrupt snapshot: duplicate event id ${event.id}`);
      }
      if (!isNonNegativeInt(event.tick)) {
        throw new RangeError(`corrupt snapshot: event ${event.id} has an invalid tick ${event.tick}`);
      }
      assertValidEventType(event.eventType);
      assertValidLocation(event.location);
      for (const entityId of [...event.subjectIds, ...event.objectIds]) {
        if (!entities.isKnown(entityId)) {
          throw new RangeError(`corrupt snapshot: event ${event.id} references unknown entity id ${entityId}`);
        }
      }
      if (event.causeEventId !== undefined) {
        if (!seenIds.has(event.causeEventId)) {
          throw new RangeError(
            `corrupt snapshot: event ${event.id} references causeEventId ${event.causeEventId}, which must be an earlier event in the snapshot`,
          );
        }
        if (event.causeEventId >= event.id) {
          throw new RangeError(
            `corrupt snapshot: event ${event.id} has causeEventId ${event.causeEventId} >= its own id -- causes must strictly precede effects`,
          );
        }
        const cause = log.eventsById.get(event.causeEventId)!; // present: causeEventId < event.id and every smaller id was already inserted below
        if (cause.tick > event.tick) {
          throw new RangeError(
            `corrupt snapshot: event ${event.id} at tick ${event.tick} is caused by event ${event.causeEventId} at tick ${cause.tick} -- a cause cannot happen after its effect`,
          );
        }
      }
      seenIds.add(event.id);
      if (event.id > maxId) maxId = event.id;
      log.eventsById.set(event.id, event);
      log.order.push(event.id);
    }
    if (snapshot.nextValue <= maxId) {
      throw new RangeError(
        `corrupt snapshot: nextValue (${snapshot.nextValue}) must exceed every stored event id (max ${maxId})`,
      );
    }
    if (snapshot.events.length !== snapshot.nextValue - 1) {
      throw new RangeError(
        `corrupt snapshot: expected ${snapshot.nextValue - 1} events (ids are a gapless sequence from 1), got ${snapshot.events.length}`,
      );
    }
    log.nextValue = snapshot.nextValue;
    return log;
  }
}
