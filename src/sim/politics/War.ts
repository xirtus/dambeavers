import { ComponentStore, defineComponent, type ComponentType } from "../core/ComponentStore.js";
import type { EntityId } from "../core/EntityId.js";
import type { EventId } from "../history/EventLog.js";
import type { World } from "../persistence/WorldSnapshot.js";
import { battlesOfWar } from "./Battle.js";
import { overlappingClaimCells, getTerritoryClaim, setTerritoryClaim, registerClaimWithPolity } from "./Territory.js";
import { signTreaty } from "./Diplomacy.js";
import type { RegionCoordinate } from "../region/RegionMap.js";

/**
 * P7-16: a war is ONE historically tracked composition of real battles
 * and real territorial/political objectives -- a persistent `"war"`
 * entity declared for a REAL cause (territorial overlap, raid
 * escalation, a broken treaty -- each an actual recorded event), whose
 * battles are real `Battle` entities (P7-15) attached to it, and whose
 * end is a real recorded outcome: territory genuinely changes hands
 * (the loser's claims shrink, the winner's grow -- ordinary claim
 * entities, P7-07), a real peace treaty is signed (P7-06), and the
 * whole arc is queryable as real events (`war-declared` ->
 * `battle-began`/`battle-ended` -> `territory-ceded` -> `war-ended`).
 */

export type WarCauseKind = "territory" | "raid-escalation" | "broken-treaty";

export interface WarOutcome {
  winnerSiteId?: EntityId;
  cededCellCount: number;
}

export interface War {
  participantIds: readonly [EntityId, EntityId];
  causeKind: WarCauseKind;
  causeEventId: EventId;
  declaredEventId: EventId;
  status: "ongoing" | "ended";
  endedEventId?: EventId;
  outcome?: WarOutcome;
}
export const WarComponent: ComponentType<War> = defineComponent<War>("war");

const WAR_CAUSE_KINDS: readonly WarCauseKind[] = ["territory", "raid-escalation", "broken-treaty"];

export function assertValidWar(war: War): void {
  if (war.participantIds.length !== 2) throw new RangeError(`war must have exactly two participants, got ${war.participantIds.length}`);
  if (war.participantIds[0] === war.participantIds[1]) throw new RangeError(`war participants must differ, both ${war.participantIds[0]}`);
  for (const participantId of war.participantIds) {
    if (!Number.isInteger(participantId) || participantId < 1) throw new RangeError(`war participant ids must be positive integers, got ${participantId}`);
  }
  if (!WAR_CAUSE_KINDS.includes(war.causeKind)) throw new RangeError(`war causeKind must be one of ${WAR_CAUSE_KINDS.join(", ")}, got ${JSON.stringify(war.causeKind)}`);
  if (!Number.isInteger(war.causeEventId) || war.causeEventId < 1) throw new RangeError(`war causeEventId must be a positive integer, got ${war.causeEventId}`);
  if (!Number.isInteger(war.declaredEventId) || war.declaredEventId < 1) throw new RangeError(`war declaredEventId must be a positive integer, got ${war.declaredEventId}`);
  if (war.status !== "ongoing" && war.status !== "ended") throw new RangeError(`war status must be ongoing/ended, got ${JSON.stringify(war.status)}`);
  if (war.status === "ended" && (war.endedEventId === undefined || !Number.isInteger(war.endedEventId) || war.endedEventId < 1)) {
    throw new RangeError(`an ended war must carry a positive endedEventId, got ${war.endedEventId}`);
  }
  if (war.status === "ongoing" && war.endedEventId !== undefined) throw new RangeError("an ongoing war must not carry an endedEventId");
  if (war.outcome !== undefined) {
    if (war.outcome.winnerSiteId !== undefined && (!Number.isInteger(war.outcome.winnerSiteId) || war.outcome.winnerSiteId < 1)) {
      throw new RangeError(`war outcome winnerSiteId must be a positive integer when present, got ${war.outcome.winnerSiteId}`);
    }
    if (!Number.isInteger(war.outcome.cededCellCount) || war.outcome.cededCellCount < 0) {
      throw new RangeError(`war outcome cededCellCount must be a non-negative integer, got ${war.outcome.cededCellCount}`);
    }
  }
}

