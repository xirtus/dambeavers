import type { EntityId } from "../core/EntityId.js";
import type { EventId, RecordedEvent } from "../history/EventLog.js";
import type { World } from "../persistence/WorldSnapshot.js";
import { nameOf, recordedNameOf } from "../creatures/Naming.js";
import { getSite } from "../region/Site.js";
import { getPoliticalEntity } from "../politics/PoliticalEntity.js";

/**
 * P8-04: a site's history -- founding, ownership (its polity and its
 * territorial claims), population, disasters, constructions, battles,
 * and cultural changes -- reconstructed from recorded history. Every
 * entry carries its own real event id where one exists; the population
 * timeline is derived from the exact numbers the recording systems
 * wrote into their events at the moment they happened (P8's `data`
 * payloads: site-founded's initialPopulation, migration events'
 * populationCount, world-disaster events' populationLost). Where a
 * number was never recorded (events from before those payloads
 * existed), the reconstruction honestly reports it cannot know instead
 * of guessing.
 */

export interface SiteHistoryEntry {
  tick: number;
  kind: "founding" | "ownership" | "population" | "disaster" | "construction" | "battle" | "culture" | "current-state";
  description: string;
  eventId?: EventId;
}

export interface SitePopulationReconstruction {
  reconstructible: boolean;
  population?: number;
  basisEventIds: EventId[];
}

const DISASTER_EVENT_TYPES = new Set(["world-drought", "world-flood", "world-wildfire"]);
const CONSTRUCTION_EVENT_TYPES = new Set(["dam-segment-applied", "bridge-segment-applied"]);
const BATTLE_EVENT_TYPES = new Set(["battle-began", "battle-ended", "raid-arrived", "raid-looted"]);
const CULTURE_EVENT_TYPES = new Set([
  "polity-established",
  "leader-appointed",
  "ritual-performed",
  "civilization-founded",
  "civilization-collapsed",
  "civilization-succeeded",
  "war-declared",
  "war-ended",
]);

function describe(world: World, id: EntityId): string {
  const name = recordedNameOf(world, id);
  return name !== undefined ? `"${name}" (#${id})` : `#${id}`;
}

