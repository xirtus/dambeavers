/**
 * LocalSimBridge — Mode A (threejs_layer.md §4): the authoritative sim runs
 * in-process; the bridge projects frames, maps command intents onto real
 * sim mechanisms, and answers inspection/causal queries through the real
 * DebugInspector/CausalExplanation systems. The renderer holds no `World`
 * reference -- it physically cannot reach past this boundary.
 */
import type { World } from "../../sim/persistence/WorldSnapshot.js";
import type { WorldSnapshot } from "../../sim/persistence/WorldSnapshot.js";
import type { EntityId } from "../../sim/core/EntityId.js";
import { designateTreeCut } from "../../sim/labor/TreeCutting.js";
import { designateConstruction } from "../../sim/labor/Construction.js";
import { inspectEntity, inspectCell } from "../../sim/debug/DebugInspector.js";
import { getIdentity } from "../../sim/creatures/Beaver.js";
import {
  explainDeath,
  explainUnreachable,
  explainWaterRose,
  explainPlantDeath,
  type CausalExplanation,
} from "../../sim/history/CausalExplanation.js";
import { TextUI } from "../../ui/TextUI.js";
import { getSwimmer } from "../../sim/creatures/Beaver.js";
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
import { RenderProjector } from "../projection/render-projection.js";
import {
  createPondScenario,
  restorePondScenario,
  snapshotPondScenario,
  stepPondScenarioSystems,
  type PondScenario,
} from "../scenario/pond-scenario.js";
import type { SimBridge } from "./sim-bridge.js";

export class LocalSimBridge implements SimBridge {
  private scenario: PondScenario;
  private projector: RenderProjector;
  private frame: RenderFrame;
  private readonly frameQueue: RenderFrame[] = [];
  private ui: TextUI;
  private unsubscribeTick: () => void;

  constructor(seed: string | number | undefined, snapshot?: WorldSnapshot) {
    this.scenario = snapshot === undefined ? createPondScenario(seed) : restorePondScenario(snapshot);
    this.projector = new RenderProjector(this.scenario.world, { plantSpecies: this.scenario.plantSpecies });
    this.ui = new TextUI(this.scenario.world, this.scenario.world.water);
    // The ONE authoritative clock drives the scenario systems -- exactly
    // like every headless loop in this project (SimulationClock.advance).
    this.unsubscribeTick = this.scenario.world.clock.onTick(() => {
      stepPondScenarioSystems(this.scenario);
      this.frame = this.projector.buildFrame(this.scenario.world);
      this.frameQueue.push(this.frame);
    }, "local-sim-bridge");
    this.frame = this.projector.buildFrame(this.scenario.world);
    this.frameQueue.push(this.frame); // the initial world must reach the renderer too
  }

  /** Queues a rebuilt frame for the render pump (command-driven changes outside ticks). */
  private publish(frame: RenderFrame): void {
    this.frame = frame;
    this.frameQueue.push(frame);
  }

  drainFrames(): RenderFrame[] {
    return this.frameQueue.splice(0, this.frameQueue.length);
  }

  get streamSource(): { readonly x: number; readonly z: number } {
    return this.scenario.source;
  }

  get prospectiveDamSite(): { readonly x: number; readonly z: number } {
    return this.scenario.damSite;
  }

  /** Test/harness-only escape hatch: the underlying world for assertions. The renderer NEVER receives this. */
  get worldForVerification(): World {
    return this.scenario.world;
  }

  /** Test/harness-only: the code-defined material registry (pathfinding cost queries in truth audits). */
  get materialsForVerification() {
    return this.scenario.materials;
  }

  getFrame(): RenderFrame {
    return this.frame;
  }

  getTerrainChunk(coord: ChunkCoordinate): RenderChunkTerrain {
    return this.projector.chunkProjector.terrainChunk(this.scenario.world, coord);
  }

  getWaterChunk(coord: ChunkCoordinate): RenderChunkWater {
    return this.projector.chunkProjector.waterChunk(this.scenario.world, coord);
  }

