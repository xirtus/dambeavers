/**
 * Headless acceptance test for P1-13 — Basic food and drink.
 *
 * Roadmap acceptance test (DAMN_BEAVERS_MASTER_ROADMAP.md, P1-13):
 *   "a hungry beaver acquires an edible item or reaches a valid food
 *   source, consumes it, and changes its nutritional state."
 *
 * The roadmap's own wording offers two paths ("acquires an edible item OR
 * reaches a valid food source") -- this test drives BOTH for real, rather
 * than picking whichever is more convenient: a beaver that reaches a live
 * tree (P0-10) eats real bark/cambium via `eatFromTree`, and a separate
 * beaver that reaches a stored food item (P1-13's own `Food.ts`) eats it
 * via `eatFoodItem`. Both are driven purely by `tickBeaverNeeds` -- no
 * intent, target, or consumption is ever hand-set; hunger crossing
 * `NEED_URGENT_THRESHOLD` and the resulting navigation/consumption emerge
 * exactly as they did for P1-06's own acceptance test.
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
import { getNeeds, setNeeds, NEED_URGENT_THRESHOLD } from "../../src/sim/creatures/Needs.js";
import { tickBeaverNeeds, setNeedFocus } from "../../src/sim/creatures/BeaverNeeds.js";
import { setPlant, getPlant } from "../../src/sim/ecology/Plant.js";
import { setFood, getFood } from "../../src/sim/labor/Food.js";

const SIZE_X = 20;
const SIZE_Y = 8;
const SIZE_Z = 10;

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
  const clock = new SimulationClock({ tickRateHz: 20 });
  const random = new RandomStreams("p1-13-food-drink");
  const events = new EventLog(entities);
  const world: World = { clock, random, entities, components, grid, terrain, events, water, weather };
  return { world, materials, water };
}

function spawnAt(world: World, x: number, z: number, name: string) {
  const floor = world.grid.surfaceY(x, z)!;
  return spawnBeaver(world, { name, position: { x, y: floor + 1, z } });
}

const URGENT_HUNGER = { hunger: NEED_URGENT_THRESHOLD + 0.1, thirst: 0, fatigue: 0, thermalComfort: 1 };

describe("P1-13 acceptance: a hungry beaver acquires an edible item or reaches a valid food source, consumes it, and changes its nutritional state", () => {
  it("reaching a valid food source (a real live tree) consumes real bark/cambium and changes nutritional state", () => {
    const { world, materials, water } = buildWorld();
    const beaver = spawnAt(world, 1, 5, "Chewer");
    const profile = getSwimmer(world.components, beaver)!;
    setNeeds(world.components, beaver, URGENT_HUNGER);
    setNeedFocus(world.components, beaver, { current: "none" });

    const tree = world.entities.create("tree");
    world.grid.setEntityPosition(tree, 15, world.grid.surfaceY(15, 5)! + 1, 5);
    setPlant(world.components, tree, { speciesId: "aspen", ageTicks: 8_000, health: 1 });
    const healthBefore = getPlant(world.components, tree)!.health;

    let ate = false;
    for (let tick = 0; tick < 200 && !ate; tick++) {
      world.clock.resume();
      world.clock.advanceTicks(1);
      const result = tickBeaverNeeds(world.grid, world.terrain, water, materials, world.entities, world.components, beaver, profile);
      if (result.movement?.outcome === "arrived" || result.movement?.outcome === "already-there") ate = true;
    }

    expect(ate).toBe(true);
    const needsAfter = getNeeds(world.components, beaver)!;
    expect(needsAfter.hunger).toBeLessThan(URGENT_HUNGER.hunger); // nutritional state genuinely changed
    expect(getPlant(world.components, tree)!.health).toBeLessThan(healthBefore); // a real, physical consequence of eating
    expect(world.entities.isLive(tree)).toBe(true); // eating from it doesn't destroy the tree
  });

  it("acquiring an edible stored item consumes the real physical entity and changes nutritional state", () => {
    const { world, materials, water } = buildWorld();
    const beaver = spawnAt(world, 1, 5, "Forager");
    const profile = getSwimmer(world.components, beaver)!;
    setNeeds(world.components, beaver, URGENT_HUNGER);
    setNeedFocus(world.components, beaver, { current: "none" });

    const item = world.entities.create("food");
    world.grid.setEntityPosition(item, 15, world.grid.surfaceY(15, 5)! + 1, 5);
    setFood(world.components, item, { nutritionValue: 0.5 });

    let ate = false;
    for (let tick = 0; tick < 200 && !ate; tick++) {
      world.clock.resume();
      world.clock.advanceTicks(1);
      const result = tickBeaverNeeds(world.grid, world.terrain, water, materials, world.entities, world.components, beaver, profile);
      if (result.movement?.outcome === "arrived" || result.movement?.outcome === "already-there") ate = true;
    }

    expect(ate).toBe(true);
    const needsAfter = getNeeds(world.components, beaver)!;
    expect(needsAfter.hunger).toBeLessThan(URGENT_HUNGER.hunger); // nutritional state genuinely changed
    expect(world.entities.isLive(item)).toBe(false); // the acquired item is genuinely consumed, not just marked eaten
    expect(getFood(world.components, item)).toBeUndefined();
  });
});
