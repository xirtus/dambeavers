import type { EntityId, EntityKind } from "../core/EntityId.js";
import type { CellCoordinate } from "../world/WorldGrid.js";
import type { RecordedEvent } from "../history/EventLog.js";
import type { MaterialId } from "../materials/Material.js";
import type { World } from "../persistence/WorldSnapshot.js";

/**
 * Deep-copies a value known to satisfy `ComponentType`'s documented
 * JSON-plain contract (primitives, arrays, plain objects, optionally
 * `EntityId` numbers -- see ComponentStore.ts's `ComponentType` doc
 * comment) or a `RecordedEvent`'s own shape (same contract, plus branded
 * `EventId`s). A JSON round trip is a safe, exact deep clone for exactly
 * that domain -- not a general-purpose deep-clone utility, and not meant
 * to be one. Used so `inspectEntity`'s return value can never alias live
 * `ComponentStore`/`EventLog` internals: an inspector that could be
 * mutated to silently rewrite authoritative state (or historical events)
 * would violate AGENTS.md 1.4's inspectability guarantee by making
 * inspection itself an unaudited write path. `WorldGrid.positionOf()`
 * (P0-05) established the identical precedent for the same reason.
 */
function deepCopyJsonPlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Raw authoritative state for one entity, assembled purely by reading
 * already-existing systems (`EntityIdRegistry`, `WorldGrid`,
 * `ComponentStore`, `EventLog`) -- nothing here is computed, cached, or
 * approximated, satisfying P0-12's acceptance test ("inspect raw
 * authoritative state without attaching a debugger") literally: this
 * function IS the substitute for attaching a debugger.
 *
 * `components` deliberately lists every attached component generically
 * (type name + value) rather than exposing a fixed set of named fields --
 * this is what makes future component types (P1-06 Needs, P1-07 JobActor,
 * P1-11 Structure, ...) show up in entity inspection automatically the
 * moment they're attached, with zero changes to this file. The roadmap's
 * "expose overlays for... jobs / needs / structural state" bullets are
 * satisfied by this generic mechanism once those components exist, not by
 * this file special-casing them.
 */
export interface EntityInspection {
  id: EntityId;
  kind: EntityKind;
  live: boolean;
  /** `undefined` if this entity has never been placed in the `WorldGrid` (e.g. an item still in an inventory, once P0-10/P1-09-era systems represent that). */
  position: CellCoordinate | undefined;
  components: Array<{ type: string; value: unknown }>;
  /** Every recorded event where this entity is a subject or object, oldest first -- the roadmap's "event chains" bullet. Each entry's own `causeEventId` can be followed with `EventLog.traceBack()` to walk further back; this list is the set of entry points into that history, not a pre-walked chain itself. */
  events: RecordedEvent[];
}

/** Raw authoritative state for one grid cell: the roadmap's "entity IDs" and "terrain elevation" overlay bullets, for a single cell rather than a rendered heightmap (a real heightmap/overlay is presentation's job, layered on top of this data). */
export interface CellInspection {
  cell: CellCoordinate;
  solid: boolean;
  material: MaterialId | undefined;
  entityIds: EntityId[];
}

/**
 * A whole-world debug summary: every subsystem's own `getDebugState()`,
 * gathered in one place. Adds no new logic beyond wiring -- each field is
 * exactly what that subsystem already reports about itself, mirroring how
 * `WorldSnapshot.snapshotWorld()` aggregates each subsystem's `toSnapshot()`
 * for persistence rather than reimplementing serialization.
 *
 * Derived as a mapped type over `World` itself (not a hand-written field
 * list) specifically so this stays compile-time-honest if `World` ever
 * gains an 8th subsystem: `inspectWorld`'s object literal would then fail
 * to typecheck until it added the matching field, rather than silently
 * compiling a summary that quietly omits the new subsystem. This relies
 * on every current and future `World` member exposing a `getDebugState()`
 * method with no arguments, true of all seven today.
 */
