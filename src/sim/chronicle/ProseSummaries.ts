import type { EntityId } from "../core/EntityId.js";
import type { EventId, RecordedEvent } from "../history/EventLog.js";
import type { World } from "../persistence/WorldSnapshot.js";
import { nameOf, recordedNameOf } from "../creatures/Naming.js";
import { getWar, warHistory } from "../politics/War.js";
import { getSite } from "../region/Site.js";
import { getGood } from "../economy/Good.js";
import { figurePage } from "./FigurePages.js";

/**
 * P8-09: generated prose summaries -- and NOT a lore generator. Every
 * line is assembled by template from REAL structured history only: real
 * recorded events (each line names the event ids it summarizes), real
 * entity names (`Naming.nameOf` over exactly those events' participants
 * -- a person who never appears in the underlying records can never be
 * named), and real numbers from those records. No motives, no invented
 * persons, no invented events, no invented outcomes: the template
 * vocabulary is fixed and only ever states what the records state.
 * Determinism follows trivially -- these are pure functions with no
 * randomness at all.
 */

export interface ProseLine {
  text: string;
  /** The exact recorded events this line summarizes -- its traceability guarantee. */
  recordIds: readonly EventId[];
}

export interface ProseSummary {
  subjectKind: "event" | "person" | "war" | "site";
  subjectId: number;
  title: string;
  lines: ProseLine[];
}

function describe(world: World, id: EntityId): string {
  const name = recordedNameOf(world, id);
  return name !== undefined ? `"${name}"` : `#${id}`;
}

function humanize(eventType: string): string {
  return eventType.replace(/-/g, " ");
}

