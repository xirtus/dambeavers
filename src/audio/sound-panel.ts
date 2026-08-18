/**
 * The sound panel (ARCHITECTURE_CONTRACT §26): player-facing control of
 * the generative score. Same dark-glass/amber language as the HUD. Sound
 * begins ONLY from a real click here (browser autoplay honesty): the
 * first press of "Enable sound" creates the AudioContext, starts the
 * conductor's pump, and voices the world's identity — root, mode family,
 * tempo — so the player can hear (and see) what this world's music IS.
 */
import type { AudioDirector } from "./audio-director.js";
import type { OscClient } from "./osc-client.js";
import type { MidiBackend } from "./midi-out.js";

const NOTE_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"] as const;

const CSS = `
  #sound-root { position: fixed; right: 12px; bottom: 12px; z-index: 11; font-family: "Avenir Next", "Segoe UI", system-ui, sans-serif; color: #e8e0d0; }
  #sound-root .sound-toggle { background: rgba(14, 17, 22, 0.78); backdrop-filter: blur(10px); border: 1px solid rgba(232, 200, 130, 0.16); border-radius: 10px; padding: 7px 11px; color: inherit; font: inherit; font-size: 13px; cursor: pointer; }
  #sound-root .sound-toggle.on { background: rgba(176, 124, 42, 0.9); border-color: #f0c060; color: #fff8ea; }
  #sound-root .sound-panel { display: none; margin-top: 6px; width: 260px; background: rgba(14, 17, 22, 0.87); backdrop-filter: blur(12px); border: 1px solid rgba(232, 200, 130, 0.18); border-radius: 12px; padding: 12px 14px; font-size: 13px; }
  #sound-root .sound-panel.open { display: block; }
  #sound-root h2 { margin: 0 0 2px; font-size: 15px; color: #f5d9a0; }
  #sound-root .identity { color: #a89880; font-size: 11.5px; margin-bottom: 8px; }
  #sound-root label.slider { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 2px 0; }
  #sound-root label.slider span { color: #a89880; font-size: 12px; width: 74px; }
  #sound-root input[type="range"] { flex: 1; accent-color: #b07c2a; height: 18px; }
  #sound-root .backend { display: flex; align-items: center; gap: 7px; padding: 3px 0; }
  #sound-root .backend .status { font-size: 11px; color: #a89880; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #sound-root .dot { width: 7px; height: 7px; border-radius: 50%; background: #5a5248; flex: none; }
  #sound-root .dot.on { background: #8fd07a; }
  #sound-root .dot.err { background: #e07850; }
  #sound-root input[type="text"], #sound-root select { background: rgba(46,52,62,0.85); color: #e8e0d0; border: 1px solid rgba(232,200,130,0.2); border-radius: 6px; font-size: 11.5px; padding: 3px 6px; width: 100%; margin-top: 3px; }
  #sound-root .enable { width: 100%; margin-bottom: 8px; background: rgba(46,52,62,0.85); color: #e8e0d0; border: 1px solid rgba(232,200,130,0.25); border-radius: 7px; padding: 7px; font: inherit; cursor: pointer; }
  #sound-root .enable:hover { background: rgba(74,84,98,0.95); }
  #sound-root .enable.on { background: rgba(176,124,42,0.9); border-color: #f0c060; color: #fff8ea; }
`;

export interface SoundPanelOptions {
  readonly director: AudioDirector;
  readonly osc: OscClient;
  readonly midi: MidiBackend;
}

export class SoundPanel {
  private readonly root: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private readonly toggle: HTMLButtonElement;
  private enabled = false;
  private oscDot: HTMLSpanElement | undefined;

  constructor(private readonly options: SoundPanelOptions) {
    const style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);

    this.root = document.createElement("div");
    this.root.id = "sound-root";
    document.body.appendChild(this.root);

    this.toggle = document.createElement("button");
    this.toggle.className = "sound-toggle";
    this.toggle.textContent = "🔇 Sound";
    this.toggle.title = "Sound on/off and score settings";
    this.toggle.addEventListener("click", () => this.panel.classList.toggle("open"));
    this.root.appendChild(this.toggle);

