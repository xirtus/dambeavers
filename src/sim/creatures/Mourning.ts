import type { EntityId } from "../core/EntityId.js";
import type { EventId } from "../history/EventLog.js";
import type { CellCoordinate } from "../world/WorldGrid.js";
import type { World } from "../persistence/WorldSnapshot.js";
import { relationshipWith } from "./Relationships.js";
import { recordMemory } from "./Memory.js";

/**
 * P2-15's "relationship-sensitive social consequences" half. Deliberately
 * NOT a new persisted grief state or a parallel emotion mechanism -- it
 * records exactly one ordinary, generic `"beaver-mourned"` event
 * (P0-08's `EventLog`, the project's existing general "something
 * happened that other systems can react to" mechanism) naming every LIVE
 * beaver who genuinely had a relationship with the deceased as a subject.
 * `Mood.ts`'s `deriveMood` (P2-14) is what actually turns that into a
 * felt reaction, reading EACH mourner's own relationship strength toward
 * the deceased -- so the same shared death event produces a different
 * mood swing for a grieving mate than for a distant acquaintance, the
 * literal "relationship-sensitive" wording, using the SAME "same event,
 * persistent-trait/relationship-driven reaction" mechanism P2-14 already
 * built, not a second bespoke grief system.
 *
 * Only beavers who already hold a real `RelationshipEdge` TOWARD the
 * deceased mourn at all -- a stranger with no relationship never gets a
 * fabricated one just so it can "feel something" (AGENTS.md Law 1 -- no
 * invented population-wide data this task doesn't require, matching
 * `Relationships.ts`'s own "nothing here creates a relationship
 * automatically" precedent).
 */
export const MOURNED_EVENT_TYPE = "beaver-mourned";

function liveBeaverIds(world: World): EntityId[] {
  return world.entities.liveIdsOfKind("beaver").sort((a, b) => a - b);
}

/**
 * Records one shared `"beaver-mourned"` event (subjectIds: every live
 * beaver with an existing relationship edge toward `deceasedBeaverId`,
 * objectIds: `[deceasedBeaverId]`) at `location`, or returns `undefined`
 * if nobody currently alive had any relationship with the deceased --
 * genuinely no consequence to record, not an empty/degenerate event.
 * Called once, synchronously, from `Mortality.ts`'s `die()` -- death
 * itself is the single, real, unambiguous moment this consequence
 * happens, the same "record the byproduct at its one real origin point"
 * discipline `BeaverNeeds.ts`'s `eatFoodItem`/`Reproduction.ts`'s
 * `produceOffspring` already use, rather than a per-tick scan for a
 * condition that only ever becomes true at one instant.
 */
export function notifyDeathForMourning(
  world: World,
  deceasedBeaverId: EntityId,
  location: CellCoordinate,
): EventId | undefined {
  const mournerIds = liveBeaverIds(world).filter(
    (candidateId) => candidateId !== deceasedBeaverId && relationshipWith(world.components, candidateId, deceasedBeaverId) !== undefined,
  );
  if (mournerIds.length === 0) return undefined;
  const eventId = world.events.record({
    tick: world.clock.tick,
    eventType: MOURNED_EVENT_TYPE,
    subjectIds: mournerIds,
    objectIds: [deceasedBeaverId],
    location,
  });

  // P5-02: each mourner keeps a real, persisted memory of this death --
  // not merely `Mood.ts`'s live 500-tick reaction window -- with a real,
  // relationship-sensitive valence (closer relationships hurt more),
  // mirroring `Mood.ts`'s own `griefValence` formula shape without
  // reaching into that file's private helper.
  for (const mournerId of mournerIds) {
    const edge = relationshipWith(world.components, mournerId, deceasedBeaverId)!;
    const valence = -Math.min(1, edge.familiarity + (edge.kin !== "unrelated" ? 0.3 : 0));
    recordMemory(world, mournerId, eventId, valence);
  }

  return eventId;
}