export function setWar(components: ComponentStore, warId: EntityId, war: War): void {
  assertValidWar(war);
  const normalized: War = {
    participantIds: [war.participantIds[0], war.participantIds[1]],
    causeKind: war.causeKind,
    causeEventId: war.causeEventId,
    declaredEventId: war.declaredEventId,
    status: war.status,
  };
  if (war.endedEventId !== undefined) normalized.endedEventId = war.endedEventId;
  if (war.outcome !== undefined) {
    normalized.outcome = {
      cededCellCount: war.outcome.cededCellCount,
      ...(war.outcome.winnerSiteId !== undefined ? { winnerSiteId: war.outcome.winnerSiteId } : {}),
    };
  }
  components.set(warId, WarComponent, normalized);
}

export function getWar(components: ComponentStore, warId: EntityId): War | undefined {
  const war = components.get(warId, WarComponent);
  if (war !== undefined) assertValidWar(war);
  return war;
}

/**
 * Declares a real war between two settlements for a REAL cause: the
 * `causeEventId` must be an actual recorded event naming at least one
 * participant (the contested territorial claim, the raid, the broken
 * treaty -- a claim event names its claimer, and the conflict IS the
 * other side's contested ground). Records `"war-declared"` chained to
 * that cause. One ongoing war per participant pair (a second
 * declaration for the same pair is a no-op returning the existing war).
 */
export function declareWar(world: World, siteAId: EntityId, siteBId: EntityId, causeKind: WarCauseKind, causeEventId: EventId): EntityId {
  for (const warId of world.components.query(WarComponent)) {
    const war = getWar(world.components, warId);
    if (war !== undefined && war.status === "ongoing" && war.participantIds.includes(siteAId) && war.participantIds.includes(siteBId)) return warId;
  }
  const causeEvent = world.events.get(causeEventId);
  const involved = new Set([...causeEvent.subjectIds, ...causeEvent.objectIds]);
  if (!involved.has(siteAId) && !involved.has(siteBId)) {
    throw new RangeError(`war cause event ${causeEventId} does not involve either participant ${siteAId} or ${siteBId}`);
  }
  const warId = world.entities.create("war");
  const declaredEventId = world.events.record({
    tick: world.clock.tick,
    eventType: "war-declared",
    subjectIds: [siteAId, siteBId],
    objectIds: [warId],
    location: { x: 0, y: 0, z: 0 },
    causeEventId,
  });
  setWar(world.components, warId, {
    participantIds: [siteAId, siteBId],
    causeKind,
    causeEventId,
    declaredEventId,
    status: "ongoing",
  });
  return warId;
}

/** Attaches an existing battle to a war (real composition: the war's battles are its battles, P7-15's entity gains the war reference). */
export function attachBattleToWar(world: World, battleId: EntityId, warId: EntityId): void {
  const war = getWar(world.components, warId);
  if (war === undefined) throw new RangeError(`unknown war ${warId}`);
  if (war.status !== "ongoing") throw new RangeError(`war ${warId} has ended -- cannot attach new battles`);
  const battle = getBattleFor(world, battleId);
  if (battle === undefined) throw new RangeError(`unknown battle ${battleId}`);
  setBattleFor(world, battleId, { ...battle, warId });
}

import { getBattle, setBattle } from "./Battle.js";
function getBattleFor(world: World, battleId: EntityId) {
  return getBattle(world.components, battleId);
}
function setBattleFor(world: World, battleId: EntityId, battle: ReturnType<typeof getBattleFor>): void {
  if (battle !== undefined) setBattle(world.components, battleId, battle);
}

/**
 * Ends a war with a real outcome: the contested (overlapping) territory
 * genuinely changes hands -- each loser claim is rewritten without the
 * contested cells, the winner gains a real claim of them, a
 * `"territory-ceded"` event records each cession (chained to the war
 * end), a real peace treaty is signed (P7-06), and `"war-ended"` fires
 * chained to the war's declaration. Returns the war-ended event id.
 */
