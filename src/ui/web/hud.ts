/**
 * Web HUD (threejs_layer.md §16): the 3D world is primary; panels reveal
 * density on demand. Dark glass, amber accents (lodge-at-dusk palette).
 * Every control talks to the bridge -- never to sim internals (Law R6).
 */
import type { SimBridge } from "../../presentation/bridge/sim-bridge.js";
import type { EntityInspectionView, CellInspectionView } from "../../presentation/contracts/queries.js";
import type { ThreejsApp, ToolKind, FrameStats } from "../../render3d/app/threejs-app.js";
import type { PickResult } from "../../render3d/interaction/picking.js";

const CSS = `
  #hud { position: fixed; inset: 0; pointer-events: none; font-family: "Avenir Next", "Segoe UI", system-ui, sans-serif; color: #e8e0d0; z-index: 10; }
  #hud .bar { position: absolute; display: flex; gap: 6px; align-items: center; background: rgba(14, 17, 22, 0.78); backdrop-filter: blur(10px); border: 1px solid rgba(232, 200, 130, 0.16); border-radius: 10px; padding: 7px 10px; pointer-events: auto; }
  #hud #topbar { top: 12px; left: 50%; transform: translateX(-50%); }
  #hud #tools { left: 12px; top: 50%; transform: translateY(-50%); flex-direction: column; }
  #hud button { background: rgba(46, 52, 62, 0.85); color: #e8e0d0; border: 1px solid rgba(232, 200, 130, 0.22); border-radius: 7px; padding: 6px 11px; font: inherit; font-size: 13px; cursor: pointer; transition: background 0.15s, border-color 0.15s; }
  #hud button:hover { background: rgba(74, 84, 98, 0.95); }
  #hud button.active { background: rgba(176, 124, 42, 0.9); border-color: #f0c060; color: #fff8ea; }
  #hud button:disabled { opacity: 0.45; cursor: default; }
  #hud .stat { font-size: 13px; padding: 0 6px; white-space: nowrap; }
  #hud .stat b { color: #f0c060; font-weight: 600; }
  #hud #panel { position: absolute; right: 12px; top: 64px; width: 320px; max-height: calc(100% - 140px); overflow-y: auto; background: rgba(14, 17, 22, 0.85); backdrop-filter: blur(12px); border: 1px solid rgba(232, 200, 130, 0.18); border-radius: 12px; padding: 14px 16px; pointer-events: auto; display: none; }
  #hud #panel h2 { margin: 0 0 2px; font-size: 17px; color: #f5d9a0; }
  #hud #panel h3 { margin: 12px 0 4px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: #a89880; }
  #hud #panel .sub { color: #9d9480; }
  #hud #panel .row { display: flex; justify-content: space-between; font-size: 13px; padding: 2px 0; }
  #hud #panel .row .k { color: #a89880; }
  #hud #panel .mono { font-family: ui-monospace, monospace; font-size: 12px; color: #b8ac90; }
  #hud #panel .why-steps { font-size: 12.5px; line-height: 1.55; color: #d8ccb2; }
  #hud #panel .why-steps li { margin-bottom: 5px; }
  #hud #events { position: absolute; bottom: 12px; left: 50%; transform: translateX(-50%); display: flex; flex-direction: column-reverse; gap: 4px; align-items: center; pointer-events: none; }
  #hud #events .toast { background: rgba(14, 17, 22, 0.82); border: 1px solid rgba(232, 200, 130, 0.2); border-radius: 8px; padding: 5px 12px; font-size: 12.5px; color: #e8d8b0; animation: fadein 0.25s ease-out; }
  @keyframes fadein { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; } }
  #hud #alerts { position: absolute; top: 64px; left: 12px; display: flex; flex-direction: column; gap: 5px; pointer-events: auto; max-width: 300px; }
  #hud #alerts .alert { background: rgba(80, 30, 22, 0.88); border: 1px solid rgba(240, 120, 90, 0.4); border-radius: 8px; padding: 6px 10px; font-size: 12.5px; }
  #hud kbd { background: rgba(255,255,255,0.09); border-radius: 4px; padding: 1px 5px; font-size: 11px; font-family: ui-monospace, monospace; }
  #hud .tool-label { font-size: 10.5px; color: #a89880; text-align: center; margin-top: -3px; }
`;

