import type { EntityId, EntityIdRegistry } from "../core/EntityId.js";
import type { ComponentStore } from "../core/ComponentStore.js";
import type { WorldGrid } from "../world/WorldGrid.js";
import type { WaterField } from "../hydrology/WaterField.js";
import type { RandomStream } from "../core/Random.js";
import type { World } from "../persistence/WorldSnapshot.js";
import { getPlant, setPlant } from "./Plant.js";
import { growthFraction, type PlantSpeciesRegistry } from "./PlantSpecies.js";
import { applyVegetationHealthTick, applyPlantGrowthTick, currentWetness, plantSapling } from "./EcologyResponse.js";
import { seasonalGrowthMultiplier } from "../weather/Seasons.js";
import { soilFertility, type SoilFertilityField } from "./SoilFertility.js";

/**
 * P4-02: the roadmap's own six-item lifecycle list, each mapped onto a
 * REAL mechanism rather than six independent scripted stages:
 *
 * - growth: `EcologyResponse.ts`'s existing `applyPlantGrowthTick`
 *   (P1-17, unmodified), now called at a SEASONALLY-scaled rate
 *   (`seasonalGrowthMultiplier`, P4-01) instead of a flat one tick/tick.
 * - maturity: already fully derivable -- `growthFraction(species,
 *   ageTicks) >= 1` (P0-10's `PlantSpecies.ts`), no new field.
 * - stress: `EcologyResponse.ts`'s existing `applyVegetationHealthTick`
 *   (P1-17, unmodified) -- site-fitness mismatch already drifts health
 *   down.
 * - death: NEW here -- health reaching 0 destroys the plant (a real
 *   terminal consequence P1-17 deliberately left unbuilt, matching
 *   `Mortality.ts`'s own "health is real, but nothing acted on it
 *   reaching 0" gap before P1-16 closed it for beavers).
 * - germination/reproduction: NEW here -- a mature, sufficiently healthy
 *   plant can seed a nearby open, plantable cell. Critically, the NEW
 *   sapling's species is NOT always the parent's own: `bestFittingSpecies`
 *   weighs every REGISTERED species by how well the site's actual current
 *   wetness matches that species' `moisturePreference` (the same formula
 *   `applyVegetationHealthTick` already uses for stress) and picks
 *   stochastically in proportion to fitness -- so persistently-changed
 *   site conditions (a new pond, a drained wetland) measurably shift what
 *   regrows there over time, satisfying P4-04's "wetland succession"
 *   literally through this ONE shared mechanism rather than a second,
 *   parallel system.
 */

/**
 * Health floor below which a plant is critically wilted and dies --
 * deliberately a small positive value, not exactly 0. `health` drifts
 * toward `siteFitness` PROPORTIONALLY (`applyVegetationHealthTick`,
 * P1-17): at the worst possible real site (`siteFitness` exactly 0,
 * total moisture mismatch), that drift is pure geometric decay
 * (`health *= 1 - VEGETATION_HEALTH_DRIFT_RATE` each tick) which only
 * reaches exactly 0.0 after tens of thousands of ticks of float64
 * underflow -- practically unreachable, and a real gap this file's own
 * initial version had (found empirically: a plant at a maximally
 * mismatched site never actually died within any realistic run length).
 * A small positive threshold is the honest fix: real plants die from
 * SUSTAINED critical stress, not from reaching a mathematically exact
 * zero vitality. Plausible, tunable balance data.
 */
export const PLANT_DEATH_HEALTH = 0.02;
/** Minimum health/growth fraction for a plant to be a viable seed source -- a stressed or immature plant does not reproduce, matching real biology (a plant fighting for survival doesn't invest in seeding). Plausible, tunable balance data. */
export const REPRODUCTION_MIN_HEALTH = 0.6;
/** Per-tick probability a single eligible plant attempts reproduction -- kept low so a mature forest doesn't instantly re-seed every open cell in one tick; over many ticks this produces the roadmap's own "grows measurably over successive checks" rate. Plausible, tunable balance data. */
export const REPRODUCTION_ATTEMPT_PROBABILITY = 0.002;

function manhattanNeighbors(x: number, z: number): Array<{ x: number; z: number }> {
  return [
    { x: x + 1, z },
    { x: x - 1, z },
    { x, z: z + 1 },
    { x, z: z - 1 },
  ];
}

/** Every registered species' fitness (`1 - |wetness - moisturePreference|`, `EcologyResponse.ts`'s own formula) at a real site, weighted-randomly sampled -- the mechanism `PlantLifecycle`'s own file doc comment describes for P4-04. Returns `undefined` only if no species is registered at all (never reachable once `standardPlantSpecies.ts` has run). */
export function bestFittingSpecies(plantSpecies: PlantSpeciesRegistry, water: WaterField, random: RandomStream, x: number, z: number): string | undefined {
  const all = plantSpecies.all();
  if (all.length === 0) return undefined;
  const wetness = currentWetness(water, x, z);
  const weights = all.map((species) => Math.max(0.01, 1 - Math.abs(wetness - species.moisturePreference)));
  const total = weights.reduce((sum, w) => sum + w, 0);
  let roll = random.nextFloat() * total;
  for (let i = 0; i < all.length; i++) {
    roll -= weights[i]!;
    if (roll <= 0) return all[i]!.id;
  }
  return all[all.length - 1]!.id;
}

