import { ComponentStore, defineComponent, type ComponentType } from "../core/ComponentStore.js";
import type { EntityId } from "../core/EntityId.js";
import type { World } from "../persistence/WorldSnapshot.js";

/**
 * P1-19's "relationships baseline" -- the roadmap's own four-item
 * "Store:" list, each real, persistent `ComponentStore` state (P0-03,
 * P0-06), no deep psychology (no opinion/gossip/memory-of-events system;
 * that's explicitly out of scope per the roadmap's own "No deep
 * psychology yet"):
 *
 * - kin relation: `RelationshipEdge.kin`, an open-ended string type
 *   (`Skills.ts`'s own "properties, not identity" precedent for skill
 *   names, not a closed enum a future kin type couldn't be added to).
 * - familiarity: `RelationshipEdge.familiarity`, `[0, 1]`.
 * - affinity: `RelationshipEdge.affinity`, `[-1, 1]`.
 * - household/social group hooks: `HouseholdMembership` plus
 *   `createHousehold`/`householdMembers` -- a real `"household"` entity
 *   (P0-02 stable identity), matching this project's precedent of giving
 *   durable non-physical concepts real entity identity (`Job`,
 *   `Designation`) rather than a bare label. No behavior is driven by
 *   household membership yet -- a real, inspectable "hook" for a later
 *   task, matching AGENTS.md Law 10.
 *
 * Nothing in this file creates any relationship or household
 * automatically -- `spawnSevenStartingBeavers` (P1-05) still spawns seven
 * independent beavers with no family ties invented for them (there is no
 * real narrative/generation basis for one yet); this task's job is to
 * make relationship/household state real, validated, and persistent, the
 * same way `Skills.ts` shipped a real skill-level store before any system
 * granted or consumed skill levels.
 */

// ---- Relationship edges ----

/**
 * `[0, 1]` familiarity and `[-1, 1]` affinity are `RelationshipEdge`'s own
 * plausible, tunable range choices, matching every other `[0,1]`-style
 * component elsewhere in this codebase (`Health.fraction`,
 * `Plant.health`) -- affinity gets a signed range (unlike familiarity)
 * because "how much do I like you" is genuinely bidirectional (dislike vs
 * fondness), while "how well do I know you" only ever accumulates from a
 * true zero.
 */
export type KinRelation = "unrelated" | "parent" | "child" | "sibling" | "mate";

/**
 * One directed relationship edge -- FROM the beaver this component is
 * attached to, TOWARD `withId`. Deliberately directed, not a single
 * shared/symmetric fact: real familiarity/affinity can genuinely differ
 * from one side to the other (matches this project's existing directed-
 * reference precedent, e.g. `Log.ts`'s `Held.by`/`Reservation.by`). `kin`
 * is a biological fact expected to agree on both sides in practice, but
 * this module doesn't enforce that symmetry itself -- no system creates
 * kin relations yet (a future reproduction task, e.g. P2-11, is
 * responsible for setting both sides consistently when it does).
 */
export interface RelationshipEdge {
  withId: EntityId;
  kin: KinRelation;
  /** [0, 1] how well this beaver knows the other -- 0 total stranger, 1 fully familiar. */
  familiarity: number;
  /** [-1, 1] how this beaver feels about the other -- negative dislike, positive fondness, 0 neutral. */
  affinity: number;
}

export interface Relationships {
  edges: RelationshipEdge[];
}
export const RelationshipsComponent: ComponentType<Relationships> = defineComponent<Relationships>("relationships");

export function assertValidRelationships(relationships: Relationships): void {
  const seen = new Set<EntityId>();
  for (const edge of relationships.edges) {
    if (!Number.isInteger(edge.withId) || edge.withId < 1) {
      throw new RangeError(`relationship withId must be a positive integer, got ${edge.withId}`);
    }
    if (seen.has(edge.withId)) {
      throw new RangeError(`relationships must not contain more than one edge for the same withId, got repeated id ${edge.withId}`);
    }
    seen.add(edge.withId);
    if (!(edge.familiarity >= 0 && edge.familiarity <= 1)) {
      throw new RangeError(`relationship familiarity must be in [0, 1], got ${edge.familiarity}`);
    }
    if (!(edge.affinity >= -1 && edge.affinity <= 1)) {
      throw new RangeError(`relationship affinity must be in [-1, 1], got ${edge.affinity}`);
    }
  }
}

