import type { EntityId, EntityIdRegistry } from "../core/EntityId.js";
import type { ComponentStore } from "../core/ComponentStore.js";
import type { WorldGrid } from "../world/WorldGrid.js";
import type { TerrainField } from "../world/TerrainField.js";
import type { WaterField } from "../hydrology/WaterField.js";
import type { MaterialRegistry } from "../materials/Material.js";
import type { World } from "../persistence/WorldSnapshot.js";
import { getAnimal, dieAnimal } from "./Animal.js";
import type { AnimalSpeciesRegistry } from "./AnimalSpecies.js";
import { getNeeds, setNeeds, NEED_URGENT_THRESHOLD, clamp01 } from "./Needs.js";
import { advanceTowards } from "./BeaverLocomotion.js";

/**
 * P4-07: predation emerges from the roadmap's own five-item list, each a
 * real mechanism, never a scripted "predator kills prey" event:
 * hunger (`Needs.hunger` crossing `NEED_URGENT_THRESHOLD`, P1-06's own
 * existing threshold, reused unmodified -- a predator that isn't hungry
 * doesn't hunt), perception (`nearestLivePrey`, a real nearest-live-entity
 * query over actual positions), pursuit (`advanceTowards`, P1-05's
 * already-generic navigation primitive -- no animal-specific movement
 * code), combat (adjacency-triggered kill, abstracted the same way
 * `Mortality.ts`'s own `applyTrauma` abstracts injury -- no swing-by-swing
 * simulation, Law 2 doesn't require one), and edible-body (`dieAnimal`,
 * P4-05, spawns a real physical carcass `Good` -- Law 1.6).
 */

/** Real hunger relief a successful kill grants -- plausible, tunable balance data, on the same `[0, 1]` scale `Needs.hunger` already uses. */
export const PREDATION_HUNGER_RELIEF = 0.6;

function manhattan(ax: number, az: number, bx: number, bz: number): number {
  return Math.abs(ax - bx) + Math.abs(az - bz);
}

/** Nearest live animal of any species in `predator`'s own `preySpeciesIds`, by real Manhattan distance from its current position -- ties broken by lowest id for determinism. `undefined` if no live prey exists or the predator itself has no position. */
export function nearestLivePrey(entities: EntityIdRegistry, components: ComponentStore, grid: WorldGrid, animalSpecies: AnimalSpeciesRegistry, predatorId: EntityId): EntityId | undefined {
  const predatorAnimal = getAnimal(components, predatorId);
  if (predatorAnimal === undefined) return undefined;
  const predatorSpecies = animalSpecies.get(predatorAnimal.speciesId);
  if (predatorSpecies.preySpeciesIds.length === 0) return undefined;
  const position = grid.positionOf(predatorId);
  if (position === undefined) return undefined;

  let best: EntityId | undefined;
  let bestDistance = Infinity;
  for (const id of entities.liveIdsOfKind("animal")) {
    if (id === predatorId) continue;
    const prey = getAnimal(components, id);
    if (prey === undefined || !predatorSpecies.preySpeciesIds.includes(prey.speciesId)) continue;
    const preyPosition = grid.positionOf(id);
    if (preyPosition === undefined) continue;
    const distance = manhattan(position.x, position.z, preyPosition.x, preyPosition.z);
    if (distance < bestDistance || (distance === bestDistance && (best === undefined || id < best))) {
      best = id;
      bestDistance = distance;
    }
  }
  return best;
}

export type PredationOutcome = "hunted" | "pursuing" | "idle";

/**
 * One simulated tick of predation for a single carnivore/omnivore
 * `predatorId`: idle unless genuinely hungry (`NEED_URGENT_THRESHOLD`,
 * same real threshold every other need-driven behavior in this codebase
 * already uses); otherwise perceives the nearest live prey and either
 * kills it (adjacent -- real combat/edible-body consequence) or pursues
 * it one real navigation step closer. Never called for a herbivore (its
 * own `preySpeciesIds` is empty, so `nearestLivePrey` always returns
 * `undefined` and this is a cheap no-op).
 */
export function tickPredation(
  grid: WorldGrid,
  terrain: TerrainField,
  water: WaterField,
  materials: MaterialRegistry,
  entities: EntityIdRegistry,
  components: ComponentStore,
  animalSpecies: AnimalSpeciesRegistry,
  world: World,
  predatorId: EntityId,
): PredationOutcome {
  const needs = getNeeds(components, predatorId);
  if (needs === undefined || needs.hunger < NEED_URGENT_THRESHOLD) return "idle";

  const preyId = nearestLivePrey(entities, components, grid, animalSpecies, predatorId);
  if (preyId === undefined) return "idle";

  const predatorPosition = grid.positionOf(predatorId)!;
  const preyPosition = grid.positionOf(preyId)!;

  if (manhattan(predatorPosition.x, predatorPosition.z, preyPosition.x, preyPosition.z) <= 1) {
    world.events.record({ tick: world.clock.tick, eventType: "predation", subjectIds: [predatorId], objectIds: [preyId], location: predatorPosition });
    dieAnimal(world, preyId, "predation", "plant-matter");
    setNeeds(components, predatorId, { ...needs, hunger: clamp01(needs.hunger - PREDATION_HUNGER_RELIEF) });
    return "hunted";
  }

  advanceTowards(grid, terrain, water, materials, components, predatorId, { x: preyPosition.x, z: preyPosition.z });
  return "pursuing";
}
