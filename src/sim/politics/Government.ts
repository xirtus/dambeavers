import type { EntityId } from "../core/EntityId.js";
import type { World } from "../persistence/WorldSnapshot.js";
import { householdMembers, relationshipWith } from "../creatures/Relationships.js";
import { getLeadership, setLeadership } from "../creatures/Leadership.js";
import { getSkillDebugState } from "../creatures/SkillProgression.js";
import { reputationAsSeenBy } from "../creatures/Reputation.js";
import { getPoliticalEntity, setPoliticalEntity } from "./PoliticalEntity.js";
import { assignLeader } from "../creatures/Leadership.js";

/**
 * P7-08: leadership selection/succession DIFFERS between data-defined
 * government structures -- each form is real DATA (a registry entry
 * naming a selection rule), and each rule is a real, general decision
 * over real state (skills, kinship, reputation, the current leader's own
 * affinities). No form has an authored outcome; the same beaver can win
 * under one form and lose under another because the RULES differ, not
 * because a script says so. Succession history remains the real
 * `"leader-appointed"` event chain P5-11 established (each appointment's
 * cause is the previous one).
 */

export type SelectionRule = "highest-skill" | "inheritance" | "election" | "appointment";

export interface GovernmentForm {
  id: string;
  title: string;
  selectionRule: SelectionRule;
}

/** The standard registry of government structures -- real data, extendable by future tasks the same way `STANDARD_PLANT_SPECIES` is. */
export const STANDARD_GOVERNMENT_FORMS: readonly GovernmentForm[] = Object.freeze([
  Object.freeze({ id: "elder-council", title: "Elder Council", selectionRule: "highest-skill" }),
  Object.freeze({ id: "lineage", title: "Lineage", selectionRule: "inheritance" }),
  Object.freeze({ id: "acclamation", title: "Acclamation", selectionRule: "election" }),
  Object.freeze({ id: "appointment", title: "Appointment", selectionRule: "appointment" }),
]);

export function governmentForm(formId: string): GovernmentForm | undefined {
  return STANDARD_GOVERNMENT_FORMS.find((form) => form.id === formId);
}

function totalSkillLevel(world: World, beaverId: EntityId): number {
  return getSkillDebugState(world.components, beaverId).levels.reduce((sum, entry) => sum + entry.level, 0);
}

/** Real candidate pool: the live members of the polity's own primary household (an inactive site has no members and therefore no leader -- honest absence). */
function candidatesFor(world: World, householdId: EntityId): EntityId[] {
  return householdMembers(world.components, householdId)
    .filter((id) => world.entities.isLive(id))
    .sort((a, b) => a - b);
}

function highestSkill(world: World, candidates: readonly EntityId[]): EntityId | undefined {
  let best: EntityId | undefined;
  let bestSkill = -Infinity;
  for (const candidateId of candidates) {
    const skill = totalSkillLevel(world, candidateId);
    if (skill > bestSkill || (skill === bestSkill && best !== undefined && candidateId < best)) {
      best = candidateId;
      bestSkill = skill;
    }
  }
  return best;
}

/** Inheritance: the current leader's closest live kin (by familiarity), else the highest-skill fallback. The leader themselves may be dead -- succession is exactly that case, and a relationship edge survives its holder (the codebase's own "history resolves forever" precedent). */
function inherit(world: World, candidates: readonly EntityId[], currentLeaderId: EntityId | undefined): EntityId | undefined {
  if (currentLeaderId !== undefined) {
    let best: EntityId | undefined;
    let bestFamiliarity = -Infinity;
    for (const candidateId of candidates) {
      if (candidateId === currentLeaderId) continue;
      const edge = relationshipWith(world.components, currentLeaderId, candidateId);
      if (edge === undefined || edge.kin === "unrelated") continue;
      const familiarity = edge.familiarity;
      if (familiarity > bestFamiliarity || (familiarity === bestFamiliarity && best !== undefined && candidateId < best)) {
        best = candidateId;
        bestFamiliarity = familiarity;
      }
    }
    if (best !== undefined) return best;
  }
  return highestSkill(world, candidates);
}