function numberData(event: RecordedEvent, key: string): number | undefined {
  const value = event.data?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** The site's real founding event (first `site-founded` naming it). */
export function siteFoundingEvent(world: World, siteId: EntityId): RecordedEvent | undefined {
  return world.events.eventsOfType("site-founded").find((event) => event.subjectIds.includes(siteId));
}

/**
 * The site's population at `tick`, reconstructed from recorded history:
 * the founding population plus every recorded delta (migrations out and
 * in, disaster losses) up to and including `tick`. Honest absence: if
 * the founding event predates the `data` payloads (or any delta event
 * lacks its count), the whole reconstruction reports
 * `reconstructible: false` rather than inventing a number.
 */
export function sitePopulationAt(world: World, siteId: EntityId, tick: number): SitePopulationReconstruction {
  if (!Number.isInteger(tick) || tick < 0) throw new RangeError(`tick must be a non-negative integer, got ${tick}`);
  const founding = siteFoundingEvent(world, siteId);
  if (founding === undefined) return { reconstructible: false, basisEventIds: [] };
  const initial = numberData(founding, "initialPopulation");
  if (initial === undefined) return { reconstructible: false, basisEventIds: [founding.id] };

  let population = initial;
  const basis: EventId[] = [founding.id];
  for (const event of world.events.eventsInvolving(siteId).sort((a, b) => a.tick - b.tick || a.id - b.id)) {
    if (event.tick > tick) continue;
    // Departure deltas belong to the ORIGIN only -- the departure event
    // names origin as objectIds[0] and the destination next, so a
    // destination must not be charged the departure.
    if (event.eventType === "migration-departed" && event.objectIds[0] === siteId) {
      const count = numberData(event, "populationCount");
      if (count === undefined) return { reconstructible: false, basisEventIds: basis };
      population -= count;
      basis.push(event.id);
    } else if (event.eventType === "migration-arrived" && event.subjectIds.includes(siteId)) {
      const count = numberData(event, "populationCount");
      if (count === undefined) return { reconstructible: false, basisEventIds: basis };
      population += count;
      basis.push(event.id);
    } else if (DISASTER_EVENT_TYPES.has(event.eventType) && event.subjectIds.includes(siteId)) {
      const lost = numberData(event, "populationLost") ?? 0;
      population -= lost;
      basis.push(event.id);
    }
  }
  return { reconstructible: true, population: Math.max(0, population), basisEventIds: basis };
}

/**
 * The site's full history, chronological: every recorded event naming
 * the site, classified into the roadmap's own categories (founding,
 * ownership/territory, population, disasters, constructions, battles,
 * cultural changes), plus a final current-state entry (the site's live
 * components -- population, stored food, structure count, polity
 * leader).
 */
export function siteHistory(world: World, siteId: EntityId): SiteHistoryEntry[] {
  if (!world.entities.isKnown(siteId) || world.entities.kindOf(siteId) !== "site") {
    throw new RangeError(`entity ${siteId} is not a known site`);
  }
  const entries: SiteHistoryEntry[] = [];
  const events = world.events.eventsInvolving(siteId).sort((a, b) => a.tick - b.tick || a.id - b.id);

  for (const event of events) {
    if (event.eventType === "site-founded") {
      const initial = numberData(event, "initialPopulation");
      const food = numberData(event, "initialStoredFoodKg");
      entries.push({
        tick: event.tick,
        kind: "founding",
        description:
          initial !== undefined && food !== undefined
            ? `Founded with population ${initial} and ${food}kg stored food.`
            : `Founded (recorded founding event #${event.id}).`,
        eventId: event.id,
      });
    } else if (event.eventType === "territory-claimed") {
      entries.push({
        tick: event.tick,
        kind: "ownership",
        description: `Claimed new territory (claim entity #${event.subjectIds[1] ?? "?"}).`,
        eventId: event.id,
      });
    } else if (event.eventType === "territory-ceded") {
      const cells = Array.isArray(event.data?.cells) ? (event.data.cells as unknown[]).length : undefined;
      entries.push({
        tick: event.tick,
        kind: "ownership",
        description: `Ceded territory to ${describe(world, event.objectIds[0]!)}${cells !== undefined ? ` -- ${cells} cell(s)` : ""}.`,
        eventId: event.id,
      });
    } else if (event.eventType === "migration-departed" && event.objectIds[0] === siteId) {
      const count = numberData(event, "populationCount");
      entries.push({
        tick: event.tick,
        kind: "population",
        description: `${count !== undefined ? `${count} inhabitant(s)` : "Some inhabitants"} departed toward ${describe(world, event.objectIds[1]!)}.`,
        eventId: event.id,
      });
    } else if (event.eventType === "migration-arrived") {
      const count = numberData(event, "populationCount");
      entries.push({
        tick: event.tick,
        kind: "population",
        description: `${count !== undefined ? `${count} new inhabitant(s)` : "New inhabitants"} arrived from ${describe(world, event.objectIds[0]!)}.`,
        eventId: event.id,
      });
    } else if (DISASTER_EVENT_TYPES.has(event.eventType)) {
      const food = numberData(event, "foodLostKg");
      const population = numberData(event, "populationLost");
      entries.push({
        tick: event.tick,
        kind: "disaster",
        description: `A ${event.eventType.replace(/^world-/, "")} struck${food !== undefined ? `, destroying ${food}kg of stored food` : ""}${population !== undefined && population > 0 ? ` and ${population} inhabitant(s)` : ""}.`,
        eventId: event.id,
      });
    } else if (CONSTRUCTION_EVENT_TYPES.has(event.eventType)) {
      entries.push({
        tick: event.tick,
        kind: "construction",
        description: `A ${event.eventType === "dam-segment-applied" ? "dam" : "bridge"} segment was built (construction #${event.objectIds[0] ?? "?"}).`,
        eventId: event.id,
      });
    } else if (BATTLE_EVENT_TYPES.has(event.eventType)) {
      entries.push({
        tick: event.tick,
        kind: "battle",
        description: `"${event.eventType}" -- ${event.eventType.startsWith("battle") ? "a battle" : "a raid"} involved this site.`,
        eventId: event.id,
      });
    } else if (CULTURE_EVENT_TYPES.has(event.eventType)) {
      entries.push({
        tick: event.tick,
        kind: "culture",
        description: `"${event.eventType}" -- a recorded political/cultural change naming this site.`,
        eventId: event.id,
      });
    }
  }

  // Current live state -- the site's own components, honestly labeled as
  // the present, not a historical reconstruction.
  const site = getSite(world.components, siteId);
  if (site !== undefined) {
    const entity = getPoliticalEntity(world.components, siteId);
    entries.push({
      tick: world.clock.tick,
      kind: "current-state",
      description:
        `Now: population ${site.populationCount}, ${site.storedFoodKg}kg stored food` +
        (site.structureCount !== undefined ? `, ${site.structureCount} structure(s)` : "") +
        (entity !== undefined ? `, polity with government form "${entity.governmentFormId}"` : ", no polity established") +
        (entity?.leaderId !== undefined ? `, leader ${describe(world, entity.leaderId)}` : "") +
        ".",
    });
  }
  return entries;
}
