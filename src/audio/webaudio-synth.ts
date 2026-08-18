/**
 * The built-in instrument (ARCHITECTURE_CONTRACT §26): a fully generative
 * WebAudio synth — no samples, no assets. Karplus-Strong wooden plucks,
 * shaped-noise work sounds, water droplets with real rising pitch, a
 * convolver "lodge" whose impulse is generated noise, and persistent
 * wind/water/rain/fire beds. Everything the conductor writes, this can
 * play, out of the box, offline.
 *
 * Sound-design intent: pastoral wood-and-water. Attacks are soft,
 * materials are wood/stone/water, and nothing ever clips — the master
 * runs through a gentle compressor. Beauty is the requirement: every
 * envelope is exponential, every filter swept, nothing raw-square.
 */
import type { AudioBackend } from "../presentation/audio/backend.js";
import { midiToFreq } from "../presentation/audio/music-theory.js";
import type { LayerPatch, NoteGesture, SfxGesture, SoundGesture, TransportState } from "../presentation/audio/sound-gesture.js";

/** Per-voice concurrency caps — the score stays transparent, never a wall of nodes. */
const VOICE_CAPS: Partial<Record<string, number>> = { droplet: 10, cricket: 8, bird: 6, pluck: 14, bell: 8 };

export class WebAudioSynth implements AudioBackend {
  readonly name = "webaudio";
  private ctx: AudioContext | undefined;
  private master!: GainNode;
  private muffleFilter!: BiquadFilterNode;
  private musicBus!: GainNode;
  private ambienceBus!: GainNode;
  private sfxBus!: GainNode;
  private uiBus!: GainNode;
  private reverbSend!: GainNode;
  private noiseBuffer!: AudioBuffer;
  private beds!: Beds;
  private transport: TransportState = { bpm: 64, beat: 0, beatsPerSecond: 1, running: true };
  private readonly voiceCounts = new Map<string, number>();
  private mix = { master: 0.9, music: 0.9, ambience: 0.9, sfx: 1, ui: 0.9 };
  private running = false;

  setMix(mix: Partial<typeof this.mix>): void {
    Object.assign(this.mix, mix);
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.mix.master, t, 0.05);
    this.musicBus.gain.setTargetAtTime(this.mix.music, t, 0.05);
    this.ambienceBus.gain.setTargetAtTime(this.mix.ambience, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(this.mix.sfx, t, 0.05);
    this.uiBus.gain.setTargetAtTime(this.mix.ui, t, 0.05);
  }

  start(): void {
    if (this.ctx !== undefined) {
      void this.ctx.resume();
      this.running = true;
      return;
    }
    const ctx = new AudioContext({ latencyHint: "interactive" });
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.muffleFilter = ctx.createBiquadFilter();
    this.muffleFilter.type = "lowpass";
    this.muffleFilter.frequency.value = 19000;
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 22;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.24;
    this.master.connect(this.muffleFilter).connect(compressor).connect(ctx.destination);

    // The lodge: a generated stereo impulse — exponentially decaying,
    // gently band-limited noise. Wood-room warmth, zero assets.
    const seconds = 1.9;
    const impulse = ctx.createBuffer(2, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = impulse.getChannelData(channel);
      let seed = 2222 + channel * 777;
      for (let i = 0; i < data.length; i++) {
        seed = (seed * 16807) % 2147483647;
        const white = (seed / 2147483647) * 2 - 1;
        data[i] = white * Math.pow(1 - i / data.length, 2.6) * 0.6;
      }
    }
    const convolver = ctx.createConvolver();
    convolver.buffer = impulse;
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.33;
    this.reverbSend.connect(convolver).connect(this.master);

    this.musicBus = ctx.createGain();
    this.ambienceBus = ctx.createGain();
    this.sfxBus = ctx.createGain();
    this.uiBus = ctx.createGain();
    for (const [bus, send] of [[this.musicBus, 0.9], [this.ambienceBus, 0.5], [this.sfxBus, 0.45], [this.uiBus, 0.3]] as const) {
      bus.connect(this.master);
      const tap = ctx.createGain();
      tap.gain.value = send;
      bus.connect(tap).connect(this.reverbSend);
    }
    this.setMix({});

    // One shared noise buffer for every shaped-noise voice.
    const len = ctx.sampleRate * 2;
    this.noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const noise = this.noiseBuffer.getChannelData(0);
    let seed = 987654321;
    for (let i = 0; i < len; i++) {
      seed = (seed * 16807) % 2147483647;
      noise[i] = (seed / 2147483647) * 2 - 1;
    }

    this.beds = new Beds(ctx, this.ambienceBus, this.noiseBuffer);
    this.running = true;
  }