/** Election: the candidate the polity's own norms rate highest (reputation-as-seen-by), tie-broken by skill, then id. */
function elect(world: World, householdId: EntityId, candidates: readonly EntityId[]): EntityId | undefined {
  let best: EntityId | undefined;
  let bestReputation = -Infinity;
  let bestSkill = -Infinity;
  for (const candidateId of candidates) {
    const reputation = reputationAsSeenBy(world, candidateId, householdId);
    const skill = totalSkillLevel(world, candidateId);
    if (
      reputation > bestReputation ||
      (reputation === bestReputation && skill > bestSkill) ||
      (reputation === bestReputation && skill === bestSkill && best !== undefined && candidateId < best)
    ) {
      best = candidateId;
      bestReputation = reputation;
      bestSkill = skill;
    }
  }
  return best;
}

/** Appointment: the current leader designates the candidate they personally trust most (highest affinity toward them), else the skill fallback. */
function appoint(world: World, candidates: readonly EntityId[], currentLeaderId: EntityId | undefined): EntityId | undefined {
  if (currentLeaderId !== undefined) {
    let best: EntityId | undefined;
    let bestAffinity = -Infinity;
    for (const candidateId of candidates) {
      if (candidateId === currentLeaderId) continue;
      const edge = relationshipWith(world.components, currentLeaderId, candidateId);
      const affinity = edge?.affinity ?? 0;
      if (affinity > bestAffinity || (affinity === bestAffinity && best !== undefined && candidateId < best)) {
        best = candidateId;
        bestAffinity = affinity;
      }
    }
    if (best !== undefined) return best;
  }
  return highestSkill(world, candidates);
}

/**
 * The real successor under `form` for the polity's own primary
 * household, given its current leader (if any): one rule per form,
 * evaluated over real state. `undefined` = no eligible candidate.
 */
export function successorFor(world: World, householdId: EntityId, form: GovernmentForm, currentLeaderId?: EntityId): EntityId | undefined {
  const candidates = candidatesFor(world, householdId);
  if (candidates.length === 0) return undefined;
  switch (form.selectionRule) {
    case "highest-skill":
      return highestSkill(world, candidates);
    case "inheritance":
      return inherit(world, candidates, currentLeaderId);
    case "election":
      return elect(world, householdId, candidates);
    case "appointment":
      return appoint(world, candidates, currentLeaderId);
  }
}

/**
 * One tick of succession for `siteId`'s polity: when the polity has no
 * live leader (first selection after establishment, or the previous
 * leader died), its OWN government form's rule picks the successor, the
 * real P5-11 `Leadership` component is updated with a real
 * `"leader-appointed"` event chained to the previous appointment, and
 * the polity's `leaderId` follows. A no-op when leadership is already
 * legitimately held. Returns the new leader id, or undefined when there
 * is no eligible candidate.
 */
export function tickSuccession(world: World, siteId: EntityId): EntityId | undefined {
  const entity = getPoliticalEntity(world.components, siteId);
  if (entity === undefined || entity.householdId === undefined) return undefined;
  const form = governmentForm(entity.governmentFormId);
  if (form === undefined) throw new RangeError(`site ${siteId} names unknown government form ${JSON.stringify(entity.governmentFormId)}`);

  const current = getLeadership(world.components, entity.householdId);
  if (current !== undefined && world.entities.isLive(current.leaderId)) return current.leaderId;

  const successor = successorFor(world, entity.householdId, form, current?.leaderId);
  if (successor === undefined) return undefined;

  const location = world.grid.positionOf(successor) ?? { x: 0, y: 0, z: 0 };
  const eventId = world.events.record({
    tick: world.clock.tick,
    eventType: "leader-appointed",
    subjectIds: [successor],
    objectIds: [entity.householdId, siteId],
    location,
    ...(current !== undefined ? { causeEventId: current.lastAppointmentEventId } : {}),
  });
  setLeadership(world.components, entity.householdId, { leaderId: successor, sinceTick: world.clock.tick, lastAppointmentEventId: eventId });
  setPoliticalEntity(world.components, siteId, { ...entity, leaderId: successor });
  return successor;
}

/**
 * Convenience: assigns the polity's primary household its initial leader
 * under the polity's own form (the same real rule as every later
 * succession -- no special "founding leader" script).
 */
export function selectInitialLeader(world: World, siteId: EntityId): EntityId | undefined {
  return tickSuccession(world, siteId);
}

export { assignLeader };
