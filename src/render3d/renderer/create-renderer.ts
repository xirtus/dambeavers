/**
 * Renderer factory (threejs_layer.md §7): WebGPU-forward with automatic
 * WebGL 2 fallback via three's WebGPURenderer(forceWebGL). One material
 * codebase (TSL node materials) compiles to both backends, so the fallback
 * path is a real, testable configuration -- not a second renderer.
 *
 * Deterministic render-test mode (Law R11): forced WebGL backend, fixed
 * pixel ratio, no antialias sample randomness, frozen visual time (the app
 * pins the global time uniform), ACES off in favor of literal output only
 * if requested. Everything visual stays identical frame-to-frame for the
 * same authoritative state + camera.
 */
import { WebGPURenderer } from "three/webgpu";
import type { WebGPURendererParameters } from "three/webgpu";
import { ACESFilmicToneMapping, SRGBColorSpace } from "three";

export type RenderBackend = "webgpu" | "webgl";

export interface RenderSettings {
  readonly backend: RenderBackend;
  readonly deterministic: boolean;
  readonly pixelRatio: number;
  readonly antialias: boolean;
  readonly shadowMapSize: number;
  readonly maxAnisotropy: number;
}

export interface QualityTier {
  readonly name: "low" | "medium" | "high" | "ultra";
  readonly renderScale: number;
  readonly shadowMapSize: number;
  readonly particleMultiplier: number;
  readonly vegetationDensity: number;
}

export const QUALITY_TIERS: readonly QualityTier[] = [
  { name: "low", renderScale: 0.75, shadowMapSize: 1024, particleMultiplier: 0.4, vegetationDensity: 0.6 },
  { name: "medium", renderScale: 1, shadowMapSize: 2048, particleMultiplier: 0.7, vegetationDensity: 0.85 },
  { name: "high", renderScale: 1, shadowMapSize: 4096, particleMultiplier: 1, vegetationDensity: 1 },
  { name: "ultra", renderScale: 1.25, shadowMapSize: 4096, particleMultiplier: 1.5, vegetationDensity: 1 },
];

export async function detectBestBackend(): Promise<RenderBackend> {
  if (typeof navigator === "undefined" || !("gpu" in navigator)) return "webgl";
  try {
    const gpu = (navigator as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    const adapter = await gpu?.requestAdapter();
    return adapter ? "webgpu" : "webgl";
  } catch {
    return "webgl";
  }
}

export interface CreatedRenderer {
  readonly renderer: WebGPURenderer;
  readonly backend: RenderBackend;
  readonly settings: RenderSettings;
}

export async function createRenderer(options: {
  canvas: HTMLCanvasElement;
  deterministic?: boolean;
  forceBackend?: RenderBackend;
  quality?: QualityTier;
}): Promise<CreatedRenderer> {
  const deterministic = options.deterministic ?? false;
  const backend = options.forceBackend ?? (deterministic ? "webgl" : await detectBestBackend());
  const quality = options.quality ?? QUALITY_TIERS[2]!;

  const parameters: WebGPURendererParameters = {
    canvas: options.canvas,
    antialias: !deterministic,
    forceWebGL: backend === "webgl",
    powerPreference: "high-performance",
  };
  const renderer = new WebGPURenderer(parameters);
  renderer.setPixelRatio(deterministic ? 1 : Math.min(globalThis.devicePixelRatio || 1, 2) * quality.renderScale);
  renderer.setSize(options.canvas.clientWidth || globalThis.innerWidth, options.canvas.clientHeight || globalThis.innerHeight, false);
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  await renderer.init();

  const settings: RenderSettings = {
    backend,
    deterministic,
    pixelRatio: renderer.getPixelRatio(),
    antialias: !deterministic,
    shadowMapSize: quality.shadowMapSize,
    maxAnisotropy: 8,
  };
  return { renderer, backend, settings };
}
