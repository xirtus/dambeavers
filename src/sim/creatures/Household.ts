import type { EntityId } from "../core/EntityId.js";
import type { World } from "../persistence/WorldSnapshot.js";
import { createHousehold, getHouseholdMembership, setHouseholdMembership, householdMembers, relationshipWith } from "./Relationships.js";
import { generateNorms } from "./Norms.js";

/**
 * P5-05: real, AUTOMATIC household formation from kinship/partnership --
 * `Relationships.ts` (P1-19) already made `HouseholdMembership`/
 * `createHousehold`/`householdMembers` real, but deliberately created
 * nothing automatically ("no behavior is driven by household membership
 * yet," that file's own doc comment). This is the real driver: two
 * parents who don't yet share a household when they have a child
 * together now form (or merge into) one, the literal "kinship and
 * partnership create persistent household groupings" acceptance test.
 */

/** Throws if a stored `HouseholdMembership` points at an entity that is no longer a live `"household"` -- mirrors P2-11's own critic-driven invariant (a corrupted/destroyed household reference must fail loudly here, before any beaver/event mutation happens, never silently treated as "no household"). */
function assertLiveHousehold(world: World, householdId: EntityId): void {
  if (!world.entities.isLive(householdId) || world.entities.kindOf(householdId) !== "household") {
    throw new RangeError(`household ${householdId} is not a live household entity`);
  }
}

/**
 * Ensures `aId`/`bId` share one live household, returning its id --
 * creates a fresh one if neither has one, adds the un-housed party if
 * only one does, or MERGES two existing different households into one
 * (every member of `bId`'s own household joins `aId`'s, which survives)
 * if both already have separate ones. Real, idempotent: calling this
 * again for the same pair once they already share a household is a
 * cheap no-op. Validates liveness of every existing household reference
 * BEFORE mutating anything, so a corrupted/destroyed household fails the
 * whole call atomically.
 */
export function ensureSharedHousehold(world: World, aId: EntityId, bId: EntityId): EntityId {
  const membershipA = getHouseholdMembership(world.components, aId);
  const membershipB = getHouseholdMembership(world.components, bId);
  if (membershipA !== undefined) assertLiveHousehold(world, membershipA.householdId);
  if (membershipB !== undefined) assertLiveHousehold(world, membershipB.householdId);

  if (membershipA !== undefined && membershipB !== undefined) {
    if (membershipA.householdId === membershipB.householdId) return membershipA.householdId;
    for (const memberId of householdMembers(world.components, membershipB.householdId)) {
      setHouseholdMembership(world.components, memberId, { householdId: membershipA.householdId });
    }
    return membershipA.householdId;
  }
  if (membershipA !== undefined) {
    setHouseholdMembership(world.components, bId, { householdId: membershipA.householdId });
    return membershipA.householdId;
  }
  if (membershipB !== undefined) {
    setHouseholdMembership(world.components, aId, { householdId: membershipB.householdId });
    return membershipB.householdId;
  }
  const householdId = createHousehold(world);
  setHouseholdMembership(world.components, aId, { householdId });
  setHouseholdMembership(world.components, bId, { householdId });
  // P5-07: a freshly-formed household immediately generates its own real norm profile from its founders -- never merged/joined households, which already have one.
  generateNorms(world, householdId, world.random.stream("household-norms"));
  return householdId;
}

/**
 * P5-05's own "inheritance hooks": the real, ordered set of household
 * members eligible to inherit from `deceasedId` -- every OTHER live
 * member of its household, ordered by real relationship closeness
 * (kin edges outrank a merely-shared household with no direct
 * relationship, mates/children first). A real, callable list, not yet
 * itself an ownership-transfer mechanism -- P5-06's `Ownership.ts` is
 * the real consumer (AGENTS.md Law 10: the hook exists now, the system
 * that acts on it is that later task's own job).
 */
export function inheritingHouseholdMembers(world: World, deceasedId: EntityId): EntityId[] {
  const membership = getHouseholdMembership(world.components, deceasedId);
  if (membership === undefined) return [];
  const closeness = (candidateId: EntityId): number => {
    const edge = relationshipWith(world.components, candidateId, deceasedId);
    if (edge === undefined) return 0;
    if (edge.kin === "mate" || edge.kin === "child") return 3;
    if (edge.kin === "parent" || edge.kin === "sibling") return 2;
    return 1 + edge.familiarity;
  };
  return householdMembers(world.components, membership.householdId)
    .filter((id) => id !== deceasedId && world.entities.isLive(id))
    .sort((a, b) => closeness(b) - closeness(a) || a - b);
}