export type WorldDebugSummary = {
  [K in keyof World]: ReturnType<World[K]["getDebugState"]>;
};

/**
 * P0-12's central acceptance-test mechanism: given any entity id known to
 * `world`, return everything authoritative about it. A future
 * click-to-inspect UI (P1-20) would resolve a mouse click to an
 * `EntityId` (a presentation-layer concern -- raycasting against
 * `WorldGrid` positions, not built here) and call this; a developer today
 * can call it directly from a test or a REPL with no UI at all.
 *
 * Deliberately does NOT attempt "pathability," "water," "flow vectors,"
 * "jobs," or "needs" overlays the roadmap's wishlist names alongside this
 * one: those require hydrology (done, P1-02/P1-03) and job (P1-07)/needs
 * (P1-06) systems, or -- for pathability specifically -- a per-entity
 * route to show. Navigation itself now exists (P1-04,
 * `src/sim/navigation/Pathfinding.ts`) and already exposes its own
 * debug/explain primitives directly (`describeEdgeBlock`,
 * `reachableColumns`) for "why is this blocked"/"what's reachable from
 * here" queries; there is just nothing per-entity to attach to
 * `inspectEntity` yet, since no entity has a current route until P1-05's
 * beavers exist to have one. Inventing placeholder data for the rest here
 * would be exactly the "scripted outcome"/fake-system smell AGENTS.md
 * prohibits -- a debug overlay showing plausible-looking fake data is
 * worse than showing nothing.
 *
 * "Needs" and "structural state" are safe bets to satisfy automatically,
 * later, via this same `components`-list mechanism once P1-06/P1-11
 * attach their own component types to the entity itself -- no changes to
 * this file needed for those two. "Jobs" is a weaker bet: a worker's
 * CURRENT job may well show up the same way if P1-07 models it as a
 * component on the worker (matching ARCHITECTURE_CONTRACT §6's sketched
 * `JobActor` component), but the job pipeline's own state (unclaimed work,
 * reservations, priority queues) more naturally lives in a separate
 * registry than as per-entity component data, and that registry -- not
 * yet designed -- would need its own inspection entry point alongside
 * `inspectEntity`, not a guaranteed free ride from it. "Pathability,"
 * "water," and "flow vectors" need navigation/hydrology systems that
 * don't exist yet and aren't guaranteed to be component-shaped at all.
 */
export function inspectEntity(world: World, id: EntityId): EntityInspection {
  const kind = world.entities.kindOf(id); // throws for a truly unknown id -- the entity must at least have existed
  const live = world.entities.isLive(id);
  const position = world.grid.positionOf(id);
  const components = world.components
    .typesOf(id)
    .map((type) => ({ type: type.name, value: deepCopyJsonPlain(world.components.get(id, type)) }))
    .sort((a, b) => a.type.localeCompare(b.type));
  const events = world.events.eventsInvolving(id).map((event) => deepCopyJsonPlain(event));
  return { id, kind, live, position, components, events };
}

/** Raw authoritative state for one cell -- the roadmap's "entity IDs"/"terrain elevation" bullets, satisfied by reading `WorldGrid`/`TerrainField` directly, not by rendering anything. */
export function inspectCell(world: World, x: number, y: number, z: number): CellInspection {
  return {
    cell: { x, y, z },
    solid: world.grid.isSolid(x, y, z),
    material: world.terrain.materialAt(x, y, z),
    entityIds: world.grid.entitiesAt(x, y, z),
  };
}

/** Whole-world debug summary -- every subsystem's own `getDebugState()`, gathered in one place for a developer inspecting overall authoritative state (Phase 0 Gate: "developer can inspect authoritative state"), not just one entity. */
export function inspectWorld(world: World): WorldDebugSummary {
  return {
    clock: world.clock.getDebugState(),
    random: world.random.getDebugState(),
    entities: world.entities.getDebugState(),
    components: world.components.getDebugState(),
    grid: world.grid.getDebugState(),
    terrain: world.terrain.getDebugState(),
    events: world.events.getDebugState(),
  };
}
