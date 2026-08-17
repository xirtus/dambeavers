/**
 * Headless acceptance test for P1-06 — Basic needs.
 *
 * Roadmap acceptance test (DAMN_BEAVERS_MASTER_ROADMAP.md, P1-06):
 *   "an idle beaver eventually seeks food, water, and sleep without
 *   scripted scheduling."
 *
 * "Seeks food"/"seeks water" are real navigation toward a real tree
 * entity (P0-10) or a real wet column (P1-02/03), driven by
 * `tickBeaverNeeds` (`BeaverNeeds.ts`). As of P1-13, arrival now also
 * genuinely consumes (eats bark/cambium, drinks) -- this test's own
 * assertions don't depend on that either way (they only ever check WHICH
 * intents occurred, never hunger/thirst's exact numeric trajectory), so
 * P1-13 landing changes nothing about what this test proves; the trees it
 * spawns now carry a real `Plant` component only because `eatFromTree`
 * needs one to exist to eat from at all. "Seeks sleep" is the `"rest"`
 * intent: with no shelter system yet (P1-10/P1-14), the honest minimal
 * behavior is that an urgently-fatigued beaver stops and its intent
 * visibly changes to resting, rather than inventing a shelter-seeking
 * destination that doesn't exist yet.
 *
 * "Without scripted scheduling" is checked structurally: the test never
 * tells the beaver what to do at any tick or checks "did tick N do X" --
 * it drives `tickBeaverNeeds` every simulated tick and only asserts on
 * the SET of distinct intents that emerged over the run, which is purely
 * a function of continuous need decay crossing `NEED_URGENT_THRESHOLD` at
 * whatever tick that naturally happens.
 */
import { describe, expect, it } from "vitest";
import { EntityIdRegistry } from "../../src/sim/core/EntityId.js";
import { ComponentStore } from "../../src/sim/core/ComponentStore.js";
import { SimulationClock } from "../../src/sim/core/SimulationClock.js";
import { RandomStreams } from "../../src/sim/core/Random.js";
import { WorldGrid } from "../../src/sim/world/WorldGrid.js";
import { TerrainField } from "../../src/sim/world/TerrainField.js";
import { EventLog } from "../../src/sim/history/EventLog.js";
import { MaterialRegistry } from "../../src/sim/materials/Material.js";
import { registerStandardMaterials } from "../../src/sim/materials/standardMaterials.js";
import { WaterField } from "../../src/sim/hydrology/WaterField.js";
import { Weather } from "../../src/sim/weather/Weather.js";
import type { World } from "../../src/sim/persistence/WorldSnapshot.js";
import { spawnBeaver, getSwimmer } from "../../src/sim/creatures/Beaver.js";
import { getNeeds, NEED_URGENT_THRESHOLD } from "../../src/sim/creatures/Needs.js";
import { tickBeaverNeeds } from "../../src/sim/creatures/BeaverNeeds.js";
import { setPlant } from "../../src/sim/ecology/Plant.js";

const SIZE_X = 30;
const SIZE_Y = 8;
const SIZE_Z = 12;
const SPAWN = { x: 1, z: 1 };
const TREE_AT = { x: 24, z: 1 }; // far enough that the round trip alone can push fatigue past threshold
const WATER_AT_X_START = 26; // a small pond, farther still

function buildWorld(): { world: World; materials: MaterialRegistry; water: WaterField } {
  const entities = new EntityIdRegistry();
  const components = new ComponentStore(entities);
  const grid = new WorldGrid({ sizeX: SIZE_X, sizeY: SIZE_Y, sizeZ: SIZE_Z }, entities);
  const materials = new MaterialRegistry();
  registerStandardMaterials(materials);
  const terrain = new TerrainField(grid, materials);
  for (let x = 0; x < SIZE_X; x++) {
    for (let z = 0; z < SIZE_Z; z++) {
      for (let y = 0; y <= 2; y++) terrain.setMaterial(x, y, z, "soil");
    }
  }
  const water = new WaterField(grid);
  const weather = new Weather();
  for (let x = WATER_AT_X_START; x < SIZE_X; x++) {
    for (let z = 0; z < SIZE_Z; z++) water.setDepth(x, z, 0.3);
  }

  const clock = new SimulationClock({ tickRateHz: 20 });
  const random = new RandomStreams("p1-06-needs");
  const events = new EventLog(entities);
  const world: World = { clock, random, entities, components, grid, terrain, events, water, weather };
  return { world, materials, water };
}

