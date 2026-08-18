/**
 * The conductor's contract: deterministic composition, total coverage
 * (every render event kind is voiced), grid-locked timing (the world
 * plays in time), honest silence when paused, and listener truth (far
 * things quieter, pan follows the camera). Pure and headless — this file
 * never touches an audio API.
 */
import { describe, expect, it } from "vitest";
import { Conductor } from "../../src/presentation/audio/conductor.js";
import type { RenderFrame, RenderEnvironment } from "../../src/presentation/contracts/render-frame.js";
import type { RenderEvent, RenderEventKind } from "../../src/presentation/contracts/render-events.js";
import type { SoundGesture } from "../../src/presentation/audio/sound-gesture.js";
import { activeScale, worldMusicIdentity } from "../../src/presentation/audio/music-theory.js";

function environment(overrides: Partial<RenderEnvironment> = {}): RenderEnvironment {
  return {
    tick: 0,
    dayPhase: 0.45,
    isDaytime: true,
    weatherCondition: "clear",
    ambientTemperature: 0.7,
    paused: false,
    speed: 1,
    ...overrides,
  };
}

function frame(overrides: Partial<RenderFrame> = {}): RenderFrame {
  return {
    schemaVersion: 1,
    tick: 0,
    worldRevision: 1,
    fullSync: false,
    focus: { sizeX: 41, sizeY: 14, sizeZ: 61 },
    environment: environment(),
    entityUpserts: [],
    entityRemovals: [],
    dirtyTerrainChunks: [],
    dirtyWaterChunks: [],
    events: [],
    liveBeavers: 7,
    liveTrees: 40,
    looseLogs: 0,
    ...overrides,
  };
}

function event(kind: RenderEventKind, sourceType: string, x = 21, z = 31): RenderEvent {
  return { kind, sourceType, tick: 0, entityIds: [1], location: { x, y: 8, z } };
}

const NEAR_LISTENER = { x: 21, y: 9, z: 31, yaw: 0.8, distance: 20, underwater: 0 };

function run(conductor: Conductor, seconds: number, step = 0.05): SoundGesture[] {
  const out: SoundGesture[] = [];
  for (let t = 0; t < seconds; t += step) out.push(...conductor.produce(step).gestures);
  return out;
}

describe("event coverage — nothing that happens is silent", () => {
  const ALL_KINDS: Array<[RenderEventKind, string]> = [
    ["tree-felled", "tree-felled"],
    ["log-spawned", "log-spawned"],
    ["construction-complete", "construction-completed"],
    ["dam-segment-applied", "dam-segment-applied"],
    ["item-picked-up", "item-picked-up"],
    ["item-dropped", "refuse-created"],
    ["item-moved", "item-moved"],
    ["death", "drowning-death"],
    ["death", "starvation-death"],
    ["death", "trauma-death"],
    ["birth", "offspring-born"],
    ["life-stage", "life-stage-changed"],
    ["plant-died", "plant-died"],
    ["fire", "plant-ignited"],
    ["fire", "plant-burned-out"],
    ["food", "food-produced"],
    ["food", "food-spoiled"],
    ["social", "social-interaction"],
    ["fight", "beaver-fight"],
    ["infection", "infection-contracted"],
    ["gate", "gate-opened"],
    ["gate", "gate-closed"],
    ["generic", "meteor-struck"],
  ];

  it.each(ALL_KINDS)("kind %s (%s) produces gestures", (kind, sourceType) => {
    const conductor = new Conductor({ seed: "coverage" });
    conductor.setListener(NEAR_LISTENER);
    conductor.ingestFrame(frame({ events: [event(kind, sourceType)] }));
    const gestures = conductor.produce(0.05).gestures;
    expect(gestures.length).toBeGreaterThan(0);
    for (const g of gestures) {
      expect(g.gain).toBeGreaterThan(0);
      expect(g.gain).toBeLessThanOrEqual(1);
    }
  });

  it("every pitched event note is in the current mode (consonance by construction)", () => {
    const identity = worldMusicIdentity("coverage-scale");
    for (const [kind, sourceType] of ALL_KINDS) {
      const conductor = new Conductor({ seed: "coverage-scale" });
      conductor.setListener(NEAR_LISTENER);
      conductor.ingestFrame(frame({ events: [event(kind, sourceType)] }));
      const scale = activeScale(identity, 0.45, "clear");
      for (const g of conductor.produce(0.05).gestures) {
        if (g.kind !== "note" || g.voice === "cricket") continue;
        const rel = ((g.midi - identity.root) % 12 + 12) % 12;
        expect(scale, `${kind}/${sourceType} note ${g.midi} out of scale`).toContain(rel);
      }
    }
  });
});

