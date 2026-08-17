import { ComponentStore, defineComponent, type ComponentType } from "../core/ComponentStore.js";
import type { EntityId } from "../core/EntityId.js";
import type { MaterialId } from "../materials/Material.js";
import type { World } from "../persistence/WorldSnapshot.js";
import { ambientTemperature } from "../weather/Weather.js";

/**
 * P3-08: a real, physical quantity of liquid held inside a container
 * entity (typically also carrying `Container.ts`'s discrete-item
 * `Container`, but this component is independent of it -- a barrel
 * holds either loose items or a liquid, never modeled as needing both at
 * once). `materialId` is the base liquid (`"water"`, P0-07); `composition`
 * holds dissolved/suspended substance fractions (`{sugar: 0.1}`) of that
 * same volume -- fractions need not sum to 1 (the remainder is inert
 * solvent), matching a real solution rather than a fixed enum of liquid
 * "types."
 */
export interface LiquidContents {
  capacityL: number;
  materialId?: MaterialId;
  volumeL: number;
  composition: Readonly<Record<string, number>>;
}
export const LiquidContentsComponent: ComponentType<LiquidContents> = defineComponent<LiquidContents>("liquid-contents");

const EMPTY_EPSILON_L = 1e-9;

export function assertValidLiquidContents(liquid: LiquidContents): void {
  if (!(Number.isFinite(liquid.capacityL) && liquid.capacityL > 0)) {
    throw new RangeError(`liquid capacityL must be a positive finite number, got ${liquid.capacityL}`);
  }
  if (!(Number.isFinite(liquid.volumeL) && liquid.volumeL >= 0)) {
    throw new RangeError(`liquid volumeL must be a non-negative finite number, got ${liquid.volumeL}`);
  }
  if (liquid.volumeL > liquid.capacityL + 1e-9) {
    throw new RangeError(`liquid volumeL (${liquid.volumeL}) exceeds capacityL (${liquid.capacityL})`);
  }
  if (liquid.materialId !== undefined && liquid.materialId.trim().length === 0) {
    throw new RangeError("liquid materialId must be non-empty when present");
  }
  if (liquid.volumeL <= EMPTY_EPSILON_L && liquid.materialId !== undefined) {
    throw new RangeError("liquid with zero volume must not have a materialId");
  }
  for (const [key, fraction] of Object.entries(liquid.composition)) {
    if (!(Number.isFinite(fraction) && fraction >= 0 && fraction <= 1)) {
      throw new RangeError(`liquid composition fraction for "${key}" must be between 0 and 1, got ${fraction}`);
    }
  }
}

export function setLiquidContents(components: ComponentStore, id: EntityId, liquid: LiquidContents): void {
  assertValidLiquidContents(liquid);
  const normalized: LiquidContents = { capacityL: liquid.capacityL, volumeL: liquid.volumeL, composition: { ...liquid.composition } };
  if (liquid.materialId !== undefined) normalized.materialId = liquid.materialId;
  components.set(id, LiquidContentsComponent, normalized);
}

export function getLiquidContents(components: ComponentStore, id: EntityId): LiquidContents | undefined {
  const liquid = components.get(id, LiquidContentsComponent);
  if (liquid !== undefined) assertValidLiquidContents(liquid);
  return liquid;
}

export function createLiquidContainer(world: World, capacityL: number, position: { x: number; y: number; z: number }): EntityId {
  const id = world.entities.create("liquid-container");
  world.grid.setEntityPosition(id, position.x, position.y, position.z);
  setLiquidContents(world.components, id, { capacityL, volumeL: 0, composition: {} });
  return id;
}

