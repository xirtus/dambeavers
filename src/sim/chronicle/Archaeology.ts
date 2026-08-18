import type { EntityId } from "../core/EntityId.js";
import type { EventId, RecordedEvent } from "../history/EventLog.js";
import type { World } from "../persistence/WorldSnapshot.js";
import { getSite } from "../region/Site.js";
import { getRuin } from "../structures/InfrastructureMemory.js";
import { getGood } from "../economy/Good.js";
import { getBelief } from "../creatures/Belief.js";
import { techKnowledgeOf } from "../economy/TechKnowledge.js";

/**
 * P11-19: millennia-scale archaeology -- artifacts, ruins, sediment,
 * and altered landscapes preserve PARTIAL evidence after the original
 * records/knowledge disappear. Knowledge loss is real and already
 * structural: a belief or technology held only by an extinct household
 * lineage is held by NOBODY once the lineage dies out (the
 * `heldBy...Ids` shapes -- nothing re-grants it). What survives is the
 * physical side: ruin entities, artifact goods with their provenance
 * events, recorded watershed spans, and the sites' own records. A new
 * population can EXCAVATE that evidence and only PARTIALLY reconstruct
 * the history -- the reconstruction cites only discovered real events
 * and states the gaps honestly, never filling them with fabrication.
 */

export interface Discovery {
  siteId: EntityId;
  /** Real ruins found at the site (live entities, where the site's detailed world is active). */
  ruinIds: EntityId[];
  /** Real artifact goods found (live entities carrying provenance). */
  artifactIds: EntityId[];
  /** Real recorded events the physical evidence references (founding, watershed spans, encounters). */
  evidenceEventIds: EventId[];
  /** Real recorded events the original civilization knew but the evidence can no longer reach -- the honest gap. */
  unreachableEventIds: EventId[];
}

/** Everything physical evidence at `siteId` can honestly recover -- live ruins and artifacts, plus the site's own recorded events (founding, terrain reshaping, encounters). Never conjures evidence that isn't there. */
export function excavateSite(world: World, siteId: EntityId): Discovery {
  const site = getSite(world.components, siteId);
  if (site === undefined) throw new RangeError(`entity ${siteId} has no Site component`);
  const ruinIds = world.entities
    .liveIdsOfKind("ruin")
    .filter((id) => getRuin(world.components, id) !== undefined)
    .sort((a: EntityId, b: EntityId) => a - b);
  const artifactIds = world.entities
    .liveIdsOfKind("good")
    .filter((id) => getGood(world.components, id) !== undefined)
    .sort((a: EntityId, b: EntityId) => a - b);

  const evidenceEventIds: EventId[] = [];
  const founded = world.events.get(site.foundedEventId);
  if (founded !== undefined) evidenceEventIds.push(founded.id);
  for (const event of world.events.eventsOfType("watershed-advanced")) evidenceEventIds.push(event.id);
  for (const event of world.events.eventsOfType("ruin-encountered")) {
    if (ruinIds.includes(event.objectIds[0]!)) evidenceEventIds.push(event.id);
  }
  for (const event of world.events.eventsOfType("ruin-materialized")) {
    if (ruinIds.includes(event.subjectIds[0]!)) evidenceEventIds.push(event.id);
  }

  // The honest gap: recorded events the evidence does NOT reference
  // (what the original civilization knew that its physical remains
  // cannot retell).
  const unreachableEventIds: EventId[] = [];
  const reachable = new Set(evidenceEventIds);
  for (const event of world.events.all()) {
    if (event.id === site.foundedEventId) continue;
    if (!reachable.has(event.id) && event.eventType !== "site-founded") unreachableEventIds.push(event.id);
  }
  return { siteId, ruinIds, artifactIds, evidenceEventIds: [...new Set(evidenceEventIds)], unreachableEventIds };
}

export interface ReconstructionStep {
  description: string;
  eventId?: EventId;
  tick: number;
}

export interface PartialReconstruction {
  question: string;
  /** Real steps citing discovered evidence, oldest first. */
  steps: ReconstructionStep[];
  /** The events that exist in history but were NOT reachable through the evidence -- stated honestly, never narrated. */
  acknowledgedGaps: EventId[];
}

/**
 * Partial reconstruction from a discovery: every step cites a real
 * DISCOVERED event (or a live fact read from the evidence itself), and
 * the gaps are stated as gaps -- "the evidence ends here," never a
 * fabricated bridge. This is the archaeology version of P11-12's
 * grounding discipline.
 */
export function reconstructHistory(world: World, discovery: Discovery): PartialReconstruction {
  const steps: ReconstructionStep[] = [];
  for (const eventId of [...discovery.evidenceEventIds].sort((a, b) => a - b)) {
    const event = world.events.get(eventId)!;
    steps.push({ description: `Evidence event #${event.id} ("${event.eventType}", tick ${event.tick}) was recovered from the physical record.`, eventId: event.id, tick: event.tick });
  }
  for (const ruinId of discovery.ruinIds) {
    const ruin = getRuin(world.components, ruinId);
    if (ruin !== undefined) {
      steps.push({ description: `Ruin #${ruinId} (an abandoned "${ruin.kind}" structure) still physically stands -- direct evidence of older construction.`, tick: ruin.abandonedTick });
    }
  }
  for (const artifactId of discovery.artifactIds) {
    steps.push({ description: `Artifact #${artifactId} survives as a physical object -- its own recorded provenance is the partial trace of its makers.`, tick: world.clock.tick });
  }
  if (discovery.unreachableEventIds.length > 0) {
    steps.push({
      description: `The evidence ends here: ${discovery.unreachableEventIds.length} recorded event(s) exist in history but no physical evidence references them -- they cannot be reconstructed from what survives.`,
      tick: world.clock.tick,
    });
  }
  return { question: `what can be reconstructed about site #${discovery.siteId} from physical evidence?`, steps, acknowledgedGaps: [...discovery.unreachableEventIds] };
}

/** Confirms the knowledge-loss side structurally: beliefs and technologies held only by extinct lineages have no living holder -- nothing re-grants them. */
export function unheldKnowledge(world: World): { unheldBeliefIds: EntityId[]; unheldTechKnowledgeIds: EntityId[] } {
  const liveHouseholdIds = new Set(world.entities.liveIdsOfKind("household"));
  const unheldBeliefIds = world.entities
    .liveIdsOfKind("belief")
    .filter((id) => {
      const belief = getBelief(world.components, id);
      return belief !== undefined && !belief.heldByHouseholdIds.some((householdId) => liveHouseholdIds.has(householdId));
    })
    .sort((a: EntityId, b: EntityId) => a - b);
  const unheldTechKnowledgeIds = world.entities
    .liveIdsOfKind("tech-knowledge")
    .filter((id) => !world.entities.liveIdsOfKind("household").some((householdId) => techKnowledgeOf(world, householdId).includes(id)))
    .sort((a: EntityId, b: EntityId) => a - b);
  return { unheldBeliefIds, unheldTechKnowledgeIds };
}
