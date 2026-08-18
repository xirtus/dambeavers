/**
 * Damn Beavers — browser entry point. Wires the authoritative simulation
 * (through LocalSimBridge) to the Three.js world layer and the web HUD.
 *
 * URL params:
 *   ?seed=xyz           world seed (default "m0-pond-test")
 *   ?deterministic=1    fixed backend/clock/camera for capture (Law R11)
 *   ?renderer=webgl|webgpu  force backend
 *   ?audio=1            auto-start the generative score (captures with sound)
 *   ?osc=ws://host:8787 OSC bridge URL (default ws://localhost:8787)
 */
import * as THREE_WEBGPU from "three/webgpu";
import * as TSL from "three/tsl";
import { createLocalBridge } from "./presentation/bridge/local-bridge.js";
import { ThreejsApp } from "./render3d/app/threejs-app.js";
import { Hud } from "./ui/web/hud.js";
import { AudioDirector } from "./audio/audio-director.js";
import { WebAudioSynth } from "./audio/webaudio-synth.js";
import { OscClient } from "./audio/osc-client.js";
import { MidiBackend } from "./audio/midi-out.js";
import { SoundPanel } from "./audio/sound-panel.js";
import type { WorldSnapshot } from "./sim/persistence/WorldSnapshot.js";

const params = new URLSearchParams(globalThis.location.search);
const deterministic = params.get("deterministic") === "1";
const seed = params.get("seed") ?? "m0-pond-test";