export class Hud {
  private readonly root: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private readonly events: HTMLDivElement;
  private readonly alertsBox: HTMLDivElement;
  private readonly toolButtons = new Map<ToolKind, HTMLButtonElement>();
  private readonly timeStat: HTMLSpanElement;
  private readonly popStat: HTMLSpanElement;
  private readonly treeStat: HTMLSpanElement;
  private readonly perfStat: HTMLSpanElement;
  private alertSignature = "";

  constructor(
    private readonly app: ThreejsApp,
    private readonly bridge: SimBridge,
    private readonly callbacks: {
      onSave: () => void;
      onLoad: () => void;
      onWhy: (target: PickResult) => void;
      /** Interface sounds (§26): the UI's own small voice — tool switches, toasts. */
      onUiSound?: (name: "ui-confirm" | "ui-tool" | "ui-error" | "ui-save" | "ui-toast") => void;
    },
  ) {
    const style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);

    this.root = document.createElement("div");
    this.root.id = "hud";
    document.body.appendChild(this.root);

    // -- top bar --
    const topbar = document.createElement("div");
    topbar.className = "bar";
    topbar.id = "topbar";
    this.root.appendChild(topbar);

    this.timeStat = this.stat("Day 1");
    topbar.appendChild(this.timeStat);

    const pauseBtn = this.button("▶ Play", () => {
      const frame = this.bridge.getFrame();
      this.bridge.submitCommand({ type: frame.environment.paused ? "resume" : "pause" });
    });
    pauseBtn.id = "pause-btn";
    topbar.appendChild(pauseBtn);

    for (const speed of [1, 4, 8]) {
      const btn = this.button(`${speed}×`, () => {
        this.bridge.submitCommand({ type: "resume" });
        this.bridge.submitCommand({ type: "set-speed", speed });
        refreshSpeed();
      });
      btn.dataset["speed"] = String(speed);
      topbar.appendChild(btn);
    }
    const refreshSpeed = () => {
      const current = this.bridge.getFrame().environment.speed;
      for (const btn of topbar.querySelectorAll("button[data-speed]")) {
        btn.classList.toggle("active", Number((btn as HTMLElement).dataset["speed"]) === current);
      }
      pauseBtn.textContent = this.bridge.getFrame().environment.paused ? "▶ Play" : "⏸ Pause";
    };
    this.refreshSpeed = refreshSpeed;

    this.popStat = this.stat("🦫 7");
    this.treeStat = this.stat("🌲 0");
    topbar.appendChild(this.popStat);
    topbar.appendChild(this.treeStat);
    this.perfStat = this.stat("");
    topbar.appendChild(this.perfStat);

    topbar.appendChild(this.button("💾 Save", callbacks.onSave));
    topbar.appendChild(this.button("📂 Load", callbacks.onLoad));

    // -- tools --
    const tools = document.createElement("div");
    tools.className = "bar";
    tools.id = "tools";
    this.root.appendChild(tools);
    const addTool = (tool: ToolKind, label: string, keyHint: string) => {
      const btn = this.button(label, () => this.setTool(tool));
      tools.appendChild(btn);
      const hint = document.createElement("div");
      hint.className = "tool-label";
      hint.innerHTML = `<kbd>${keyHint}</kbd>`;
      tools.appendChild(hint);
      this.toolButtons.set(tool, btn);
    };
    addTool("inspect", "🔍 Inspect", "I");
    addTool("cut-tree", "🪓 Cut tree", "C");
    addTool("build-dam", "🌊 Build dam", "B");
    tools.appendChild(this.button("💧 Water data", () => this.app.toggleHydrologyDebug()));
    tools.appendChild(this.button("🎥 Follow", () => this.app.followSelection()));
    this.setTool("inspect");

    // -- inspector panel --
    this.panel = document.createElement("div");
    this.panel.id = "panel";
    this.root.appendChild(this.panel);

    // -- event toasts --
    this.events = document.createElement("div");
    this.events.id = "events";
    this.root.appendChild(this.events);

    // -- alerts --
    this.alertsBox = document.createElement("div");
    this.alertsBox.id = "alerts";
    this.root.appendChild(this.alertsBox);