  submitCommand(command: PresentationCommand): CommandResult {
    try {
      switch (command.type) {
        case "designate-tree-cut": {
          const treeId = command.treeId as EntityId;
          if (!this.scenario.world.entities.isLive(treeId) || this.scenario.world.entities.kindOf(treeId) !== "tree") {
            return { ok: false, message: `entity ${command.treeId} is not a live tree` };
          }
          const designationId = designateTreeCut(this.scenario.world, treeId);
          this.publish(this.projector.buildFrame(this.scenario.world));
          return { ok: true, entityId: designationId as number };
        }
        case "designate-construction": {
          const id = designateConstruction(this.scenario.world, command.kind, { x: command.x, z: command.z });
          this.publish(this.projector.buildFrame(this.scenario.world));
          return { ok: true, entityId: id as number };
        }
        case "pause":
          this.ui.pause();
          this.publish(this.projector.buildFrame(this.scenario.world));
          return { ok: true };
        case "resume":
          this.ui.resume();
          this.publish(this.projector.buildFrame(this.scenario.world));
          return { ok: true };
        case "set-speed":
          this.ui.setSpeed(command.speed);
          this.publish(this.projector.buildFrame(this.scenario.world));
          return { ok: true };
        case "advance-ticks": {
          const wasPaused = this.scenario.world.clock.isPaused;
          if (wasPaused) this.scenario.world.clock.resume();
          this.scenario.world.clock.advanceTicks(command.ticks);
          if (wasPaused) {
            this.scenario.world.clock.pause();
            // The last tick's frame was built while the clock read
            // "running"; publish a fresh frame so environment.paused
            // reflects the truth again.
            this.publish(this.projector.buildFrame(this.scenario.world));
          }
          return { ok: true };
        }
        case "save":
          return { ok: true };
        case "load":
          if (command.snapshot === undefined || command.snapshot === null) {
            return { ok: false, message: "no snapshot supplied" };
          }
          this.loadSnapshot(command.snapshot);
          return { ok: true };
      }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  advance(realDeltaSeconds: number): void {
    this.scenario.world.clock.advance(realDeltaSeconds);
  }

  inspectEntity(id: StableEntityId): EntityInspectionView | undefined {
    const world = this.scenario.world;
    if (!world.entities.isKnown(id as EntityId)) return undefined;
    const raw = inspectEntity(world, id as EntityId);
    const components: Record<string, unknown> = {};
    for (const entry of raw.components) {
      components[entry.type] = entry.value;
    }
    const name = getIdentity(world.components, id as EntityId)?.name;
    return {
      id: raw.id as number,
      kind: raw.kind,
      live: raw.live,
      ...(raw.position === undefined ? {} : { position: raw.position }),
      ...(name === undefined ? {} : { name }),
      components,
      events: raw.events.map((event) => ({
        tick: event.tick,
        type: event.eventType,
        description: `${event.eventType} @ (${event.location.x}, ${event.location.y}, ${event.location.z})`,
      })),
    };
  }

  inspectCell(x: number, z: number): CellInspectionView {
    const tile = this.ui.inspectTile(x, z);
    const world = this.scenario.world;
    const surface = world.water.waterSurfaceY(x, z);
    return {
      x,
      z,
      ...(tile.groundY === undefined ? {} : { groundY: tile.groundY }),
      ...(tile.cell?.material === undefined ? {} : { material: tile.cell.material }),
      waterDepth: world.water.depthAt(x, z),
      ...(surface === undefined ? {} : { waterSurfaceY: surface }),
      occupantIds: tile.occupantIds as number[],
    };
  }

  whyAboutEntity(id: StableEntityId): ExplanationView {
    const world = this.scenario.world;
    const kind = world.entities.isKnown(id as EntityId) ? world.entities.kindOf(id as EntityId) : "unknown";
    let explanation: CausalExplanation;
    if (kind === "corpse") {
      explanation = explainDeath(world, world.water, id as EntityId);
    } else if (kind === "tree") {
      explanation = explainPlantDeath(world, id as EntityId);
    } else {
      explanation = {
        question: `What has entity ${id} (${kind}) been involved in?`,
        steps: world.events.eventsInvolving(id as EntityId).map((event) => ({
          description: `${event.eventType} at (${event.location.x}, ${event.location.y}, ${event.location.z})`,
          tick: event.tick,
          location: { x: event.location.x, z: event.location.z },
        })),
      };
    }
    return toView(explanation);
  }

  whyUnreachable(fromX: number, fromZ: number, toX: number, toZ: number): ExplanationView {
    const world = this.scenario.world;
    const explanation = explainUnreachable(world, world.water, this.scenario.materials, NON_SWIMMER_PROFILE, { x: fromX, z: fromZ }, { x: toX, z: toZ });
    return toView(explanation);
  }

  whyWaterRose(x: number, z: number): ExplanationView {
    const world = this.scenario.world;
    return toView(explainWaterRose(world, world.water, x, z));
  }

  alerts(): AlertView[] {
    return this.ui.alerts().map((alert) => ({ kind: alert.kind, entityId: alert.entityId as number, message: alert.message }));
  }

  saveSnapshot(): unknown {
    return snapshotPondScenario(this.scenario);
  }

  loadSnapshot(snapshot: unknown): void {
    this.unsubscribeTick();
    const restored = restorePondScenario(snapshot as WorldSnapshot);
    this.scenario = restored;
    this.projector = new RenderProjector(restored.world, { plantSpecies: restored.plantSpecies });
    this.ui = new TextUI(restored.world, restored.world.water);
    this.unsubscribeTick = restored.world.clock.onTick(() => {
      stepPondScenarioSystems(restored);
      this.frame = this.projector.buildFrame(restored.world);
      this.frameQueue.push(this.frame);
    }, "local-sim-bridge");
    this.frame = this.projector.buildFrame(restored.world);
    this.frameQueue.length = 0; // a load is a full rehydration: the renderer rebuilds from this frame, not stale deltas
    this.frameQueue.push(this.frame);
  }
}

/** The profile the "Why can't I path there?" query answers for -- an ordinary non-swimmer colonist, the legibility case that matters. */
export const NON_SWIMMER_PROFILE = { canSwim: false, maxWadingDepth: 1 } as const;

function toView(explanation: CausalExplanation): ExplanationView {
  return {
    question: explanation.question,
    steps: explanation.steps.map((step) => ({
      description: step.description,
      tick: step.tick,
      ...(step.location === undefined ? {} : { location: step.location }),
    })),
  };
}

export function createLocalBridge(options: { seed?: string | number; snapshot?: WorldSnapshot }): LocalSimBridge {
  return new LocalSimBridge(options.seed, options.snapshot);
}