async function boot(): Promise<void> {
  const canvas = document.createElement("canvas");
  canvas.id = "gl";
  document.getElementById("app")!.appendChild(canvas);
  canvas.style.width = "100%";
  canvas.style.height = "100%";

  const bridge = createLocalBridge({ seed });

  // §26 — the generative score. One conductor stream, three instruments:
  // the built-in synth, the OSC bridge, and Web MIDI. Silent until the
  // player enables sound (or ?audio=1), always observing, never writing.
  const director = new AudioDirector({ seed, bridge, listener: () => app.listenerPose() });
  const synth = new WebAudioSynth();
  const panelRef: { panel?: SoundPanel } = {};
  const osc = new OscClient({
    url: params.get("osc") ?? "ws://localhost:8787",
    onStatus: (status) => panelRef.panel?.setOscStatus(status),
  });
  const midi = new MidiBackend();
  director.registerBackend(synth);
  director.registerBackend(osc);
  director.registerBackend(midi);
  director.setMix({ master: 0.9 });
  director.restoreMix();

  const app = new ThreejsApp({
    canvas,
    bridge,
    deterministic,
    onSelectionChanged: (selection) => hud.showSelection(selection),
    onFrame: (stats) => hud.update(stats),
    onFramesMerged: (frame) => director.handleMergedFrame(frame),
    onDesignate: () => director.uiSound("ui-confirm"),
  });
  await app.init();

  const panel = new SoundPanel({ director, osc, midi });
  panelRef.panel = panel;

  const hud = new Hud(app, bridge, {
    onSave: () => {
      const snapshot = bridge.saveSnapshot();
      globalThis.localStorage.setItem("damn-beavers-save", JSON.stringify(snapshot));
      const blob = new Blob([JSON.stringify(snapshot)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `damn-beavers-day${Math.floor(bridge.getFrame().tick / 2400) + 1}.json`;
      a.click();
      URL.revokeObjectURL(url);
      director.uiSound("ui-save");
      hud.toast("Saved (browser storage + file downloaded)");
    },
    onLoad: () => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "application/json";
      input.addEventListener("change", async () => {
        const file = input.files?.[0];
        const text = file !== undefined ? await file.text() : globalThis.localStorage.getItem("damn-beavers-save");
        if (text === null || text === undefined) {
          hud.toast("No save found");
          director.uiSound("ui-error");
          return;
        }
        try {
          bridge.loadSnapshot(JSON.parse(text) as WorldSnapshot);
          director.uiSound("ui-confirm");
          hud.toast("Loaded — world rebuilt from restored simulation state");
        } catch (error) {
          hud.toast(`Load failed: ${error instanceof Error ? error.message : String(error)}`);
          director.uiSound("ui-error");
        }
      });
      // Prefer a file pick, but if the user cancels and a browser save exists, offer it implicitly next time.
      input.click();
    },
    onWhy: (target) => {
      director.uiSound("ui-toast");
      if (target.type === "entity") {
        const explanation = bridge.whyAboutEntity(target.entityId);
        hud.showWhy(explanation.question, explanation.steps);
      } else if (target.type === "cell") {
        const explanation = bridge.whyWaterRose(target.x, target.z);
        hud.showWhy(explanation.question, explanation.steps);
      }
    },
    onUiSound: (name) => director.uiSound(name),
  });

  // Deterministic capture hooks (tools/visual/capture.mjs).
  const expose = {
    app,
    bridge,
    audio: director,
    ready: true,
    advanceTicks(ticks: number): void {
      bridge.submitCommand({ type: "advance-ticks", ticks });
    },
    setCamera(name: "overview" | "pond" | "beaver-close" | "low-stream" | "dam-wall"): void {
      app.setCameraPreset(name);
    },
    designateNearestTrees(count: number): number {
      const frame = bridge.getFrame();
      const dam = bridge.prospectiveDamSite;
      const trees = frame.entityUpserts
        .filter((e) => e.kind === "tree")
        .sort((a, b) => {
          const da = Math.abs(a.x - dam.x) + Math.abs(a.z - dam.z);
          const db = Math.abs(b.x - dam.x) + Math.abs(b.z - dam.z);
          return da - db || a.id - b.id;
        });
      let designated = 0;
      for (const tree of trees.slice(0, count)) {
        const result = bridge.submitCommand({ type: "designate-tree-cut", treeId: tree.id });
        if (result.ok) designated++;
      }
      return designated;
    },
    buildDamRow(): number {
      // One designation per site per call (the sim correctly refuses a
      // second active construction at the same site); the capture suite
      // calls this once per level with ticks in between.
      const site = bridge.prospectiveDamSite;
      let placed = 0;
      for (let dx = -2; dx <= 2; dx++) {
        const result = bridge.submitCommand({ type: "designate-construction", kind: "dam-segment", x: site.x + dx, z: site.z });
        if (result.ok) placed++;
      }
      return placed;
    },
    setVisualTime(t: number): void {
      app["visualClock"].value = t;
    },
    setCameraAbsolute(x: number, y: number, z: number, distance: number, yaw: number, pitch: number): void {
      const V = Object.getPrototypeOf(app["cameraController"].camera.position).constructor as new (x: number, y: number, z: number) => never;
      app["cameraController"].setPose(new V(x, y, z) as never, distance, yaw, pitch);
    },
    instanceFingerprint(): unknown {
      const registry = app["registry"] as never as { trees: { meshes(): IterableIterator<{ count: number; instanceMatrix: { array: Float32Array } }> } };
      const out: number[] = [];
      for (const m of registry.trees.meshes()) {
        for (let i = 0; i < m.count * 16; i++) out.push(Math.round(m.instanceMatrix.array[i]! * 1e6));
      }
      return out;
    },
    sceneAudit(): unknown {
      const app2 = app as never as { roots: { scene: { traverse(cb: (o: never) => void): void } } };
      const rows: { type: string; parent: string; tris: number; count?: number }[] = [];
      app2.roots.scene.traverse((o: { type: string; geometry?: { index?: { count: number }; attributes?: { position?: { count: number } } }; count?: number; parent?: { type: string } }) => {
        if ((o.type === "Mesh" || o.type === "InstancedMesh") && o.geometry) {
          const base = o.geometry.index ? o.geometry.index.count / 3 : (o.geometry.attributes?.position?.count ?? 0) / 3;
          const instances = o.type === "InstancedMesh" ? (o.count ?? 1) : 1;
          rows.push({ type: o.type, parent: o.parent?.type ?? "", tris: Math.round(base * instances), ...(o.type === "InstancedMesh" ? { count: instances } : {}) });
        }
      });
      return rows;
    },
    beaverProbe(): unknown {
      const registry = app["registry"] as unknown as { beavers: Map<number, { group: { position: { x: number; y: number; z: number } } }> };
      return [...registry.beavers.entries()].map(([id, v]) => ({ id, pos: [v.group.position.x, v.group.position.y, v.group.position.z] }));
    },
    treeProbe(): unknown {
      const registry = app["registry"] as unknown as {
        trees: { meshes(): IterableIterator<import("three/webgpu").InstancedMesh> };
        recordOf(id: number): { x: number; y: number; z: number; kind: string; speciesId?: string } | undefined;
      };
      const frame = bridge.getFrame();
      const treeRecords = frame.entityUpserts.filter((e) => e.kind === "tree").slice(0, 5);
      const meshes = [...registry.trees.meshes()].map((m) => ({ count: m.count, visible: m.visible, inScene: m.parent !== null }));
      return { sample: treeRecords.map((t) => ({ id: t.id, x: t.x, y: t.y, z: t.z, species: t.speciesId })), meshes };
    },
  };
  (globalThis as unknown as { __app: typeof expose }).__app = expose;
  // Debug handle for visual probes (tools/visual/probe*.mjs).
  (globalThis as unknown as { __THREE: unknown }).__THREE = { ...THREE_WEBGPU, tsl: TSL };

  if (deterministic) {
    // A quiet fixed moment for captures: mid-morning light.
    bridge.submitCommand({ type: "advance-ticks", ticks: 0 });
  }

  // ?audio=1: start the score without a click (for sound-on captures and
  // kiosk runs). Browser autoplay policy may still gate the AudioContext;
  // the panel always remains the explicit path.
  if (params.get("audio") === "1") {
    director.start();
    void director.setBackendEnabled("webaudio", true);
  }
}

void boot();
