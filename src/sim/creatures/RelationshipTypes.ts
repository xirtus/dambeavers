import type { ComponentStore } from "../core/ComponentStore.js";
import type { EntityId, EntityIdRegistry } from "../core/EntityId.js";
import { relationshipWith, type RelationshipEdge } from "./Relationships.js";
import { skillLevel } from "./SkillProgression.js";
import { currentJobOf } from "../jobs/JobBoard.js";
import { laborKindForJob } from "../jobs/LaborPreferences.js";

/**
 * P5-04's own "include: friendships, rivals, mentors, colleagues" list
 * (parent/child/sibling/mate are already real via `RelationshipEdge.kin`;
 * grudges are `RelationshipEdge.grudge`, P5-14's own accumulator) --
 * every classification here is DERIVED from real state (familiarity/
 * affinity thresholds, or real shared-labor/skill facts), never a
 * separately-stored label that could drift out of sync with the numbers
 * that actually justify it, matching `EcologyResponse.ts`'s own
 * `floodTolerance`-style "derive, don't duplicate" precedent.
 */
export type SocialBond = "stranger" | "acquaintance" | "friend" | "rival";

/** Real threshold-based bond classification -- a friend is someone well-known AND well-liked; a rival is someone well-known but disliked; anyone merely somewhat known is an acquaintance; nobody with an edge at all is a stranger. Plausible, tunable thresholds. */
export function socialBond(edge: RelationshipEdge | undefined): SocialBond {
  if (edge === undefined || edge.familiarity < 0.2) return "stranger";
  if (edge.familiarity < 0.5) return "acquaintance";
  return edge.affinity >= 0.3 ? "friend" : edge.affinity <= -0.3 ? "rival" : "acquaintance";
}

export function socialBondBetween(components: ComponentStore, id: EntityId, withId: EntityId): SocialBond {
  return socialBond(relationshipWith(components, id, withId));
}

/** Real minimum skill-level gap, in the same labor kind, for the more-skilled beaver to count as a mentor. Plausible, tunable balance data. */
export const MENTOR_SKILL_GAP = 3;

/**
 * Whether `mentorId` is a real mentor to `studentId` in `laborKind` --
 * both must already have SOME relationship (mentorship doesn't spring
 * from nothing), and `mentorId`'s real `SkillProgression` level in
 * `laborKind` must exceed `studentId`'s own by `MENTOR_SKILL_GAP`. A real
 * fact derived from two already-real systems (P1-19 relationships, P2-03
 * skill progression), never a separately-assigned role.
 */
export function isMentorOf(components: ComponentStore, mentorId: EntityId, studentId: EntityId, laborKind: string): boolean {
  if (relationshipWith(components, studentId, mentorId) === undefined) return false;
  return skillLevel(components, mentorId, laborKind) - skillLevel(components, studentId, laborKind) >= MENTOR_SKILL_GAP;
}

/** Whether `aId`/`bId` are real colleagues right now -- both hold a currently-active job of the SAME real labor kind. Derived fresh from live job state every call, never a stored role. */
export function areColleagues(components: ComponentStore, entities: EntityIdRegistry, aId: EntityId, bId: EntityId): boolean {
  const aJobId = currentJobOf(entities, components, aId);
  const bJobId = currentJobOf(entities, components, bId);
  if (aJobId === undefined || bJobId === undefined) return false;
  return laborKindForJob(components, aJobId) === laborKindForJob(components, bJobId);
}
