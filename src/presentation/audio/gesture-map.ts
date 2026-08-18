/**
 * GENERATIVE SCORE — the event scorecard (ARCHITECTURE_CONTRACT §26).
 *
 * Every render event kind — every coarse family of REAL happenings the
 * EventLog projects — has a composed recipe here, so nothing that occurs
 * in the world is ever silent. Recipes are pure functions of the event,
 * the world's musical identity, and the current scale: they return
 * RELATIVE gestures (scale degrees around a base register, 0..1
 * intensities); the conductor quantizes, spatializes, and schedules them
 * onto the transport grid, which is why a felled tree lands ON the beat —
 * the world's percussion section plays in time by construction.
 *
 * Fine distinction lives in `sourceType` (the real EventLog type): a
 * drowning death sinks, a starvation death hollows, a trauma death
 * strikes — one coarse kind, honest different voices.
 */
import type { RenderEvent } from "../contracts/render-events.js";
import { degreeToMidi, quantizeToScale, type WorldMusicIdentity } from "./music-theory.js";
import type { NoteGesture, SfxGesture, SfxName, NoteVoice } from "./sound-gesture.js";

export interface RelativeNote {
  readonly voice: NoteVoice;
  /** Scale-degree offset from the recipe's base register (already includes octaves via large offsets). */
  readonly degree: number;
  /** Beat offset from the recipe's downbeat. */
  readonly at: number;
  readonly velocity: number;
  readonly durBeats: number;
}

export interface RelativeSfx {
  readonly name: SfxName;
  readonly at: number;
  readonly intensity: number;
  /** 0..1 size/mass — backends pitch material sounds by it. */
  readonly size: number;
}

export interface Recipe {
  readonly notes: readonly RelativeNote[];
  readonly sfx: readonly RelativeSfx[];
  /** Sub-beat grid this recipe quantizes to: 2 = eighths (small things), 1 = quarters (heavy things land on beats). */
  readonly grid: number;
}

const EMPTY: Recipe = { notes: [], sfx: [], grid: 2 };

/** Base registers per recipe family, in scale degrees above root — where in the field each happening sings. */
const REG = { low: -7, mid: 0, high: 7, sky: 14 } as const;

function deathRecipe(sourceType: string): Recipe {
  // The lament descends the world's own motif, reversed and slowed — the
  // colony's work-song turned to mourning. Cause colors the strike:
  const strike: SfxName = sourceType === "drowning-death" ? "splash" : sourceType === "trauma-death" ? "thump" : "sub-drop";
  const hollow = sourceType === "starvation-death" || sourceType === "disease-death";
  return {
    grid: 1,
    sfx: [
      { name: strike, at: 0, intensity: 0.7, size: 0.3 },
      { name: "sub-drop", at: 0, intensity: 0.55, size: 0.2 },
    ],
    notes: [
      { voice: "lament", degree: REG.mid + 2, at: 0.5, velocity: hollow ? 0.35 : 0.5, durBeats: 1.5 },
      { voice: "lament", degree: REG.mid + 1, at: 2, velocity: hollow ? 0.3 : 0.45, durBeats: 1.5 },
      { voice: "lament", degree: REG.mid - 2, at: 3.5, velocity: hollow ? 0.28 : 0.42, durBeats: 2.5 },
      { voice: "bass", degree: REG.low, at: 0, velocity: 0.5, durBeats: 3 },
    ],
  };
}

function birthRecipe(identity: WorldMusicIdentity): Recipe {
  // A rising lullaby built from the world's motif, ascending — new life
  // literally sings the colony's song upward. Bells, soft and high.
  void identity;
  return {
    grid: 2,
    sfx: [],
    notes: [
      { voice: "bell", degree: REG.mid, at: 0, velocity: 0.4, durBeats: 0.75 },
      { voice: "bell", degree: REG.mid + 2, at: 0.5, velocity: 0.42, durBeats: 0.75 },
      { voice: "bell", degree: REG.mid + 4, at: 1, velocity: 0.46, durBeats: 1.5 },
    ],
  };
}

