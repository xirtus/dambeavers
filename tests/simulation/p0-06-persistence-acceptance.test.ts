/**
 * Headless acceptance test for P0-06 — Versioned persistence schema.
 *
 * Roadmap acceptance test (DAMN_BEAVERS_MASTER_ROADMAP.md, P0-06):
 *   "a test world containing terrain, entities, inventories, references,
 *   and events serializes and reloads with all references intact."
 *
 * "Terrain" and "entities" use the real, already-built P0-09/P0-02/P0-03
 * systems. "Inventories" and "events" are represented here with
 * test-local, JSON-plain component shapes -- the real item/inventory
 * system (P0-10) and event/causality log (P0-08) don't exist yet and
 * building them is explicitly out of P0-06's scope (AGENTS.md: don't
 * build ahead of unblocked tasks). What this test proves is the GENERAL
 * persistence mechanism: any JSON-plain component data -- a scalar, an
 * array of entity references, an array of structured log records -- moves
 * through ComponentStore + WorldSnapshot and back with nothing lost or
 * misattributed, which is exactly the primitive P0-08/P0-10 will build on
 * top of. Nothing here hardcodes "inventory" or "event" as a persistence
 * concept.
 *
 * The round trip below goes through an ACTUAL `JSON.stringify`/
 * `JSON.parse`, not just a structural object copy -- proving the save is
 * genuinely serializable (bigints, Maps, and other non-JSON-safe internals
 * would fail this even if a same-process object reference happened to
 * "work").
 */
import { describe, expect, it } from "vitest";
import { EntityIdRegistry, type EntityId } from "../../src/sim/core/EntityId.js";
import { ComponentStore, defineComponent, type ComponentType } from "../../src/sim/core/ComponentStore.js";
import { SimulationClock } from "../../src/sim/core/SimulationClock.js";
import { RandomStreams } from "../../src/sim/core/Random.js";
import { WorldGrid } from "../../src/sim/world/WorldGrid.js";
import { TerrainField, applyHeightfield, type StrataLayer } from "../../src/sim/world/TerrainField.js";
import { EventLog } from "../../src/sim/history/EventLog.js";
import { MaterialRegistry } from "../../src/sim/materials/Material.js";
import { registerStandardMaterials } from "../../src/sim/materials/standardMaterials.js";
import { snapshotWorld, restoreWorld, type World, type WorldRestoreContext } from "../../src/sim/persistence/WorldSnapshot.js";

// -- test-local stand-ins for not-yet-built P0-08/P0-10 domain shapes --
interface Inventory {
  /** EntityIds of items held -- a reference, not a duplicated copy of item data (ARCHITECTURE_CONTRACT: physical resources are physical). */
  itemIds: EntityId[];
}
const InventoryComponent = defineComponent<Inventory>("inventory");

interface EventLogEntry {
  tick: number;
  kind: string;
  subjectId: EntityId;
}
const EventLogComponent = defineComponent<EventLogEntry[]>("event-log");

function buildComponentTypeRegistry(): ReadonlyMap<string, ComponentType<unknown>> {
  return new Map<string, ComponentType<unknown>>([
    ["inventory", InventoryComponent],
    ["event-log", EventLogComponent],
  ]);
}

function buildTestWorld(): World {
  const entities = new EntityIdRegistry();
  const components = new ComponentStore(entities);
  const grid = new WorldGrid({ sizeX: 21, sizeY: 10, sizeZ: 6 }, entities);
  const materials = new MaterialRegistry();
  registerStandardMaterials(materials);
  const terrain = new TerrainField(grid, materials);
  const clock = new SimulationClock({ tickRateHz: 20 });
  const random = new RandomStreams("p0-06-acceptance");
  const events = new EventLog(entities);
  return { clock, random, entities, components, grid, terrain, events };
}