  stop(): void {
    this.running = false;
    void this.ctx?.suspend();
  }

  setTransport(transport: TransportState): void {
    this.transport = transport;
  }

  applyLayers(layers: LayerPatch, atSec: number): void {
    if (!this.ctx || !this.running) return;
    const t = Math.max(atSec, this.ctx.currentTime);
    if (layers.muffle !== undefined) {
      // Underwater: the world closes over your ears — 19 kHz down to a muffled 600 Hz.
      const freq = 19000 * Math.pow(600 / 19000, layers.muffle);
      this.muffleFilter.frequency.setTargetAtTime(freq, t, 0.12);
    }
    this.beds.apply(layers, t);
  }

  play(gesture: SoundGesture, atSec: number): void {
    if (!this.ctx || !this.running) return;
    const now = this.ctx.currentTime;
    const t = Math.max(atSec, now + 0.005);
    if (gesture.kind === "note") this.playNote(gesture, t);
    else this.playSfx(gesture, t);
  }

  private trackVoice(key: string): boolean {
    const cap = VOICE_CAPS[key];
    if (cap === undefined) return true;
    const count = this.voiceCounts.get(key) ?? 0;
    if (count >= cap) return false;
    this.voiceCounts.set(key, count + 1);
    return true;
  }

  private releaseVoice(key: string): void {
    const count = this.voiceCounts.get(key);
    if (count !== undefined) this.voiceCounts.set(key, Math.max(0, count - 1));
  }

  private panner(pan: number): StereoPannerNode {
    const node = this.ctx!.createStereoPanner();
    node.pan.value = Math.max(-1, Math.min(1, pan));
    return node;
  }

  // ---------------------------------------------------------------- voices

