/**
 * ThreejsApp — the composition root of the 3D layer. Owns the render loop
 * and every visual subsystem; talks to the simulation ONLY through a
 * SimBridge (Law R6). Frame pump per render frame:
 *
 *   drain authoritative delta frames -> mergeFrames -> reconcile
 *   (terrain/water/entities) -> interpolate visuals -> render.
 *
 * Deterministic mode (Law R11): pinned visual clock, fixed camera poses,
 * and window.__app hooks used by tools/visual/capture.mjs.
 */
import { Vector2, Vector3, Color } from "three/webgpu";
import type { SimBridge } from "../../presentation/bridge/sim-bridge.js";
import { mergeFrames } from "../../presentation/contracts/frame-merge.js";
import type { RenderEntityRecord } from "../../presentation/contracts/render-entity.js";
import { createRenderer, QUALITY_TIERS, type CreatedRenderer } from "../renderer/create-renderer.js";
import { createSceneRoots, type SceneRoots } from "./scene-root.js";
import { createLightingRig, type LightingRig } from "../lighting/lighting-rig.js";
import { createNoiseTexture } from "../materials/noise-texture.js";
import { createVisualClock } from "../materials/visual-clock.js";
import { TerrainChunkManager } from "../world/terrain/terrain-chunk-manager.js";
import { WaterManager } from "../world/water/water-manager.js";
import { EntityVisualRegistry } from "../entities/registry/entity-visual-registry.js";
import { CameraController } from "../camera/camera-controller.js";
import { pick, type PickResult } from "../interaction/picking.js";
import { ParticleSystem } from "../effects/particles.js";
import { SelectionHighlight } from "../overlays/selection-highlight.js";
import { HydrologyDebugOverlay } from "../debug/hydrology-debug.js";

export type ToolKind = "inspect" | "cut-tree" | "build-dam";

export interface AppOptions {
  readonly canvas: HTMLCanvasElement;
  readonly bridge: SimBridge;
  readonly deterministic?: boolean;
  readonly seed?: string | number;
  readonly onSelectionChanged?: (selection: PickResult | undefined) => void;
  readonly onFrame?: (stats: FrameStats) => void;
}

export interface FrameStats {
  readonly tick: number;
  readonly fps: number;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly liveBeavers: number;
  readonly liveTrees: number;
  readonly backend: string;
}

export class ThreejsApp {
  private created!: CreatedRenderer;
  private roots!: SceneRoots;
  private lighting!: LightingRig;
  private terrain!: TerrainChunkManager;
  private water!: WaterManager;
  private registry!: EntityVisualRegistry;
  private cameraController!: CameraController;
  private particles!: ParticleSystem;
  private highlight!: SelectionHighlight;
  private debugOverlay!: HydrologyDebugOverlay;
  private visualClock = createVisualClock();
  private readonly deterministic: boolean;
  private tool: ToolKind = "inspect";
  private selection: PickResult | undefined;
  private lastTime = 0;
  private visualTime = 0;
  private fps = 0;
  private frameCount = 0;
  private fpsTime = 0;
  private disposed = false;
  private input = { panX: 0, panZ: 0, rotate: 0, pitch: 0, zoomDelta: 0 };
  private keys = new Set<string>();
  private pointerNdc = new Vector2();
  private dragging: "rotate" | "pan" | undefined;
  /** Authoritative tick duration in seconds (for interpolation pacing). */
  private tickSeconds = 1 / 20;
  private lastInterpTick = -1;

  constructor(private readonly options: AppOptions) {
    this.deterministic = options.deterministic ?? false;
  }

