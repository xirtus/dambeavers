import type { EntityId } from "../core/EntityId.js";
import type { EventId } from "../history/EventLog.js";
import type { World } from "../persistence/WorldSnapshot.js";
import { territoryTension } from "./Territory.js";
import { diplomaticStanding } from "./Diplomacy.js";

/**
 * P7-16's real "territorial/political objectives" side: war causes are
 * DISCOVERED from real state -- territorial overlap (P7-07's own real
 * tension) combined with genuinely hostile standing (P7-06) -- never
 * authored. `territorialWarCause` returns the real recorded event a
 * territory war should chain from: the most recent territorial claim
 * by either side over contested ground.
 */

export const WAR_TENSION_THRESHOLD = 0.25;
export const WAR_HOSTILITY_THRESHOLD = -0.3;

/**
 * The real cause for a territorial war between two settlements, if one
 * exists: their real territorial tension at/above threshold AND their
 * real diplomatic standing at/below the hostility threshold. The
 * returned event id is a REAL recorded claim event (the most recent
 * contested claim) -- the war's causal root, walkable via
 * `EventLog.traceBack`.
 */
export function territorialWarCause(world: World, siteAId: EntityId, siteBId: EntityId): EventId | undefined {
  const tension = territoryTension(world, siteAId, siteBId);
  if (tension < WAR_TENSION_THRESHOLD) return undefined;
  const standing = diplomaticStanding(world, siteAId, siteBId);
  if (standing > WAR_HOSTILITY_THRESHOLD) return undefined;
  let latest: EventId | undefined;
  for (const event of world.events.eventsOfType("territory-claimed")) {
    if (!event.subjectIds.includes(siteAId) && !event.subjectIds.includes(siteBId)) continue;
    if (latest === undefined || event.tick > world.events.get(latest).tick) latest = event.id;
  }
  return latest;
}
