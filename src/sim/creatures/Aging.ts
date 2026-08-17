import { defineComponent, type ComponentStore, type ComponentType } from "../core/ComponentStore.js";
import type { EntityId } from "../core/EntityId.js";
import type { World } from "../persistence/WorldSnapshot.js";
import {
  DEFAULT_BEAVER_CAN_SWIM,
  DEFAULT_BEAVER_MASS_KG,
  DEFAULT_BEAVER_MAX_WADING_DEPTH,
  DEFAULT_BEAVER_SPEED,
  setCreatureBody,
  setLocomotion,
  setSwimmer,
} from "./Beaver.js";

/**
 * P2-12's baseline childhood/aging model. Age is authoritative persistent
 * state measured in `SimulationClock.tick` units; life stage is the
 * normalized capability band derived from that age. The actual capability
 * changes are written into the existing beaver body/locomotion/swimmer
 * components so other systems keep reading the same authoritative fields
 * they already use.
 */
export type LifeStage = "newborn" | "juvenile" | "adult";

export interface LifeStageState {
  ageTicks: number;
  stage: LifeStage;
  lastUpdatedTick: number;
}
export const LifeStageComponent: ComponentType<LifeStageState> = defineComponent<LifeStageState>("life-stage");

export const NEWBORN_TO_JUVENILE_TICKS = 100;
export const JUVENILE_TO_ADULT_TICKS = 250;

export const LIFE_STAGE_CAPABILITIES: Readonly<Record<LifeStage, { massKg: number; speed: number; canSwim: boolean; maxWadingDepth: number }>> =
  Object.freeze({
    newborn: Object.freeze({ massKg: 4, speed: 0.25, canSwim: false, maxWadingDepth: 0.05 }),
    juvenile: Object.freeze({ massKg: 10, speed: 1, canSwim: DEFAULT_BEAVER_CAN_SWIM, maxWadingDepth: 0.2 }),
    adult: Object.freeze({
      massKg: DEFAULT_BEAVER_MASS_KG,
      speed: DEFAULT_BEAVER_SPEED,
      canSwim: DEFAULT_BEAVER_CAN_SWIM,
      maxWadingDepth: DEFAULT_BEAVER_MAX_WADING_DEPTH,
    }),
  });

const LIFE_STAGES: readonly LifeStage[] = ["newborn", "juvenile", "adult"];

function assertNonNegativeInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new RangeError(`${label} must be a non-negative integer, got ${JSON.stringify(value)}`);
  }
}

export function lifeStageForAge(ageTicks: number): LifeStage {
  assertNonNegativeInteger(ageTicks, "ageTicks");
  if (ageTicks >= JUVENILE_TO_ADULT_TICKS) return "adult";
  if (ageTicks >= NEWBORN_TO_JUVENILE_TICKS) return "juvenile";
  return "newborn";
}

export function assertValidLifeStageState(state: LifeStageState): void {
  if (state === null || typeof state !== "object") throw new RangeError("life stage state must be an object");
  assertNonNegativeInteger(state.ageTicks, "life stage ageTicks");
  assertNonNegativeInteger(state.lastUpdatedTick, "life stage lastUpdatedTick");
  if (!LIFE_STAGES.includes(state.stage)) {
    throw new RangeError(`life stage must be one of ${LIFE_STAGES.join(", ")}, got ${JSON.stringify(state.stage)}`);
  }
  const derived = lifeStageForAge(state.ageTicks);
  if (state.stage !== derived) {
    throw new RangeError(`life stage ${state.stage} does not match ageTicks ${state.ageTicks}; expected ${derived}`);
  }
}

export function setLifeStage(components: ComponentStore, beaverId: EntityId, state: LifeStageState): void {
  assertValidLifeStageState(state);
  components.set(beaverId, LifeStageComponent, state);
}

export function getLifeStage(components: ComponentStore, beaverId: EntityId): LifeStageState | undefined {
  const state = components.get(beaverId, LifeStageComponent);
  if (state !== undefined) assertValidLifeStageState(state);
  return state;
}

