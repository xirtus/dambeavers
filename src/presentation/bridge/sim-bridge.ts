/**
 * SimBridge (threejs_layer.md §4): the ONLY interface between the 3D
 * renderer/UI and the authoritative simulation. Implementations: local
 * in-process (Mode A, built first), web worker (Mode B), websocket
 * (Mode C). The renderer is written against this interface exclusively,
 * so topology can change without touching render code.
 *
 * Everything crossing this boundary is immutable/JSON-plain contract data.
 */
import type { RenderFrame } from "../contracts/render-frame.js";
import type { ChunkCoordinate, RenderChunkTerrain, RenderChunkWater } from "../contracts/render-chunk.js";
import type { PresentationCommand, CommandResult } from "../contracts/commands.js";
import type {
  AlertView,
  CellInspectionView,
  EntityInspectionView,
  ExplanationView,
} from "../contracts/queries.js";
import type { StableEntityId } from "../contracts/render-entity.js";

export interface SimBridge {
  /** The latest projected frame (rebuilt after every authoritative tick and on demand). Never drains the frame queue. */
  getFrame(): RenderFrame;
  /**
   * Drains every frame produced since the last drain (one per
   * authoritative tick, plus command-driven rebuilds). The render loop
   * merges these via `mergeFrames` so no create/update/remove or event is
   * ever lost to tick batching.
   */
  drainFrames(): RenderFrame[];
  /** Demand-load one chunk's packed terrain payload (large; only fetched when its revision changes). */
  getTerrainChunk(coord: ChunkCoordinate): RenderChunkTerrain;
  getWaterChunk(coord: ChunkCoordinate): RenderChunkWater;

  submitCommand(command: PresentationCommand): CommandResult;

  inspectEntity(id: StableEntityId): EntityInspectionView | undefined;
  inspectCell(x: number, z: number): CellInspectionView;
  /** The flagship causal query: grounded explanation chains from the real CausalExplanation system. */
  whyAboutEntity(id: StableEntityId): ExplanationView;
  whyUnreachable(fromX: number, fromZ: number, toX: number, toZ: number): ExplanationView;
  whyWaterRose(x: number, z: number): ExplanationView;
  alerts(): AlertView[];

  /** Deterministic simulation-advance hook for the render loop: real seconds -> authoritative ticks. */
  advance(realDeltaSeconds: number): void;

  /** Save/load through the real persistence path (snapshotWorld/restoreWorld). */
  saveSnapshot(): unknown;
  loadSnapshot(snapshot: unknown): void;

  /** Water source column (scenario metadata for debug overlays). */
  readonly streamSource: { readonly x: number; readonly z: number };
  readonly prospectiveDamSite: { readonly x: number; readonly z: number };
}