/**
 * Moves up to `requestedVolumeL` from `fromId` to `toId`, conserving both
 * total quantity (the source loses exactly what the destination gains --
 * this function's own literal P3-08 acceptance test) and composition
 * (the destination's fractions become the volume-weighted average of
 * what it already held and what arrived, the physically correct mixing
 * result, not a discard-and-replace). Returns the ACTUAL volume moved,
 * which can be less than requested if the source doesn't have enough or
 * the destination doesn't have room -- never partially applied (either
 * both sides update by the same real amount, or neither does). Throws if
 * the two containers hold incompatible base liquids (mixing water and,
 * say, a future non-water base liquid is a real operation this system
 * doesn't yet model, so it's rejected rather than silently overwriting
 * one).
 */
export function transferLiquid(components: ComponentStore, fromId: EntityId, toId: EntityId, requestedVolumeL: number): number {
  const source = getLiquidContents(components, fromId);
  const destination = getLiquidContents(components, toId);
  if (source === undefined) throw new RangeError(`entity ${fromId} has no LiquidContents component`);
  if (destination === undefined) throw new RangeError(`entity ${toId} has no LiquidContents component`);
  if (source.materialId === undefined || source.volumeL <= EMPTY_EPSILON_L) return 0;
  if (destination.materialId !== undefined && destination.materialId !== source.materialId) {
    throw new RangeError(`cannot transfer "${source.materialId}" into a container holding "${destination.materialId}"`);
  }

  const availableSpace = destination.capacityL - destination.volumeL;
  const actual = Math.max(0, Math.min(requestedVolumeL, source.volumeL, availableSpace));
  if (actual <= EMPTY_EPSILON_L) return 0;

  const mergedComposition: Record<string, number> = {};
  const keys = new Set([...Object.keys(source.composition), ...Object.keys(destination.composition)]);
  const newVolumeL = destination.volumeL + actual;
  for (const key of keys) {
    const destFraction = destination.composition[key] ?? 0;
    const srcFraction = source.composition[key] ?? 0;
    mergedComposition[key] = (destination.volumeL * destFraction + actual * srcFraction) / newVolumeL;
  }

  setLiquidContents(components, toId, { capacityL: destination.capacityL, materialId: source.materialId, volumeL: newVolumeL, composition: mergedComposition });

  const remainingVolumeL = source.volumeL - actual;
  if (remainingVolumeL <= EMPTY_EPSILON_L) {
    setLiquidContents(components, fromId, { capacityL: source.capacityL, volumeL: 0, composition: {} });
  } else {
    setLiquidContents(components, fromId, { capacityL: source.capacityL, materialId: source.materialId, volumeL: remainingVolumeL, composition: { ...source.composition } });
  }
  return actual;
}

/** Fraction of `substance` converted to `intoSubstance` per tick, at ambient temperature `1` (peak daytime warmth, `Weather.ts`'s own `[0,1]` scale) -- plausible, tunable balance data. Real fermentation needs real warmth: `tickFermentation` scales this by the CURRENT ambient temperature, so a cold container ferments slower, never at a flat rate regardless of conditions. */
export const FERMENTATION_RATE_PER_TICK = 0.001;

/** P3-09: advances one fermentable substance's conversion inside a liquid container by one tick, driven by real ambient conditions (`Weather.ts`'s `ambientTemperature`, already a pure function of tick -- no new environmental mechanism invented here). A no-op if the container is empty or has none of `substance` left. Intoxication/consumption effects are deliberately out of scope (AGENTS.md Law 10 -- not yet a real roadmap task). */
export function tickFermentation(world: World, containerId: EntityId, substance: string, intoSubstance: string): void {
  const liquid = getLiquidContents(world.components, containerId);
  if (liquid === undefined || liquid.materialId === undefined) return;
  const sourceFraction = liquid.composition[substance] ?? 0;
  if (sourceFraction <= 0) return;
  const temperature = ambientTemperature(world.clock.tick);
  const delta = Math.min(sourceFraction, FERMENTATION_RATE_PER_TICK * temperature);
  if (delta <= 0) return;
  const composition = { ...liquid.composition };
  composition[substance] = sourceFraction - delta;
  composition[intoSubstance] = (composition[intoSubstance] ?? 0) + delta;
  setLiquidContents(world.components, containerId, { ...liquid, composition });
}