export function endWar(world: World, warId: EntityId, winnerSiteId?: EntityId): EventId {
  const war = getWar(world.components, warId);
  if (war === undefined) throw new RangeError(`unknown war ${warId}`);
  if (war.status === "ended") throw new RangeError(`war ${warId} has already ended`);

  const contested = overlappingClaimCells(world, war.participantIds[0], war.participantIds[1]);
  const loserId = winnerSiteId !== undefined && winnerSiteId === war.participantIds[0] ? war.participantIds[1]
    : winnerSiteId !== undefined && winnerSiteId === war.participantIds[1] ? war.participantIds[0]
    : undefined;

  const endedEventId = world.events.record({
    tick: world.clock.tick,
    eventType: "war-ended",
    subjectIds: [...war.participantIds],
    objectIds: [warId, ...(winnerSiteId !== undefined ? [winnerSiteId] : [])],
    location: { x: 0, y: 0, z: 0 },
    causeEventId: war.declaredEventId,
  });

  // Real territorial consequence: contested cells move from loser to winner.
  let cededCellCount = 0;
  if (loserId !== undefined && winnerSiteId !== undefined && contested.length > 0) {
    const contestedKeys = new Set(contested.map((cell) => `${cell.regionX},${cell.regionZ}`));
    const rewrittenClaimIds: EntityId[] = [];
    for (const claimId of world.components.query(TerritoryClaimMarker).sort((a, b) => a - b)) {
      const claim = getTerritoryClaim(world.components, claimId);
      if (claim === undefined || claim.ownerSiteId !== loserId) continue;
      const keptXs: number[] = [];
      const keptZs: number[] = [];
      for (let i = 0; i < claim.regionXs.length; i++) {
        if (!contestedKeys.has(`${claim.regionXs[i]},${claim.regionZs[i]}`)) {
          keptXs.push(claim.regionXs[i]!);
          keptZs.push(claim.regionZs[i]!);
        }
      }
      setTerritoryClaim(world.components, claimId, {
        ownerSiteId: claim.ownerSiteId,
        regionXs: keptXs,
        regionZs: keptZs,
        sinceTick: claim.sinceTick,
        claimEventId: claim.claimEventId,
      });
      rewrittenClaimIds.push(claimId);
    }
    const winnerClaimId = world.entities.create("territory-claim");
    const winnerClaimEventId = world.events.record({
      tick: world.clock.tick,
      eventType: "territory-claimed",
      subjectIds: [winnerSiteId, winnerClaimId],
      location: { x: 0, y: 0, z: 0 },
      causeEventId: endedEventId,
    });
    setTerritoryClaim(world.components, winnerClaimId, {
      ownerSiteId: winnerSiteId,
      regionXs: contested.map((cell) => cell.regionX),
      regionZs: contested.map((cell) => cell.regionZ),
      sinceTick: world.clock.tick,
      claimEventId: winnerClaimEventId,
    });
    registerClaimWithPolity(world, winnerSiteId, winnerClaimId);
    cededCellCount = contested.length;
    world.events.record({
      tick: world.clock.tick,
      eventType: "territory-ceded",
      subjectIds: [loserId],
      objectIds: [winnerSiteId, warId],
      location: { x: 0, y: 0, z: 0 },
      causeEventId: endedEventId,
      // P8-07: the exact ceded cells and the exact rewritten claims are
      // recorded at the moment they change, so a political map at any
      // past date is reconstructible from recorded history alone.
      data: {
        cells: contested.map((cell) => ({ regionX: cell.regionX, regionZ: cell.regionZ })),
        claimIds: rewrittenClaimIds,
      },
    });
  }

  const ended: War = {
    ...war,
    status: "ended",
    endedEventId,
    outcome: { cededCellCount, ...(winnerSiteId !== undefined ? { winnerSiteId } : {}) },
  };
  setWar(world.components, warId, ended);

  signTreaty(world, [...war.participantIds], "peace", endedEventId);
  return endedEventId;
}

import { TerritoryClaimComponent } from "./Territory.js";
const TerritoryClaimMarker = TerritoryClaimComponent;

/** The war's real battles, oldest first (P7-15's own query). */
export function warBattles(world: World, warId: EntityId): EntityId[] {
  return battlesOfWar(world, warId);
}

/** The war's full real history: declaration, its battles, cessions, and end -- as recorded events, in record order. */
export function warHistory(world: World, warId: EntityId) {
  const events = [
    ...world.events.eventsOfType("war-declared").filter((e) => e.objectIds.includes(warId)),
    ...world.events.eventsOfType("war-ended").filter((e) => e.objectIds.includes(warId)),
    ...world.events.eventsOfType("territory-ceded").filter((e) => e.objectIds.includes(warId)),
  ];
  for (const battleId of battlesOfWar(world, warId)) {
    events.push(...world.events.eventsOfType("battle-began").filter((e) => e.objectIds.includes(battleId)));
    events.push(...world.events.eventsOfType("battle-ended").filter((e) => e.objectIds.includes(battleId)));
  }
  return events.sort((a, b) => a.tick - b.tick || a.id - b.id);
}

/** The war's real territorial stake: the cells its participants currently both claim. */
export function warContestedTerritory(world: World, warId: EntityId): RegionCoordinate[] {
  const war = getWar(world.components, warId);
  if (war === undefined) return [];
  return overlappingClaimCells(world, war.participantIds[0], war.participantIds[1]);
}
