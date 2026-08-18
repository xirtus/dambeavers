/**
 * Deterministic RGBA noise DataTexture -- four independent value-noise
 * channels, tileable, generated once from a fixed hash (Law R11: identical
 * every run, no Math.random). Shared by terrain detail, water ripple/foam
 * breakup, and particle sprites so those systems all sample one small
 * texture instead of three.
 */
import { DataTexture, RepeatWrapping, LinearFilter, RGBAFormat, UnsignedByteType } from "three";

function hash2(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Tileable value noise at (x,y) in [0,period) with the given octave period. */
function valueNoise(x: number, y: number, period: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = smooth(x - xi);
  const yf = smooth(y - yi);
  const x0 = ((xi % period) + period) % period;
  const x1 = (x0 + 1) % period;
  const y0 = ((yi % period) + period) % period;
  const y1 = (y0 + 1) % period;
  const a = hash2(x0, y0, seed);
  const b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed);
  const d = hash2(x1, y1, seed);
  return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
}

export function createNoiseTexture(size = 256): DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // R: soft billows (2 octaves of 8/16-period noise) -- foam blotches
      const r = valueNoise((x / size) * 8, (y / size) * 8, 8, 11) * 0.65 + valueNoise((x / size) * 16, (y / size) * 16, 16, 12) * 0.35;
      // G: fine grain (32-period) -- surface grain/ripple breakup
      const g = valueNoise((x / size) * 32, (y / size) * 32, 32, 23);
      // B: medium streaks (16-period) -- flow streaks, terrain mottling
      const b = valueNoise((x / size) * 16, (y / size) * 16, 16, 37);
      // A: very fine speckle (64-period)
      const a = valueNoise((x / size) * 64, (y / size) * 64, 64, 51);
      data[i] = Math.round(r * 255);
      data[i + 1] = Math.round(g * 255);
      data[i + 2] = Math.round(b * 255);
      data[i + 3] = Math.round(a * 255);
    }
  }
  const texture = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}
