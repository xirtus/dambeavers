import type { EntityId } from "../core/EntityId.js";
import type { ColumnCoordinate } from "../hydrology/WaterField.js";
import type { RandomStream } from "../core/Random.js";
import type { World } from "../persistence/WorldSnapshot.js";
import { getAnimal, spawnAnimal, dieAnimal } from "../creatures/Animal.js";
import { seasonalAmbientTemperature } from "../weather/Seasons.js";
import type { AnimalSpeciesRegistry } from "../creatures/AnimalSpecies.js";

/**
 * P4-06: fish distribution as a real, per-tick derived consequence of
 * connected water, depth, and habitat -- never a fixed population placed
 * once. Reuses P4-05's generic `Animal`/`spawnAnimal`/`dieAnimal`
 * (species `"trout"`, `AnimalSpecies.ts`) rather than P1-17's own bare,
 * behaviorless `"fish"` presence entity (`EcologyResponse.ts`'s
 * `spawnFish`) -- that earlier mechanism is untouched (Law 10: an
 * already-shipped, already-tested task's own code is not rewritten
 * speculatively) and remains valid as simple habitat presence; this file
 * is the real distribution/behavior layer the roadmap's own P4-06
 * wording asks for, built on the species framework that didn't exist
 * when P1-17 shipped. "Temperature" is sourced today from `Weather.ts`'s
 * real seasonal ambient scalar (P4-01) rather than a dedicated per-column
 * water-temperature field -- P4-11 (`WaterTemperature.ts`) adds that
 * later; once it exists, `fishHabitatSuitability` below is the one place
 * to swap in real per-column readings.
 */

function manhattanNeighbors(x: number, z: number): ColumnCoordinate[] {
  return [
    { x: x + 1, z },
    { x: x - 1, z },
    { x, z: z + 1 },
    { x, z: z - 1 },
  ];
}

/** Real habitat suitability `[0, 1]` for an aquatic species at a column -- depth adequacy (0 below `minHabitatDepth`, saturating shortly above it) scaled by the current seasonal ambient temperature (colder seasons are less suitable, a real if coarse stand-in until P4-11's per-column field exists). */
export function fishHabitatSuitability(world: World, animalSpecies: AnimalSpeciesRegistry, speciesId: string, x: number, z: number): number {
  const species = animalSpecies.get(speciesId);
  if (!species.aquatic) return 0;
  const depth = world.water.depthAt(x, z);
  if (depth < species.minHabitatDepth) return 0;
  const depthSuitability = Math.min(1, (depth - species.minHabitatDepth + 0.1) / 0.5);
  // Real seasonal temperature (P4-01) scales suitability -- colder water
  // is genuinely less suitable habitat, one shared formula rather than a
  // per-species table. (A per-column WaterTemperatureField reading is a
  // documented future refinement once P4-11's field is wired here.)
  const temperature = seasonalAmbientTemperature(world.clock.tick);
  return depthSuitability * temperature;
}

/** Per-tick probability an already-established fish population spreads into one newly-connected, suitable neighboring column. Plausible, tunable balance data. */
export const FISH_SPREAD_PROBABILITY = 0.02;

/**
 * One tick of real fish distribution for `speciesId`: any live fish now
 * in a column that's dropped below real habitat suitability strands and
 * dies (a real, systemic consequence of drying/receding water, not a
 * scripted despawn); every surviving fish then has a small chance to
 * spread into one immediately-adjacent (hence genuinely CONNECTED, never
 * teleporting into a disconnected pond) column that's real suitable
 * habitat and doesn't already hold a fish.
 */
export function tickFishDistribution(world: World, animalSpecies: AnimalSpeciesRegistry, random: RandomStream, speciesId: string): void {
  const occupied = new Set<string>();
  const liveFish: EntityId[] = [];
  for (const id of world.entities.liveIdsOfKind("animal").sort((a: EntityId, b: EntityId) => a - b)) {
    if (getAnimal(world.components, id)?.speciesId !== speciesId) continue;
    liveFish.push(id);
    const position = world.grid.positionOf(id);
    if (position !== undefined) occupied.add(`${position.x},${position.z}`);
  }

  for (const id of liveFish) {
    const position = world.grid.positionOf(id);
    if (position === undefined) continue;
    if (fishHabitatSuitability(world, animalSpecies, speciesId, position.x, position.z) <= 0) {
      dieAnimal(world, id, "stranded", "plant-matter");
      occupied.delete(`${position.x},${position.z}`);
      continue;
    }
    if (!random.nextBool(FISH_SPREAD_PROBABILITY)) continue;
    const candidates = random
      .shuffle(manhattanNeighbors(position.x, position.z))
      .filter((cell) => !occupied.has(`${cell.x},${cell.z}`) && fishHabitatSuitability(world, animalSpecies, speciesId, cell.x, cell.z) > 0);
    const site = candidates[0];
    if (site === undefined) continue;
    const floor = world.grid.surfaceY(site.x, site.z);
    if (floor === undefined) continue;
    spawnAnimal(world, animalSpecies, speciesId, { x: site.x, y: floor + 1, z: site.z });
    occupied.add(`${site.x},${site.z}`);
  }
}