    this.panel = document.createElement("div");
    this.panel.className = "sound-panel";
    this.root.appendChild(this.panel);
    this.render();
  }

  private render(): void {
    const { director, osc, midi } = this.options;
    const identity = director.conductor.identity;
    const rootName = NOTE_NAMES[identity.root % 12]!;
    this.panel.replaceChildren();

    const title = document.createElement("h2");
    title.textContent = "Generative score";
    this.panel.appendChild(title);
    const idLine = document.createElement("div");
    idLine.className = "identity";
    idLine.textContent = `world tune · ${rootName} ${identity.family.id} · ${identity.bpm} bpm`;
    this.panel.appendChild(idLine);

    const enable = document.createElement("button");
    enable.className = `enable${this.enabled ? " on" : ""}`;
    enable.textContent = this.enabled ? "🔊 Sound on — click to silence" : "🔇 Enable sound";
    enable.addEventListener("click", () => {
      // The click IS the autoplay-policy gesture; never auto-called.
      void this.setEnabled(!this.enabled);
    });
    this.panel.appendChild(enable);

    // -- mixer --
    const mix = director.getMix();
    const sliders: Array<[keyof typeof mix, string]> = [
      ["master", "Master"],
      ["music", "Music"],
      ["ambience", "Ambience"],
      ["sfx", "Work & hits"],
      ["ui", "Interface"],
    ];
    for (const [key, label] of sliders) {
      const row = document.createElement("label");
      row.className = "slider";
      const name = document.createElement("span");
      name.textContent = label;
      const input = document.createElement("input");
      input.type = "range";
      input.min = "0";
      input.max = "1";
      input.step = "0.01";
      input.value = String(mix[key]);
      input.addEventListener("input", () => director.setMix({ [key]: Number(input.value) }));
      row.appendChild(name);
      row.appendChild(input);
      this.panel.appendChild(row);
    }

    // -- backends --
    this.panel.appendChild(hr());
    this.panel.appendChild(this.backendRow("webaudio", "Built-in synth", "wood & water, offline"));
    const oscRow = this.backendRow("osc", "OSC bridge", "SuperCollider / Max / Pd");
    this.oscDot = oscRow.querySelector<HTMLSpanElement>(".dot") ?? undefined;
    this.panel.appendChild(oscRow);
    {
      const url = document.createElement("input");
      url.type = "text";
      url.value = osc.currentUrl;
      url.spellcheck = false;
      url.title = "tools/audio/osc-bridge.mjs WebSocket URL";
      url.addEventListener("change", () => osc.setUrl(url.value));
      this.panel.appendChild(url);
    }
    this.panel.appendChild(this.backendRow("midi", "MIDI out", "DAW / hardware synth"));
    {
      const select = document.createElement("select");
      const refresh = (): void => {
        const outputs = midi.listOutputs();
        select.replaceChildren(...outputs.map((o) => {
          const option = document.createElement("option");
          option.value = o.id;
          option.textContent = o.name;
          return option;
        }));
        if (outputs.length === 0) {
          const option = document.createElement("option");
          option.textContent = "(no outputs — enable MIDI to scan)";
          select.appendChild(option);
        }
      };
      select.addEventListener("change", () => midi.selectOutput(select.value));
      select.addEventListener("focus", refresh);
      refresh();
      this.panel.appendChild(select);
    }
  }

  private backendRow(name: "webaudio" | "osc" | "midi", label: string, hint: string): HTMLDivElement {
    const row = document.createElement("div");
    row.className = "backend";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = this.options.director.isBackendEnabled(name);
    const dot = document.createElement("span");
    dot.className = "dot";
    const text = document.createElement("span");
    text.className = "status";
    text.textContent = `${label} — ${hint}`;
    checkbox.addEventListener("change", () => {
      void this.options.director
        .setBackendEnabled(name, checkbox.checked)
        .then(() => {
          dot.className = `dot${checkbox.checked ? " on" : ""}`;
          if (name === "midi" && checkbox.checked) this.render(); // refresh output list
        })
        .catch(() => {
          checkbox.checked = false; // the instrument refused — stay honest
        });
    });
    row.appendChild(checkbox);
    row.appendChild(dot);
    row.appendChild(text);
    return row;
  }

  private async setEnabled(on: boolean): Promise<void> {
    this.enabled = on;
    this.toggle.classList.toggle("on", on);
    this.toggle.textContent = on ? "🔊 Sound" : "🔇 Sound";
    if (on) {
      this.options.director.start();
      // Re-enable the instruments the player had chosen (synth always; OSC/MIDI restored).
      const wanted = this.previouslyEnabled ?? ["webaudio"];
      for (const name of wanted) {
        try {
          await this.options.director.setBackendEnabled(name, true);
        } catch {
          // instrument unavailable — its checkbox simply renders unchecked
        }
      }
    } else {
      this.previouslyEnabled = this.options.director.backendNames().filter((n) => this.options.director.isBackendEnabled(n));
      for (const name of this.options.director.backendNames()) {
        await this.options.director.setBackendEnabled(name, false);
      }
      this.options.director.stop();
    }
    const wasOpen = this.panel.classList.contains("open");
    this.render();
    if (wasOpen) this.panel.classList.add("open");
  }

  private previouslyEnabled: string[] | undefined;

  /** Live OSC bridge status (wired from the client's onStatus in main.ts). */
  setOscStatus(status: "connected" | "disconnected" | "error"): void {
    if (this.oscDot === undefined) return;
    this.oscDot.className = `dot${status === "connected" ? " on" : status === "error" ? " err" : ""}`;
    this.oscDot.title = `OSC bridge: ${status}`;
  }
}

function hr(): HTMLHRElement {
  const el = document.createElement("hr");
  el.style.border = "none";
  el.style.borderTop = "1px solid rgba(232,200,130,0.14)";
  el.style.margin = "8px 0";
  return el;
}
