import type { EntityId } from "../core/EntityId.js";
import type { EventId } from "../history/EventLog.js";
import type { World } from "../persistence/WorldSnapshot.js";
import { getSite } from "../region/Site.js";
import { habitatMosaic, mosaicClassCounts } from "../ecology/HabitatMosaic.js";

/**
 * P11-18: cultural landscape transformation -- centuries of settlements
 * leave physical and ecological signatures a later population can
 * INSPECT, not just subjectively notice. This is a composition/query
 * layer over the real mechanisms: terrain reshaping (P11-01's recorded
 * `"watershed-advanced"` spans), ecological mosaics (P11-02's live
 * classification), abandoned and repaired constructions (P11-11's
 * per-site records and encounter events), and settlements themselves
 * (P6-06's `"site-founded"` events). Everything returned is either a
 * real recorded event or a live fact read at query time -- the same
 * no-fabrication discipline as the rest of the chronicle.
 */

export interface LandscapeSignature {
  kind: "terrain-reshaping" | "settlement" | "abandoned-structures" | "ruin-encounter" | "mosaic-state";
  description: string;
  eventIds: EventId[];
  entityIds: EntityId[];
  tick: number;
}

/** All terrain-reshaping spans recorded so far -- real events, each carrying the span's own length and applied terrain-event count. */
export function terrainReshapingSignatures(world: World): LandscapeSignature[] {
  return world.events
    .eventsOfType("watershed-advanced")
    .map((event) => ({
      kind: "terrain-reshaping" as const,
      description: `A ${event.data?.spanTicks ?? "?"}-tick watershed span reshaped terrain with ${event.data?.terrainEvents ?? 0} mass-conserving erosion/deposition events (tick ${event.tick}).`,
      eventIds: [event.id],
      entityIds: [],
      tick: event.tick,
    }))
    .sort((a, b) => a.tick - b.tick);
}

/** Every settlement this landscape has known, with its real founding event. */
export function settlementSignatures(world: World): LandscapeSignature[] {
  const signatures: LandscapeSignature[] = [];
  for (const siteId of world.entities.liveIdsOfKind("site").sort((a: EntityId, b: EntityId) => a - b)) {
    const site = getSite(world.components, siteId);
    if (site === undefined) continue;
    signatures.push({
      kind: "settlement",
      description: `Site #${siteId} at (${site.regionX}, ${site.regionZ}): founded by recorded event #${site.foundedEventId}; currently ${site.active ? "active" : "inactive"} with population ${site.populationCount} and ${site.structureCount ?? 0} structures.`,
      eventIds: [site.foundedEventId],
      entityIds: [siteId],
      tick: world.events.get(site.foundedEventId)?.tick ?? 0,
    });
  }
  return signatures.sort((a, b) => a.tick - b.tick);
}

/** The abandoned-structure records each site left behind (the physical memory of older civilizations) plus every real ruin encounter. */
export function infrastructureSignatures(world: World): LandscapeSignature[] {
  const signatures: LandscapeSignature[] = [];
  for (const siteId of world.entities.liveIdsOfKind("site").sort((a: EntityId, b: EntityId) => a - b)) {
    const site = getSite(world.components, siteId);
    if (site === undefined || site.abandonedStructures === undefined) continue;
    const breakdown = Object.entries(site.abandonedStructures)
      .map(([kind, count]) => `${count} "${kind}"`)
      .join(", ");
    signatures.push({
      kind: "abandoned-structures",
      description: `Site #${siteId} recorded abandoned structures at its last deactivation: ${breakdown}.`,
      eventIds: [site.foundedEventId],
      entityIds: [siteId],
      tick: world.events.get(site.foundedEventId)?.tick ?? 0,
    });
  }
  for (const event of world.events.eventsOfType("ruin-encountered")) {
    signatures.push({
      kind: "ruin-encounter",
      description: `A later population encountered ruin #${event.objectIds[0] ?? "?"} on tick ${event.tick} (the encounter is recorded as event #${event.id}).`,
      eventIds: [event.id],
      entityIds: [...event.objectIds],
      tick: event.tick,
    });
  }
  return signatures.sort((a, b) => a.tick - b.tick);
}

/**
 * The complete inspectable landscape history since `sinceTick` -- every
 * signature kind, oldest first. A later population can query this and
 * see exactly which settlements stood where, what they abandoned, and
 * how the terrain was reshaped -- never a subjective "it looks
 * different," always the recorded + live facts.
 */
export function landscapeHistorySince(world: World, sinceTick: number): LandscapeSignature[] {
  if (!Number.isInteger(sinceTick) || sinceTick < 0) throw new RangeError(`sinceTick must be a non-negative integer, got ${sinceTick}`);
  return [
    ...terrainReshapingSignatures(world),
    ...settlementSignatures(world),
    ...infrastructureSignatures(world),
  ]
    .filter((signature) => signature.tick >= sinceTick)
    .sort((a, b) => a.tick - b.tick);
}

/** The live ecological side: every current habitat mosaic class count (P11-02's classification, read fresh at query time -- the ecological signature the terrain reshaping left behind). */
export function currentMosaicSignature(world: World, fertilityAt: (x: number, z: number) => number): LandscapeSignature {
  const counts = mosaicClassCounts(habitatMosaic(world, fertilityAt));
  return {
    kind: "mosaic-state",
    description: `The current habitat mosaic: ${counts["open-water"]} open-water, ${counts["wetland"]} wetland, ${counts["damp-edge"]} damp-edge, ${counts["dry-land"]} dry-land columns.`,
    eventIds: [],
    entityIds: [],
    tick: world.clock.tick,
  };
}
