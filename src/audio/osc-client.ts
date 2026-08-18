/**
 * OSC backend — browser side (ARCHITECTURE_CONTRACT §26).
 *
 * Browsers cannot speak UDP, so the score's OSC stream travels as JSON
 * over a WebSocket to tools/audio/osc-bridge.mjs (zero-dependency Node),
 * which re-emits every message as a real binary OSC 1.1 packet over UDP
 * (default 127.0.0.1:57120, SuperCollider's port). The address scheme —
 * the game's whole score as OSC — is documented in docs/AUDIO.md:
 *
 *   /beavers/note  <voice> <midi> <velocity 0..1> <durBeats> <pan -1..1> <gain 0..1> <whenSec>
 *   /beavers/sfx   <name> <intensity 0..1> <size 0..1> <pan> <gain> <whenSec>
 *   /beavers/layer <param> <value>            (bed targets; padChord arrives as /beavers/chord)
 *   /beavers/chord <midi0> <midi1> ...        (pad harmony changed)
 *   /beavers/transport <bpm> <beat> <beatsPerSecond> <running 0|1>
 *   /beavers/mix <bus> <value>
 *
 * Delivery is best-effort and never queued: a disconnected bridge means
 * silent notes are dropped, not stockpiled (music is ephemeral). Layer
 * and transport state, being continuous truth, IS remembered and
 * re-broadcast on reconnect so a late-joining synth catches the moment.
 */
import type { AudioBackend } from "../presentation/audio/backend.js";
import type { LayerPatch, SoundGesture, TransportState } from "../presentation/audio/sound-gesture.js";

export interface OscClientOptions {
  /** ws:// URL of tools/audio/osc-bridge.mjs. */
  readonly url: string;
  readonly onStatus?: (status: "connected" | "disconnected" | "error") => void;
}

export class OscClient implements AudioBackend {
  readonly name = "osc";
  private socket: WebSocket | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private enabled = false;
  private url: string;
  private lastLayers: LayerPatch = {};
  private lastTransport: TransportState | undefined;
  private readonly t0 = performance.now();

  constructor(private readonly options: OscClientOptions) {
    this.url = options.url;
  }

  /** Point at a different bridge; reconnects immediately if live. */
  setUrl(url: string): void {
    this.url = url;
    if (this.enabled) {
      this.socket?.close();
      this.socket = undefined;
      this.connect();
    }
  }

  get currentUrl(): string {
    return this.url;
  }

  private nowSec(): number {
    return (performance.now() - this.t0) / 1000;
  }

  start(): void {
    this.enabled = true;
    this.connect();
  }

  stop(): void {
    this.enabled = false;
    if (this.reconnectTimer !== undefined) clearTimeout(this.reconnectTimer);
    this.socket?.close();
    this.socket = undefined;
    this.options.onStatus?.("disconnected");
  }

  private connect(): void {
    if (!this.enabled) return;
    let socket: WebSocket;
    try {
      socket = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    socket.addEventListener("open", () => {
      if (this.socket !== socket) return;
      this.options.onStatus?.("connected");
      // Continuous truth re-broadcast so the receiver catches the moment.
      if (this.lastTransport !== undefined) this.sendTransport(this.lastTransport);
      this.sendLayers(this.lastLayers);
    });
    socket.addEventListener("close", () => {
      if (this.socket === socket) this.socket = undefined;
      this.options.onStatus?.("disconnected");
      this.scheduleReconnect();
    });
    socket.addEventListener("error", () => {
      this.options.onStatus?.("error");
      socket.close();
    });
  }

  private scheduleReconnect(): void {
    if (!this.enabled || this.reconnectTimer !== undefined) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect();
    }, 2500);
  }

  private send(address: string, args: readonly (string | number)[]): void {
    const socket = this.socket;
    if (socket === undefined || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type: "osc", address, args }));
  }

  setTransport(transport: TransportState): void {
    this.lastTransport = transport;
    this.sendTransport(transport);
  }

  private sendTransport(t: TransportState): void {
    this.send("/beavers/transport", [t.bpm, Math.round(t.beat * 1000) / 1000, Math.round(t.beatsPerSecond * 1000) / 1000, t.running ? 1 : 0]);
  }

  applyLayers(layers: LayerPatch, _atSec: number): void {
    this.lastLayers = { ...this.lastLayers, ...layers };
    this.sendLayers(layers);
  }

  private sendLayers(layers: LayerPatch): void {
    for (const [key, value] of Object.entries(layers)) {
      if (value === undefined) continue;
      if (key === "padChord") {
        this.send("/beavers/chord", value as readonly number[]);
      } else {
        this.send("/beavers/layer", [key, value as number]);
      }
    }
  }

  play(gesture: SoundGesture, atSec: number): void {
    const when = Math.round(Math.max(0, atSec - this.nowSec()) * 1000) / 1000;
    if (gesture.kind === "note") {
      this.send("/beavers/note", [
        gesture.voice,
        gesture.midi,
        round3(gesture.velocity),
        round3(gesture.durBeats),
        round3(gesture.pan),
        round3(gesture.gain),
        when,
      ]);
    } else {
      this.send("/beavers/sfx", [gesture.name, round3(gesture.intensity), round3(gesture.size), round3(gesture.pan), round3(gesture.gain), when]);
    }
  }
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