describe("P0-06 acceptance: a test world with terrain, entities, inventories, references, and events", () => {
  it("serializes through real JSON and reloads with every reference intact", () => {
    const world = buildTestWorld();

    // -- terrain: a valley cross-section, banks, soil-over-rock strata --
    const strata: StrataLayer[] = [
      { materialId: "soil", depth: 2 },
      { materialId: "stone", depth: 1000 },
    ];
    applyHeightfield(world.terrain, (x, _z) => 2 + Math.round(Math.abs(x - 10) * 0.45), strata);

    // -- entities of several kinds --
    const beaver = world.entities.create("beaver");
    const tree = world.entities.create("tree");
    const log = world.entities.create("log");
    const stick = world.entities.create("stick");
    const worldLog = world.entities.create("world-log"); // pseudo-entity the event-log stand-in attaches to

    world.grid.setEntityPosition(beaver, 10, 3, 0);
    world.grid.setEntityPosition(tree, 5, 5, 0);

    // -- inventories: a beaver holding real item entities by reference --
    world.components.set(beaver, InventoryComponent, { itemIds: [log, stick] });

    // -- references: an event referencing the beaver and the tree it felled --
    world.components.set(worldLog, EventLogComponent, [
      { tick: 0, kind: "spawned", subjectId: beaver },
      { tick: 1, kind: "felled", subjectId: tree },
    ]);

    // advance the clock and draw some randomness so those sections aren't trivially at their construction defaults
    world.random.stream("job-selection").nextUint32();
    world.clock.resume();
    world.clock.advance(0.37); // crosses several 50ms ticks with a mid-tick remainder

    const beforeClockTick = world.clock.tick;
    const beforeRandomDraw = world.random.stream("job-selection").getDebugState();

    // -- the actual serialization proof: real JSON round trip --
    const json = JSON.stringify(snapshotWorld(world));
    expect(typeof json).toBe("string");
    const revivedSnapshot = JSON.parse(json);

    const context: WorldRestoreContext = {
      componentTypes: buildComponentTypeRegistry(),
      materials: (() => {
        const m = new MaterialRegistry();
        registerStandardMaterials(m);
        return m;
      })(),
    };
    const restored = restoreWorld(revivedSnapshot, context);

    // -- terrain intact --
    for (let x = 0; x < 21; x++) {
      expect(restored.grid.surfaceY(x, 0), `column x=${x} should have a surface`).toBeDefined();
    }
    expect(restored.grid.surfaceY(10, 0)!).toBeLessThan(restored.grid.surfaceY(0, 0)!);
    expect(restored.terrain.materialAt(10, 0, 0)).toBe("stone"); // bedrock
    const floorSurface = restored.grid.surfaceY(10, 0)!;
    expect(restored.terrain.materialAt(10, floorSurface, 0)).toBe("soil");

    // -- entities intact: same ids, same kinds, same liveness --
    for (const id of [beaver, tree, log, stick, worldLog]) {
      expect(restored.entities.isLive(id)).toBe(true);
    }
    expect(restored.entities.kindOf(beaver)).toBe("beaver");
    expect(restored.entities.kindOf(log)).toBe("log");
    expect(restored.grid.positionOf(beaver)).toEqual({ x: 10, y: 3, z: 0 });

    // -- inventories + references intact: the restored inventory's item ids
    // are the SAME numeric ids, and each still resolves to a live,
    // correctly-kinded entity in the restored registry (not dangling, not
    // renumbered) --
    const restoredInventory = restored.components.get(beaver, InventoryComponent)!;
    expect(restoredInventory.itemIds).toEqual([log, stick]);
    for (const itemId of restoredInventory.itemIds) {
      expect(restored.entities.isLive(itemId)).toBe(true);
    }
    expect(restored.entities.kindOf(restoredInventory.itemIds[0]!)).toBe("log");
    expect(restored.entities.kindOf(restoredInventory.itemIds[1]!)).toBe("stick");

    // -- events intact: structured record array, referencing entities by id --
    const restoredEvents = restored.components.get(worldLog, EventLogComponent)!;
    expect(restoredEvents).toEqual([
      { tick: 0, kind: "spawned", subjectId: beaver },
      { tick: 1, kind: "felled", subjectId: tree },
    ]);
    expect(restored.entities.kindOf(restoredEvents[0]!.subjectId)).toBe("beaver");
    expect(restored.entities.kindOf(restoredEvents[1]!.subjectId)).toBe("tree");

    // -- clock and RNG state intact --
    expect(restored.clock.tick).toBe(beforeClockTick);
    expect(restored.random.stream("job-selection").getDebugState()).toEqual(beforeRandomDraw);

    // -- the restored world is genuinely live, not just inert data: it can keep simulating --
    const ticksBefore = restored.clock.tick;
    restored.clock.advance(0.05);
    expect(restored.clock.tick).toBeGreaterThan(ticksBefore);

    // -- new entities can be created after reload without colliding with restored ids --
    const newEntity = restored.entities.create("beaver");
    expect(newEntity).not.toBe(beaver);
    expect(newEntity).not.toBe(tree);
    expect(newEntity).not.toBe(log);
    expect(newEntity).not.toBe(stick);
    expect(newEntity).not.toBe(worldLog);
  });
});