  async init(): Promise<void> {
    const bridge = this.options.bridge;
    this.created = await createRenderer({
      canvas: this.options.canvas,
      deterministic: this.deterministic,
      ...(this.deterministic ? { forceBackend: "webgl" as const } : {}),
      quality: QUALITY_TIERS[2]!,
    });
    this.roots = createSceneRoots();
    const focus = bridge.getFrame().focus;
    const mapRadius = Math.max(focus.sizeX, focus.sizeZ) * 0.75;

    this.lighting = createLightingRig({ shadowMapSize: this.created.settings.shadowMapSize, mapRadius });
    this.roots.scene.add(this.lighting.skyMesh, this.lighting.sun, this.lighting.sun.target, this.lighting.hemisphere);

    const noise = createNoiseTexture();
    this.terrain = new TerrainChunkManager(bridge, this.roots.terrainRoot, noise);
    this.water = new WaterManager(bridge, this.roots.waterRoot, {
      sky: this.lighting.skyUniforms,
      noise,
      timeU: this.visualClock,
      deepColor: [0.012, 0.075, 0.09],
      shallowColor: [0.08, 0.27, 0.27],
    });
    this.registry = new EntityVisualRegistry({ entityRoot: this.roots.entityRoot, vegetationRoot: this.roots.vegetationRoot }, noise, this.visualClock);
    this.cameraController = new CameraController(this.options.canvas.clientWidth / Math.max(1, this.options.canvas.clientHeight));
    this.particles = new ParticleSystem(this.roots.effectsRoot, noise);
    this.highlight = new SelectionHighlight(this.roots.overlayRoot);
    this.debugOverlay = new HydrologyDebugOverlay(this.roots.debugRoot);

    this.lighting.setDayPhase(0.4, 0.7, focus.sizeX / 2, focus.sizeZ / 2);

    this.bindInput();
    this.created.renderer.setAnimationLoop((time) => this.frame(time));
  }

  get stats(): FrameStats {
    const info = this.created.renderer.info;
    const frame = this.options.bridge.getFrame();
    return {
      tick: frame.tick,
      fps: Math.round(this.fps),
      drawCalls: info.render.drawCalls,
      triangles: info.render.triangles,
      liveBeavers: frame.liveBeavers,
      liveTrees: frame.liveTrees,
      backend: this.created.backend,
    };
  }

  setTool(tool: ToolKind): void {
    this.tool = tool;
  }

  get currentTool(): ToolKind {
    return this.tool;
  }

  getSelection(): PickResult | undefined {
    return this.selection;
  }

  selectEntity(entityId: number): void {
    const record = this.registry.recordOf(entityId);
    if (record === undefined) return;
    this.selection = { type: "entity", entityId, kind: record.kind, point: { x: record.x, y: record.y, z: record.z } };
    this.highlight.showEntity(this.registry, entityId);
    this.options.onSelectionChanged?.(this.selection);
  }

  /** Deterministic capture support: fixed camera poses over real state. */
  setCameraPreset(name: "overview" | "pond" | "beaver-close" | "low-stream" | "dam-wall"): void {
    const focus = this.options.bridge.getFrame().focus;
    const cx = focus.sizeX / 2;
    const cz = focus.sizeZ / 2;
    switch (name) {
      case "overview":
        this.cameraController.setPose(new Vector3(cx, 7, cz), 52, 0.65, 0.95);
        break;
      case "pond":
        this.cameraController.setPose(new Vector3(this.options.bridge.prospectiveDamSite.x, 7, this.options.bridge.prospectiveDamSite.z), 20, 0.4, 0.5);
        break;
      case "beaver-close": {
        const record = [...this.registry.allRecords()].find((r) => r.kind === "beaver");
        const pos = record !== undefined ? new Vector3(record.x, record.y, record.z) : new Vector3(cx, 8, cz);
        this.cameraController.setPose(pos, 4.5, 0.9, 0.32);
        break;
      }
      case "low-stream": {
        // Aim at real open water: scan the water chunks near the dam site
        // for a deep wet column, then sit just above its surface looking
        // downstream. Never lands inside foliage like a fixed offset can.
        const site = this.options.bridge.prospectiveDamSite;
        let best = { x: site.x, z: site.z - 4, depth: 0 };
        for (const coord of this.options.bridge.getFrame().dirtyWaterChunks.length > 0 ? [] : []) void coord;
        for (let dz = -8; dz <= 2; dz++) {
          for (let dx = -6; dx <= 6; dx++) {
            const cell = this.options.bridge.inspectCell(site.x + dx, site.z + dz);
            if (cell.waterDepth > best.depth) best = { x: site.x + dx, z: site.z + dz, depth: cell.waterDepth };
          }
        }
        const surface = best.depth > 0 ? (this.options.bridge.inspectCell(best.x, best.z).waterSurfaceY ?? 6) + 1 : 6;
        this.cameraController.setPose(new Vector3(best.x, surface + 0.9, best.z), 9, 2.85, 0.18);
        break;
      }
      case "dam-wall": {
        const site = this.options.bridge.prospectiveDamSite;
        this.cameraController.setPose(new Vector3(site.x, 6.5, site.z), 15, 0.35, 0.3);
        break;
      }
    }
  }