  private playNote(note: NoteGesture, t: number): void {
    if (!this.trackVoice(note.voice)) return;
    const ctx = this.ctx!;
    const out = this.panner(note.pan);
    const amp = ctx.createGain();
    amp.gain.value = 0;
    out.connect(amp).connect(note.voice === "cricket" || note.voice === "bird" ? this.ambienceBus : this.musicBus);
    const level = note.velocity * note.gain;
    const durSec = Math.max(0.06, note.durBeats / Math.max(0.2, this.transport.beatsPerSecond));
    const freq = midiToFreq(note.midi);
    const done = (): void => {
      this.releaseVoice(note.voice);
      setTimeout(() => {
        out.disconnect();
        amp.disconnect();
      }, 50);
    };
    switch (note.voice) {
      case "pluck":
        this.karplus(freq, t, level, Math.min(2.2, durSec * 1.6), amp);
        setTimeout(done, (t - ctx.currentTime + 2.6) * 1000);
        break;
      case "droplet": {
        // Real water: the pitch RISES as the drop's cavity collapses.
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq * 0.55, t);
        osc.frequency.exponentialRampToValueAtTime(freq * 1.04, t + 0.055);
        amp.gain.setValueAtTime(0, t);
        amp.gain.linearRampToValueAtTime(level * 0.7, t + 0.008);
        amp.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
        osc.connect(amp);
        osc.start(t);
        osc.stop(t + 0.2);
        setTimeout(done, (t - ctx.currentTime + 0.3) * 1000);
        break;
      }
      case "bell": {
        const partials: Array<[number, number]> = [[1, 1], [2.01, 0.32], [2.74, 0.12]];
        for (const [ratio, amount] of partials) {
          const osc = ctx.createOscillator();
          osc.type = "sine";
          osc.frequency.value = freq * ratio;
          const g = ctx.createGain();
          g.gain.setValueAtTime(0, t);
          g.gain.linearRampToValueAtTime(level * 0.5 * amount, t + 0.006);
          g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.9, durSec * 1.4));
          osc.connect(g).connect(amp);
          osc.start(t);
          osc.stop(t + Math.max(1, durSec * 1.5));
        }
        setTimeout(done, (t - ctx.currentTime + Math.max(1.1, durSec * 1.6)) * 1000);
        break;
      }
      case "bird": {
        const osc = ctx.createOscillator();
        osc.type = "sine";
        const chirp = Math.min(0.16, durSec);
        osc.frequency.setValueAtTime(freq * 0.82, t);
        osc.frequency.exponentialRampToValueAtTime(freq * 1.16, t + chirp * 0.4);
        osc.frequency.exponentialRampToValueAtTime(freq * 0.94, t + chirp);
        amp.gain.setValueAtTime(0, t);
        amp.gain.linearRampToValueAtTime(level * 0.5, t + 0.012);
        amp.gain.exponentialRampToValueAtTime(0.0001, t + chirp + 0.05);
        osc.connect(amp);
        osc.start(t);
        osc.stop(t + chirp + 0.08);
        setTimeout(done, (t - ctx.currentTime + chirp + 0.15) * 1000);
        break;
      }
      case "cricket": {
        const osc = ctx.createOscillator();
        osc.type = "triangle";
        osc.frequency.value = freq;
        const am = ctx.createGain();
        const lfo = ctx.createOscillator();
        lfo.type = "square";
        lfo.frequency.value = 42;
        const lfoDepth = ctx.createGain();
        lfoDepth.gain.value = 0.5;
        am.gain.value = 0.5;
        lfo.connect(lfoDepth).connect(am.gain);
        const gate = ctx.createGain();
        gate.gain.setValueAtTime(0, t);
        gate.gain.linearRampToValueAtTime(level * 0.4, t + 0.01);
        gate.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.07, durSec));
        osc.connect(am).connect(gate).connect(amp);
        osc.start(t);
        lfo.start(t);
        osc.stop(t + Math.max(0.1, durSec + 0.05));
        lfo.stop(t + Math.max(0.1, durSec + 0.05));
        setTimeout(done, (t - ctx.currentTime + durSec + 0.15) * 1000);
        break;
      }
      case "bass": {
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.value = freq;
        const warmth = ctx.createOscillator();
        warmth.type = "triangle";
        warmth.frequency.value = freq * 2;
        const warmthGain = ctx.createGain();
        warmthGain.gain.value = 0.18;
        amp.gain.setValueAtTime(0, t);
        amp.gain.linearRampToValueAtTime(level * 0.85, t + 0.09);
        amp.gain.setTargetAtTime(0, t + durSec * 0.7, 0.3);
        osc.connect(amp);
        warmth.connect(warmthGain).connect(amp);
        osc.start(t);
        warmth.start(t);
        osc.stop(t + durSec + 1.4);
        warmth.stop(t + durSec + 1.4);
        setTimeout(done, (t - ctx.currentTime + durSec + 1.5) * 1000);
        break;
      }
      case "lament": {
        // a hollow reed: triangle pair with slow vibrato through a nasal band
        const body = ctx.createBiquadFilter();
        body.type = "bandpass";
        body.frequency.value = 760;
        body.Q.value = 0.8;
        for (const detune of [-6, 5]) {
          const osc = ctx.createOscillator();
          osc.type = "triangle";
          osc.frequency.value = freq;
          osc.detune.value = detune;
          const vib = ctx.createOscillator();
          vib.frequency.value = 4.6;
          const vibDepth = ctx.createGain();
          vibDepth.gain.value = 5;
          vib.connect(vibDepth).connect(osc.detune);
          osc.connect(body);
          osc.start(t);
          vib.start(t);
          osc.stop(t + durSec + 0.6);
          vib.stop(t + durSec + 0.6);
        }
        amp.gain.setValueAtTime(0, t);
        amp.gain.linearRampToValueAtTime(level * 0.5, t + 0.16);
        amp.gain.setTargetAtTime(0, t + durSec * 0.75, 0.25);
        body.connect(amp);
        setTimeout(done, (t - ctx.currentTime + durSec + 0.8) * 1000);
        break;
      }
    }
  }

  /** Karplus-Strong: a noise burst in a filtered feedback delay — the sound of a plucked, struck, or knocked piece of wood. */
  private karplus(freq: number, t: number, level: number, sustainSec: number, out: GainNode): void {
    const ctx = this.ctx!;
    const burst = ctx.createBufferSource();
    burst.buffer = this.noiseBuffer;
    const burstGain = ctx.createGain();
    burstGain.gain.setValueAtTime(level, t);
    burstGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.012);
    const delay = ctx.createDelay(0.05);
    delay.delayTime.value = 1 / freq;
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = Math.min(9000, freq * 5);
    const feedback = ctx.createGain();
    // gain^loops = 0.001 over sustain -> natural string decay
    feedback.gain.value = Math.min(0.985, Math.pow(0.001, 1 / (freq * sustainSec)));
    burst.connect(burstGain).connect(delay);
    delay.connect(tone).connect(feedback).connect(delay);
    const tap = ctx.createGain();
    tap.gain.value = 1;
    tone.connect(tap).connect(out);
    // Also excite the body directly a touch — wood speaks before it rings.
    const body = ctx.createBiquadFilter();
    body.type = "bandpass";
    body.frequency.value = freq * 2;
    body.Q.value = 1.2;
    burstGain.connect(body).connect(out);
    burst.start(t, Math.random() * 0.5);
    burst.stop(t + 0.05);
    const stopAt = t + sustainSec + 0.4;
    setTimeout(() => {
      delay.disconnect();
      tone.disconnect();
      feedback.disconnect();
      tap.disconnect();
      body.disconnect();
    }, Math.max(0, (stopAt - ctx.currentTime) * 1000));
  }

  // ------------------------------------------------------------------- sfx

  private playSfx(sfx: SfxGesture, t: number): void {
    const ctx = this.ctx!;
    const out = this.panner(sfx.pan);
    const amp = ctx.createGain();
    amp.gain.value = 0;
    out.connect(amp).connect(sfx.name.startsWith("ui-") ? this.uiBus : this.sfxBus);
    const level = sfx.intensity * sfx.gain;
    const size = sfx.size;
    const cleanup = (afterSec: number): void => {
      setTimeout(() => {
        out.disconnect();
        amp.disconnect();
      }, (t - ctx.currentTime + afterSec + 0.2) * 1000);
    };
    const noise = (filterType: BiquadFilterType, freq: number, q: number): { src: AudioBufferSourceNode; filter: BiquadFilterNode } => {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = filterType;
      filter.frequency.value = freq;
      filter.Q.value = q;
      src.connect(filter).connect(amp);
      return { src, filter };
    };
    const tone = (type: OscillatorType, freq: number): OscillatorNode => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = freq;
      osc.connect(amp);
      return osc;
    };
    const env = (peak: number, attack: number, decay: number): void => {
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(peak, t + attack);
      amp.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    };
    switch (sfx.name) {
      case "wood-crack": {
        const { src, filter } = noise("bandpass", 650 + size * 700, 1.4);
        // splintering: a handful of fast amplitude pulses
        amp.gain.setValueAtTime(0, t);
        const pulses = 5;
        for (let i = 0; i < pulses; i++) {
          const at = t + i * 0.028;
          amp.gain.linearRampToValueAtTime(level * (1 - i / pulses) * 0.9, at + 0.006);
          amp.gain.exponentialRampToValueAtTime(0.001, at + 0.026);
        }
        const thud = tone("sine", 120);
        thud.frequency.exponentialRampToValueAtTime(48, t + 0.22);
        src.start(t);
        src.stop(t + 0.3);
        thud.start(t + 0.1);
        thud.stop(t + 0.4);
        cleanup(0.5);
        break;
      }
      case "wood-tap": {
        const { src } = noise("bandpass", 800 + size * 1300, 2.5);
        env(level * 0.8, 0.004, 0.055);
        const tok = tone("sine", 150 + size * 170);
        tok.frequency.exponentialRampToValueAtTime(90 + size * 60, t + 0.07);
        src.start(t);
        src.stop(t + 0.09);
        tok.start(t);
        tok.stop(t + 0.1);
        cleanup(0.15);
        break;
      }
      case "gnaw": {
        const { src, filter } = noise("bandpass", 1250 + size * 600, 3);
        amp.gain.setValueAtTime(0, t);
        amp.gain.linearRampToValueAtTime(level * 0.5, t + 0.012);
        amp.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
        filter.frequency.exponentialRampToValueAtTime(900 + size * 400, t + 0.1);
        src.start(t);
        src.stop(t + 0.14);
        cleanup(0.2);
        break;
      }
      case "thump": {
        const osc = tone("sine", 130 + size * 60);
        osc.frequency.exponentialRampToValueAtTime(48 + size * 20, t + 0.16);
        env(level * 0.9, 0.006, 0.24);
        osc.start(t);
        osc.stop(t + 0.3);
        const { src } = noise("lowpass", 300, 0.6);
        src.start(t);
        src.stop(t + 0.12);
        cleanup(0.35);
        break;
      }
      case "sub-drop": {
        const osc = tone("sine", 96);
        osc.frequency.exponentialRampToValueAtTime(36, t + 0.42);
        amp.gain.setValueAtTime(0, t);
        amp.gain.linearRampToValueAtTime(level, t + 0.02);
        amp.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
        osc.start(t);
        osc.stop(t + 1);
        const { src } = noise("lowpass", 130, 0.5);
        src.start(t);
        src.stop(t + 0.5);
        cleanup(1.1);
        break;
      }
      case "splash": {
        const { src, filter } = noise("bandpass", 900, 0.9);
        filter.frequency.setValueAtTime(750, t);
        filter.frequency.exponentialRampToValueAtTime(2300, t + 0.09);
        filter.frequency.exponentialRampToValueAtTime(800, t + 0.3);
        env(level * 0.7, 0.01, 0.32);
        src.start(t);
        src.stop(t + 0.4);
        cleanup(0.45);
        break;
      }
      case "paddle": {
        const { src } = noise("lowpass", 520 + size * 200, 0.7);
        env(level * 0.5, 0.03, 0.16);
        src.start(t);
        src.stop(t + 0.25);
        cleanup(0.3);
        break;
      }
      case "footstep": {
        const { src } = noise("lowpass", 210 + size * 120, 0.8);
        env(level * 0.5, 0.005, 0.07);
        src.start(t);
        src.stop(t + 0.1);
        cleanup(0.15);
        break;
      }
      case "scrape": {
        const { src, filter } = noise("bandpass", 430, 1.1);
        filter.frequency.exponentialRampToValueAtTime(220, t + 0.2);
        env(level * 0.55, 0.015, 0.2);
        src.start(t);
        src.stop(t + 0.26);
        cleanup(0.3);
        break;
      }
      case "munch": {
        const { src } = noise("bandpass", 480 + size * 200, 2);
        amp.gain.setValueAtTime(0, t);
        amp.gain.linearRampToValueAtTime(level * 0.4, t + 0.01);
        amp.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
        amp.gain.linearRampToValueAtTime(level * 0.3, t + 0.08);
        amp.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
        src.start(t);
        src.stop(t + 0.16);
        cleanup(0.2);
        break;
      }
      case "breath": {
        const { src } = noise("lowpass", 320, 0.5);
        amp.gain.setValueAtTime(0, t);
        amp.gain.linearRampToValueAtTime(level * 0.32, t + 0.25);
        amp.gain.linearRampToValueAtTime(0, t + 0.7);
        src.start(t);
        src.stop(t + 0.75);
        cleanup(0.8);
        break;
      }
      case "creak": {
        const osc = tone("sawtooth", 78 + size * 60);
        const filter = ctx.createBiquadFilter();
        filter.type = "bandpass";
        filter.frequency.value = 560;
        filter.Q.value = 4;
        osc.disconnect();
        osc.connect(filter).connect(amp);
        osc.frequency.setValueAtTime(70 + size * 50, t);
        osc.frequency.linearRampToValueAtTime(96 + size * 70, t + 0.55);
        amp.gain.setValueAtTime(0, t);
        amp.gain.linearRampToValueAtTime(level * 0.4, t + 0.09);
        amp.gain.linearRampToValueAtTime(0, t + 0.65);
        osc.start(t);
        osc.stop(t + 0.7);
        cleanup(0.75);
        break;
      }
      case "rustle": {
        const { src } = noise("highpass", 2400, 0.7);
        env(level * 0.35, 0.02, 0.3);
        src.start(t);
        src.stop(t + 0.36);
        cleanup(0.4);
        break;
      }
      case "crackle": {
        const { src } = noise("highpass", 1700, 0.8);
        amp.gain.setValueAtTime(0, t);
        const ticks = 3 + Math.floor(size * 3);
        for (let i = 0; i < ticks; i++) {
          const at = t + i * (0.02 + 0.02 * ((i * 37) % 1));
          amp.gain.linearRampToValueAtTime(level * 0.4 * (1 - i / (ticks + 1)), at + 0.004);
          amp.gain.exponentialRampToValueAtTime(0.0005, at + 0.018);
        }
        src.start(t);
        src.stop(t + 0.24);
        cleanup(0.3);
        break;
      }
      case "whoosh": {
        const { src, filter } = noise("lowpass", 500, 0.6);
        filter.frequency.setValueAtTime(420, t);
        filter.frequency.exponentialRampToValueAtTime(1350, t + 0.4);
        filter.frequency.exponentialRampToValueAtTime(430, t + 1.1);
        amp.gain.setValueAtTime(0, t);
        amp.gain.linearRampToValueAtTime(level * 0.5, t + 0.3);
        amp.gain.linearRampToValueAtTime(0, t + 1.15);
        src.start(t);
        src.stop(t + 1.2);
        cleanup(1.25);
        break;
      }
      case "thunder": {
        const { src, filter } = noise("lowpass", 120, 0.5);
        filter.frequency.setValueAtTime(150, t);
        filter.frequency.exponentialRampToValueAtTime(58, t + 2.2);
        amp.gain.setValueAtTime(0, t);
        amp.gain.linearRampToValueAtTime(level, t + 0.07);
        amp.gain.exponentialRampToValueAtTime(0.0001, t + 2.4 + size * 1.4);
        src.start(t);
        src.stop(t + 4);
        const sub = tone("sine", 44);
        sub.frequency.exponentialRampToValueAtTime(30, t + 1.8);
        sub.start(t);
        sub.stop(t + 2.2);
        cleanup(4.1);
        break;
      }
      case "gust": {
        const { src, filter } = noise("lowpass", 380, 0.7);
        filter.frequency.linearRampToValueAtTime(820, t + 0.6);
        filter.frequency.linearRampToValueAtTime(340, t + 1.5);
        amp.gain.setValueAtTime(0, t);
        amp.gain.linearRampToValueAtTime(level * 0.5, t + 0.5);
        amp.gain.linearRampToValueAtTime(0, t + 1.6);
        src.start(t);
        src.stop(t + 1.7);
        cleanup(1.75);
        break;
      }
      case "cough": {
        const { src } = noise("bandpass", 330, 1.6);
        amp.gain.setValueAtTime(0, t);
        amp.gain.linearRampToValueAtTime(level * 0.5, t + 0.015);
        amp.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
        amp.gain.linearRampToValueAtTime(level * 0.35, t + 0.14);
        amp.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
        src.start(t);
        src.stop(t + 0.25);
        cleanup(0.3);
        break;
      }
      case "chatter": {
        // two bright squeaks — beaver small talk
        const osc = tone("sine", 620 + size * 300);
        osc.frequency.setValueAtTime(640 + size * 300, t);
        osc.frequency.exponentialRampToValueAtTime(880 + size * 320, t + 0.06);
        osc.frequency.exponentialRampToValueAtTime(560 + size * 260, t + 0.16);
        env(level * 0.4, 0.012, 0.2);
        osc.start(t);
        osc.stop(t + 0.25);
        cleanup(0.3);
        break;
      }
      case "scuffle": {
        const { src } = noise("bandpass", 760, 1);
        amp.gain.setValueAtTime(0, t);
        for (let i = 0; i < 4; i++) {
          const at = t + i * 0.055;
          amp.gain.linearRampToValueAtTime(level * 0.5, at + 0.01);
          amp.gain.exponentialRampToValueAtTime(0.001, at + 0.05);
        }
        src.start(t);
        src.stop(t + 0.3);
        const osc = tone("sine", 110);
        osc.frequency.exponentialRampToValueAtTime(55, t + 0.2);
        osc.start(t + 0.24);
        osc.stop(t + 0.42);
        cleanup(0.5);
        break;
      }
      case "ui-confirm":
      case "ui-tool":
      case "ui-error":
      case "ui-save":
      case "ui-toast": {
        const { src } = noise("bandpass", 1500, 3);
        env(level * 0.3, 0.004, 0.05);
        src.start(t);
        src.stop(t + 0.07);
        cleanup(0.12);
        break;
      }
    }
  }
}