describe("P1-06 acceptance: an idle beaver eventually seeks food, water, and sleep without scripted scheduling", () => {
  it("starts idle with every need satisfied", () => {
    const { world } = buildWorld();
    const floor = world.grid.surfaceY(SPAWN.x, SPAWN.z)!;
    const id = spawnBeaver(world, { name: "Groundhog", position: { x: SPAWN.x, y: floor + 1, z: SPAWN.z } });

    const needs = getNeeds(world.components, id)!;
    expect(needs.hunger).toBeLessThan(NEED_URGENT_THRESHOLD);
    expect(needs.thirst).toBeLessThan(NEED_URGENT_THRESHOLD);
    expect(needs.fatigue).toBeLessThan(NEED_URGENT_THRESHOLD);
  });

  it("over enough time, an initially-idle beaver's needs alone eventually produce all three behaviors -- seek-food, seek-water, and rest -- with genuine, non-oscillating progress, not a permanent stuck loop", () => {
    const { world, materials, water } = buildWorld();
    const floor = world.grid.surfaceY(SPAWN.x, SPAWN.z)!;
    const id = spawnBeaver(world, { name: "Groundhog", position: { x: SPAWN.x, y: floor + 1, z: SPAWN.z } });
    const profile = getSwimmer(world.components, id)!;
    world.entities.create("tree"); // never placed -- must not be selectable; keeps the real tree below the only valid target
    const tree = world.entities.create("tree");
    world.grid.setEntityPosition(tree, TREE_AT.x, world.grid.surfaceY(TREE_AT.x, TREE_AT.z)! + 1, TREE_AT.z);
    setPlant(world.components, tree, { speciesId: "aspen", ageTicks: 8_000, health: 1 });

    const observedIntentKinds = new Set<string>();
    // Every distinct column the beaver has ever stood on, sampled across
    // the WHOLE run (not just up to the first time all three intents were
    // observed) -- a regression guard against a beaver that ticks off all
    // three intent kinds early and then locks into a useless back-and-forth
    // between just two adjacent columns forever afterward (a real bug this
    // task's own development found and fixed: an earlier version of the
    // anti-starvation logic did exactly that once hunger and thirst were
    // both permanently urgent with no consumption system to ever resolve
    // them).
    const visitedColumns = new Set<string>();
    const MAX_TICKS = 5000;
    for (let tick = 0; tick < MAX_TICKS; tick++) {
      world.clock.resume();
      world.clock.advanceTicks(1);
      const result = tickBeaverNeeds(
        world.grid,
        world.terrain,
        water,
        materials,
        world.entities,
        world.components,
        id,
        profile,
      );
      observedIntentKinds.add(result.intent.kind);
      const position = world.grid.positionOf(id)!;
      visitedColumns.add(`${position.x},${position.z}`);
    }

    // Every one of the three named behaviors genuinely emerged at some
    // point -- not scripted at any particular tick, purely a consequence
    // of continuous per-tick need decay independently crossing the same
    // urgency threshold for hunger, thirst, and fatigue at whatever tick
    // that naturally happened.
    expect(observedIntentKinds.has("seek-food")).toBe(true);
    expect(observedIntentKinds.has("seek-water")).toBe(true);
    expect(observedIntentKinds.has("rest")).toBe(true);
    // "idle" must also have genuinely occurred -- the beaver really did
    // start idle, this isn't a scenario where every need was already
    // urgent from tick one.
    expect(observedIntentKinds.has("idle")).toBe(true);
    // Genuine cross-map travel happened -- both the spawn end and the far
    // end (tree/water) were actually reached, not just approached from a
    // narrow oscillation band a few columns wide.
    expect(visitedColumns.has(`${SPAWN.x},${SPAWN.z}`)).toBe(true);
    expect(visitedColumns.has(`${TREE_AT.x},${TREE_AT.z}`)).toBe(true);
    expect(visitedColumns.size).toBeGreaterThan(10);
  });

  it("the SAME beaver, re-ticked deterministically from the same seed and starting state, produces the identical sequence of intents", () => {
    function runFirstNTicks(n: number): string[] {
      const { world, materials, water } = buildWorld();
      const floor = world.grid.surfaceY(SPAWN.x, SPAWN.z)!;
      const id = spawnBeaver(world, { name: "Groundhog", position: { x: SPAWN.x, y: floor + 1, z: SPAWN.z } });
      const profile = getSwimmer(world.components, id)!;
      const tree = world.entities.create("tree");
      world.grid.setEntityPosition(tree, TREE_AT.x, world.grid.surfaceY(TREE_AT.x, TREE_AT.z)! + 1, TREE_AT.z);
      setPlant(world.components, tree, { speciesId: "aspen", ageTicks: 8_000, health: 1 });

      const kinds: string[] = [];
      for (let tick = 0; tick < n; tick++) {
        const result = tickBeaverNeeds(world.grid, world.terrain, water, materials, world.entities, world.components, id, profile);
        kinds.push(result.intent.kind);
      }
      return kinds;
    }

    const runA = runFirstNTicks(400);
    const runB = runFirstNTicks(400);
    expect(runB).toEqual(runA);
  });
});