  toggleHydrologyDebug(): void {
    this.debugOverlay.toggle(this.water);
  }

  focusOn(x: number, y: number, z: number): void {
    this.cameraController.focusOn(new Vector3(x, y, z));
  }

  followSelection(): void {
    const sel = this.selection;
    if (sel?.type === "entity") {
      const id = sel.entityId;
      this.cameraController.follow(() => this.registry.beaverVisual(id)?.renderPosition);
    }
  }

  stopFollow(): void {
    this.cameraController.stopFollow();
  }

  private frame(timeMs: number): void {
    if (this.disposed) return;
    const dt = Math.min(0.1, this.lastTime === 0 ? 1 / 60 : (timeMs - this.lastTime) / 1000);
    this.lastTime = timeMs;
    this.frameCount++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      this.fps = this.frameCount / this.fpsTime;
      this.frameCount = 0;
      this.fpsTime = 0;
    }

    const bridge = this.options.bridge;

    // 1. Advance the authoritative sim by real elapsed time (clock applies pause/speed).
    if (!this.deterministic) {
      bridge.advance(dt);
    }

    // 2. Drain + merge delta frames; reconcile visuals.
    const drained = bridge.drainFrames();
    const merged = mergeFrames(drained);
    if (merged !== undefined) {
      if (merged.fullSync) {
        // Law R8: a (re)load reconstructs visuals SOLELY from restored
        // simulation state -- every visual registry resets first.
        this.registry.clear();
        this.terrain.clear();
        this.water.clear();
      }
      this.terrain.syncTerrain(merged.dirtyTerrainChunks);
      this.terrain.syncWater(merged.dirtyWaterChunks);
      this.water.sync(merged.dirtyWaterChunks);
      for (const record of merged.entityUpserts) this.applyRecord(record);
      for (const id of merged.entityRemovals) this.registry.remove(id);
      this.lighting.setDayPhase(merged.environment.dayPhase, merged.environment.ambientTemperature, merged.focus.sizeX / 2, merged.focus.sizeZ / 2);
      this.tickSeconds = 1 / (20 * Math.max(1e-6, merged.environment.speed));
      this.registry.tickSeconds = this.tickSeconds;
      for (const event of merged.events) this.applyEventEffects(event.kind, event.location.x, event.location.y, event.location.z);
      if (merged.tick !== this.lastInterpTick) this.lastInterpTick = merged.tick;
    }

    // 3. Visual-only updates.
    if (!this.deterministic) {
      this.visualTime += dt;
      this.visualClock.value = this.visualTime;
    }
    this.registry.update(dt, this.visualClock.value);
    this.particles.update(dt);
    this.applyActivityEffects(dt);
    this.highlight.update(this.registry);

    // 4. Camera.
    const input = this.consumeInput(dt);
    this.cameraController.update(dt, input);

