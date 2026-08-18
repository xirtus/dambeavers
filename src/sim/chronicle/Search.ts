import type { EntityId } from "../core/EntityId.js";
import type { EventId } from "../history/EventLog.js";
import type { World } from "../persistence/WorldSnapshot.js";
import { AccusationComponent, getAccusation } from "../politics/Justice.js";
import { WarComponent, getWar } from "../politics/War.js";

/**
 * P8-10: search and cross-reference -- EVERY historical record
 * involving a selected beaver, artifact, site, or organization, in one
 * deterministic list. "Every" is complete by construction: the search
 * scans the whole recorded history once (every event naming the target
 * as subject/object, plus every record that names the target through
 * its structured payload -- ownership transfers naming it as either
 * owner) and joins the real component-held references (accusation
 * evidence items, war participants). The same scan serves all four
 * target kinds because records reference ids uniformly (P0-02/P0-08's
 * stable-id contract).
 */

export interface CrossReference {
  eventId: EventId;
  eventType: string;
  tick: number;
  /** How this record references the target. */
  role: "subject" | "object" | "previous-owner" | "new-owner" | "evidence" | "war-participant";
  /** The OTHER entities the record names alongside the target. */
  counterpartIds: EntityId[];
}

function recordRoleOf(event: { subjectIds: readonly EntityId[]; objectIds: readonly EntityId[] }, targetId: EntityId): "subject" | "object" | undefined {
  if (event.subjectIds.includes(targetId)) return "subject";
  if (event.objectIds.includes(targetId)) return "object";
  return undefined;
}

/**
 * Every historical record involving `targetId`, oldest first, de-
 * duplicated per (event, role). Records come from the event log itself
 * (participation + ownership payloads) and from live component state
 * that references history (accusations holding the target as evidence,
 * wars listing the target as a participant).
 */
export function findAllRecords(world: World, targetId: EntityId): CrossReference[] {
  const byKey = new Map<string, CrossReference>();

  const add = (event: { id: EventId; eventType: string; tick: number; subjectIds: readonly EntityId[]; objectIds: readonly EntityId[] }, role: CrossReference["role"]) => {
    const key = `${event.id}:${role}`;
    if (byKey.has(key)) return;
    const counterpartIds = [...new Set([...event.subjectIds, ...event.objectIds])].filter((id) => id !== targetId);
    byKey.set(key, { eventId: event.id, eventType: event.eventType, tick: event.tick, role, counterpartIds });
  };

  for (const event of world.events.all()) {
    const role = recordRoleOf(event, targetId);
    if (role !== undefined) add(event, role);
    if (event.eventType === "ownership-transferred") {
      const previousOwner = event.data?.previousOwner;
      const newOwner = event.data?.newOwner;
      const previousOwnerId = previousOwner !== null && typeof previousOwner === "object" ? (previousOwner as { ownerId?: unknown }).ownerId : undefined;
      const newOwnerId = newOwner !== null && typeof newOwner === "object" ? (newOwner as { ownerId?: unknown }).ownerId : undefined;
      if (Number.isInteger(previousOwnerId) && previousOwnerId === targetId) add(event, "previous-owner");
      if (Number.isInteger(newOwnerId) && newOwnerId === targetId) add(event, "new-owner");
    }
  }

  // Evidence: accusations whose real evidence item IS the target.
  for (const accusationId of world.components.query(AccusationComponent)) {
    const accusation = getAccusation(world.components, accusationId);
    if (accusation === undefined || accusation.evidenceItemId !== targetId) continue;
    const violation = world.events.get(accusation.violationEventId);
    add(violation, "evidence");
    add(world.events.get(accusation.filedEventId), "evidence");
  }

  // War participation: wars that list the target as a participant, via
  // their recorded declaration and end events.
  for (const warId of world.components.query(WarComponent)) {
    const war = getWar(world.components, warId);
    if (war === undefined || !war.participantIds.includes(targetId)) continue;
    add(world.events.get(war.declaredEventId), "war-participant");
    if (war.endedEventId !== undefined) add(world.events.get(war.endedEventId), "war-participant");
  }

  return [...byKey.values()].sort((a, b) => a.tick - b.tick || a.eventId - b.eventId);
}

/** Batch cross-reference: the same complete search for every id in `targetIds`, in one deterministic pass. */
export function crossReferenceIndex(world: World, targetIds: readonly EntityId[]): ReadonlyMap<EntityId, CrossReference[]> {
  const index = new Map<EntityId, CrossReference[]>();
  for (const targetId of [...new Set(targetIds)].sort((a, b) => a - b)) {
    index.set(targetId, findAllRecords(world, targetId));
  }
  return index;
}
