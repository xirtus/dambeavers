/**
 * Frame projection (threejs_layer.md §3.1/§3.4): composes entity + chunk +
 * environment projections into immutable RenderFrames with delta semantics
 * (full upsert set on first frame, create/update/remove patches after).
 */
import type { World } from "../../sim/persistence/WorldSnapshot.js";
import { dayNightPhase, isDaytime, ambientTemperature } from "../../sim/weather/Weather.js";
import { RENDER_CONTRACT_VERSION, type RenderFrame } from "../contracts/render-frame.js";
import type { RenderEntityRecord } from "../contracts/render-entity.js";
import type { RenderEvent, RenderEventKind } from "../contracts/render-events.js";
import { EntityProjector, type EntityProjectionContext } from "./entity-projection.js";
import { ChunkProjector } from "./chunk-projection.js";

/** EventLog event types worth surfacing to the renderer as feedback hooks. */
const EVENT_KIND_MAP: Readonly<Record<string, RenderEventKind>> = {
  "tree-felled": "tree-felled",
  "dam-segment-applied": "dam-segment-applied",
  "drowning-death": "death",
  "construction-completed": "construction-complete",
};

export class RenderProjector {
  private readonly entities: EntityProjector;
  private readonly chunks: ChunkProjector;
  private worldRevision = 1;
  private lastEventCount = 0;
  private lastEmittedRevision = 0;
  private firstFrame = true;

  constructor(world: World, context: EntityProjectionContext) {
    this.entities = new EntityProjector(context);
    this.chunks = new ChunkProjector(world);
  }

  get chunkProjector(): ChunkProjector {
    return this.chunks;
  }

  /** Builds the next frame. Always recomputed from live state -- frames are cheap; chunk PAYLOADS are demand-loaded through the bridge. */
  buildFrame(world: World): RenderFrame {
    const { records, liveProjectedIds } = this.entities.projectAll(world);
    const removals = this.entities.removalsFor(liveProjectedIds);
    const { dirtyTerrain, dirtyWater } = this.chunks.scan(world);

    // True delta semantics (§3.4): per-entity revisions bump only on
    // content change, so the upsert set is exactly the records whose
    // projection changed since the last frame (full set on first frame).
    const changed: RenderEntityRecord[] = this.firstFrame
      ? records
      : records.filter((record) => record.revision > this.lastEmittedRevision);
    let maxRevision = this.lastEmittedRevision;
    for (const record of records) {
      if (record.revision > maxRevision) maxRevision = record.revision;
    }
    this.lastEmittedRevision = maxRevision;

    const events = this.collectEvents(world);
    const environment = {
      tick: world.clock.tick,
      dayPhase: dayNightPhase(world.clock.tick),
      isDaytime: isDaytime(world.clock.tick),
      weatherCondition: world.weather.condition,
      ambientTemperature: ambientTemperature(world.clock.tick),
      paused: world.clock.isPaused,
      speed: world.clock.speed,
    };

    const frame: RenderFrame = {
      schemaVersion: RENDER_CONTRACT_VERSION,
      tick: world.clock.tick,
      worldRevision: this.worldRevision++,
      fullSync: this.firstFrame,
      focus: { sizeX: world.grid.dims.sizeX, sizeY: world.grid.dims.sizeY, sizeZ: world.grid.dims.sizeZ },
      environment,
      entityUpserts: changed,
      entityRemovals: removals,
      dirtyTerrainChunks: dirtyTerrain,
      dirtyWaterChunks: dirtyWater,
      events,
      liveBeavers: world.entities.liveIdsOfKind("beaver").length,
      liveTrees: world.entities.liveIdsOfKind("tree").length,
      looseLogs: world.entities.liveIdsOfKind("log").length,
    };
    this.firstFrame = false;
    return frame;
  }

  /** Projects EventLog entries recorded since the last frame into renderer feedback events. Read-only; history stays authoritative in the sim. */
  private collectEvents(world: World): RenderEvent[] {
    const total = world.events.count;
    if (total <= this.lastEventCount) return [];
    const recent = world.events.all().slice(this.lastEventCount);
    this.lastEventCount = total;
    const result: RenderEvent[] = [];
    for (const event of recent) {
      const kind = EVENT_KIND_MAP[event.eventType];
      if (kind === undefined) continue;
      result.push({
        kind,
        tick: event.tick,
        entityIds: [...event.subjectIds, ...event.objectIds] as number[],
        location: event.location,
      });
    }
    return result;
  }
}
