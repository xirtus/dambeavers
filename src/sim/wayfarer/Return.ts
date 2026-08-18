import type { EntityId } from "../core/EntityId.js";
import type { World } from "../persistence/WorldSnapshot.js";
import { releaseControl, isPlayerControlled, getPlayerControl } from "./Control.js";
import { getCompanion, dismissCompanion, companionsOf } from "./Companions.js";

/**
 * P9-10: return to colony/world mode -- changes made during Wayfarer
 * remain true when returning to colony/history views, because there is
 * nothing to convert: the controlled character IS an ordinary beaver in
 * the ordinary world, every verb mutated ordinary components and
 * recorded ordinary events, and "returning" is just releasing the
 * decision-source override. The colony loop then ticks the same beaver
 * through the same arbitration it always used, and Chronicle reads the
 * same records. This module is deliberately small -- its size IS the
 * proof that no parallel state exists to reconcile.
 */

export interface ReturnSummary {
  beaverId: EntityId;
  wasControlled: boolean;
  pendingCommandDropped: boolean;
  companionsDismissed: EntityId[];
  eventCount: number;
}

/**
 * Releases control and returns the beaver to ordinary AI. Any pending
 * player command is dropped (the player has left the driver's seat --
 * their intent is not the beaver's own), companions are dismissed with
 * an honest recorded reason, and everything else stays exactly as it
 * is: the same components, the same event log, the same world.
 */
export function resumeColonyMode(world: World, beaverId: EntityId): ReturnSummary {
  const wasControlled = isPlayerControlled(world.components, beaverId);
  const pendingCommandDropped = getPlayerControl(world.components, beaverId)?.pending !== undefined;
  const companions = companionsOf(world.components, beaverId);
  for (const companionId of companions) {
    dismissCompanion(world, companionId, "the player returned to colony mode");
  }
  if (wasControlled) releaseControl(world, beaverId);
  return {
    beaverId,
    wasControlled,
    pendingCommandDropped,
    companionsDismissed: companions,
    eventCount: world.events.count,
  };
}
