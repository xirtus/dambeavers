import { ComponentStore, defineComponent, type ComponentType } from "../core/ComponentStore.js";
import type { EntityId, EntityIdRegistry } from "../core/EntityId.js";
import type { RandomStream } from "../core/Random.js";
import type { World } from "../persistence/WorldSnapshot.js";
import { getHealth, setHealth } from "./Beaver.js";
import { die, applyHealthDamage } from "./Mortality.js";
import { dieAnimal } from "./Animal.js";

/**
 * P4-14: infection as a real, transmissible per-host state -- not a
 * scripted "beaver X catches disease Y" event. `Infection` is generic
 * over any entity carrying the ordinary `Health` component (P0-02's own
 * kind-agnostic component contract), so the SAME mechanism covers
 * beavers and any P4-05 animal alike, matching this codebase's own
 * "share general components" discipline. `PathogenDefinition` is a data-
 * defined registry (same contract shape as `MaterialRegistry`); the
 * transmission route this task builds is real physical proximity
 * (adjacency each tick), the literal "defined transmission route" the
 * acceptance test names.
 */
export interface PathogenDefinition {
  readonly id: string;
  readonly displayName: string;
  /** Probability an infected host transmits to an adjacent, uninfected, susceptible host on a single tick. */
  readonly transmissionProbability: number;
  /** Real health loss per tick while infected -- scales with `Infection.severity`. */
  readonly severityGrowthPerTick: number;
  readonly baseHealthLossPerTick: number;
}

const PATHOGEN_ID_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

function assertValidPathogen(def: PathogenDefinition): void {
  if (!PATHOGEN_ID_PATTERN.test(def.id)) throw new RangeError(`pathogen id must be non-empty lowercase kebab-case, got ${JSON.stringify(def.id)}`);
  if (def.displayName.length === 0) throw new RangeError(`pathogen "${def.id}" must have a non-empty displayName`);
  if (!(def.transmissionProbability >= 0 && def.transmissionProbability <= 1)) throw new RangeError(`pathogen "${def.id}": transmissionProbability must be in [0,1]`);
  if (!(def.severityGrowthPerTick >= 0 && Number.isFinite(def.severityGrowthPerTick))) throw new RangeError(`pathogen "${def.id}": severityGrowthPerTick must be non-negative`);
  if (!(def.baseHealthLossPerTick >= 0 && Number.isFinite(def.baseHealthLossPerTick))) throw new RangeError(`pathogen "${def.id}": baseHealthLossPerTick must be non-negative`);
}

export class PathogenRegistry {
  private readonly pathogens = new Map<string, PathogenDefinition>();

  define(definition: PathogenDefinition): void {
    assertValidPathogen(definition);
    if (this.pathogens.has(definition.id)) throw new RangeError(`pathogen "${definition.id}" is already defined`);
    this.pathogens.set(definition.id, Object.freeze({ ...definition }));
  }

  get(id: string): PathogenDefinition {
    const def = this.pathogens.get(id);
    if (def === undefined) throw new RangeError(`unknown pathogen id "${id}"`);
    return def;
  }

  has(id: string): boolean {
    return this.pathogens.has(id);
  }
}

/** Plausible, tunable initial pathogen -- mild, slow, transmissible via real proximity. */
export const STANDARD_PATHOGENS: readonly PathogenDefinition[] = [
  { id: "swamp-fever", displayName: "Swamp Fever", transmissionProbability: 0.05, severityGrowthPerTick: 0.005, baseHealthLossPerTick: 0.01 },
];

export function registerStandardPathogens(registry: PathogenRegistry): void {
  for (const pathogen of STANDARD_PATHOGENS) registry.define(pathogen);
}

export interface Infection {
  pathogenId: string;
  contractedTick: number;
  severity: number;
}
export const InfectionComponent: ComponentType<Infection> = defineComponent<Infection>("infection");

export function assertValidInfection(infection: Infection): void {
  if (infection.pathogenId.trim().length === 0) throw new RangeError("infection pathogenId must be non-empty");
  if (!Number.isInteger(infection.contractedTick) || infection.contractedTick < 0) throw new RangeError("infection contractedTick must be a non-negative integer");
  if (!(infection.severity >= 0 && infection.severity <= 1)) throw new RangeError(`infection severity must be in [0,1], got ${infection.severity}`);
}

export function setInfection(components: ComponentStore, id: EntityId, infection: Infection): void {
  assertValidInfection(infection);
  components.set(id, InfectionComponent, infection);
}

