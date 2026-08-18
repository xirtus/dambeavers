/**
 * The score's musical foundation: every world has a stable identity,
 * every quantized note lands in-scale, every chord is diatonic — the
 * invariants that make emergent polyphony consonant by construction.
 */
import { describe, expect, it } from "vitest";
import {
  MODE_FAMILIES,
  activeScale,
  chordFor,
  daylightAmount,
  degreeToMidi,
  midiToFreq,
  motifPhrase,
  quantizeToScale,
  slotRandom,
  worldMusicIdentity,
} from "../../src/presentation/audio/music-theory.js";

describe("worldMusicIdentity", () => {
  it("is deterministic per seed", () => {
    const a = worldMusicIdentity("m0-pond-test");
    const b = worldMusicIdentity("m0-pond-test");
    expect(a).toEqual(b);
  });

  it("different seeds produce musically different worlds", () => {
    const identities = new Set<string>();
    for (let i = 0; i < 24; i++) {
      const id = worldMusicIdentity(`world-${i}`);
      identities.add(`${id.root}/${id.family.id}/${id.bpm}/${id.chordCycle.join("")}`);
    }
    expect(identities.size).toBeGreaterThan(6);
  });

  it("tempo stays a walking andante and motif has five steps", () => {
    for (let i = 0; i < 40; i++) {
      const id = worldMusicIdentity(i * 7919);
      expect(id.bpm).toBeGreaterThanOrEqual(58);
      expect(id.bpm).toBeLessThanOrEqual(71);
      expect(id.motif).toHaveLength(5);
      expect(MODE_FAMILIES).toContain(id.family);
    }
  });
});

describe("scales and quantization", () => {
  it("quantizeToScale always lands on a scale tone", () => {
    const id = worldMusicIdentity("quantize");
    const scale = activeScale(id, 0.5, "clear");
    for (let midi = 30; midi < 100; midi++) {
      const q = quantizeToScale(midi, id.root, scale);
      const rel = ((q - id.root) % 12 + 12) % 12;
      expect(scale).toContain(rel);
    }
  });

  it("quantizeToScale never moves a note by more than a semitone", () => {
    const id = worldMusicIdentity("quantize-2");
    const scale = activeScale(id, 0.5, "clear");
    for (let midi = 30; midi < 100; midi++) {
      const q = quantizeToScale(midi, id.root, scale);
      expect(Math.abs(q - midi)).toBeLessThanOrEqual(1.0001);
    }
  });

  it("degreeToMidi wraps octaves both directions", () => {
    const scale = [0, 2, 4, 7, 9];
    expect(degreeToMidi(60, scale, 0)).toBe(60);
    expect(degreeToMidi(60, scale, 5)).toBe(72);
    expect(degreeToMidi(60, scale, -1)).toBe(57); // A below C
  });

  it("midiToFreq is concert-correct", () => {
    expect(midiToFreq(69)).toBeCloseTo(440, 6);
    expect(midiToFreq(57)).toBeCloseTo(220, 6);
  });

  it("every chord tone of every cycle position is diatonic", () => {
    for (const seedWord of ["a", "b", "c", "d", "e"]) {
      const id = worldMusicIdentity(seedWord);
      const scale = activeScale(id, 0.5, "clear");
      for (let cycle = 0; cycle < 8; cycle++) {
        for (const tone of chordFor(id, scale, cycle)) {
          const rel = ((tone - id.root) % 12 + 12) % 12;
          expect(scale).toContain(rel);
        }
      }
    }
  });

  it("motif phrases stay in the mode", () => {
    const id = worldMusicIdentity("motif");
    const scale = activeScale(id, 0.9, "clear");
    for (const midi of motifPhrase(id, scale, 0, 1)) {
      const rel = ((midi - id.root) % 12 + 12) % 12;
      expect(scale).toContain(rel);
    }
  });

  it("daylight is smooth and bounded", () => {
    for (let i = 0; i < 100; i++) {
      const v = daylightAmount(i / 100);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(daylightAmount(0.5)).toBeGreaterThan(0.9); // noon
    expect(daylightAmount(0)).toBeLessThan(0.1); // midnight
  });

  it("storms always take the tense scale", () => {
    const id = worldMusicIdentity("storm");
    expect(activeScale(id, 0.5, "storm")).toBe(id.family.tense);
  });
});

describe("slotRandom", () => {
  it("is a pure function of (world, slot, salt)", () => {
    const a = slotRandom(12345, 100, 7)();
    const b = slotRandom(12345, 100, 7)();
    expect(a).toBe(b);
    const c = slotRandom(12345, 101, 7)();
    expect(c).not.toBe(a);
  });
});