    // 5. Render.
    this.created.renderer.render(this.roots.scene, this.cameraController.camera);
    this.options.onFrame?.(this.stats);
  }

  private applyRecord(record: RenderEntityRecord): void {
    // Splash when a beaver's activity really becomes swimming.
    const previous = this.registry.recordOf(record.id);
    this.registry.upsert(record);
    if (record.kind === "beaver" && previous !== undefined && previous.activity !== "swimming" && record.activity === "swimming") {
      this.particles.burstSplash(record.x + 0.5, record.y + 0.1, record.z + 0.5);
    }
  }

  private applyEventEffects(kind: string, x: number, y: number, z: number): void {
    if (kind === "tree-felled") {
      this.particles.burstWoodChips(x + 0.5, y + 1, z + 0.5);
    } else if (kind === "dam-segment-applied" || kind === "construction-complete") {
      this.particles.burstDust(x + 0.5, y + 1, z + 0.5);
    }
  }

  /** Wood chips fly while a real cut job works (activity projected from real progress components). */
  private applyActivityEffects(dt: number): void {
    this.effectAccum += dt;
    if (this.effectAccum < 0.22) return;
    this.effectAccum = 0;
    for (const record of this.registry.allRecords()) {
      if (record.kind === "beaver" && record.activity === "cutting-tree") {
        // Chips at the beaver's position, drifting toward where it faces.
        this.particles.burstWoodChips(record.x + 0.5, record.y + 0.6, record.z + 0.5);
      }
    }
  }

  private effectAccum = 0;

  private consumeInput(dt: number): { panX: number; panZ: number; rotate: number; pitch: number; zoomDelta: number } {
    const speed = 1.6;
    let panX = 0;
    let panZ = 0;
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) panZ -= speed;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) panZ += speed;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) panX -= speed;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) panX += speed;
    if (this.keys.has("KeyQ")) this.input.rotate -= speed * 1.4;
    if (this.keys.has("KeyE")) this.input.rotate += speed * 1.4;
    const consumed = { panX, panZ, rotate: this.input.rotate, pitch: this.input.pitch, zoomDelta: this.input.zoomDelta };
    this.input.rotate = 0;
    this.input.pitch = 0;
    this.input.zoomDelta = 0;
    void dt;
    return consumed;
  }

  private bindInput(): void {
    const canvas = this.options.canvas;
    canvas.addEventListener("pointerdown", (e) => {
      canvas.setPointerCapture(e.pointerId);
      if (e.button === 2 || e.button === 1) this.dragging = "pan";
      else if (e.button === 0 && (e.shiftKey || e.altKey)) this.dragging = "rotate";
      else if (e.button === 0) this.handleClick(e);
    });
    canvas.addEventListener("pointermove", (e) => {
      const rect = canvas.getBoundingClientRect();
      this.pointerNdc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      if (this.dragging === "rotate") {
        this.input.rotate += e.movementX * 0.005 * 60 * 0.016 * 10;
        this.input.pitch += e.movementY * 0.005 * 60 * 0.016 * 10;
      } else if (this.dragging === "pan") {
        this.cameraController.dragPan(e.movementX, e.movementY);
      }
    });
    canvas.addEventListener("pointerup", (e) => {
      this.dragging = undefined;
      canvas.releasePointerCapture(e.pointerId);
    });
    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.input.zoomDelta += Math.sign(e.deltaY) * -1;
    }, { passive: false });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener("keydown", (e) => {
      this.keys.add(e.code);
      if (e.code === "Escape") {
        this.selection = undefined;
        this.highlight.hide();
        this.options.onSelectionChanged?.(undefined);
        this.cameraController.stopFollow();
      }
      if (e.code === "KeyF") this.followSelection();
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
  }

  private handleClick(e: MouseEvent): void {
    if (this.dragging !== undefined) return;
    const result = pick(this.pointerNdc, this.cameraController.camera, {
      terrainMeshes: () => this.terrain.meshes(),
      waterMeshes: () => this.water.pickMeshes(),
      registry: this.registry,
      treeMeshes: () => this.registry.trees.meshes(),
      logMesh: () => this.registry.logs.poolMesh(),
    });
    if (result === undefined) {
      if (this.tool === "inspect") {
        this.selection = undefined;
        this.highlight.hide();
        this.options.onSelectionChanged?.(undefined);
      }
      return;
    }
    this.applyToolToPick(result);
  }

  private applyToolToPick(result: PickResult): void {
    const bridge = this.options.bridge;
    switch (this.tool) {
      case "inspect":
        this.selection = result;
        if (result.type === "entity") this.highlight.showEntity(this.registry, result.entityId);
        else this.highlight.showCell(result.x, result.z, result.groundY);
        this.options.onSelectionChanged?.(result);
        break;
      case "cut-tree":
        if (result.type === "entity" && result.kind === "tree") {
          bridge.submitCommand({ type: "designate-tree-cut", treeId: result.entityId });
          this.highlight.flashEntity(this.registry, result.entityId);
        }
        break;
      case "build-dam": {
        const x = result.type === "cell" ? result.x : Math.floor(result.point.x);
        const z = result.type === "cell" ? result.z : Math.floor(result.point.z);
        bridge.submitCommand({ type: "designate-construction", kind: "dam-segment", x, z });
        break;
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    this.created.renderer.setAnimationLoop(null);
  }
}