/** Persistent ambient beds: water babble, wind, rain hiss, fire glow, and the slow chord pad. */
class Beds {
  private readonly waterGain: GainNode;
  private readonly waterFilter: BiquadFilterNode;
  private readonly windGain: GainNode;
  private readonly windFilter: BiquadFilterNode;
  private readonly rainGain: GainNode;
  private readonly fireGain: GainNode;
  private readonly padGain: GainNode;
  private readonly padFilter: BiquadFilterNode;
  private padVoices: Array<{ osc: OscillatorNode; gain: GainNode }> = [];
  private currentChord: readonly number[] = [];

  constructor(
    private readonly ctx: AudioContext,
    out: GainNode,
    noise: AudioBuffer,
  ) {
    const bed = (type: BiquadFilterType, freq: number, q: number): { gain: GainNode; filter: BiquadFilterNode } => {
      const src = ctx.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      src.playbackRate.value = 0.85 + Math.random() * 0.3;
      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = freq;
      filter.Q.value = q;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(filter).connect(gain).connect(out);
      src.start();
      return { gain, filter };
    };
    const water = bed("bandpass", 760, 0.55);
    this.waterGain = water.gain;
    this.waterFilter = water.filter;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.17;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 210;
    lfo.connect(lfoDepth).connect(this.waterFilter.frequency);
    lfo.start();

    const wind = bed("lowpass", 420, 0.45);
    this.windGain = wind.gain;
    this.windFilter = wind.filter;
    const windLfo = ctx.createOscillator();
    windLfo.frequency.value = 0.09;
    const windDepth = ctx.createGain();
    windDepth.gain.value = 0.4;
    windLfo.connect(windDepth);
    windDepth.connect(this.windGain.gain);
    windLfo.start();

    const rain = bed("highpass", 1500, 0.4);
    this.rainGain = rain.gain;

    const fire = bed("bandpass", 1500, 0.9);
    this.fireGain = fire.gain;

    // The pad: one detuned saw pair per chord tone through a slow lowpass — the lodge's hearth drone.
    this.padGain = ctx.createGain();
    this.padGain.gain.value = 0;
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = "lowpass";
    this.padFilter.frequency.value = 900;
    this.padFilter.connect(this.padGain).connect(out);
  }