    window.addEventListener("keydown", (e) => {
      if (e.code === "KeyI") this.setTool("inspect");
      if (e.code === "KeyC") this.setTool("cut-tree");
      if (e.code === "KeyB") this.setTool("build-dam");
      if (e.code === "Space") {
        e.preventDefault();
        pauseBtn.click();
      }
    });
  }

  private refreshSpeed: () => void;

  setTool(tool: ToolKind): void {
    this.app.setTool(tool);
    for (const [kind, btn] of this.toolButtons) btn.classList.toggle("active", kind === tool);
    this.callbacks.onUiSound?.("ui-tool");
  }

  private button(label: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.addEventListener("click", onClick);
    return btn;
  }

  private stat(html: string): HTMLSpanElement {
    const span = document.createElement("span");
    span.className = "stat";
    span.innerHTML = html;
    return span;
  }

  toast(message: string): void {
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = message;
    this.events.appendChild(el);
    setTimeout(() => el.remove(), 5200);
    while (this.events.children.length > 5) this.events.firstChild?.remove();
    this.callbacks.onUiSound?.("ui-toast");
  }

  /** Per-frame HUD refresh from the latest frame + stats. */
  update(stats: FrameStats): void {
    const frame = this.bridge.getFrame();
    const day = Math.floor(frame.tick / 2400) + 1;
    const phase = frame.environment.dayPhase;
    const hhTotal = phase * 24;
    const hh = Math.floor(hhTotal);
    const mm = Math.floor((hhTotal - hh) * 60);
    this.timeStat.innerHTML = `Day <b>${day}</b> · ${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")} ${frame.environment.paused ? "· ⏸" : ""}`;
    this.popStat.innerHTML = `🦫 <b>${stats.liveBeavers}</b>`;
    this.treeStat.innerHTML = `🌲 <b>${stats.liveTrees}</b>`;
    this.perfStat.innerHTML = `<b>${stats.fps}</b> fps · ${stats.drawCalls} dc · ${(stats.triangles / 1000).toFixed(0)}k tri · ${stats.backend}`;
    this.refreshSpeed();

    const alerts = this.bridge.alerts();
    const signature = alerts.map((a) => `${a.kind}:${a.entityId}`).join("|");
    if (signature !== this.alertSignature) {
      this.alertSignature = signature;
      this.alertsBox.replaceChildren(...alerts.slice(0, 6).map((a) => {
        const el = document.createElement("div");
        el.className = "alert";
        el.textContent = `⚠ ${a.message}`;
        el.style.cursor = "pointer";
        el.addEventListener("click", () => {
          this.app.selectEntity(a.entityId);
          this.app.followSelection();
        });
        return el;
      }));
    }
  }

  /** Render the inspector for the current selection. */
  showSelection(selection: PickResult | undefined): void {
    if (selection === undefined) {
      this.panel.style.display = "none";
      return;
    }
    this.panel.style.display = "block";
    if (selection.type === "entity") {
      const view = this.bridge.inspectEntity(selection.entityId);
      if (view === undefined) {
        this.panel.style.display = "none";
        return;
      }
      this.renderEntityInspector(view);
    } else {
      this.renderCellInspector(this.bridge.inspectCell(selection.x, selection.z));
    }
  }

  private renderEntityInspector(view: EntityInspectionView): void {
    const rows: string[] = [];
    rows.push(`<h2>${escapeHtml(view.name ?? view.kind)}</h2>`);
    rows.push(`<div class="mono">#${view.id} · ${escapeHtml(view.kind)} · ${view.live ? "live" : "gone"}</div>`);
    if (view.position !== undefined) {
      rows.push(`<div class="row"><span class="k">Position</span><span>${view.position.x}, ${view.position.y}, ${view.position.z}</span></div>`);
    }
    const components = view.components;
    const needs = components["needs"] as { hunger: number; thirst: number; fatigue: number; thermalComfort: number } | undefined;
    if (needs !== undefined) {
      rows.push(`<h3>Needs</h3>`);
      rows.push(this.meter("Hunger", 1 - needs.hunger));
      rows.push(this.meter("Thirst", 1 - needs.thirst));
      rows.push(this.meter("Rested", 1 - needs.fatigue));
      rows.push(this.meter("Warmth", 1 - needs.thermalComfort));
    }
    const health = components["health"] as { fraction: number } | undefined;
    if (health !== undefined) {
      rows.push(this.meter("Health", health.fraction));
    }
    const plant = components["plant"] as { speciesId: string; ageTicks: number; health: number } | undefined;
    if (plant !== undefined) {
      rows.push(`<div class="row"><span class="k">Species</span><span>${escapeHtml(plant.speciesId)}</span></div>`);
      rows.push(this.meter("Health", plant.health));
    }
    const log = components["log"] as { materialId: string; massKg: number } | undefined;
    if (log !== undefined) {
      rows.push(`<div class="row"><span class="k">Material</span><span>${escapeHtml(log.materialId)}</span></div>`);
      rows.push(`<div class="row"><span class="k">Mass</span><span>${log.massKg.toFixed(1)} kg</span></div>`);
    }
    const construction = components["construction"] as { kind: string; status: string; workDone: number; workRequired: number } | undefined;
    if (construction !== undefined) {
      rows.push(`<div class="row"><span class="k">Structure</span><span>${escapeHtml(construction.kind)}</span></div>`);
      rows.push(`<div class="row"><span class="k">Status</span><span>${escapeHtml(construction.status)}</span></div>`);
      rows.push(this.meter("Work", construction.workRequired > 0 ? construction.workDone / construction.workRequired : 0));
    }
    if (view.events.length > 0) {
      rows.push(`<h3>History</h3>`);
      for (const event of view.events.slice(-6)) {
        rows.push(`<div class="mono">t${event.tick} ${escapeHtml(event.type)}</div>`);
      }
    }
    this.panel.innerHTML = rows.join("");
    const why = document.createElement("button");
    why.textContent = "❓ Why?";
    why.style.marginTop = "10px";
    why.style.width = "100%";
    why.addEventListener("click", () => this.callbacks.onWhy({ type: "entity", entityId: view.id, kind: view.kind, point: { x: view.position?.x ?? 0, y: view.position?.y ?? 0, z: view.position?.z ?? 0 } }));
    this.panel.appendChild(why);
  }

  private renderCellInspector(view: CellInspectionView): void {
    const rows: string[] = [];
    rows.push(`<h2>Cell ${view.x}, ${view.z}</h2>`);
    rows.push(`<div class="mono">ground y = ${view.groundY ?? "—"}</div>`);
    if (view.material !== undefined) rows.push(`<div class="row"><span class="k">Material</span><span>${escapeHtml(view.material)}</span></div>`);
    rows.push(`<div class="row"><span class="k">Water depth</span><span>${view.waterDepth.toFixed(3)}</span></div>`);
    if (view.waterSurfaceY !== undefined) rows.push(`<div class="row"><span class="k">Surface y</span><span>${view.waterSurfaceY.toFixed(2)}</span></div>`);
    if (view.occupantIds.length > 0) {
      rows.push(`<h3>Occupants</h3>`);
      for (const id of view.occupantIds) {
        rows.push(`<div class="mono" data-occupant="${id}" style="cursor:pointer">#${id}</div>`);
      }
    }
    this.panel.innerHTML = rows.join("");
    for (const el of this.panel.querySelectorAll("[data-occupant]")) {
      el.addEventListener("click", () => {
        this.app.selectEntity(Number((el as HTMLElement).dataset["occupant"]));
        this.showSelection(this.app.getSelection());
      });
    }
    if (view.waterDepth > 0) {
      const why = document.createElement("button");
      why.textContent = "❓ Why is water here?";
      why.style.marginTop = "10px";
      why.style.width = "100%";
      why.addEventListener("click", () => this.callbacks.onWhy({ type: "cell", x: view.x, z: view.z, groundY: view.groundY ?? 0, point: { x: view.x, y: view.waterSurfaceY ?? 0, z: view.z } }));
      this.panel.appendChild(why);
    }
  }

  showWhy(question: string, steps: readonly { description: string; tick: number }[]): void {
    this.panel.style.display = "block";
    const items = steps.map((s) => `<li><span class="mono">t${s.tick}</span> ${escapeHtml(s.description)}</li>`).join("");
    this.panel.innerHTML = `<h2>Why?</h2><div class="sub" style="margin-bottom:8px">${escapeHtml(question)}</div><ol class="why-steps">${items}</ol>`;
    const back = document.createElement("button");
    back.textContent = "← Back";
    back.style.width = "100%";
    back.addEventListener("click", () => this.showSelection(this.app.getSelection()));
    this.panel.appendChild(back);
  }

  private meter(label: string, fraction: number): string {
    const pct = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
    const hue = pct > 55 ? "150" : pct > 25 ? "38" : "8";
    return `<div class="row"><span class="k">${label}</span><span style="display:inline-flex;align-items:center;gap:6px"><span style="display:inline-block;width:90px;height:7px;background:rgba(255,255,255,0.08);border-radius:4px;overflow:hidden"><span style="display:block;height:100%;width:${pct}%;background:hsl(${hue} 60% 55%)"></span></span>${pct}%</span></div>`;
  }
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