/** The full scorecard. One entry per RenderEventKind; `generic` keeps even unmapped future history audible (quietly, consistently pitched by its real type's hash — never silent, never random). */
export function recipeFor(event: RenderEvent, identity: WorldMusicIdentity): Recipe {
  switch (event.kind) {
    case "tree-felled":
      return {
        grid: 1,
        sfx: [
          { name: "wood-crack", at: 0, intensity: 0.95, size: 0.6 },
          { name: "whoosh", at: 0.25, intensity: 0.5, size: 0.5 },
          { name: "thump", at: 1, intensity: 0.85, size: 0.75 },
        ],
        notes: [
          // the falling whistle: three descending plucks as the crown comes down
          { voice: "pluck", degree: REG.high + 2, at: 0.25, velocity: 0.4, durBeats: 0.2 },
          { voice: "pluck", degree: REG.high, at: 0.5, velocity: 0.38, durBeats: 0.2 },
          { voice: "pluck", degree: REG.high - 2, at: 0.75, velocity: 0.36, durBeats: 0.2 },
          // the warm "timber" fifth when it lands
          { voice: "pluck", degree: REG.mid, at: 1, velocity: 0.5, durBeats: 1 },
          { voice: "bass", degree: REG.low, at: 1, velocity: 0.45, durBeats: 1.5 },
        ],
      };
    case "dam-segment-applied":
      return {
        grid: 1,
        sfx: [
          { name: "sub-drop", at: 0, intensity: 0.9, size: 0.85 },
          { name: "splash", at: 0.5, intensity: 0.45, size: 0.5 },
        ],
        // The civilizational floor: a long low root, and the colony answering a fifth above — a stone-set cadence.
        notes: [
          { voice: "bass", degree: REG.low, at: 0, velocity: 0.6, durBeats: 3 },
          { voice: "pluck", degree: REG.mid, at: 1, velocity: 0.4, durBeats: 1 },
          { voice: "pluck", degree: REG.mid + 3, at: 2, velocity: 0.42, durBeats: 2 },
        ],
      };
    case "construction-complete":
      return {
        grid: 2,
        sfx: [
          { name: "wood-tap", at: 0, intensity: 0.6, size: 0.5 },
          { name: "wood-tap", at: 0.5, intensity: 0.7, size: 0.55 },
        ],
        // a perfect little cadence: the work is done
        notes: [
          { voice: "pluck", degree: REG.mid + 3, at: 0, velocity: 0.45, durBeats: 0.5 },
          { voice: "pluck", degree: REG.mid + 4, at: 0.5, velocity: 0.5, durBeats: 1.25 },
        ],
      };
    case "birth":
      return birthRecipe(identity);
    case "life-stage": {
      // sourceType "life-stage-changed": a single chime stepping up (grown) — the data's finer truth (elder) isn't projected, so the chime stays neutral-bright and brief.
      return {
        grid: 2,
        sfx: [],
        notes: [
          { voice: "bell", degree: REG.mid + 1, at: 0, velocity: 0.35, durBeats: 0.5 },
          { voice: "bell", degree: REG.mid + 3, at: 0.5, velocity: 0.38, durBeats: 1 },
        ],
      };
    }
    case "death":
      return deathRecipe(event.sourceType);
    case "plant-died":
      return {
        grid: 2,
        sfx: [{ name: "rustle", at: 0, intensity: 0.35, size: 0.4 }],
        notes: [{ voice: "pluck", degree: REG.mid - 1, at: 0, velocity: 0.2, durBeats: 0.5 }],
      };
    case "fire":
      if (event.sourceType === "plant-ignited") {
        return {
          grid: 2,
          sfx: [
            { name: "whoosh", at: 0, intensity: 0.65, size: 0.6 },
            { name: "crackle", at: 0.5, intensity: 0.6, size: 0.5 },
          ],
          // alarm color: the tense second
          notes: [{ voice: "bell", degree: REG.mid + 1, at: 0, velocity: 0.4, durBeats: 0.75 }],
        };
      }
      return {
        grid: 2,
        sfx: [
          { name: "crackle", at: 0, intensity: 0.45, size: 0.4 },
          { name: "thump", at: 0.5, intensity: 0.35, size: 0.5 },
        ],
        notes: [{ voice: "lament", degree: REG.mid - 1, at: 0, velocity: 0.25, durBeats: 1 }],
      };
    case "food":
      if (event.sourceType === "food-produced") {
        return { grid: 2, sfx: [], notes: [{ voice: "pluck", degree: REG.mid + 2, at: 0, velocity: 0.22, durBeats: 0.5 }] };
      }
      // spoilage: a muted, drooping tok — plenty turning to loss, quietly
      return { grid: 2, sfx: [{ name: "thump", at: 0, intensity: 0.2, size: 0.3 }], notes: [] };
    case "social":
      return {
        grid: 2,
        sfx: [{ name: "chatter", at: 0, intensity: 0.3, size: 0.5 }],
        notes: [
          { voice: "pluck", degree: REG.mid, at: 0, velocity: 0.18, durBeats: 0.25 },
          { voice: "pluck", degree: REG.mid + 2, at: 0.25, velocity: 0.16, durBeats: 0.25 },
        ],
      };
    case "fight":
      return {
        grid: 2,
        sfx: [
          { name: "scuffle", at: 0, intensity: 0.55, size: 0.5 },
          { name: "thump", at: 0.5, intensity: 0.5, size: 0.55 },
        ],
        notes: [
          { voice: "pluck", degree: REG.mid, at: 0, velocity: 0.4, durBeats: 0.2 },
          { voice: "pluck", degree: REG.mid + 1, at: 0.25, velocity: 0.38, durBeats: 0.3 },
        ],
      };
    case "infection":
      return { grid: 2, sfx: [{ name: "cough", at: 0, intensity: 0.35, size: 0.4 }], notes: [] };
    case "gate": {
      const opening = event.sourceType === "gate-opened";
      return {
        grid: 2,
        sfx: [
          { name: "creak", at: 0, intensity: 0.6, size: opening ? 0.7 : 0.4 },
          { name: "splash", at: 0.5, intensity: 0.35, size: 0.5 },
        ],
        notes: [{ voice: "pluck", degree: opening ? REG.mid + 2 : REG.mid - 1, at: 0.5, velocity: 0.3, durBeats: 0.75 }],
      };
    }
    case "item-picked-up":
      return { grid: 2, sfx: [], notes: [{ voice: "pluck", degree: REG.mid + 1, at: 0, velocity: 0.2, durBeats: 0.25 }] };
    case "item-dropped":
      return { grid: 2, sfx: [{ name: "thump", at: 0, intensity: 0.3, size: 0.45 }], notes: [] };
    case "item-moved":
      // A log changing hands: one soft wooden tok — the economy's heartbeat.
      return {
        grid: 2,
        sfx: [{ name: "wood-tap", at: 0, intensity: 0.28, size: 0.5 }],
        notes: [],
      };
    case "log-spawned":
      return { grid: 2, sfx: [{ name: "thump", at: 0, intensity: 0.4, size: 0.5 }], notes: [] };
    case "generic": {
      // The conductor's observed swim transitions arrive as this honest
      // pseudo-type (no EventLog record exists for "started swimming" —
      // the activity projection is the truth), voiced as a real splash.
      if (event.sourceType === "beaver-entered-water") {
        return {
          grid: 2,
          sfx: [{ name: "splash", at: 0, intensity: 0.5, size: 0.5 }],
          notes: [
            { voice: "droplet", degree: REG.high, at: 0.25, velocity: 0.16, durBeats: 0.2 },
            { voice: "droplet", degree: REG.high + 2, at: 0.5, velocity: 0.12, durBeats: 0.2 },
          ],
        };
      }
      // Even unmapped history sounds: a single quiet bell whose degree is a
      // stable function of the real type string — consistent, never silent.
      const stableDegree = (event.sourceType.length + event.sourceType.charCodeAt(0)) % 5;
      return {
        grid: 2,
        sfx: [],
        notes: [{ voice: "bell", degree: REG.mid + stableDegree, at: 0, velocity: 0.15, durBeats: 0.5 }],
      };
    }
  }
}

/** Realize a recipe into absolute, scale-quantized gestures at a beat/location. Pan/gain filled by the conductor's listener model. */
export function realizeRecipe(
  recipe: Recipe,
  identity: WorldMusicIdentity,
  scale: readonly number[],
  downbeat: number,
  pan: number,
  gain: number,
): Array<NoteGesture | SfxGesture> {
  const out: Array<NoteGesture | SfxGesture> = [];
  for (const note of recipe.notes) {
    out.push({
      kind: "note",
      voice: note.voice,
      beat: downbeat + note.at,
      immediate: false,
      midi: quantizeToScale(degreeToMidi(identity.root, scale, note.degree + 7), identity.root, scale),
      velocity: note.velocity,
      durBeats: note.durBeats,
      pan,
      gain,
    });
  }
  for (const sfx of recipe.sfx) {
    out.push({
      kind: "sfx",
      name: sfx.name,
      beat: downbeat + sfx.at,
      immediate: false,
      intensity: sfx.intensity,
      size: sfx.size,
      pan,
      gain,
    });
  }
  return out;
}