function numberData(event: RecordedEvent, key: string): number | undefined {
  const value = event.data?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Summarizes ONE recorded event: its own line, its participants, and its recorded cause if any. */
export function summarizeEvent(world: World, eventId: EventId): ProseSummary {
  const event = world.events.get(eventId);
  const lines: ProseLine[] = [];
  lines.push({
    text: `On tick ${event.tick}, the recorded event "${humanize(event.eventType)}" occurred at (${event.location.x}, ${event.location.y}, ${event.location.z}).`,
    recordIds: [event.id],
  });
  const participants = [...new Set([...event.subjectIds, ...event.objectIds])];
  if (participants.length > 0) {
    lines.push({
      text: `Recorded participants: ${participants.map((id) => describe(world, id)).join(", ")}.`,
      recordIds: [event.id],
    });
  }
  if (event.causeEventId !== undefined) {
    lines.push({
      text: `The record links this event to its recorded cause, event #${event.causeEventId}.`,
      recordIds: [event.id],
    });
  }
  return { subjectKind: "event", subjectId: eventId, title: `Event #${eventId}: ${humanize(event.eventType)}`, lines };
}

/** Summarizes a person's recorded life: birth, death (or the live fact), offspring, leadership, and their reputation-bearing deeds. */
export function summarizeLife(world: World, personId: EntityId): ProseSummary {
  const page = figurePage(world, personId);
  if (!page.known) {
    return { subjectKind: "person", subjectId: personId, title: `Unknown beaver #${personId}`, lines: [] };
  }
  const name = page.name !== undefined ? `"${page.name}"` : `Beaver #${personId}`;
  const lines: ProseLine[] = [];

  const birth = world.events.eventsOfType("offspring-born").find((event) => event.subjectIds.includes(personId));
  if (birth !== undefined) {
    const parents = [...birth.objectIds].slice(0, 2);
    lines.push({
      text: `${name} was born on tick ${birth.tick} at (${birth.location.x}, ${birth.location.y}, ${birth.location.z}), the recorded child of ${parents.map((id) => describe(world, id)).join(" and ")}.`,
      recordIds: [birth.id],
    });
  } else {
    lines.push({ text: `${name} has no recorded birth -- no birth event names them.`, recordIds: [] });
  }

  const deathEvents = world.events
    .eventsInvolving(personId)
    .filter((event) => event.subjectIds.includes(personId) && event.eventType.endsWith("-death"))
    .sort((a, b) => a.tick - b.tick || a.id - b.id);
  if (deathEvents.length > 0) {
    const death = deathEvents[deathEvents.length - 1]!;
    lines.push({
      text: `${name} died on tick ${death.tick} at (${death.location.x}, ${death.location.y}, ${death.location.z}); the recorded cause is "${humanize(death.eventType)}".`,
      recordIds: [death.id],
    });
  } else {
    lines.push({ text: `${name} is still alive as of tick ${world.clock.tick}.`, recordIds: [] });
  }

  const offspring = world.events
    .eventsOfType("offspring-born")
    .filter((event) => event.objectIds[0] === personId || event.objectIds[1] === personId)
    .sort((a, b) => a.tick - b.tick || a.id - b.id);
  if (offspring.length > 0) {
    lines.push({
      text: `The records name ${name} as a parent in ${offspring.length} birth${offspring.length === 1 ? "" : "s"} (${offspring.map((event) => describe(world, event.subjectIds[0]!)).join(", ")}).`,
      recordIds: offspring.map((event) => event.id),
    });
  }

  const leadership = world.events.eventsOfType("leader-appointed").filter((event) => event.subjectIds.includes(personId)).sort((a, b) => a.tick - b.tick || a.id - b.id);
  if (leadership.length > 0) {
    lines.push({
      text: `${name} is recorded as appointed leader ${leadership.length} time${leadership.length === 1 ? "" : "s"}, first on tick ${leadership[0]!.tick}.`,
      recordIds: leadership.map((event) => event.id),
    });
  }

  const reputationEvents = world.events
    .eventsInvolving(personId)
    .filter((event) => event.subjectIds.includes(personId) && ["offspring-born", "leader-appointed", "ritual-performed", "rule-violated"].includes(event.eventType))
    .sort((a, b) => a.tick - b.tick || a.id - b.id);
  if (reputationEvents.length > 0) {
    const violations = reputationEvents.filter((event) => event.eventType === "rule-violated").length;
    const good = reputationEvents.length - violations;
    lines.push({
      text: `The recorded history of ${name} holds ${good} reputation-bearing deed${good === 1 ? "" : "s"} and ${violations} recorded violation${violations === 1 ? "" : "s"}.`,
      recordIds: reputationEvents.map((event) => event.id),
    });
  }

  const casualties = world.events.eventsOfType("battle-casualty").filter((event) => event.subjectIds.includes(personId));
  if (casualties.length > 0) {
    lines.push({
      text: `${name} is recorded among the casualties of a battle (${casualties.length} casualty record${casualties.length === 1 ? "" : "s"}).`,
      recordIds: casualties.map((event) => event.id),
    });
  }

  return { subjectKind: "person", subjectId: personId, title: `The life of ${name}`, lines };
}

/** Summarizes a war's full recorded arc: declaration, its battles, casualties, cessions, and its end. */
export function summarizeWar(world: World, warId: EntityId): ProseSummary {
  const war = getWar(world.components, warId);
  if (war === undefined) {
    return { subjectKind: "war", subjectId: warId, title: `Unknown war #${warId}`, lines: [] };
  }
  const lines: ProseLine[] = [];
  const declaration = world.events.get(war.declaredEventId);
  const participants = war.participantIds.map((id) => describe(world, id));
  lines.push({
    text: `On tick ${declaration.tick}, war was declared between ${participants[0]} and ${participants[1]} over a recorded ${humanize(war.causeKind)} cause (cause event #${war.causeEventId}).`,
    recordIds: [declaration.id],
  });

  const battleIds = new Set<EntityId>();
  for (const event of world.events.eventsOfType("battle-began")) {
    for (const id of event.objectIds) {
      if (world.entities.isKnown(id) && world.entities.kindOf(id) === "battle") battleIds.add(id);
    }
  }
  const warBattleIds = [...battleIds].filter((battleId) => warHistory(world, warId).some((event) => event.objectIds.includes(battleId) && event.eventType === "battle-began"));
  if (warBattleIds.length > 0) {
    lines.push({
      text: `The records attach ${warBattleIds.length} battle${warBattleIds.length === 1 ? "" : "s"} to this war (battle entit${warBattleIds.length === 1 ? "y" : "ies"} ${warBattleIds.map((id) => `#${id}`).join(", ")}).`,
      recordIds: warHistory(world, warId).filter((event) => event.eventType === "battle-began" && event.objectIds.some((id) => warBattleIds.includes(id))).map((event) => event.id),
    });
  }

  const casualties = world.events
    .eventsOfType("battle-casualty")
    .filter((event) => event.objectIds.some((id) => warBattleIds.includes(id)))
    .sort((a, b) => a.tick - b.tick || a.id - b.id);
  if (casualties.length > 0) {
    lines.push({
      text: `${casualties.length} battle casualty record${casualties.length === 1 ? "" : "s"} ${casualties.length === 1 ? "is" : "are"} attached to this war's battles: ${casualties.map((event) => describe(world, event.subjectIds[0]!)).join(", ")}.`,
      recordIds: casualties.map((event) => event.id),
    });
  }

  const cessions = world.events.eventsOfType("territory-ceded").filter((event) => event.objectIds.includes(warId)).sort((a, b) => a.tick - b.tick || a.id - b.id);
  for (const cession of cessions) {
    const cellCount = Array.isArray(cession.data?.cells) ? (cession.data.cells as unknown[]).length : undefined;
    lines.push({
      text: `On tick ${cession.tick}, ${describe(world, cession.subjectIds[0]!)} ceded territory to ${describe(world, cession.objectIds[0]!)}${cellCount !== undefined ? ` -- the record names ${cellCount} cell${cellCount === 1 ? "" : "s"}` : ""}.`,
      recordIds: [cession.id],
    });
  }

  if (war.status === "ended" && war.endedEventId !== undefined) {
    const ended = world.events.get(war.endedEventId);
    const winnerText = war.outcome?.winnerSiteId !== undefined ? ` The record names ${describe(world, war.outcome.winnerSiteId)} as the winner.` : "";
    lines.push({
      text: `The war ended on tick ${ended.tick}.${winnerText}`,
      recordIds: [ended.id],
    });
  } else {
    lines.push({ text: `As of tick ${world.clock.tick}, the war's status is recorded as "${war.status}".`, recordIds: [] });
  }

  return { subjectKind: "war", subjectId: warId, title: `The war between ${participants[0]} and ${participants[1]}`, lines };
}

/** Summarizes a site's recorded history: founding, disasters, battles, cultural changes, and its present state. */
export function summarizeSite(world: World, siteId: EntityId): ProseSummary {
  const site = getSite(world.components, siteId);
  if (site === undefined) {
    return { subjectKind: "site", subjectId: siteId, title: `Unknown site #${siteId}`, lines: [] };
  }
  const name = recordedNameOf(world, siteId);
  const label = name !== undefined ? `"${name}"` : `Site #${siteId}`;
  const lines: ProseLine[] = [];

  const founding = world.events.eventsOfType("site-founded").find((event) => event.subjectIds.includes(siteId));
  if (founding !== undefined) {
    const population = numberData(founding, "initialPopulation");
    const food = numberData(founding, "initialStoredFoodKg");
    lines.push({
      text:
        `${label} was founded on tick ${founding.tick} at region (${site.regionX}, ${site.regionZ})` +
        (population !== undefined && food !== undefined ? ` with a recorded founding population of ${population} and ${food}kg of stored food` : "") +
        ".",
      recordIds: [founding.id],
    });
  }

  const disasters = world.events
    .eventsInvolving(siteId)
    .filter((event) => event.eventType.startsWith("world-"))
    .sort((a, b) => a.tick - b.tick || a.id - b.id);
  for (const disaster of disasters) {
    const food = numberData(disaster, "foodLostKg");
    const population = numberData(disaster, "populationLost");
    lines.push({
      text: `On tick ${disaster.tick}, a recorded ${humanize(disaster.eventType.replace(/^world-/, ""))} struck ${label}${food !== undefined ? `, destroying ${food}kg of stored food` : ""}${population !== undefined && population > 0 ? ` and costing ${population} inhabitant${population === 1 ? "" : "s"}` : ""}.`,
      recordIds: [disaster.id],
    });
  }

  const battles = world.events
    .eventsInvolving(siteId)
    .filter((event) => event.eventType === "battle-began" || event.eventType === "battle-ended" || event.eventType === "raid-arrived" || event.eventType === "raid-looted")
    .sort((a, b) => a.tick - b.tick || a.id - b.id);
  for (const battle of battles) {
    lines.push({
      text: `On tick ${battle.tick}, a recorded ${battle.eventType === "battle-began" || battle.eventType === "battle-ended" ? "battle" : "raid"} event names ${label}.`,
      recordIds: [battle.id],
    });
  }

  const culture = world.events
    .eventsInvolving(siteId)
    .filter((event) => ["polity-established", "civilization-founded", "civilization-collapsed", "war-declared", "war-ended", "leader-appointed"].includes(event.eventType))
    .sort((a, b) => a.tick - b.tick || a.id - b.id);
  if (culture.length > 0) {
    lines.push({
      text: `The records name ${label} in ${culture.length} political/cultural event${culture.length === 1 ? "" : "s"}: ${culture.map((event) => `"${humanize(event.eventType)}" (tick ${event.tick})`).join(", ")}.`,
      recordIds: culture.map((event) => event.id),
    });
  }

  lines.push({
    text: `As of tick ${world.clock.tick}, ${label} is recorded with population ${site.populationCount} and ${site.storedFoodKg}kg of stored food.`,
    recordIds: [],
  });

  return { subjectKind: "site", subjectId: siteId, title: `The history of ${label}`, lines };
}
