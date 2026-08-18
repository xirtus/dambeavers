/**
 * Frame merge (threejs_layer.md §3.4): the sim may tick several times
 * between rendered frames; each tick produces one delta frame. The
 * renderer must never lose a create/update/remove or an event because of
 * that batching, so it drains the bridge's frame queue and merges the
 * batch into ONE reconciled patch set, applied in authoritative order:
 *
 *  - upserts: last record per stable id wins (ids are never reused);
 *  - removals: an id removed in an earlier frame and never upserted later
 *    in the batch stays removed; a later upsert resurrects the record
 *    (possible only for projection-shape changes, never id reuse);
 *  - events: concatenated in tick order (they are history, not state);
 *  - dirty chunks: unioned (a chunk rebuilt once covers any number of
 *    changes);
 *  - environment/focus/counters: from the newest frame.
 */
import type { RenderFrame } from "./render-frame.js";
import type { RenderEntityRecord } from "./render-entity.js";
import type { RenderEvent } from "./render-events.js";
import type { ChunkCoordinate } from "./render-chunk.js";

function chunkKey(coord: ChunkCoordinate): string {
  return `${coord.cx},${coord.cz}`;
}

export function mergeFrames(frames: readonly RenderFrame[]): RenderFrame | undefined {
  if (frames.length === 0) return undefined;
  const latest = frames[frames.length - 1]!;

  // A full-sync frame (post-load) discards delta semantics: its upsert set
  // IS the whole world, and the renderer resets before applying it.
  if (latest.fullSync) {
    return { ...latest, entityUpserts: latest.entityUpserts, entityRemovals: [] };
  }

  const upsertById = new Map<number, RenderEntityRecord>();
  const removedIds = new Set<number>();
  const events: RenderEvent[] = [];
  const dirtyTerrain = new Map<string, ChunkCoordinate>();
  const dirtyWater = new Map<string, ChunkCoordinate>();

  for (const frame of frames) {
    for (const record of frame.entityUpserts) {
      upsertById.set(record.id, record);
      removedIds.delete(record.id); // a LATER upsert cancels an earlier removal in the batch
    }
    for (const id of frame.entityRemovals) {
      upsertById.delete(id); // a removal overrides every EARLIER upsert in the batch
      removedIds.add(id);
    }
    events.push(...frame.events);
    for (const coord of frame.dirtyTerrainChunks) dirtyTerrain.set(chunkKey(coord), coord);
    for (const coord of frame.dirtyWaterChunks) dirtyWater.set(chunkKey(coord), coord);
  }

  return {
    schemaVersion: latest.schemaVersion,
    tick: latest.tick,
    worldRevision: latest.worldRevision,
    fullSync: false,
    focus: latest.focus,
    environment: latest.environment,
    entityUpserts: [...upsertById.values()].sort((a, b) => a.id - b.id),
    entityRemovals: [...removedIds].sort((a, b) => a - b),
    dirtyTerrainChunks: [...dirtyTerrain.values()],
    dirtyWaterChunks: [...dirtyWater.values()],
    events,
    liveBeavers: latest.liveBeavers,
    liveTrees: latest.liveTrees,
    looseLogs: latest.looseLogs,
  };
}
