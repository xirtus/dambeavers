import type { RecordedEvent } from "./EventLog.js";
import type { World } from "../persistence/WorldSnapshot.js";

/**
 * P5-16: "founding, births, deaths, offices, constructions, disasters,
 * artworks, and conflicts... queried chronologically" -- composed
 * ENTIRELY from real event types already recorded by their own owning
 * systems across this codebase (P0-08's `EventLog` is the one shared
 * mechanism, mirroring `EcosystemCausality.ts`'s (P4-16) identical
 * composition pattern). This file invents no new event type of its own;
 * it only names which already-real types count as "settlement history"
 * and returns them in chronological order.
 */
export const SETTLEMENT_HISTORY_EVENT_TYPES: readonly string[] = [
  // births / offices
  "offspring-born",
  "leader-appointed",
  // deaths
  "drowning-death",
  "starvation-death",
  "exposure-death",
  "trauma-death",
  "disease-death",
  "beaver-mourned",
  // culture / conflict
  "social-interaction",
  "ritual-performed",
  "rule-violated",
  "beaver-argument",
  "beaver-fight",
  // disasters / infrastructure
  "plant-burned-out",
  "dam-segment-applied",
  "bridge-segment-applied",
];

/** Every recorded settlement-history event, oldest first (tick, then id for same-tick determinism). */
export function settlementTimeline(world: World): RecordedEvent[] {
  const events: RecordedEvent[] = [];
  for (const eventType of SETTLEMENT_HISTORY_EVENT_TYPES) events.push(...world.events.eventsOfType(eventType));
  return events.sort((a, b) => a.tick - b.tick || a.id - b.id);
}

/** The same timeline restricted to `[sinceTick, untilTick]` (inclusive) -- a real, queryable slice, e.g. "this settlement's history over its last generation." */
export function settlementTimelineBetween(world: World, sinceTick: number, untilTick: number): RecordedEvent[] {
  return settlementTimeline(world).filter((e) => e.tick >= sinceTick && e.tick <= untilTick);
}