describe("grid quantization — the world plays in time", () => {
  it("heavy events land on beats, light events on eighths", () => {
    const conductor = new Conductor({ seed: "grid" });
    conductor.setListener(NEAR_LISTENER);
    conductor.ingestFrame(frame({ events: [event("tree-felled", "tree-felled"), event("item-moved", "item-moved")] }));
    const gestures = conductor.produce(0.05).gestures;
    const heavy = gestures.filter((g) => g.kind === "sfx" && g.name === "wood-crack");
    expect(heavy.length).toBe(1);
    const beat = heavy[0]!.beat;
    expect(Math.abs(beat - Math.round(beat))).toBeLessThan(1e-6); // on the quarter
    const light = gestures.filter((g) => g.kind === "sfx" && g.name === "wood-tap");
    for (const tap of light) {
      expect(Math.abs(tap.beat * 2 - Math.round(tap.beat * 2))).toBeLessThan(1e-6); // on an eighth
    }
  });
});

describe("determinism — the same world hears the same piece", () => {
  it("identical inputs produce identical streams, including rain and night", () => {
    const compose = (): SoundGesture[] => {
      const conductor = new Conductor({ seed: "deterministic-world" });
      conductor.setListener(NEAR_LISTENER);
      const out: SoundGesture[] = [];
      // a rain day
      conductor.ingestFrame(frame({ environment: environment({ weatherCondition: "rain" }) }));
      out.push(...run(conductor, 6));
      // night with a beaver working nearby
      conductor.ingestFrame(
        frame({
          environment: environment({ dayPhase: 0.95, isDaytime: false, weatherCondition: "clear" }),
          entityUpserts: [{ id: 42, kind: "beaver", x: 23, y: 8, z: 33, live: true, activity: "cutting-tree", revision: 1 }],
        }),
      );
      out.push(...run(conductor, 6));
      // a death and a birth
      conductor.ingestFrame(frame({ events: [event("death", "drowning-death"), event("birth", "offspring-born")] }));
      out.push(...run(conductor, 4));
      return out;
    };
    const a = compose();
    const b = compose();
    expect(a.length).toBeGreaterThan(10);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("transport honesty", () => {
  it("the beat clock holds while paused, and UI sounds still answer", () => {
    const conductor = new Conductor({ seed: "pause" });
    conductor.setListener(NEAR_LISTENER);
    conductor.ingestFrame(frame({ environment: environment({ paused: true }) }));
    const before = conductor.produce(1).transport;
    expect(before.running).toBe(false);
    expect(before.beatsPerSecond).toBe(0);
    const silent = run(conductor, 2);
    expect(silent).toHaveLength(0);
    conductor.ui("ui-confirm");
    const ui = conductor.produce(0.05).gestures;
    expect(ui.length).toBeGreaterThan(0);
    expect(ui.every((g) => g.immediate)).toBe(true);
  });

  it("speed quickens the score sub-linearly (8× is brisk, never frantic)", () => {
    const atSpeed = (speed: number): number => {
      const conductor = new Conductor({ seed: "speed" });
      conductor.ingestFrame(frame({ environment: environment({ speed }) }));
      return conductor.produce(0.05).transport.beatsPerSecond;
    };
    const one = atSpeed(1);
    const eight = atSpeed(8);
    expect(eight).toBeGreaterThan(one);
    expect(eight / one).toBeLessThan(2.2);
  });
});

describe("listener truth", () => {
  it("far events are quieter and can fall silent; near events are loud", () => {
    // compare the event recipe's own percussion (ambient wildlife is not part of this assertion)
    const crackGain = (gestures: readonly SoundGesture[]): number => {
      const cracks = gestures.filter((g) => g.kind === "sfx" && (g.name === "wood-crack" || g.name === "thump"));
      return cracks.length === 0 ? 0 : Math.max(...cracks.map((g) => g.gain));
    };
    const near = new Conductor({ seed: "space" });
    near.setListener(NEAR_LISTENER);
    near.ingestFrame(frame({ events: [event("tree-felled", "tree-felled", 21, 31)] }));
    const nearGain = crackGain(near.produce(0.05).gestures);

    const far = new Conductor({ seed: "space" });
    far.setListener(NEAR_LISTENER);
    far.ingestFrame(frame({ events: [event("tree-felled", "tree-felled", 5, 5)] }));
    const farGain = crackGain(far.produce(0.05).gestures);

    expect(nearGain).toBeGreaterThan(0.5);
    expect(farGain).toBeGreaterThan(0); // audible but faint at ~30 cells
    expect(farGain).toBeLessThan(nearGain * 0.4);

    const gone = new Conductor({ seed: "space" });
    gone.setListener(NEAR_LISTENER);
    gone.ingestFrame(frame({ events: [event("item-moved", "item-moved", 0, 0)] })); // a quiet tok across the whole map
    const goneCracks = gone.produce(0.05).gestures.filter((g) => g.kind === "sfx" && g.name === "wood-tap");
    expect(goneCracks).toHaveLength(0); // below audibility: honestly silent
  });

  it("pan follows the camera's right vector", () => {
    const conductor = new Conductor({ seed: "pan" });
    conductor.setListener({ x: 20, y: 9, z: 30, yaw: 0, distance: 20, underwater: 0 }); // facing -z; right = +x
    conductor.ingestFrame(frame({ events: [event("item-moved", "item-moved", 26, 30)] }));
    const gestures = conductor.produce(0.05).gestures;
    expect(gestures.length).toBeGreaterThan(0);
    for (const g of gestures) expect(g.pan).toBeGreaterThan(0);
  });

  it("submersion muffles the world", () => {
    const conductor = new Conductor({ seed: "muffle" });
    conductor.setListener({ ...NEAR_LISTENER, underwater: 1 });
    conductor.ingestFrame(frame({ events: [event("tree-felled", "tree-felled")] }));
    const frameOut = conductor.produce(0.05);
    expect(frameOut.layers.muffle).toBe(1);
    const open = new Conductor({ seed: "muffle" });
    open.setListener(NEAR_LISTENER);
    open.ingestFrame(frame({ events: [event("tree-felled", "tree-felled")] }));
    const openGain = Math.max(...open.produce(0.05).gestures.map((g) => g.gain));
    const underGain = Math.max(...frameOut.gestures.map((g) => g.gain));
    expect(underGain).toBeLessThan(openGain);
  });
});

describe("generative beds follow real state", () => {
  it("rain becomes a pentatonic music-box and stops when the sky clears", () => {
    const conductor = new Conductor({ seed: "rain" });
    conductor.setListener(NEAR_LISTENER);
    conductor.ingestFrame(frame({ environment: environment({ weatherCondition: "rain" }) }));
    const rainGestures = run(conductor, 8);
    const droplets = rainGestures.filter((g) => g.kind === "note" && g.voice === "droplet");
    expect(droplets.length).toBeGreaterThan(4);
    const identity = worldMusicIdentity("rain");
    const scale = activeScale(identity, 0.45, "rain");
    for (const drop of droplets) {
      const rel = (((drop.kind === "note" ? drop.midi : 0) - identity.root) % 12 + 12) % 12;
      expect(scale).toContain(rel);
    }
    const dry = new Conductor({ seed: "rain" });
    dry.setListener(NEAR_LISTENER);
    dry.ingestFrame(frame());
    const dryGestures = run(dry, 8);
    expect(dryGestures.filter((g) => g.kind === "note" && g.voice === "droplet")).toHaveLength(0);
  });

  it("work rhythms: a cutting beaver becomes transport-locked percussion", () => {
    const conductor = new Conductor({ seed: "work" });
    conductor.setListener(NEAR_LISTENER);
    conductor.ingestFrame(
      frame({
        entityUpserts: [{ id: 7, kind: "beaver", x: 22, y: 8, z: 31, live: true, activity: "cutting-tree", revision: 1 }],
      }),
    );
    const gestures = run(conductor, 3);
    const gnaws = gestures.filter((g) => g.kind === "sfx" && g.name === "gnaw");
    expect(gnaws.length).toBeGreaterThanOrEqual(4);
    for (const gnaw of gnaws) {
      expect(gnaw.beat).toBeGreaterThan(0);
      // steps land near the half-beat grid (jitter < 5%)
      const frac = Math.abs((gnaw.beat * 2) % 1);
      expect(Math.min(frac, 1 - frac)).toBeLessThan(0.06);
    }
  });

  it("a beaver diving in splashes (observed activity transition)", () => {
    const conductor = new Conductor({ seed: "splash" });
    conductor.setListener(NEAR_LISTENER);
    conductor.ingestFrame(
      frame({ entityUpserts: [{ id: 9, kind: "beaver", x: 22, y: 8, z: 31, live: true, activity: "walking", revision: 1 }] }),
    );
    run(conductor, 0.2);
    conductor.ingestFrame(
      frame({ entityUpserts: [{ id: 9, kind: "beaver", x: 22, y: 8, z: 31, live: true, activity: "swimming", revision: 2 }] }),
    );
    const gestures = conductor.produce(0.05).gestures;
    expect(gestures.some((g) => g.kind === "sfx" && g.name === "splash")).toBe(true);
    expect(gestures.some((g) => g.kind === "note" && g.voice === "droplet")).toBe(true);
  });

  it("crickets own the clear night, birds the clear day", () => {
    const day = new Conductor({ seed: "wildlife" });
    day.setListener(NEAR_LISTENER);
    day.ingestFrame(frame());
    const dayGestures = run(day, 30);
    expect(dayGestures.some((g) => g.kind === "note" && g.voice === "cricket")).toBe(false);

    const night = new Conductor({ seed: "wildlife" });
    night.setListener(NEAR_LISTENER);
    night.ingestFrame(frame({ environment: environment({ dayPhase: 0.98, isDaytime: false }) }));
    const nightGestures = run(night, 12);
    expect(nightGestures.some((g) => g.kind === "note" && g.voice === "cricket")).toBe(true);
  });
});

describe("score observability", () => {
  it("exposes inspectable debug state", () => {
    const conductor = new Conductor({ seed: "debug" });
    conductor.ingestFrame(frame());
    conductor.produce(0.1);
    const state = conductor.getDebugState();
    expect(state["family"]).toBe(worldMusicIdentity("debug").family.id);
    expect(state["running"]).toBe(true);
    expect(typeof state["beat"]).toBe("number");
  });
});
