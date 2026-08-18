/**
 * GENERATIVE SCORE — the control-stream contract (ARCHITECTURE_CONTRACT §26).
 *
 * The conductor composes an abstract, JSON-plain stream of musical
 * gestures from observed simulation state. Backends (the built-in
 * WebAudio synth, the OSC bridge into SuperCollider/Max/Pd, a Web MIDI
 * output into a DAW) render that ONE stream — the game is the composer,
 * the backend is the instrument. Nothing here references any browser API;
 * the same stream drives a synth, a socket, or a test assertion.
 *
 * Gesture times are in TRANSPORT BEATS (the conductor's musical clock),
 * not sim ticks and not wall seconds: when the sim runs faster the score
 * gently quickens (sub-linear), and when paused the world's music
 * breathes out and holds. UI gestures are immediate (they answer the
 * player's finger, not the world's pulse).
 */

/** Pitched voices the score writes for. A backend maps each to its own instrument (KS pluck, sine droplet, ...). */
export type NoteVoice =
  | "pluck" // wooden Karplus-Strong — work knocks in key, the colony motif
  | "droplet" // water plink, fast rising pitch
  | "bell" // soft struck sine with harmonic — alerts, chimes, life passages
  | "bird" // agile high sine chirps
  | "cricket" // dry high ticks
  | "bass" // low sustained root — dam-stone, civilizational floor
  | "lament"; // hollow reed — mourning

/** Noise/texture gestures — the sound of work, water, weather, and interface. */
export type SfxName =
  | "wood-crack" // a tree lets go
  | "wood-tap" // building knocks (pitched: use `pitch` 0..1)
  | "gnaw" // beaver teeth on heartwood
  | "thump" // soft earth/log landing
  | "sub-drop" // deep mass settling — dam stone, death
  | "splash" // water broken
  | "paddle" // swimming strokes
  | "footstep" // hauling gait
  | "scrape" // digging
  | "munch" // eating
  | "breath" // sleeping
  | "creak" // wood under load — gates
  | "rustle" // dry leaves — plant death
  | "crackle" // fire ticks
  | "whoosh" // weather fronts, fire ignition
  | "thunder"
  | "gust"
  | "cough" // sickness, muted
  | "chatter" // social squeaks
  | "scuffle" // fights
  | "ui-confirm"
  | "ui-tool"
  | "ui-error"
  | "ui-save"
  | "ui-toast";

export interface NoteGesture {
  readonly kind: "note";
  readonly voice: NoteVoice;
  /** Transport beat to sound at; ignored when `immediate`. */
  readonly beat: number;
  readonly immediate: boolean;
  readonly midi: number;
  /** 0..1 — musical intensity before spatial gain. */
  readonly velocity: number;
  readonly durBeats: number;
  /** -1 (left) .. 1 (right). */
  readonly pan: number;
  /** 0..1 — distance/audibility gain from the listener model. */
  readonly gain: number;
}

export interface SfxGesture {
  readonly kind: "sfx";
  readonly name: SfxName;
  readonly beat: number;
  readonly immediate: boolean;
  /** 0..1 — how hard the material is struck / how big the front is. */
  readonly intensity: number;
  /** Relative size/pitch center 0..1 (a heavy log thumps lower than a twig). */
  readonly size: number;
  readonly pan: number;
  readonly gain: number;
}

export type SoundGesture = NoteGesture | SfxGesture;

/**
 * Continuous bed parameters — smoothed by backends toward their targets.
 * All gains/cutoffs normalized 0..1; `padChord` is absolute midi notes.
 */
export interface LayerState {
  readonly padGain: number;
  readonly padBrightness: number;
  readonly padChord: readonly number[];
  readonly waterGain: number;
  readonly waterCutoff: number;
  readonly waterTrickle: number;
  readonly windGain: number;
  readonly windCutoff: number;
  readonly rainGain: number;
  readonly fireGain: number;
  readonly birdDensity: number;
  readonly cricketDensity: number;
  /** Global lowpass/darkening when the listener is submerged (0 = open air, 1 = fully under). */
  readonly muffle: number;
}

export type LayerPatch = Partial<LayerState>;

export interface TransportState {
  readonly bpm: number;
  /** Current transport position in beats. */
  readonly beat: number;
  /** Beats added per real second right now (0 while paused). */
  readonly beatsPerSecond: number;
  readonly running: boolean;
}

/** One conductor emission: gestures scheduled into the lookahead window plus the latest bed state. */
export interface ScoreFrame {
  readonly gestures: readonly SoundGesture[];
  readonly layers: LayerPatch;
  readonly transport: TransportState;
}

/** Where the player's ear is, in world cells — derived from the real camera each render frame. */
export interface ListenerPose {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Camera yaw (radians) — for stereo panning of world positions. */
  readonly yaw: number;
  /** Zoom distance — height above the world widens the wind, narrows detail. */
  readonly distance: number;
  /** 0..1 how submerged the ear is (camera below the real water surface). */
  readonly underwater: number;
}

/** Local water truth the host samples from real bridge queries (never guessed): how wet the columns around the listener are, and where the nearest open water lies relative to the listener. */
export interface WaterProbe {
  /** 0..1 mean depth around the listener (normalized to ~2 cells). */
  readonly wetness: number;
  /** Direction to the wettest sampled column, listener-relative cells (0,0 = beneath). */
  readonly dx: number;
  readonly dz: number;
  /** True while the flow solver is actively changing the water near the listener (real churn observed through dirty water chunks). */
  readonly moving: boolean;
}
