import type { EntityId } from "../core/EntityId.js";
import type { RecordedEvent } from "./EventLog.js";
import type { World } from "../persistence/WorldSnapshot.js";

/**
 * P4-16: "explain a population or vegetation shift using recorded
 * environmental causes" -- composed entirely from `EventLog.ts`'s own
 * already-real, already-tested primitives (P0-08/P1-22:
 * `eventsInvolving`, `eventsOfType`, `traceBack`), never a second,
 * parallel history mechanism. This file's only job is picking the right
 * composition for ecosystem-shaped questions ("why did this population/
 * this vegetation change"), the same way P1-22's own causal-explanation
 * work composed the identical primitives for beaver-scoped questions.
 */

/** One entity's full explained history: every event it was ever a subject/object of, each paired with its own real backward causal chain (`traceBack`, empty-tail-first -- see that method's own doc comment) if one exists. */
export interface CausalExplanation {
  event: RecordedEvent;
  causalChain: readonly RecordedEvent[];
}

/** Every real recorded event `entityId` (a died tree, a felled tree, a starved animal, ...) was ever involved in, each with its own real causal chain. Ordering matches `EventLog.eventsInvolving`'s own (insertion order). */
export function explainEntityHistory(world: World, entityId: EntityId): CausalExplanation[] {
  return world.events.eventsInvolving(entityId).map((event) => ({
    event,
    causalChain: event.causeEventId !== undefined ? world.events.traceBack(event.id) : [event],
  }));
}

export interface EcosystemEventCount {
  eventType: string;
  count: number;
}

/** Real, derived tally of every ecosystem-relevant event type recorded at or after `sinceTick` -- "how many trees died of fire vs. old age vs. felling this period," "how many animals starved vs. were predated" -- computed fresh from `EventLog`'s own append-only history every call, never a separately-maintained counter that could drift. `eventTypes` is caller-supplied (this file never hardcodes which types count as "population/vegetation shift" events -- that's a judgment call for whoever is asking the question, matching `EventLog.ts`'s own "open, kebab-case string, never branched on" event-type discipline). */
export function summarizeEcosystemEvents(world: World, eventTypes: readonly string[], sinceTick: number): EcosystemEventCount[] {
  return eventTypes
    .map((eventType) => ({ eventType, count: world.events.eventsOfType(eventType).filter((e) => e.tick >= sinceTick).length }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count || a.eventType.localeCompare(b.eventType));
}

/** Real event-type names this project's own Phase 4 ecosystem systems record -- a convenience default for `summarizeEcosystemEvents`, not an exhaustive/closed list (any caller can pass its own). */
export const VEGETATION_EVENT_TYPES: readonly string[] = ["tree-felled", "plant-died", "plant-ignited", "plant-burned-out"];
export const POPULATION_EVENT_TYPES: readonly string[] = [
  "predation",
  "starvation-death",
  "drowning-death",
  "exposure-death",
  "trauma-death",
  "disease-death",
  "offspring-born",
];
