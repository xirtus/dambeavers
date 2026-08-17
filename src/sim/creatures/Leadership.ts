import { ComponentStore, defineComponent, type ComponentType } from "../core/ComponentStore.js";
import type { EntityId } from "../core/EntityId.js";
import type { EventId } from "../history/EventLog.js";
import type { World } from "../persistence/WorldSnapshot.js";
import { householdMembers } from "./Relationships.js";
import { getSkillDebugState } from "./SkillProgression.js";

/**
 * P5-11: a household (this project's current real "settlement" unit,
 * P5-07's own precedent) assigns a leader through an EXPLICIT, real
 * rule -- the member with the highest total real skill level across
 * every skill it has practiced (`SkillProgression.ts`, P2-03, unmodified)
 * -- never an authored/randomly-chosen figurehead. `lastAppointmentEventId`
 * chains each new appointment's own recorded event back to the previous
 * one via `causeEventId`, so succession history is a real, walkable
 * `EventLog.traceBack` chain, the literal "preserve succession history"
 * acceptance clause.
 */
export interface Leadership {
  leaderId: EntityId;
  sinceTick: number;
  lastAppointmentEventId: EventId;
}
export const LeadershipComponent: ComponentType<Leadership> = defineComponent<Leadership>("leadership");

export function assertValidLeadership(leadership: Leadership): void {
  if (!Number.isInteger(leadership.leaderId) || leadership.leaderId < 1) {
    throw new RangeError(`leadership leaderId must be a positive integer, got ${leadership.leaderId}`);
  }
  if (!Number.isInteger(leadership.sinceTick) || leadership.sinceTick < 0) {
    throw new RangeError(`leadership sinceTick must be a non-negative integer, got ${leadership.sinceTick}`);
  }
  if (!Number.isInteger(leadership.lastAppointmentEventId) || leadership.lastAppointmentEventId < 1) {
    throw new RangeError(`leadership lastAppointmentEventId must be a positive integer, got ${leadership.lastAppointmentEventId}`);
  }
}

export function setLeadership(components: ComponentStore, householdId: EntityId, leadership: Leadership): void {
  assertValidLeadership(leadership);
  components.set(householdId, LeadershipComponent, leadership);
}

export function getLeadership(components: ComponentStore, householdId: EntityId): Leadership | undefined {
  const leadership = components.get(householdId, LeadershipComponent);
  if (leadership !== undefined) assertValidLeadership(leadership);
  return leadership;
}

function totalSkillLevel(components: ComponentStore, beaverId: EntityId): number {
  return getSkillDebugState(components, beaverId).levels.reduce((sum, entry) => sum + entry.level, 0);
}

/**
 * Real, explicit succession rule: the household's own live member with
 * the highest total skill level becomes leader. A no-op (returns the
 * existing leader's id, no new event) if that member is already the
 * current leader -- a real appointment only happens when leadership
 * genuinely CHANGES hands.
 */
export function assignLeader(world: World, householdId: EntityId): EntityId {
  const members = householdMembers(world.components, householdId).filter((id) => world.entities.isLive(id));
  if (members.length === 0) throw new RangeError(`household ${householdId} has no live members -- cannot assign a leader`);

  let bestId = members[0]!;
  let bestSkill = totalSkillLevel(world.components, bestId);
  for (const memberId of members.slice(1)) {
    const skill = totalSkillLevel(world.components, memberId);
    if (skill > bestSkill || (skill === bestSkill && memberId < bestId)) {
      bestId = memberId;
      bestSkill = skill;
    }
  }

  const current = getLeadership(world.components, householdId);
  if (current !== undefined && current.leaderId === bestId) return bestId;

  const location = world.grid.positionOf(bestId) ?? { x: 0, y: 0, z: 0 };
  const eventId = world.events.record({
    tick: world.clock.tick,
    eventType: "leader-appointed",
    subjectIds: [bestId],
    objectIds: [householdId],
    location,
    ...(current !== undefined ? { causeEventId: current.lastAppointmentEventId } : {}),
  });
  setLeadership(world.components, householdId, { leaderId: bestId, sinceTick: world.clock.tick, lastAppointmentEventId: eventId });
  return bestId;
}
