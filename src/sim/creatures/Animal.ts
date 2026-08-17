import { ComponentStore, defineComponent, type ComponentType } from "../core/ComponentStore.js";
import type { EntityId } from "../core/EntityId.js";
import type { CellCoordinate } from "../world/WorldGrid.js";
import type { World } from "../persistence/WorldSnapshot.js";
import { setCreatureBody, setLocomotion, setSwimmer, getCreatureBody, setHealth } from "./Beaver.js";
import { setNeeds, BASELINE_NEEDS } from "./Needs.js";
import type { AnimalSpeciesRegistry } from "./AnimalSpecies.js";
import { setGood } from "../economy/Good.js";

/**
 * P4-05: the ONLY per-animal state this file adds is `speciesId` --
 * mass, speed, swim capability, hunger/thirst/fatigue, and health are all
 * the SAME generic components `Beaver.ts`/`Needs.ts` already defined
 * (kind `"animal"`, not `"beaver"`, but identical component types).
 * `spawnAnimal` (below) is the entire "species-specific AI controller"
 * this task refuses to write: it just reads `AnimalSpeciesProperties`
 * into the generic components and stops.
 */
export interface Animal {
  speciesId: string;
}
export const AnimalComponent: ComponentType<Animal> = defineComponent<Animal>("animal");

export function assertValidAnimal(animal: Animal): void {
  if (animal.speciesId.trim().length === 0) throw new RangeError("animal speciesId must be non-empty");
}

export function setAnimal(components: ComponentStore, id: EntityId, animal: Animal): void {
  assertValidAnimal(animal);
  components.set(id, AnimalComponent, animal);
}

export function getAnimal(components: ComponentStore, id: EntityId): Animal | undefined {
  const animal = components.get(id, AnimalComponent);
  if (animal !== undefined) assertValidAnimal(animal);
  return animal;
}

/** Places a new live animal of `speciesId` at `position`, attaching the same generic creature/needs/health components any other creature in this codebase already uses. Throws if the species is unregistered. */
export function spawnAnimal(world: World, animalSpecies: AnimalSpeciesRegistry, speciesId: string, position: CellCoordinate): EntityId {
  const species = animalSpecies.get(speciesId);
  const id = world.entities.create("animal");
  world.grid.setEntityPosition(id, position.x, position.y, position.z);
  setAnimal(world.components, id, { speciesId });
  setCreatureBody(world.components, id, { massKg: species.massKg });
  setLocomotion(world.components, id, { speed: species.speed });
  setSwimmer(world.components, id, { canSwim: species.canSwim, maxWadingDepth: species.maxWadingDepth });
  setNeeds(world.components, id, { ...BASELINE_NEEDS });
  setHealth(world.components, id, { fraction: 1 });
  return id;
}

/**
 * Kills `animalId` outright: records a real event, drops a real physical
 * carcass (`Good`, `goodKind: "carcass"`, a real `MaterialId` so it
 * decays/is haulable like any other good -- P4-07's own "edible-body"
 * requirement, Law 1.6) at its last position, and destroys the entity.
 * Deliberately lighter-weight than `Mortality.ts`'s beaver-only `die`
 * (no burial/mourning -- that machinery is specifically about beaver
 * social consequences, not a generic animal-death primitive).
 */
export function dieAnimal(world: World, animalId: EntityId, cause: string, carcassMaterialId: string): EntityId {
  if (!world.entities.isLive(animalId) || world.entities.kindOf(animalId) !== "animal") {
    throw new RangeError(`entity ${animalId} is not a live animal -- cannot mark it dead`);
  }
  const position = world.grid.positionOf(animalId);
  if (position === undefined) throw new RangeError(`animal ${animalId} has no position -- cannot record where it died`);
  const body = getCreatureBody(world.components, animalId);
  const massKg = body?.massKg ?? 1;

  world.events.record({ tick: world.clock.tick, eventType: `${cause}-death`, subjectIds: [animalId], location: position });

  const carcassId = world.entities.create("good");
  world.grid.setEntityPosition(carcassId, position.x, position.y, position.z);
  setGood(world.components, carcassId, { goodKind: "carcass", materialId: carcassMaterialId, massKg: massKg * 0.4 });

  world.entities.destroy(animalId);
  return carcassId;
}

