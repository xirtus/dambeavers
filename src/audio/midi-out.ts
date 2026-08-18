/**
 * MIDI backend (ARCHITECTURE_CONTRACT §26): the score performed by any
 * Web MIDI output — a DAW, a hardware synth, a network session. The
 * conductor's stream maps onto a small, documented orchestra (full table
 * in docs/AUDIO.md):
 *
 *   ch 1  pad            (Strings Ens. 1)   chord tones, held
 *   ch 2  pluck/motif    (Marimba)          colony work-song, event plucks
 *   ch 3  droplets       (Vibraphone)       rain music-box, water trickle
 *   ch 4  bells/birds    (Tubular Bells / Whistle — birds share via bank-less program 79? kept one program: Tubular Bells; bird chirps land an octave up)
 *   ch 5  bass           (Acoustic Bass)    dam-stone floor
 *   ch 6  lament         (English Horn)     mourning reed
 *   ch 10 percussion                       every work/weather/UI sfx
 *
 * CC 74 broadcasts the underwater muffle (brightness). Notes are sent
 * with Web MIDI timestamps so scheduled gestures stay on the grid.
 */
import type { AudioBackend } from "../presentation/audio/backend.js";
import type { LayerPatch, NoteGesture, SoundGesture, TransportState } from "../presentation/audio/sound-gesture.js";

/** GM program (0-indexed) per melodic channel. */
const PROGRAMS: Readonly<Record<number, number>> = {
  0: 49, // String Ensemble 1 — pad
  1: 12, // Marimba — pluck
  2: 11, // Vibraphone — droplet
  3: 14, // Tubular Bells — bell & bird
  4: 32, // Acoustic Bass — bass
  5: 69, // English Horn — lament
};

const VOICE_CHANNEL: Readonly<Record<string, number>> = {
  pluck: 1,
  droplet: 2,
  bell: 3,
  bird: 3,
  bass: 4,
  lament: 5,
  cricket: 3,
};

/** GM percussion note per sfx (channel 10). */
const SFX_DRUM: Readonly<Record<string, number>> = {
  "wood-crack": 75, // claves, hard
  "wood-tap": 76, // hi woodblock
  gnaw: 69, // cabasa
  thump: 64, // low conga
  "sub-drop": 36, // bass drum
  splash: 57, // crash 2, soft
  paddle: 62, // mute hi conga
  footstep: 37, // side stick
  scrape: 73, // short guiro
  munch: 60, // hi bongo, soft
  breath: 54, // tambourine, softest
  creak: 68, // low agogo
  rustle: 70, // maracas
  crackle: 69,
  whoosh: 57,
  thunder: 41, // low floor tom
  gust: 57,
  cough: 60,
  chatter: 72, // long whistle
  scuffle: 38, // snare
  "ui-confirm": 76,
  "ui-tool": 76,
  "ui-error": 77, // low woodblock
  "ui-save": 76,
  "ui-toast": 76,
};

export class MidiBackend implements AudioBackend {
  readonly name = "midi";
  private access: MIDIAccess | undefined;
  private output: MIDIOutput | undefined;
  private enabled = false;
  private transport: TransportState = { bpm: 64, beat: 0, beatsPerSecond: 1, running: true };
  private heldPadNotes: number[] = [];

  constructor(private readonly onStatus?: (status: string) => void) {}

