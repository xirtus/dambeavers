import { ComponentStore, defineComponent, type ComponentType } from "../core/ComponentStore.js";
import type { EntityId } from "../core/EntityId.js";
import type { RandomStream } from "../core/Random.js";
import type { World } from "../persistence/WorldSnapshot.js";
import { householdMembers } from "./Relationships.js";
import { getTraits, traitOrDefault } from "./Traits.js";

/**
 * P5-07: real, GENERATED per-household norms -- a household (P5-05's
 * own real persistent social group) is this project's current unit of
 * "settlement" (a single colony has no separate settlement entity yet;
 * two distinct households ARE two distinct social groups a behavior can
 * be evaluated against). `NormProfile.values` is generated ONCE, at
 * household formation, from its founding members' own real traits plus
 * real random variation -- a household's own culture, not merely "the
 * live average of whoever happens to be in it today" (which would drift
 * with membership and stop being a persistent generated fact).
 */
export const NORM_DIMENSIONS = ["industriousness", "possessiveness", "courage", "sociability", "playfulness"] as const;
export type NormDimension = (typeof NORM_DIMENSIONS)[number];

export interface NormProfile {
  values: Readonly<Record<NormDimension, number>>;
  generatedTick: number;
}
export const NormProfileComponent: ComponentType<NormProfile> = defineComponent<NormProfile>("norm-profile");

export function assertValidNormProfile(profile: NormProfile): void {
  for (const dim of NORM_DIMENSIONS) {
    const value = profile.values[dim];
    if (!(typeof value === "number" && value >= 0 && value <= 1)) {
      throw new RangeError(`norm profile value for "${dim}" must be in [0, 1], got ${value}`);
    }
  }
  if (!Number.isInteger(profile.generatedTick) || profile.generatedTick < 0) {
    throw new RangeError(`norm profile generatedTick must be a non-negative integer, got ${profile.generatedTick}`);
  }
}

export function setNormProfile(components: ComponentStore, householdId: EntityId, profile: NormProfile): void {
  assertValidNormProfile(profile);
  components.set(householdId, NormProfileComponent, profile);
}

export function getNormProfile(components: ComponentStore, householdId: EntityId): NormProfile | undefined {
  const profile = components.get(householdId, NormProfileComponent);
  if (profile !== undefined) assertValidNormProfile(profile);
  return profile;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function traitDimensionValue(components: ComponentStore, beaverId: EntityId, dim: NormDimension): number {
  const traits = getTraits(components, beaverId);
  if (dim === "sociability") return traits?.sociability ?? 0.5;
  return traitOrDefault(traits, dim);
}

/** Real random variation applied on top of the founders' own average -- household culture is influenced by, but not IDENTICAL to, its founders (plausible, tunable spread). */
export const NORM_VARIATION = 0.15;

/**
 * Generates and persists `householdId`'s own norm profile from its
 * CURRENT members' traits (called once, at formation, before membership
 * can drift) plus real random variation. Idempotent guard: throws if
 * this household already has a generated profile (culture, once formed,
 * doesn't get silently regenerated).
 */
export function generateNorms(world: World, householdId: EntityId, random: RandomStream): NormProfile {
  if (getNormProfile(world.components, householdId) !== undefined) {
    throw new RangeError(`household ${householdId} already has a generated norm profile`);
  }
  const members = householdMembers(world.components, householdId);
  const values = {} as Record<NormDimension, number>;
  for (const dim of NORM_DIMENSIONS) {
    const average = members.length === 0 ? 0.5 : members.reduce((sum, id) => sum + traitDimensionValue(world.components, id, dim), 0) / members.length;
    values[dim] = clamp01(average + (random.nextFloat() - 0.5) * 2 * NORM_VARIATION);
  }
  const profile: NormProfile = { values, generatedTick: world.clock.tick };
  setNormProfile(world.components, householdId, profile);
  return profile;
}

/**
 * How favorably `norms` evaluates a real observed `magnitude` ([0,1]) of
 * behavior along `dimension` -- `1` when it exactly matches this
 * household's own valued level for that dimension, falling off with
 * distance. The SAME formula fed two different households' own generated
 * `values` for the identical `dimension`/`magnitude` produces two
 * different scores -- the literal P5-07 acceptance test, satisfied by
 * construction rather than a per-settlement branch.
 */
export function evaluateBehavior(norms: NormProfile, dimension: NormDimension, magnitude: number): number {
  const ideal = norms.values[dimension];
  return clamp01(1 - Math.abs(magnitude - ideal));
}

/**
 * P11-08: cultural evolution -- norms are no longer "generated once,
 * never re-rolled." A real small random-walk drift per dimension,
 * applied at generational turnover (household founding/inheritance).
 * Each step is small and clamped to [0, 1]; over many generations two
 * separated populations genuinely drift apart -- a statistical
 * consequence of the walk, never a scripted divergence.
 */
export const NORM_DRIFT_SCALE = 0.03;

export function driftNormProfile(world: World, householdId: EntityId, random: RandomStream, driftScale = NORM_DRIFT_SCALE): NormProfile {
  const profile = getNormProfile(world.components, householdId);
  if (profile === undefined) throw new RangeError(`household ${householdId} has no norm profile to drift`);
  const values = {} as Record<NormDimension, number>;
  for (const dim of NORM_DIMENSIONS) {
    values[dim] = clamp01(profile.values[dim] + (random.nextFloat() - 0.5) * 2 * driftScale);
  }
  const drifted: NormProfile = { values, generatedTick: world.clock.tick };
  setNormProfile(world.components, householdId, drifted);
  return drifted;
}

/**
 * A new household inherits its parent household's culture WITH one real
 * drift step -- the generational-turnover hook: culture is transmitted,
 * but transmission is never a perfect copy (the roadmap's own "drift
 * measurably across separated populations" needs exactly this). The new
 * household must not already have a profile (the same idempotency
 * `generateNorms` enforces), and the parent's profile is left
 * untouched -- children diverge from parents, not the other way around.
 */
export function inheritNormsWithDrift(world: World, parentHouseholdId: EntityId, newHouseholdId: EntityId, random: RandomStream): NormProfile {
  const parent = getNormProfile(world.components, parentHouseholdId);
  if (parent === undefined) throw new RangeError(`household ${parentHouseholdId} has no norm profile to inherit`);
  if (getNormProfile(world.components, newHouseholdId) !== undefined) {
    throw new RangeError(`household ${newHouseholdId} already has a norm profile`);
  }
  const values = {} as Record<NormDimension, number>;
  for (const dim of NORM_DIMENSIONS) {
    values[dim] = clamp01(parent.values[dim] + (random.nextFloat() - 0.5) * 2 * NORM_DRIFT_SCALE);
  }
  const inherited: NormProfile = { values, generatedTick: world.clock.tick };
  setNormProfile(world.components, newHouseholdId, inherited);
  return inherited;
}
