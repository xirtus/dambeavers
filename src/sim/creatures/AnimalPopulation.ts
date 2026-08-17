import type { EntityId, EntityIdRegistry } from "../core/EntityId.js";
import type { ComponentStore } from "../core/ComponentStore.js";
import type { WorldGrid } from "../world/WorldGrid.js";
import type { TerrainField } from "../world/TerrainField.js";
import type { WaterField } from "../hydrology/WaterField.js";
import type { MaterialRegistry } from "../materials/Material.js";
import type { RandomStream } from "../core/Random.js";
import type { World } from "../persistence/WorldSnapshot.js";
import { getAnimal, spawnAnimal, dieAnimal } from "./Animal.js";
import type { AnimalSpeciesRegistry } from "./AnimalSpecies.js";
import { getNeeds, setNeeds, applyNeedsTick } from "./Needs.js";
import { tickPredation } from "./Predation.js";
import { fishHabitatSuitability } from "../ecology/FishEcology.js";
import { seasonalActivityMultiplier } from "../weather/Seasons.js";

/**
 * P4-08: unmanaged animal populations rise and fall from the roadmap's
 * own four real inputs -- food (starvation death when hunger sustains at
 * its own ceiling, mirroring `Mortality.ts`'s beaver starvation
 * mechanism at animal scale), habitat (reproduction only succeeds at a
 * genuinely suitable site -- land needs free ground, water species need
 * real habitat depth, `FishEcology.ts`'s own `fishHabitatSuitability`
 * reused unmodified), predation (`Predation.ts`, P4-07, unmodified --
 * every predator tick runs here too), and reproduction
 * (`attemptAnimalReproduction`, gated on real hunger and a real seasonal
 * activity multiplier, P4-01). No population counter exists anywhere:
 * "population" is always just `entities.liveIdsOfKind("animal")`,
 * derived, never tracked.
 */

/** Real per-tick health/hunger loss while `Needs.hunger` sits at its own ceiling -- the same "sustained hunger genuinely harms" mechanism `Mortality.ts`'s `STARVATION_DAMAGE_PER_TICK` established for beavers, at animal scale. Plausible, tunable balance data. */
export const ANIMAL_STARVATION_HEALTH_LOSS_PER_TICK = 0.02;
/** Above this hunger fraction, an animal will not attempt reproduction -- a real food gate on population growth. */
export const REPRODUCTION_MAX_HUNGER = 0.5;
/** Per-tick probability an eligible animal attempts reproduction, before the seasonal activity multiplier. Plausible, tunable balance data. */
export const REPRODUCTION_BASE_PROBABILITY = 0.003;

function manhattanNeighbors(x: number, z: number): Array<{ x: number; z: number }> {
  return [
    { x: x + 1, z },
    { x: x - 1, z },
    { x, z: z + 1 },
    { x, z: z - 1 },
  ];
}

function isFreeLandGround(grid: WorldGrid, entities: EntityIdRegistry, x: number, z: number): boolean {
  const floor = grid.surfaceY(x, z);
  if (floor === undefined) return false;
  for (const id of grid.entitiesAt(x, floor + 1, z)) {
    if (entities.kindOf(id) === "animal") return false;
  }
  return true;
}

/** Attempts one reproduction roll for a real, sufficiently-fed animal at a genuinely suitable nearby site -- aquatic species need real habitat depth there (`fishHabitatSuitability`), land species need real free ground. No-op if ineligible, the roll fails, or nothing suitable is nearby. */
export function attemptAnimalReproduction(world: World, animalSpecies: AnimalSpeciesRegistry, random: RandomStream, animalId: EntityId): EntityId | undefined {
  const animal = getAnimal(world.components, animalId);
  if (animal === undefined) return undefined;
  const species = animalSpecies.get(animal.speciesId);
  const needs = getNeeds(world.components, animalId);
  if (needs === undefined || needs.hunger > REPRODUCTION_MAX_HUNGER) return undefined;

  const probability = REPRODUCTION_BASE_PROBABILITY * seasonalActivityMultiplier(world.clock.tick);
  if (!random.nextBool(probability)) return undefined;

  const position = world.grid.positionOf(animalId);
  if (position === undefined) return undefined;
  const candidates = random.shuffle(manhattanNeighbors(position.x, position.z)).filter((cell) => {
    if (species.aquatic) return fishHabitatSuitability(world, animalSpecies, animal.speciesId, cell.x, cell.z) > 0;
    return isFreeLandGround(world.grid, world.entities, cell.x, cell.z);
  });
  const site = candidates[0];
  if (site === undefined) return undefined;
  const floor = world.grid.surfaceY(site.x, site.z);
  if (floor === undefined) return undefined;
  return spawnAnimal(world, animalSpecies, animal.speciesId, { x: site.x, y: floor + 1, z: site.z });
}

export type AnimalPopulationOutcome = "hunted" | "pursuing" | "starved" | "reproduced" | "idle";

/** One simulated tick for a single live animal: predation first (if a carnivore/omnivore with real prey nearby), then needs decay, starvation death if sustained, then a reproduction attempt. */
export function tickAnimal(
  grid: WorldGrid,
  terrain: TerrainField,
  water: WaterField,
  materials: MaterialRegistry,
  entities: EntityIdRegistry,
  components: ComponentStore,
  animalSpecies: AnimalSpeciesRegistry,
  random: RandomStream,
  world: World,
  animalId: EntityId,
): AnimalPopulationOutcome {
  const predationOutcome = tickPredation(grid, terrain, water, materials, entities, components, animalSpecies, world, animalId);
  if (predationOutcome !== "idle") return predationOutcome;

  const needs = getNeeds(components, animalId);
  if (needs === undefined) return "idle";
  const advanced = applyNeedsTick(needs, false);
  setNeeds(components, animalId, advanced);

  if (advanced.hunger >= 1) {
    dieAnimal(world, animalId, "starvation", "plant-matter");
    return "starved";
  }

  const reproducedId = attemptAnimalReproduction(world, animalSpecies, random, animalId);
  return reproducedId !== undefined ? "reproduced" : "idle";
}

/** Drives every live animal's population tick once, in a deterministic (sorted-id) order. */
export function tickAllAnimals(deps: { grid: WorldGrid; terrain: TerrainField; water: WaterField; materials: MaterialRegistry; entities: EntityIdRegistry; components: ComponentStore }, animalSpecies: AnimalSpeciesRegistry, random: RandomStream, world: World): void {
  for (const animalId of deps.entities.liveIdsOfKind("animal").sort((a: EntityId, b: EntityId) => a - b)) {
    if (!deps.entities.isLive(animalId)) continue; // an earlier animal this same tick may have preyed on this one
    tickAnimal(deps.grid, deps.terrain, deps.water, deps.materials, deps.entities, deps.components, animalSpecies, random, world, animalId);
  }
}
