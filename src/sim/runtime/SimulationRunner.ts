import { EntityIdRegistry } from "../core/EntityId.js";
import { ComponentStore } from "../core/ComponentStore.js";
import { SimulationClock } from "../core/SimulationClock.js";
import { RandomStreams } from "../core/Random.js";
import { WorldGrid, type WorldGridDimensions } from "../world/WorldGrid.js";
import { TerrainField } from "../world/TerrainField.js";
import { EventLog } from "../history/EventLog.js";
import { MaterialRegistry } from "../materials/Material.js";
import { registerStandardMaterials } from "../materials/standardMaterials.js";
import type { World } from "../persistence/WorldSnapshot.js";

/**
 * An intention requesting state change (ARCHITECTURE_CONTRACT §8): the
 * thing a headless runner "injects." `type` is a label for
 * observability/CI assertions ("which commands ran"), not a dispatch key
 * this file switches on -- `apply` IS the command; nothing here branches
 * on `type`. Deliberately just this generic shape, not a growing library
 * of concrete commands (`PauseCommand`, `DesignateTreeCutCommand`, ...):
 * P0-11's job is the injection MECHANISM, not the command vocabulary,
 * which belongs to whichever future system (jobs, construction, ...)
 * needs a concrete command. A caller can express "pause" today as
 * `{ type: "pause", apply: (world) => world.clock.pause() }` with no
 * library needed.
 */
export interface Command {
  readonly type: string;
  apply(world: World): void;
}

export interface CreateWorldOptions {
  /** Drives every subsystem's determinism: `RandomStreams`' master seed. Same seed + same commands + same tick count -> bit-for-bit identical resulting world state (ARCHITECTURE_CONTRACT §17). */
  seed: number | string;
  dimensions: WorldGridDimensions;
  /** Defaults to 20, matching `SimulationClock`'s own default. */
  tickRateHz?: number;
}

/**
 * Deterministically constructs a fresh, empty `World`: real terrain
 * substrate (an empty `TerrainField` over a `WorldGrid` of the given
 * dimensions, with the standard material set registered) and real
 * identity/component/event/clock/random subsystems, but no generated
 * watershed content -- terrain shaping, tree spawning, and beaver
 * placement are later systems (P1-01 and beyond) layered on top of this,
 * not P0-11's job. A caller (a test, or eventually a real watershed
 * generator) populates the returned world before/via commands.
 */
export function createWorld(options: CreateWorldOptions): World {
  const entities = new EntityIdRegistry();
  const components = new ComponentStore(entities);
  const grid = new WorldGrid(options.dimensions, entities);
  const materials = new MaterialRegistry();
  registerStandardMaterials(materials);
  const terrain = new TerrainField(grid, materials);
  const events = new EventLog(entities);
  const clock = new SimulationClock(
    options.tickRateHz !== undefined ? { tickRateHz: options.tickRateHz } : {},
  );
  const random = new RandomStreams(options.seed);
  return { clock, random, entities, components, grid, terrain, events };
}

/** Applies each command to `world` in order. A thin loop, not a queue/scheduler: commands run synchronously, immediately, in the order given -- any ordering semantics beyond that belong to whichever system produces the command list. */
export function applyCommands(world: World, commands: readonly Command[]): void {
  for (const command of commands) {
    command.apply(world);
  }
}

export interface RunHeadlessOptions extends CreateWorldOptions {
  /** Exact number of simulation ticks to run, via `SimulationClock.advanceTicks` -- not a real-time delta, so this is unaffected by render frame rate or `pause`/`speed` state (P0-11's whole point: deterministic, headless, CI-drivable). */
  ticks: number;
  /** Applied once, before ticking begins. */
  commands?: readonly Command[];
}

/**
 * One-shot headless run: construct a deterministic world from a seed,
 * inject commands, simulate exactly N ticks, and hand back the resulting
 * world for the caller to assert on. This is the literal shape of P0-11's
 * roadmap acceptance test ("CI can load a seed, inject commands, simulate
 * N ticks, and assert world state") -- everything it touches
 * (`EntityIdRegistry`, `ComponentStore`, `WorldGrid`, `TerrainField`,
 * `EventLog`, `SimulationClock`, `RandomStreams`) is plain
 * simulation-layer TypeScript with zero dependency on any renderer/UI
 * code (none exists in this repository yet), satisfying
 * ARCHITECTURE_CONTRACT §1's "must run fully headless" requirement by
 * construction rather than by convention.
 */
export function runHeadless(options: RunHeadlessOptions): World {
  // Validated up front, before any world construction or command
  // execution: a CI harness that passes a bad `ticks` value should fail
  // immediately, not after paying for a full world build and every
  // command's side effects only to hit the identical check inside
  // `advanceTicks` afterward.
  if (!Number.isInteger(options.ticks) || options.ticks < 0) {
    throw new RangeError(`ticks must be a non-negative integer, got ${options.ticks}`);
  }
  const world = createWorld(options);
  if (options.commands !== undefined) {
    applyCommands(world, options.commands);
  }
  world.clock.advanceTicks(options.ticks);
  return world;
}