export function getInfection(components: ComponentStore, id: EntityId): Infection | undefined {
  const infection = components.get(id, InfectionComponent);
  if (infection !== undefined) assertValidInfection(infection);
  return infection;
}

/** Infects a not-already-infected host directly -- the primitive `tickTransmission` (below) calls once a real proximity roll succeeds. Throws if already infected (re-infection isn't modeled -- a real, documented simplification). */
export function infect(world: World, pathogens: PathogenRegistry, hostId: EntityId, pathogenId: string): void {
  if (getInfection(world.components, hostId) !== undefined) throw new RangeError(`entity ${hostId} is already infected`);
  pathogens.get(pathogenId); // validates the pathogen id is real
  setInfection(world.components, hostId, { pathogenId, contractedTick: world.clock.tick, severity: 0.05 });
  world.events.record({ tick: world.clock.tick, eventType: "infection-contracted", subjectIds: [hostId], location: world.grid.positionOf(hostId)! });
}

function manhattan(ax: number, az: number, bx: number, bz: number): number {
  return Math.abs(ax - bx) + Math.abs(az - bz);
}

/** Real host kinds `Disease.ts` can infect -- any entity kind carrying the ordinary `Health` component. Beavers and animals only, today. */
function isSusceptibleHostKind(entities: EntityIdRegistry, id: EntityId): boolean {
  const kind = entities.kindOf(id);
  return kind === "beaver" || kind === "animal";
}

/** One tick of real proximity transmission FROM `hostId` (must be currently infected): every other live, susceptible, uninfected host within Manhattan distance 1 gets a real transmission-probability roll. */
export function tickTransmission(world: World, pathogens: PathogenRegistry, random: RandomStream, hostId: EntityId): void {
  const infection = getInfection(world.components, hostId);
  if (infection === undefined) return;
  const pathogen = pathogens.get(infection.pathogenId);
  const position = world.grid.positionOf(hostId);
  if (position === undefined) return;

  for (const kind of ["beaver", "animal"] as const) {
    for (const otherId of world.entities.liveIdsOfKind(kind)) {
      if (otherId === hostId || !isSusceptibleHostKind(world.entities, otherId)) continue;
      if (getInfection(world.components, otherId) !== undefined) continue;
      const otherPosition = world.grid.positionOf(otherId);
      if (otherPosition === undefined) continue;
      if (manhattan(position.x, position.z, otherPosition.x, otherPosition.z) > 1) continue;
      if (random.nextBool(pathogen.transmissionProbability)) infect(world, pathogens, otherId, infection.pathogenId);
    }
  }
}

export type DiseaseProgressOutcome = "died" | "progressed" | "healthy";

/** One tick of real disease progression for an infected host: severity grows, real health damage scales with it, and death (through the correct real per-kind mechanism -- `Mortality.die` for a beaver, `Animal.dieAnimal` for an animal) follows once health reaches 0, exactly like every other cause of death in this codebase. */
export function tickInfectionProgress(world: World, pathogens: PathogenRegistry, hostId: EntityId): DiseaseProgressOutcome {
  const infection = getInfection(world.components, hostId);
  if (infection === undefined) return "healthy";
  const pathogen = pathogens.get(infection.pathogenId);
  const severity = Math.min(1, infection.severity + pathogen.severityGrowthPerTick);
  setInfection(world.components, hostId, { ...infection, severity });

  const health = getHealth(world.components, hostId);
  if (health === undefined) return "progressed";
  const damaged = applyHealthDamage(health, pathogen.baseHealthLossPerTick * severity);
  setHealth(world.components, hostId, damaged);

  if (damaged.fraction <= 0) {
    if (world.entities.kindOf(hostId) === "beaver") die(world, hostId, "disease");
    else dieAnimal(world, hostId, "disease", "plant-matter");
    return "died";
  }
  return "progressed";
}

/** Drives transmission then progression for every currently-infected live host once, in a deterministic (sorted-id) order. */
export function tickAllDisease(world: World, pathogens: PathogenRegistry, random: RandomStream): void {
  const infectedIds: EntityId[] = [];
  for (const kind of ["beaver", "animal"] as const) {
    for (const id of world.entities.liveIdsOfKind(kind)) {
      if (getInfection(world.components, id) !== undefined) infectedIds.push(id);
    }
  }
  infectedIds.sort((a, b) => a - b);
  for (const id of infectedIds) {
    if (!world.entities.isLive(id)) continue;
    tickTransmission(world, pathogens, random, id);
  }
  for (const id of infectedIds) {
    if (world.entities.isLive(id)) tickInfectionProgress(world, pathogens, id);
  }
}
