import { EntityIdRegistry } from "../core/EntityId.js";
import { ComponentStore } from "../core/ComponentStore.js";
import { SimulationClock } from "../core/SimulationClock.js";
import { RandomStreams } from "../core/Random.js";
import { WorldGrid } from "../world/WorldGrid.js";
import { TerrainField } from "../world/TerrainField.js";
import { EventLog } from "../history/EventLog.js";
import type { MaterialRegistry } from "../materials/Material.js";
import { WaterField } from "../hydrology/WaterField.js";
import { Weather } from "../weather/Weather.js";
import type { World } from "../persistence/WorldSnapshot.js";
import { spawnBeaver } from "../creatures/Beaver.js";
import { setFood, getFood } from "../labor/Food.js";
import { createStockpile } from "../logistics/Stockpile.js";
import { getSite, setSite } from "./Site.js";
import type { EntityId } from "../core/EntityId.js";

/**
 * P6-08: reconstructs a real, DETAILED `World` (the exact same
 * `ColonyLoop.tickColony`-compatible simulation every earlier phase
 * already built) from an abstracted `Site`'s own real summary state --
 * `activateSite` spawns exactly `site.populationCount` real beavers and
 * exactly `site.storedFoodKg` of real physical food, never a different
 * number invented for convenience -- "zooming in reconstructs a
 * detailed simulation CONSISTENT with its macro state," the literal
 * acceptance test. `deactivateSite` is the real inverse: it reads the
 * detailed world's own live state back into a fresh `Site` summary,
 * never assuming the detailed simulation "went as expected."
 */
const ACTIVATION_SIZE_X = 20;
const ACTIVATION_SIZE_Y = 8;
const ACTIVATION_SIZE_Z = 20;
const FOOD_ITEM_MASS_KG = 1;

export interface ActivatedSite {
  world: World;
  beaverIds: EntityId[];
  stockpileId: EntityId;
}

/** Builds a fresh, flat, soil-floored detailed world and populates it to match `siteId`'s own current summary state exactly. Throws if the site is already active. */
export function activateSite(siteId: EntityId, materials: MaterialRegistry, worldRef: World): ActivatedSite {
  const site = getSite(worldRef.components, siteId);
  if (site === undefined) throw new RangeError(`entity ${siteId} has no Site component`);
  if (site.active) throw new RangeError(`site ${siteId} is already active`);

  const entities = new EntityIdRegistry();
  const components = new ComponentStore(entities);
  const grid = new WorldGrid({ sizeX: ACTIVATION_SIZE_X, sizeY: ACTIVATION_SIZE_Y, sizeZ: ACTIVATION_SIZE_Z }, entities);
  const terrain = new TerrainField(grid, materials);
  for (let x = 0; x < ACTIVATION_SIZE_X; x++) {
    for (let z = 0; z < ACTIVATION_SIZE_Z; z++) {
      for (let y = 0; y <= 2; y++) terrain.setMaterial(x, y, z, "soil");
    }
  }
  const water = new WaterField(grid);
  const weather = new Weather();
  const clock = new SimulationClock({ tickRateHz: 20 });
  const random = new RandomStreams(`site-${siteId}-${worldRef.clock.tick}`);
  const events = new EventLog(entities);
  const world: World = { clock, random, entities, components, grid, terrain, events, water, weather };

  const beaverIds: EntityId[] = [];
  for (let i = 0; i < site.populationCount; i++) {
    const x = 2 + (i % 10);
    const z = 2 + Math.floor(i / 10);
    beaverIds.push(spawnBeaver(world, { name: `Resident-${i + 1}`, position: { x, y: 3, z } }));
  }

  const stockpileId = createStockpile(world, [{ x: 15, z: 15 }], {
    allowedMaterialCategories: ["organic"],
    allowedMaterialIds: [],
    forbiddenMaterialCategories: [],
    forbiddenMaterialIds: [],
  });
  let remainingFoodKg = site.storedFoodKg;
  while (remainingFoodKg > 0) {
    const massKg = Math.min(FOOD_ITEM_MASS_KG, remainingFoodKg);
    const foodId = world.entities.create("food");
    world.grid.setEntityPosition(foodId, 15, 3, 15);
    setFood(world.components, foodId, { nutritionValue: 0.3, materialId: "plant-matter", massKg });
    remainingFoodKg -= massKg;
  }

  setSite(worldRef.components, siteId, { ...site, active: true });
  return { world, beaverIds, stockpileId };
}

/** Reads a real, currently-active detailed world's own live state back into `siteId`'s summary -- population is a real live count, `storedFoodKg` is real total physical food mass across every live `"food"` entity (stored or not -- an honest total, not just what happens to sit in a stockpile). */
export function deactivateSite(siteId: EntityId, worldRef: World, activated: ActivatedSite): void {
  const site = getSite(worldRef.components, siteId);
  if (site === undefined) throw new RangeError(`entity ${siteId} has no Site component`);
  if (!site.active) throw new RangeError(`site ${siteId} is not active`);

  const populationCount = activated.world.entities.liveIdsOfKind("beaver").length;
  let storedFoodKg = 0;
  for (const foodId of activated.world.entities.liveIdsOfKind("food")) {
    storedFoodKg += getFood(activated.world.components, foodId)?.massKg ?? 0;
  }

  setSite(worldRef.components, siteId, { ...site, active: false, populationCount, storedFoodKg });
}
