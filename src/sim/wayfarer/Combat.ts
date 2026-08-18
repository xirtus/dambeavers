import type { EntityId } from "../core/EntityId.js";
import type { EventId } from "../history/EventLog.js";
import type { World } from "../persistence/WorldSnapshot.js";
import type { MaterialRegistry } from "../materials/Material.js";
import type { RandomStream } from "../core/Random.js";
import { resolveBattleExchange, type BattleExchangeResolution } from "../politics/Battle.js";

/**
 * P9-06: direct-control combat resolves through the SAME anatomy/
 * material systems as simulated battles -- literally the same function:
 * `resolveBattleExchange` (extracted from P7-15's own `tickBattle`
 * loop and exported by it). A player attack is one ordinary battle
 * exchange: the attacker's equipped weapon force x their real combat
 * skill, against the defender's equipped armor and their own struck
 * tissue, with the ordinary mortality machinery when health reaches
 * zero. The only addition here is the adventure-context record
 * (`"wayfarer-attack"`, chained to the wound) so the deed is
 * searchable in Chronicle like any other.
 */

export interface PlayerAttackResult extends BattleExchangeResolution {
  eventIds: EventId[];
}

/**
 * One player-controlled attack: the SAME exchange primitive a simulated
 * battle round uses, plus a real adventure-context event. Returns the
 * ordinary exchange resolution (part struck, severity, whether the
 * defender died).
 */
export function playerAttack(
  world: World,
  materials: MaterialRegistry,
  attackerId: EntityId,
  defenderId: EntityId,
  random: RandomStream,
  causeEventId?: EventId,
): PlayerAttackResult {
  const resolution = resolveBattleExchange(world, materials, attackerId, defenderId, random, causeEventId);
  const attackEventId = world.events.record({
    tick: world.clock.tick,
    eventType: "wayfarer-attack",
    subjectIds: [attackerId],
    objectIds: [defenderId],
    location: world.grid.positionOf(defenderId) ?? world.grid.positionOf(attackerId) ?? { x: 0, y: 0, z: 0 },
    ...(resolution.woundEventId !== undefined ? { causeEventId: resolution.woundEventId } : {}),
    data: {
      partId: resolution.partId,
      severity: resolution.severity,
      wounded: resolution.wounded,
      defenderDied: resolution.defenderDied,
    },
  });
  return { ...resolution, eventIds: [attackEventId] };
}