function assertKnownBeaver(world: World, beaverId: EntityId): void {
  if (!world.entities.isKnown(beaverId) || world.entities.kindOf(beaverId) !== "beaver") {
    throw new RangeError(`life stage entity ${beaverId} is not a known beaver entity`);
  }
}

function assertLifeStageNotFromFuture(world: World, state: LifeStageState): void {
  if (state.lastUpdatedTick > world.clock.tick) {
    throw new RangeError(`life stage lastUpdatedTick ${state.lastUpdatedTick} is after current world tick ${world.clock.tick}`);
  }
}

function applyStageCapabilities(world: World, beaverId: EntityId, stage: LifeStage): void {
  const capabilities = LIFE_STAGE_CAPABILITIES[stage];
  setCreatureBody(world.components, beaverId, { massKg: capabilities.massKg });
  setLocomotion(world.components, beaverId, { speed: capabilities.speed });
  setSwimmer(world.components, beaverId, { canSwim: capabilities.canSwim, maxWadingDepth: capabilities.maxWadingDepth });
}

export function setWorldLifeStage(world: World, beaverId: EntityId, state: LifeStageState): void {
  assertKnownBeaver(world, beaverId);
  assertLifeStageNotFromFuture(world, state);
  setLifeStage(world.components, beaverId, state);
  applyStageCapabilities(world, beaverId, state.stage);
}

export function initializeNewbornLifeStage(world: World, beaverId: EntityId): void {
  setWorldLifeStage(world, beaverId, { ageTicks: 0, stage: "newborn", lastUpdatedTick: world.clock.tick });
}

export function initializeAdultLifeStage(world: World, beaverId: EntityId): void {
  setWorldLifeStage(world, beaverId, {
    ageTicks: JUVENILE_TO_ADULT_TICKS,
    stage: "adult",
    lastUpdatedTick: world.clock.tick,
  });
}

export function tickAging(world: World, beaverId: EntityId): LifeStageState | undefined {
  assertKnownBeaver(world, beaverId);
  const current = getLifeStage(world.components, beaverId);
  if (current === undefined) return undefined;
  if (world.clock.tick < current.lastUpdatedTick) {
    throw new RangeError(`world tick ${world.clock.tick} is before life stage lastUpdatedTick ${current.lastUpdatedTick}`);
  }

  const ageTicks = current.ageTicks + (world.clock.tick - current.lastUpdatedTick);
  const stage = lifeStageForAge(ageTicks);
  const changedStage = stage !== current.stage;
  const position = changedStage ? world.grid.positionOf(beaverId) : undefined;
  if (changedStage && position === undefined) throw new RangeError(`beaver ${beaverId} has no grid position for life-stage transition event`);

  const next = { ageTicks, stage, lastUpdatedTick: world.clock.tick };
  setWorldLifeStage(world, beaverId, next);
  if (changedStage) {
    world.events.record({
      tick: world.clock.tick,
      eventType: "life-stage-changed",
      subjectIds: [beaverId],
      objectIds: [],
      location: position!,
    });
  }
  return next;
}

export function tickAllAging(world: World): void {
  for (const beaverId of world.entities.liveIdsOfKind("beaver").sort((a, b) => a - b)) {
    tickAging(world, beaverId);
  }
}

export interface AgingDebugState {
  beaverId: EntityId;
  lifeStage?: LifeStageState;
  capabilities?: (typeof LIFE_STAGE_CAPABILITIES)[LifeStage];
}

export function getAgingDebugState(world: World, beaverId: EntityId): AgingDebugState {
  assertKnownBeaver(world, beaverId);
  const lifeStage = getLifeStage(world.components, beaverId);
  if (lifeStage !== undefined) assertLifeStageNotFromFuture(world, lifeStage);
  return {
    beaverId,
    ...(lifeStage === undefined ? {} : { lifeStage, capabilities: LIFE_STAGE_CAPABILITIES[lifeStage.stage] }),
  };
}
