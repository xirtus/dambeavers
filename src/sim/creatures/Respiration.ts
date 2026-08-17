import { ComponentStore, defineComponent, type ComponentType } from "../core/ComponentStore.js";
import type { EntityId } from "../core/EntityId.js";
import type { WorldGrid } from "../world/WorldGrid.js";
import type { WaterField } from "../hydrology/WaterField.js";
import { clamp01 } from "./Needs.js";

/**
 * P1-16's "respiratory state" -- a real, depleting resource distinct from
 * `Needs` (P1-06) and `Health` (P1-05): `[0, 1]`, 1 = full breath, 0 =
 * completely out of air. This is the mechanism the roadmap's own literal
 * acceptance test names ("a beaver unable to surface can die through
 * respiratory state depletion") -- `Mortality.ts`'s `tickMortality`
 * converts SUSTAINED zero-breath into real `Health` damage, which is what
 * actually kills a beaver; nothing here ever destroys an entity directly.
 */
export interface Breath {
  fraction: number;
}
export const BreathComponent: ComponentType<Breath> = defineComponent<Breath>("breath");
export const BASELINE_BREATH: Readonly<Breath> = Object.freeze({ fraction: 1 });

export function assertValidBreath(breath: Breath): void {
  if (!(breath.fraction >= 0) || !(breath.fraction <= 1)) {
    throw new RangeError(`breath fraction must be in [0, 1], got ${breath.fraction}`);
  }
}

export function setBreath(components: ComponentStore, id: EntityId, breath: Breath): void {
  assertValidBreath(breath);
  components.set(id, BreathComponent, breath);
}

export function getBreath(components: ComponentStore, id: EntityId): Breath | undefined {
  const breath = components.get(id, BreathComponent);
  if (breath !== undefined) assertValidBreath(breath);
  return breath;
}

/** Per-tick breath change while unable to breathe vs. while able to -- recovery is deliberately much faster than depletion, matching real physiology (one held breath drains over many seconds; a fresh one refills in moments) and this project's own established `FATIGUE_REST_RECOVERY_PER_TICK`-style precedent for asymmetric drive/recover rates. Plausible, tunable balance data. */
export const BREATH_DEPLETION_PER_TICK = 0.05;
export const BREATH_RECOVERY_PER_TICK = 0.5;

/** A pure function of its inputs (AGENTS.md Law 8), exactly like `applyNeedsTick`/`applyThermalExposure`. */
export function applyBreathTick(breath: Breath, canBreathe: boolean): Breath {
  assertValidBreath(breath);
  return { fraction: clamp01(breath.fraction + (canBreathe ? BREATH_RECOVERY_PER_TICK : -BREATH_DEPLETION_PER_TICK)) };
}

/**
 * Whether a beaver standing at `(x, y, z)` can currently reach real open
 * air -- true for any dry column (trivially), and true for a wet column
 * as long as there's a genuinely clear vertical path from the beaver's
 * own position up through and past the water's surface (real
 * `WorldGrid.isSolid` cells, P0-05/09, not a separate "trapped" flag).
 * Ordinary swimming in open water is never breath-depleting under this
 * check -- a swimmer can always surface -- only a column where a solid
 * ceiling (or the map's own vertical extent) blocks that path counts as
 * "unable to surface," the roadmap's own literal phrase. This is the ONE
 * live-world-state check `tickMortality` (`Mortality.ts`) drives the
 * entire drowning mechanism from; nothing about drowning is scripted
 * here or there.
 *
 * Deliberately takes the beaver's own known `y`, rather than re-deriving
 * "the floor" via `grid.surfaceY(x, z)` (`WorldGrid.surfaceY`'s own
 * documented contract is "the topmost SOLID cell in this column," not
 * "the ground a specific creature is standing on" -- those are the SAME
 * value in every column this project's terrain generation has ever
 * produced, since nothing before this task ever placed solid material
 * ABOVE open, standable ground in the same column, matching
 * `Pathfinding.ts`'s own documented "nothing built here can currently
 * produce a disconnected overhang" assumption -- but a sealed, flooded
 * chamber, exactly this function's own reason to exist, is precisely
 * that scenario: once a real ceiling sits above the beaver's true floor,
 * `grid.surfaceY(x, z)` starts reporting the CEILING as the topmost solid
 * cell instead, silently corrupting any calculation built on top of it.
 * The beaver's own live `WorldGrid` position is always correct regardless
 * -- `tickMortality` already has it, so nothing here needs to re-derive
 * it from the terrain and risk this exact conflation). For the same
 * reason, the water surface used here is computed directly from the raw
 * stored `depthAt` value plus this SAME true floor, not from
 * `WaterField.waterSurfaceY` (which internally re-derives its own floor
 * via `grid.surfaceY` too, and would inherit the identical corruption in
 * a sealed-chamber scenario).
 */
export function canBreatheAt(grid: WorldGrid, water: WaterField, x: number, y: number, z: number): boolean {
  const depth = water.depthAt(x, z);
  if (depth <= 0) return true;
  const floor = y - 1; // the beaver's own real ground reference -- see doc comment above
  const surfaceY = floor + depth;
  const sizeY = grid.dims.sizeY;
  for (let cellY = y; cellY <= surfaceY + 1; cellY++) {
    if (cellY >= sizeY) return false; // the water fills the map's entire vertical extent here -- nowhere left to surface
    if (grid.isSolid(x, cellY, z)) return false; // a solid ceiling blocks the path to air before reaching it
  }
  return true;
}