/** Whether `(x, z)` is currently free real ground a sapling could occupy -- real terrain, not already holding a live tree, and (per `WorldGrid.entitiesAt`) not otherwise occupied. */
function isPlantableGround(grid: WorldGrid, entities: EntityIdRegistry, x: number, z: number): boolean {
  const floor = grid.surfaceY(x, z);
  if (floor === undefined) return false;
  for (const id of grid.entitiesAt(x, floor + 1, z)) {
    if (entities.kindOf(id) === "tree") return false;
  }
  return true;
}

/**
 * Attempts one reproduction roll for a mature, healthy plant: with
 * `REPRODUCTION_ATTEMPT_PROBABILITY` chance, picks a random open
 * orthogonal neighbor cell and seeds it with a fitness-weighted species
 * (`bestFittingSpecies`) via `EcologyResponse.ts`'s own `plantSapling`
 * primitive -- finally giving that function's own documented "no
 * automatic trigger yet" gap a real, systemic driver. No-op (returns
 * `undefined`) if the plant isn't mature/healthy enough, the probability
 * roll fails, or no neighbor cell is currently plantable.
 */
export function attemptReproduction(world: World, plantSpecies: PlantSpeciesRegistry, random: RandomStream, plantId: EntityId): EntityId | undefined {
  const plant = getPlant(world.components, plantId);
  if (plant === undefined) return undefined;
  const species = plantSpecies.get(plant.speciesId);
  if (growthFraction(species, plant.ageTicks) < 1 || plant.health < REPRODUCTION_MIN_HEALTH) return undefined;
  if (!random.nextBool(REPRODUCTION_ATTEMPT_PROBABILITY)) return undefined;

  const position = world.grid.positionOf(plantId);
  if (position === undefined) return undefined;
  const candidates = random.shuffle(manhattanNeighbors(position.x, position.z)).filter((cell) => isPlantableGround(world.grid, world.entities, cell.x, cell.z));
  const site = candidates[0];
  if (site === undefined) return undefined;

  const seedSpeciesId = bestFittingSpecies(plantSpecies, world.water, random, site.x, site.z);
  if (seedSpeciesId === undefined) return undefined;
  return plantSapling(world, seedSpeciesId, site);
}

export type PlantLifecycleOutcome = "grew" | "reproduced" | "died";

/**
 * One simulated tick of a single plant's full lifecycle: seasonally-scaled
 * growth, site-fitness health drift, a reproduction attempt, then death if
 * health has reached 0 -- in that order, so a plant that dies this tick
 * still got its final honest growth/health update first (never skipped
 * mid-tick). Returns `"died"` if this tick destroyed the plant (`plantId`
 * is no longer live afterward), `"reproduced"` if a new sapling was seeded
 * (the parent survives), otherwise `"grew"`.
 */
export function tickPlantLifecycle(world: World, plantSpecies: PlantSpeciesRegistry, random: RandomStream, plantId: EntityId, soil?: SoilFertilityField): PlantLifecycleOutcome {
  const plant = getPlant(world.components, plantId)!;
  const species = plantSpecies.get(plant.speciesId);
  const position = world.grid.positionOf(plantId)!;

  // P4-09: real soil fertility (persisted moisture memory, not just this
  // instant's wetness) scales growth probability alongside the season --
  // a plant on long-flooded or long-parched ground grows measurably
  // slower than one on well-balanced soil, even in the same season.
  // Optional/trailing so this function's only other caller (this same
  // file's own `tickAllPlantLifecycles`) can omit it and get season-only
  // behavior, matching this codebase's established backward-compatible
  // extension pattern (`TreeCutting.ts`'s own optional `events`/`tick`).
  const fertilityMultiplier = soil === undefined ? 1 : 0.5 + soilFertility(soil, position.x, position.z);
  const seasonMultiplier = seasonalGrowthMultiplier(world.clock.tick) * fertilityMultiplier;
  const grown = random.nextBool(Math.min(1, seasonMultiplier)) ? applyPlantGrowthTick(plant) : plant;
  const stressed = applyVegetationHealthTick(grown, species, world.water, position.x, position.z);
  setPlant(world.components, plantId, stressed);

  if (stressed.health <= PLANT_DEATH_HEALTH) {
    world.events.record({ tick: world.clock.tick, eventType: "plant-died", subjectIds: [plantId], location: position });
    world.entities.destroy(plantId);
    return "died";
  }

  const reproducedId = attemptReproduction(world, plantSpecies, random, plantId);
  return reproducedId !== undefined ? "reproduced" : "grew";
}

/** Drives every live tree's lifecycle once, in a deterministic (sorted-id) order -- the composed driver a colony/ecosystem loop calls per tick. */
export function tickAllPlantLifecycles(world: World, plantSpecies: PlantSpeciesRegistry, random: RandomStream, soil?: SoilFertilityField): void {
  for (const plantId of world.entities.liveIdsOfKind("tree").sort((a: EntityId, b: EntityId) => a - b)) {
    tickPlantLifecycle(world, plantSpecies, random, plantId, soil);
  }
}