export function setRelationships(components: ComponentStore, id: EntityId, relationships: Relationships): void {
  assertValidRelationships(relationships);
  components.set(id, RelationshipsComponent, relationships);
}

export function getRelationships(components: ComponentStore, id: EntityId): Relationships | undefined {
  const relationships = components.get(id, RelationshipsComponent);
  if (relationships !== undefined) assertValidRelationships(relationships);
  return relationships;
}

/** This beaver's own edge toward `withId`, or `undefined` if none exists (a stranger has no edge at all -- not a zero-valued one, so "never met" stays distinguishable from "met and feels neutral"). */
export function relationshipWith(components: ComponentStore, id: EntityId, withId: EntityId): RelationshipEdge | undefined {
  const relationships = getRelationships(components, id);
  return relationships?.edges.find((edge) => edge.withId === withId);
}

/** Sets (creating or replacing) this beaver's own edge toward `edge.withId` -- a real upsert, not an append-only log, so calling this twice for the same pair updates the one edge rather than accumulating duplicates that `assertValidRelationships` would then reject anyway. */
export function setRelationshipWith(components: ComponentStore, id: EntityId, edge: RelationshipEdge): void {
  const existing = getRelationships(components, id) ?? { edges: [] };
  const edges = existing.edges.filter((e) => e.withId !== edge.withId);
  edges.push(edge);
  setRelationships(components, id, { edges });
}

// ---- Household / social group hooks ----

export interface HouseholdMembership {
  householdId: EntityId;
}
export const HouseholdMembershipComponent: ComponentType<HouseholdMembership> = defineComponent<HouseholdMembership>("household-membership");

export function assertValidHouseholdMembership(membership: HouseholdMembership): void {
  if (!Number.isInteger(membership.householdId) || membership.householdId < 1) {
    throw new RangeError(`household membership householdId must be a positive integer, got ${membership.householdId}`);
  }
}

export function setHouseholdMembership(components: ComponentStore, id: EntityId, membership: HouseholdMembership): void {
  assertValidHouseholdMembership(membership);
  components.set(id, HouseholdMembershipComponent, membership);
}

export function getHouseholdMembership(components: ComponentStore, id: EntityId): HouseholdMembership | undefined {
  const membership = components.get(id, HouseholdMembershipComponent);
  if (membership !== undefined) assertValidHouseholdMembership(membership);
  return membership;
}

/**
 * Creates a real, permanently-identified `"household"` entity (P0-02) --
 * a durable social-group identity distinct from any beaver's own
 * identity, matching this project's precedent of giving durable
 * non-physical concepts real entity identity (`Job`, `Designation`)
 * rather than a bare string/number label a future rename/merge could
 * silently break.
 */
export function createHousehold(world: World): EntityId {
  return world.entities.create("household");
}

/**
 * Every beaver currently holding a `HouseholdMembership` pointing at
 * `householdId` -- discovered fresh from live component state each call,
 * never a separately-tracked member list on the household entity itself
 * (the SAME "discover from live state, never cache the inverse"
 * discipline `Log.ts`'s `Held`/`Reservation` already use for
 * holder/container relations), so a beaver's household can never desync
 * from a household's own member roster. O(beavers with a household) --
 * an on-demand query, not a per-tick hot path, matching every other
 * O(n) query/debug-scan method in this codebase. Reads each candidate's
 * membership through `getHouseholdMembership` (the validating path),
 * never `components.get` directly -- found during this task's own critic
 * review: reading the raw stored value would silently accept a corrupted
 * `householdId` (e.g. a hand-edited snapshot restored via
 * `ComponentStore.fromSnapshot`, which -- like every other component in
 * this codebase, see `Plant.ts`'s own doc comment on this -- doesn't
 * validate at restore time) instead of failing loudly the same way
 * `relationshipWith` already does via `getRelationships`.
 */
export function householdMembers(components: ComponentStore, householdId: EntityId): EntityId[] {
  return components
    .query(HouseholdMembershipComponent)
    .filter((id) => getHouseholdMembership(components, id)!.householdId === householdId);
}
