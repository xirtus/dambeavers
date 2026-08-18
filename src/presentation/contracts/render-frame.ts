/**
 * RENDER CONTRACT — the frame (threejs_layer.md §3.1).
 *
 * One `RenderFrame` is the renderer's whole view of the world at one
 * authoritative tick: environment facts + entity patches + chunk
 * revisions. Frames are immutable, JSON-plain, and cheap to diff against
 * (`worldRevision`, per-record revisions). Chunk PAYLOADS are requested
 * separately per chunk (they are large and change rarely) via
 * `SimBridge.getTerrainChunk/getWaterChunk`.
 */
import type { RenderEntityRecord } from "./render-entity.js";
import type { RenderEvent } from "./render-events.js";
import type { ChunkCoordinate } from "./render-chunk.js";

export const RENDER_CONTRACT_VERSION = 1;

export interface RenderEnvironment {
  /** Authoritative sim tick. */
  readonly tick: number;
  /** [0,1) phase of the day from the real clock (Weather.dayNightPhase). */
  readonly dayPhase: number;
  readonly isDaytime: boolean;
  /** Real weather state ("clear" | "rain" | "storm"). */
  readonly weatherCondition: string;
  /** Real ambient temperature [0,1]-ish (Weather.ambientTemperature). */
  readonly ambientTemperature: number;
  readonly paused: boolean;
  readonly speed: number;
}

export interface RenderFocus {
  /** World bounds, so the renderer can frame the map without scanning state. */
  readonly sizeX: number;
  readonly sizeY: number;
  readonly sizeZ: number;
}

export interface RenderFrame {
  readonly schemaVersion: number;
  readonly tick: number;
  /** Bumped whenever ANY projected state changes; the renderer fast-paths identical revisions. */
  readonly worldRevision: number;
  /**
   * True on the first frame after (re)load: the upsert set is the COMPLETE
   * projected world and the renderer must DROP every existing visual and
   * rebuild from this frame (Law R8). Without it, entities that existed
   * only after a save point would linger as ghost visuals post-load.
   */
  readonly fullSync: boolean;
  readonly focus: RenderFocus;
  readonly environment: RenderEnvironment;
  /** Full upsert set on first frame after (re)load; afterwards only entities whose projection changed. */
  readonly entityUpserts: readonly RenderEntityRecord[];
  readonly entityRemovals: readonly number[];
  /** Chunks whose terrain/water revision changed since the previous frame. */
  readonly dirtyTerrainChunks: readonly ChunkCoordinate[];
  readonly dirtyWaterChunks: readonly ChunkCoordinate[];
  /** Renderer-relevant events recorded since the previous frame. */
  readonly events: readonly RenderEvent[];
  /** Convenience counters for HUD/debug (live-derived, never cached state). */
  readonly liveBeavers: number;
  readonly liveTrees: number;
  readonly looseLogs: number;
}