  async start(): Promise<void> {
    this.enabled = true;
    if (this.access !== undefined) {
      this.pickDefaultOutput();
      return;
    }
    if (typeof navigator === "undefined" || navigator.requestMIDIAccess === undefined) {
      this.onStatus?.("Web MIDI unavailable in this browser");
      this.enabled = false;
      return;
    }
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
    } catch {
      this.onStatus?.("MIDI permission denied");
      this.enabled = false;
      return;
    }
    this.access.addEventListener("statechange", () => this.onStatus?.(this.describeOutputs()));
    this.pickDefaultOutput();
  }

  /** The outputs a user may choose among in the sound panel. */
  listOutputs(): Array<{ id: string; name: string }> {
    if (this.access === undefined) return [];
    const out: Array<{ id: string; name: string }> = [];
    this.access.outputs.forEach((output, id) => out.push({ id, name: output.name ?? id }));
    return out;
  }

  selectOutput(id: string): void {
    const next = this.access?.outputs.get(id);
    if (next === undefined) return;
    this.allNotesOff();
    this.output = next;
    this.sendPrograms();
    this.onStatus?.(`MIDI → ${next.name ?? id}`);
  }

  private pickDefaultOutput(): void {
    const outputs = this.listOutputs();
    if (outputs.length === 0) {
      this.onStatus?.("no MIDI outputs found");
      return;
    }
    this.selectOutput(outputs[0]!.id);
  }

  private describeOutputs(): string {
    const names = this.listOutputs().map((o) => o.name).join(", ");
    return names.length > 0 ? `outputs: ${names}` : "no MIDI outputs";
  }

  stop(): void {
    this.enabled = false;
    this.allNotesOff();
  }

  private nowMs(): number {
    return performance.now();
  }

  private send(bytes: number[], atMs?: number): void {
    if (!this.enabled || this.output === undefined) return;
    try {
      if (atMs !== undefined) this.output.send(bytes, atMs);
      else this.output.send(bytes);
    } catch {
      // an unplugged device mid-session is silent, never fatal
    }
  }

  private allNotesOff(): void {
    for (let ch = 0; ch < 16; ch++) this.send([0xb0 | ch, 123, 0]);
    this.heldPadNotes = [];
  }

  private sendPrograms(): void {
    for (const [channel, program] of Object.entries(PROGRAMS)) {
      this.send([0xc0 | Number(channel), program]);
    }
  }

  setTransport(transport: TransportState): void {
    this.transport = transport;
  }

  applyLayers(layers: LayerPatch, _atSec: number): void {
    if (layers.muffle !== undefined) {
      const value = Math.round(127 * (1 - layers.muffle * 0.85));
      for (const channel of [0, 1, 2, 3, 4, 5]) this.send([0xb0 | channel, 74, value]);
    }
    if (layers.padChord !== undefined) this.retunePad(layers.padChord);
  }

  private retunePad(chord: readonly number[]): void {
    for (const note of this.heldPadNotes) this.send([0x80, note, 0]);
    this.heldPadNotes = [];
    for (const midi of chord) {
      const note = clampMidi(midi);
      this.send([0x90, note, 34]);
      this.heldPadNotes.push(note);
    }
  }

  play(gesture: SoundGesture, atSec: number): void {
    // atSec rides the host's performance.now()/1000 timeline — convert directly.
    const atMs = Math.max(this.nowMs(), atSec * 1000);
    if (gesture.kind === "note") this.playNote(gesture, atMs);
    else this.playDrum(gesture, atMs);
  }

  private playNote(note: NoteGesture, atMs: number): void {
    const channel = VOICE_CHANNEL[note.voice] ?? 1;
    const midi = clampMidi(note.midi);
    const velocity = clampVel(note.velocity * note.gain);
    if (velocity <= 1) return;
    const durMs = Math.max(60, (note.durBeats / Math.max(0.2, this.transport.beatsPerSecond)) * 1000);
    this.send([0x90 | channel, midi, velocity], atMs);
    this.send([0x80 | channel, midi, 0], atMs + durMs);
  }

  private playDrum(sfx: Extract<SoundGesture, { kind: "sfx" }>, atMs: number): void {
    const drum = SFX_DRUM[sfx.name];
    if (drum === undefined) return;
    const velocity = clampVel(sfx.intensity * sfx.gain * (sfx.name === "thunder" || sfx.name === "sub-drop" ? 1 : 0.7));
    if (velocity <= 1) return;
    this.send([0x99, drum, velocity], atMs);
    this.send([0x89, drum, 0], atMs + 120);
  }
}

function clampMidi(midi: number): number {
  return Math.max(0, Math.min(127, Math.round(midi)));
}

function clampVel(value: number): number {
  return Math.max(0, Math.min(127, Math.round(value * 127)));
}
