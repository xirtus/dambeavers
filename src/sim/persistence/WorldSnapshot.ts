import { EntityIdRegistry, type EntityIdRegistrySnapshot } from "../core/EntityId.js";
import { ComponentStore, type ComponentStoreSnapshot, type ComponentType } from "../core/ComponentStore.js";
import { SimulationClock, type SimulationClockSnapshot } from "../core/SimulationClock.js";
import { RandomStreams, type RandomStreamsSnapshot } from "../core/Random.js";
import { WorldGrid, type WorldGridSnapshot } from "../world/WorldGrid.js";
import { TerrainField, type TerrainFieldSnapshot } from "../world/TerrainField.js";
import { EventLog, type EventLogSnapshot } from "../history/EventLog.js";
import { WaterField, type WaterFieldSnapshot } from "../hydrology/WaterField.js";
import { Weather, type WeatherSnapshot } from "../weather/Weather.js";
import type { MaterialRegistry } from "../materials/Material.js";

// Bumped 1 -> 2 when P0-08 added the `events` section, then 2 -> 3 when
// P1-21 added the `water`/`weather` sections -- both genuine breaking
// changes to this container's shape (new required fields), not
// hypothetical ones. No migration code exists (see this file's own
// migration-expectations doc comment below): there is no released save to
// migrate from yet, so the version bump alone is the correct, complete
// response at this stage.
const WORLD_SNAPSHOT_VERSION = 3;

type AnyComponentType = ComponentType<unknown>;

/**
 * The set of currently-existing authoritative subsystems this persistence
 * layer knows how to compose. P0-01..P0-05/P0-07/P0-08/P0-09's original
 * foundation, plus `water`/`weather` (P1-21) -- exactly the "another
 * grid-shaped singleton subsystem" case this interface's own doc comment
 * anticipated back at P0-06 time ("if they introduce another grid-shaped
 * singleton subsystem the way P1-02 water depth might, extend this
 * interface and `WorldSnapshot` together the same way P0-09's terrain was
 * added alongside P0-05's grid") -- not a prediction of every future
 * system, but this specific extension was flagged as the expected shape
 * of the NEXT one.
 * Jobs, needs, constructions, plants, relationships, and every other P1
 * subsystem still add their state as ordinary `ComponentStore` entries
 * (no shape change needed here for those -- see `AllComponentTypes.ts`).
 */
export interface World {
  readonly clock: SimulationClock;
  readonly random: RandomStreams;
  readonly entities: EntityIdRegistry;
  readonly components: ComponentStore;
  readonly grid: WorldGrid;
  readonly terrain: TerrainField;
  readonly events: EventLog;
  readonly water: WaterField;
  readonly weather: Weather;
}

/**
 * One versioned, JSON-plain save file. `version` is this container
 * format's own version, independent of (and typically far more stable
 * than) each nested section's own version -- a section's internal
 * representation can evolve without forcing every other section to bump.
 *
 * Migration expectations (ARCHITECTURE_CONTRACT §16): there is only ever
 * been version 1 of this container to date, so no migration code exists
 * yet -- writing an unused migration path speculatively would itself be a
 * bug per AGENTS.md's anti-speculation guidance. When a breaking change to
 * this container's shape is eventually needed, the expected pattern is a
 * chain of pure `migrateV1ToV2(raw): RawV2` functions applied to the raw
 * parsed object (keyed off `raw.version`) BEFORE calling `restoreWorld`,
 * not inside it -- keeping `restoreWorld` itself always written against
 * the single current shape. The same per-section pattern applies one level
 * down (e.g. a `ComponentStoreSnapshot` version bump), independently.
 */
export interface WorldSnapshot {
  version: number;
  clock: SimulationClockSnapshot;
  random: RandomStreamsSnapshot;
  entities: EntityIdRegistrySnapshot;
  components: ComponentStoreSnapshot;
  grid: WorldGridSnapshot;
  terrain: TerrainFieldSnapshot;
  events: EventLogSnapshot;
  water: WaterFieldSnapshot;
  weather: WeatherSnapshot;
}

/**
 * Everything `restoreWorld` needs that isn't itself part of the save data:
 * code-defined registries that a fresh process must rebuild identically
 * before state can be reattached to them.
 */
export interface WorldRestoreContext {
  /**
   * Every `ComponentType` any system in this world uses, keyed by name.
   * Component types are defined by feature modules (Transform, Needs,
   * Inventory, ...), not known to this generic persistence layer -- see
   * `ComponentStore.fromSnapshot`. Typically assembled once at startup by
   * importing every feature's component-definition module.
   */
  componentTypes: ReadonlyMap<string, AnyComponentType>;
  /**
   * A freshly constructed, fully populated `MaterialRegistry` (e.g. via
   * `registerStandardMaterials()`). Materials are code-defined balance
   * data, not per-save state -- see `MaterialRegistry`'s class doc comment
   * for why this registry is rebuilt fresh on every load rather than
   * saved.
   */
  materials: MaterialRegistry;
}

/** Captures every currently-existing authoritative subsystem into one versioned, JSON-plain snapshot. */
export function snapshotWorld(world: World): WorldSnapshot {
  return {
    version: WORLD_SNAPSHOT_VERSION,
    clock: world.clock.toSnapshot(),
    random: world.random.toSnapshot(),
    entities: world.entities.toSnapshot(),
    components: world.components.toSnapshot(),
    grid: world.grid.toSnapshot(),
    terrain: world.terrain.toSnapshot(),
    events: world.events.toSnapshot(),
    water: world.water.toSnapshot(),
    weather: world.weather.toSnapshot(),
  };
}

/**
 * Reconstructs a `World` from a snapshot. Restore order is load-bearing
 * and intentionally not caller-configurable: entity identity first (every
 * other section references entities by id and validates liveness/knownness
 * against it), then components, the spatial grid, and the event log (all
 * three only need identity), then terrain (derives cell solidity onto the
 * grid the grid's own restore already populated -- see
 * `TerrainField.fromSnapshot`'s doc comment on why that ordering matters),
 * then water (`WaterField.fromSnapshot` needs the already-restored `grid`
 * to resolve each column's real floor elevation). Clock, random streams,
 * and weather have no cross-references and are restored independently.
 */
export function restoreWorld(snapshot: WorldSnapshot, context: WorldRestoreContext): World {
  if (snapshot.version !== WORLD_SNAPSHOT_VERSION) {
    throw new RangeError(`unsupported world save version ${snapshot.version}, expected ${WORLD_SNAPSHOT_VERSION}`);
  }
  const entities = EntityIdRegistry.fromSnapshot(snapshot.entities);
  const components = ComponentStore.fromSnapshot(snapshot.components, entities, context.componentTypes);
  const grid = WorldGrid.fromSnapshot(snapshot.grid, entities);
  const events = EventLog.fromSnapshot(snapshot.events, entities);
  const terrain = TerrainField.fromSnapshot(snapshot.terrain, grid, context.materials);
  const water = WaterField.fromSnapshot(snapshot.water, grid);
  const weather = Weather.fromSnapshot(snapshot.weather);
  const clock = SimulationClock.fromSnapshot(snapshot.clock);
  const random = RandomStreams.fromSnapshot(snapshot.random);
  return { clock, random, entities, components, grid, terrain, events, water, weather };
}
