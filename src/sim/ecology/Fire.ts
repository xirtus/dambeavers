import { ComponentStore, defineComponent, type ComponentType } from "../core/ComponentStore.js";
import type { EntityId } from "../core/EntityId.js";
import type { RandomStream } from "../core/Random.js";
import type { MaterialRegistry } from "../materials/Material.js";
import type { WaterField } from "../hydrology/WaterField.js";
import type { World } from "../persistence/WorldSnapshot.js";
import { getPlant, setPlant } from "./Plant.js";
import { growthFraction, type PlantSpeciesRegistry } from "./PlantSpecies.js";
import { currentWetness } from "./EcologyResponse.js";
import { seasonalAmbientTemperature } from "../weather/Seasons.js";

/**
 * P4-13: ignition/spread from the roadmap's own three real inputs --
 * temperature (`seasonalAmbientTemperature`, P4-01), fuel (a tree's real
 * `species.woodMaterialId.organic` flag AND its own current growth
 * fraction -- a bigger, more mature tree carries more fuel), and moisture
 * (`currentWetness`, P1-17's own formula, unmodified) -- combined into
 * ONE ignition-probability formula, never a per-species/per-material-name
 * branch (a stone terrain feature or a fully-submerged plant is
 * structurally incapable of igniting here purely because `organic`/
 * `currentWetness` make the formula evaluate to 0, not because of an
 * `if (materialId === "stone") return false`).
 */
export interface Burning {
  ignitedTick: number;
}
export const BurningComponent: ComponentType<Burning> = defineComponent<Burning>("burning");

export function assertValidBurning(burning: Burning): void {
  if (!Number.isInteger(burning.ignitedTick) || burning.ignitedTick < 0) {
    throw new RangeError(`burning ignitedTick must be a non-negative integer, got ${burning.ignitedTick}`);
  }
}

export function setBurning(components: ComponentStore, id: EntityId, burning: Burning): void {
  assertValidBurning(burning);
  components.set(id, BurningComponent, burning);
}

export function getBurning(components: ComponentStore, id: EntityId): Burning | undefined {
  const burning = components.get(id, BurningComponent);
  if (burning !== undefined) assertValidBurning(burning);
  return burning;
}

/** Baseline ambient-ignition probability (a lightning-strike/spontaneous-combustion stand-in) at maximum dryness/heat/fuel -- deliberately tiny; real spread (below) is what actually grows a fire, not repeated ambient rolls. Plausible, tunable balance data. */
export const AMBIENT_IGNITION_PROBABILITY = 0.0002;
/** Probability an adjacent BURNING tree ignites this one, at maximum dryness/fuel -- deliberately much higher than ambient (real fires spread mainly tree-to-tree, not via repeated independent lightning strikes). Plausible, tunable balance data. */
export const SPREAD_IGNITION_PROBABILITY = 0.05;
export const FIRE_HEALTH_LOSS_PER_TICK = 0.1;
export const FIRE_NEIGHBOR_RADIUS = 2;

function fuelReadiness(materials: MaterialRegistry, plantSpecies: PlantSpeciesRegistry, speciesId: string, ageTicks: number, water: WaterField, x: number, z: number, tick: number): number {
  const species = plantSpecies.get(speciesId);
  const wood = materials.get(species.woodMaterialId);
  if (!wood.organic) return 0;
  const dryness = 1 - currentWetness(water, x, z);
  const temperature = seasonalAmbientTemperature(tick);
  return dryness * temperature * growthFraction(species, ageTicks);
}

function manhattan(ax: number, az: number, bx: number, bz: number): number {
  return Math.abs(ax - bx) + Math.abs(az - bz);
}

/** One tick for a single live tree: if already burning, applies real fire damage (destroying it -- ash, no harvestable logs, a fire-consumed tree yields nothing -- once health reaches 0) and rolls to ignite each nearby unburning tree within `FIRE_NEIGHBOR_RADIUS`; if not burning, rolls the tiny ambient-ignition ambient-ignition probability. Returns what happened to THIS tree this tick. */
export function tickFire(world: World, plantSpecies: PlantSpeciesRegistry, materials: MaterialRegistry, random: RandomStream, plantId: EntityId): "burned-out" | "spreading" | "ignited" | "unchanged" {
  const plant = getPlant(world.components, plantId);
  if (plant === undefined) return "unchanged";
  const position = world.grid.positionOf(plantId);
  if (position === undefined) return "unchanged";
  const readiness = fuelReadiness(materials, plantSpecies, plant.speciesId, plant.ageTicks, world.water, position.x, position.z, world.clock.tick);

  if (getBurning(world.components, plantId) !== undefined) {
    const damaged = { ...plant, health: Math.max(0, plant.health - FIRE_HEALTH_LOSS_PER_TICK) };
    setPlant(world.components, plantId, damaged);
    if (damaged.health <= 0) {
      world.events.record({ tick: world.clock.tick, eventType: "plant-burned-out", subjectIds: [plantId], location: position });
      world.entities.destroy(plantId);
      return "burned-out";
    }
    // The most recent "plant-ignited"/"plant-died" event this SAME tree
    // was itself a subject of -- its own real direct cause, if it has
    // one (an ambient ignition has none). Linking every spread event back
    // to it (`causeEventId`) is what lets P4-16's causality queries
    // (`EcosystemCausality.ts`) walk a genuine multi-hop fire-spread
    // chain via `EventLog.traceBack`, not just each event's own isolated
    // `objectIds` reference.
    const ownIgnitionEvent = world.events.eventsInvolving(plantId).find((e) => e.eventType === "plant-ignited");

    for (const otherId of world.entities.liveIdsOfKind("tree")) {
      if (otherId === plantId || getBurning(world.components, otherId) !== undefined) continue;
      const otherPlant = getPlant(world.components, otherId);
      const otherPosition = world.grid.positionOf(otherId);
      if (otherPlant === undefined || otherPosition === undefined) continue;
      if (manhattan(position.x, position.z, otherPosition.x, otherPosition.z) > FIRE_NEIGHBOR_RADIUS) continue;
      const otherReadiness = fuelReadiness(materials, plantSpecies, otherPlant.speciesId, otherPlant.ageTicks, world.water, otherPosition.x, otherPosition.z, world.clock.tick);
      if (random.nextBool(SPREAD_IGNITION_PROBABILITY * otherReadiness)) {
        setBurning(world.components, otherId, { ignitedTick: world.clock.tick });
        world.events.record({
          tick: world.clock.tick,
          eventType: "plant-ignited",
          subjectIds: [otherId],
          objectIds: [plantId],
          location: otherPosition,
          ...(ownIgnitionEvent !== undefined ? { causeEventId: ownIgnitionEvent.id } : {}),
        });
      }
    }
    return "spreading";
  }

  if (random.nextBool(AMBIENT_IGNITION_PROBABILITY * readiness)) {
    setBurning(world.components, plantId, { ignitedTick: world.clock.tick });
    world.events.record({ tick: world.clock.tick, eventType: "plant-ignited", subjectIds: [plantId], location: position });
    return "ignited";
  }
  return "unchanged";
}

/** Drives every live tree's fire tick once, in a deterministic (sorted-id) order. */
export function tickAllFire(world: World, plantSpecies: PlantSpeciesRegistry, materials: MaterialRegistry, random: RandomStream): void {
  for (const plantId of world.entities.liveIdsOfKind("tree").sort((a: EntityId, b: EntityId) => a - b)) {
    if (world.entities.isLive(plantId)) tickFire(world, plantSpecies, materials, random, plantId);
  }
}