  apply(layers: LayerPatch, t: number): void {
    const set = (param: AudioParam, value: number, tc = 0.4): void => {
      param.setTargetAtTime(value, t, tc);
    };
    if (layers.waterGain !== undefined) set(this.waterGain.gain, layers.waterGain * 0.16);
    if (layers.waterCutoff !== undefined) set(this.waterFilter.frequency, 380 + layers.waterCutoff * 900, 0.6);
    if (layers.windGain !== undefined) set(this.windGain.gain, layers.windGain * 0.14, 0.9);
    if (layers.windCutoff !== undefined) set(this.windFilter.frequency, 240 + layers.windCutoff * 700, 0.9);
    if (layers.rainGain !== undefined) set(this.rainGain.gain, layers.rainGain * 0.12, 0.8);
    if (layers.fireGain !== undefined) set(this.fireGain.gain, layers.fireGain * 0.2, 0.3);
    if (layers.padGain !== undefined) set(this.padGain.gain, layers.padGain * 0.16, 1.2);
    if (layers.padBrightness !== undefined) set(this.padFilter.frequency, 320 + layers.padBrightness * 1600, 1.2);
    if (layers.padChord !== undefined && !sameChord(this.currentChord, layers.padChord)) {
      this.currentChord = layers.padChord;
      this.retunePad(layers.padChord, t);
    }
  }

  /** Crossfade the drone into the new chord: old voices fade out gently, new voices bloom. Never a hard switch. */
  private retunePad(chord: readonly number[], t: number): void {
    for (const voice of this.padVoices) {
      voice.gain.gain.setTargetAtTime(0, t, 0.7);
      try {
        voice.osc.stop(t + 2.6);
      } catch {
        // already stopped
      }
    }
    this.padVoices = [];
    const perVoice = Math.min(0.2, 0.55 / Math.max(1, chord.length));
    for (const midi of chord) {
      const freq = midiToFreq(midi);
      for (const detune of [-5, 4]) {
        const osc = this.ctx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.value = freq;
        osc.detune.value = detune;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(perVoice, t + 2.1);
        osc.connect(g).connect(this.padFilter);
        osc.start(t);
        this.padVoices.push({ osc, gain: g });
        osc.onended = (): void => {
          g.disconnect();
        };
      }
    }
  }
}

function sameChord(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
