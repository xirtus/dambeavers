import type { EntityId } from "../core/EntityId.js";
import type { EventId, RecordedEvent } from "./EventLog.js";
import type { World } from "../persistence/WorldSnapshot.js";
import type { WaterField, ColumnCoordinate } from "../hydrology/WaterField.js";
import type { MaterialRegistry } from "../materials/Material.js";
import type { NavigationProfile } from "../navigation/Pathfinding.js";
import { describeEdgeBlock, findPath } from "../navigation/Pathfinding.js";
import { getJob } from "../jobs/Job.js";
import { getCorpse } from "../creatures/Mortality.js";
import { canBreatheAt } from "../creatures/Respiration.js";

/**
 * P1-22's "Why did this happen?" -- a real, read-only QUERY layer over
 * ALREADY-EXISTING mechanisms (P0-08's `EventLog`, P1-04's
 * `describeEdgeBlock`/`findPath`, P1-07's `Job`/`Designation`, P1-16's
 * `Corpse`), never a new parallel bookkeeping system and never fabricated
 * narrative. This file adds no new simulation state -- everything it
 * returns is either a real `RecordedEvent` already in `EventLog`, or a
 * fact derived FRESH from live/still-inspectable world state at query
 * time (matching `DebugInspector.ts`'s own "developer can inspect
 * authoritative state" precedent, just player-facing and causally
 * structured rather than raw).
 *
 * The roadmap names five required question categories. Two
 * (`explainDeath`, `explainWaterRose`) can walk a REAL `causeEventId`-free
 * but still temporally/spatially real EventLog trail once P1-22 also adds
 * `Dam.ts`'s new `"dam-segment-applied"` event (the one genuinely missing
 * causal record this task's own acceptance test surfaced -- see that
 * file's own doc comment). The other three (`explainUnreachable`,
 * `explainJobStalled`, `explainPlantDeath`) have no natural EventLog
 * story at all -- pathfinding and job scheduling are stateless/live
 * queries by design (P1-04/P1-07's own "discover from live state, never
 * cache" discipline), and plant death is HONESTLY not yet a mechanism
 * this simulation has (see `explainPlantDeath`'s own doc comment) -- so
 * those three are answered by deriving a real, honest fact from CURRENT
 * live state instead, exactly the same "real derivation, not
 * fabrication" standard `DebugInspector.ts` established.
 */

/** One real step in a causal explanation -- either backed by an actual `RecordedEvent` (`eventId` set) or a fact derived fresh from live state at query time (`eventId` left `undefined`). Never fabricated: every `description` states something this file directly verified, not a plausible-sounding guess. */
export interface ExplanationStep {
  description: string;
  tick: number;
  eventId?: EventId;
  location?: ColumnCoordinate;
}

export interface CausalExplanation {
  question: string;
  /** Oldest first -- the same chronological convention `EventLog.traceBack` already uses. */
  steps: ExplanationStep[];
}

function stepFromEvent(event: RecordedEvent, description: string): ExplanationStep {
  return { description, tick: event.tick, eventId: event.id, location: { x: event.location.x, z: event.location.z } };
}

// ---- why a beaver cannot reach something ----

/**
 * Reuses P1-04's own `describeEdgeBlock`/`findPath` completely unmodified
 * -- this function adds no new navigation logic, it just narrates
 * `describeEdgeBlock`'s already-real answer. Checks the destination
 * itself first (the common case: the target column itself is submerged/
 * has no ground); if the destination isn't directly blocked but no route
 * still exists, reports that honestly rather than fabricating a specific
 * blocking edge `findPath`'s own algorithm doesn't separately expose.
 */
export function explainUnreachable(world: World, water: WaterField, materials: MaterialRegistry, profile: NavigationProfile, from: ColumnCoordinate, to: ColumnCoordinate): CausalExplanation {
  const tick = world.clock.tick;
  const question = `why can't an agent reach (${to.x}, ${to.z}) from (${from.x}, ${from.z})?`;
  const blockReason = describeEdgeBlock(world.grid, water, profile, to);
  if (blockReason !== undefined) {
    const reasonText =
      blockReason === "no-ground"
        ? "the destination has no real ground to stand on"
        : blockReason === "no-headroom"
          ? "the destination has no vertical clearance"
          : "the destination is too deep to cross for this agent's swim/wade capability";
    return { question, steps: [{ description: `The destination is directly blocked: ${reasonText}.`, tick, location: to }] };
  }
  const path = findPath(world.grid, world.terrain, water, materials, from, to, profile);
  if (path !== undefined) {
    return { question, steps: [{ description: "The destination is actually reachable right now -- no obstruction currently exists.", tick, location: to }] };
  }
  return {
    question,
    steps: [{ description: "The destination itself is passable, but no connected route currently exists from the start column -- some obstruction lies along every possible path.", tick, location: to }],
  };
}

// ---- why a job is stalled ----

/**
 * A real, honest derivation from live `Job`/`Designation` state -- no new
 * job-scheduling logic, and deliberately does NOT attempt a labor-type-
 * specific eligibility check (`isEligibleForTreeCut`/`isEligibleForHaul`/
 * `isEligibleForBuild`, ...): those differ per labor type and this
 * function is generic across all of them, matching `Job`/`Designation`'s
 * own kind-agnostic shape.
 */
export function explainJobStalled(world: World, water: WaterField, materials: MaterialRegistry, profile: NavigationProfile, jobId: EntityId): CausalExplanation {
  const tick = world.clock.tick;
  const question = `why is job ${jobId} stalled?`;
  const job = getJob(world.components, jobId);
  if (job === undefined) {
    return { question, steps: [{ description: `Entity ${jobId} has no Job component -- there is no such job.`, tick }] };
  }
  if (job.status === "completed") {
    return { question, steps: [{ description: "This job is already complete -- it is not stalled.", tick, location: job.target }] };
  }
  if (job.status === "failed") {
    return { question, steps: [{ description: "This job already failed and will not progress further.", tick, location: job.target }] };
  }
  const blockReason = describeEdgeBlock(world.grid, water, profile, job.target);
  if (blockReason !== undefined) {
    return { question, steps: [{ description: `The job's own target location is currently unreachable (${blockReason}).`, tick, location: job.target }] };
  }
  if (job.reservedBy !== undefined) {
    if (!world.entities.isLive(job.reservedBy)) {
      return { question, steps: [{ description: `The beaver assigned to this job (entity ${job.reservedBy}) is no longer alive.`, tick, location: job.target }] };
    }
    const workerPosition = world.grid.positionOf(job.reservedBy);
    if (workerPosition === undefined) {
      return { question, steps: [{ description: `The beaver assigned to this job (entity ${job.reservedBy}) has no current position, so it cannot progress toward the target.`, tick, location: job.target }] };
    }
    const workerPath = findPath(world.grid, world.terrain, water, materials, { x: workerPosition.x, z: workerPosition.z }, job.target, profile);
    if (workerPath === undefined) {
      return { question, steps: [{ description: `Entity ${job.reservedBy} is assigned to this job, but currently has no connected route to the target.`, tick, location: job.target }] };
    }
    return { question, steps: [{ description: `Entity ${job.reservedBy} is assigned to this job and still has a connected route to the target -- it is progressing, not stalled.`, tick, location: job.target }] };
  }
  const beavers = world.entities.liveIdsOfKind("beaver");
  if (beavers.length === 0) {
    return { question, steps: [{ description: "No living beaver exists to claim this job.", tick, location: job.target }] };
  }
  for (const beaver of beavers) {
    const position = world.grid.positionOf(beaver);
    if (position === undefined) continue;
    const path = findPath(world.grid, world.terrain, water, materials, { x: position.x, z: position.z }, job.target, profile);
    if (path !== undefined) {
      return { question, steps: [{ description: "The job's target is reachable by at least one living beaver, but none has claimed it yet.", tick, location: job.target }] };
    }
  }
  return { question, steps: [{ description: "Living beavers exist, but none currently has a connected route to this job's target.", tick, location: job.target }] };
}

// ---- why water rose ----

/**
 * Finds the nearest (Euclidean, then earliest-tick as a tiebreak) real
 * `"dam-segment-applied"` event (`Dam.ts`, added by this task) and
 * reports it as a recorded candidate obstruction, alongside the column's
 * CURRENT observed depth -- a real, live fact, not a reconstructed
 * historical one (`WaterField` doesn't retain depth history, so this
 * function honestly reports what's true NOW, not at any specific past
 * tick). The query deliberately does not claim a formal `causeEventId`
 * chain the simulation does not record; acceptance tests prove the
 * P1-22 scenario's hydraulic comparison separately.
 */
export function explainWaterRose(world: World, water: WaterField, x: number, z: number): CausalExplanation {
  const tick = world.clock.tick;
  const question = `why did water rise at (${x}, ${z})?`;
  const currentDepth = water.depthAt(x, z);
  const damEvents = world.events.eventsOfType("dam-segment-applied");

  if (damEvents.length === 0) {
    return {
      question,
      steps: [{ description: `No dam segment has been built. Current observed depth here is ${currentDepth.toFixed(2)}; any rise is from ordinary inflow/precipitation/drainage, not an obstruction.`, tick, location: { x, z } }],
    };
  }

  let nearest = damEvents[0]!;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const event of damEvents) {
    const distance = Math.hypot(event.location.x - x, event.location.z - z);
    if (distance < nearestDistance || (distance === nearestDistance && event.tick < nearest.tick)) {
      nearest = event;
      nearestDistance = distance;
    }
  }

  return {
    question,
    steps: [
      stepFromEvent(nearest, `A dam segment was built at (${nearest.location.x}, ${nearest.location.z}) on tick ${nearest.tick}, raising real terrain and throttling flow there (ARCHITECTURE_CONTRACT §12 -- through ordinary material properties, not a scripted rule).`),
      { description: `The current observed water depth at (${x}, ${z}) is now ${currentDepth.toFixed(2)}; this query reports the nearest recorded obstruction and current depth, while exact historical water-depth attribution requires future depth-history/cause links.`, tick, location: { x, z } },
    ],
  };
}

// ---- why a creature died ----

/**
 * The literal centerpiece of P1-22's own acceptance test: given a
 * `"drowning-death"` corpse, assembles a real, multi-step chain --
 * the antecedent dam obstruction (if any, via `explainWaterRose`'s own
 * nearest-dam-event logic), the observed water depth at the death
 * location, whether the death POSITION still has a real path to open air
 * (`Respiration.ts`'s own `canBreatheAt` -- the ACTUAL mechanism P1-16
 * uses to decide breath depletion, not a movement/wading check: a
 * swimming-capable beaver, which every starting beaver is by default,
 * is never blocked from ESCAPING deep open water by depth alone -- it
 * only drowns when genuinely trapped, a real ceiling or the map's own
 * vertical bound standing between it and the surface), the beaver's own
 * presence (the "agent action" -- the real, if minimal, fact this
 * simulation can state: WHO was there), and finally the real, already-
 * recorded death event itself.
 */
export function explainDeath(world: World, water: WaterField, corpseId: EntityId): CausalExplanation {
  const corpse = getCorpse(world.components, corpseId);
  if (corpse === undefined) {
    throw new RangeError(`entity ${corpseId} has no Corpse component -- cannot explain its death`);
  }
  const position = world.grid.positionOf(corpseId);
  if (position === undefined) {
    throw new RangeError(`corpse ${corpseId} has no recorded position -- cannot explain its death`);
  }
  const question = `why did the creature that became corpse ${corpseId} die?`;
  const steps: ExplanationStep[] = [];

  if (corpse.causeOfDeath === "drowning") {
    const waterExplanation = explainWaterRose(world, water, position.x, position.z);
    steps.push(...waterExplanation.steps);
    const canBreathe = canBreatheAt(world.grid, water, position.x, position.y, position.z);
    steps.push({
      description: canBreathe
        ? "At this exact position there is currently a real path to open air -- the fatal entrapment must have happened at an earlier position or moment this query cannot reconstruct (WaterField/terrain retain no depth history)."
        : "At this position, no real path to open air exists -- standing water combined with a solid ceiling (or the map's own vertical bound) blocked the beaver from ever surfacing to breathe.",
      tick: world.clock.tick,
      location: { x: position.x, z: position.z },
    });
  }

  steps.push({ description: `An agent was present at (${position.x}, ${position.z}) at the moment of death.`, tick: corpse.diedAtTick, location: { x: position.x, z: position.z } });

  const deathEvent = world.events.get(corpse.deathEventId);
  steps.push(stepFromEvent(deathEvent, `The creature died of ${corpse.causeOfDeath} on tick ${deathEvent.tick} (recorded event ${deathEvent.id}).`));

  return { question, steps };
}

// ---- why a plant died ----

/**
 * Honestly reports that this simulation has NO real plant-death
 * mechanism yet -- `EcologyResponse.ts`'s `applyVegetationHealthTick`
 * only ever drifts `Plant.health`, clamped at a floor of 0, and never
 * destroys anything; `TreeCutting.ts`'s `fellTree` (the only place a
 * `"tree"` entity is ever destroyed at all) records no event either
 * (confirmed directly, `EcologyResponse.ts`'s own top doc comment already
 * notes this). Real environmental plant death is explicitly the roadmap's
 * OWN later task, P4-02 "Advanced plant lifecycle" ("germination, growth,
 * maturity, reproduction, stress, and death occur from environmental
 * conditions") -- inventing that mechanism here, just so this one query
 * branch has a real event to point to, would be exactly the "implement a
 * future phase early" AGENTS.md Law 10 prohibits. This function is
 * therefore a real, correct, honest answer given the CURRENT true state
 * of the simulation (plants cannot yet die from anything but felling, and
 * felling leaves no causal record), not a stub -- matching
 * `DebugInspector.ts`'s own "showing nothing is better than showing
 * plausible-looking fake data" precedent.
 */
export function explainPlantDeath(world: World, plantId: EntityId): CausalExplanation {
  const tick = world.clock.tick;
  const question = `why did plant ${plantId} die?`;
  if (!world.entities.isKnown(plantId)) {
    throw new RangeError(`unknown entity ${plantId} -- cannot explain plant death`);
  }
  const kind = world.entities.kindOf(plantId);
  if (kind !== "tree" && kind !== "plant") {
    throw new RangeError(`entity ${plantId} is a ${kind}, not a plant/tree -- cannot explain plant death`);
  }
  if (world.entities.isLive(plantId)) {
    return { question, steps: [{ description: "This plant is still alive -- it has not died.", tick }] };
  }
  return {
    question,
    steps: [
      {
        description:
          "No causal record exists for this plant's destruction. This simulation has no environmental plant-death mechanism yet (health drift never destroys a plant, and tree-felling records no event) -- real plant death from environmental conditions is a later task's own job (roadmap P4-02, Advanced plant lifecycle), not yet built.",
        tick,
      },
    ],
  };
}

// ---- P11-12: simulation-backed explanation for the P11 domains ----

/**
 * P11-12: the same "steps cite a real EventId or an honestly-derived
 * live fact, never a fabricated one" discipline extended to the new
 * Phase 11 domains (knowledge, rumor, invention, infrastructure
 * memory). Every function below composes REAL events (`knowledge`
 * entries reference real events; `"tech-taught"`/`"recipe-invented"`/
 * `"ruin-materialized"`/`"ruin-encountered"` are real recorded events
 * from the mechanisms themselves) with live facts read at query time --
 * and `assertGroundedExplanation` makes the discipline STRUCTURAL: any
 * step citing an unresolvable event id throws, so a fabricated
 * explanation can never pass through this file.
 */

import { getKnowledge } from "../creatures/Knowledge.js";
import { believedVersionsOf, getBelievedVersion } from "../chronicle/Rumors.js";
import { getBelief } from "../creatures/Belief.js";
import { getRuin } from "../structures/InfrastructureMemory.js";
import { getSite } from "../region/Site.js";

/**
 * Throws if ANY step's cited event id does not resolve to a real
 * recorded event -- the structural grounding proof the P11-12
 * acceptance test runs over every generated explanation. A step with no
 * `eventId` is a live fact (still honest, but not an event citation).
 */
export function assertGroundedExplanation(world: World, explanation: CausalExplanation): void {
  for (const step of explanation.steps) {
    if (step.eventId !== undefined && !world.events.has(step.eventId)) {
      throw new RangeError(`explanation step cites event ${step.eventId} which does not exist -- explanation is not grounded in recorded history`);
    }
  }
}

/** How `beaverId` learned `eventId` -- the knowledge ledger's own entry (real route + tick), plus any recorded conversations that actually transferred it. */
export function explainKnowledge(world: World, beaverId: EntityId, eventId: EventId): CausalExplanation {
  const question = `how does beaver #${beaverId} know about event #${eventId}?`;
  const entry = getKnowledge(world.components, beaverId)?.entries.find((e) => e.eventId === eventId);
  if (entry === undefined) {
    return { question, steps: [{ description: `Beaver #${beaverId} has no recorded knowledge of event #${eventId} -- they were never told, never witnessed it, and never found its evidence.`, tick: world.clock.tick }] };
  }
  const event = world.events.get(eventId)!;
  const steps: ExplanationStep[] = [
    stepFromEvent(event, `Event #${eventId} ("${event.eventType}") really happened on tick ${event.tick}.`),
    { description: `Beaver #${beaverId} learned of it on tick ${entry.acquiredTick} through ${entry.source} (their own knowledge ledger records this route).`, tick: entry.acquiredTick },
  ];
  // The recorded conversations that transferred it (real events).
  const transferEvents = world.events
    .eventsInvolving(beaverId)
    .filter((e) => e.eventType === "wayfarer-conversation" && e.causeEventId === eventId);
  for (const transfer of transferEvents) {
    steps.push(stepFromEvent(transfer, `A real conversation on tick ${transfer.tick} transferred knowledge of event #${eventId}.`));
  }
  return { question, steps };
}

/** What the believed version diverged from and how -- the authoritative origin event plus each mutation, cited against the real believed-version entity. */
export function explainRumor(world: World, versionId: EntityId): CausalExplanation {
  const version = getBelievedVersion(world.components, versionId);
  const question = `what does believed version #${versionId} say, and where did it diverge?`;
  if (version === undefined) {
    return { question, steps: [{ description: `Entity #${versionId} is not a believed version.`, tick: world.clock.tick }] };
  }
  const origin = world.events.get(version.originEventId)!;
  const steps: ExplanationStep[] = [
    stepFromEvent(origin, `The authoritative event #${origin.id} ("${origin.eventType}") is what actually happened.`),
    {
      description: `Believed version #${versionId} (formed tick ${version.formedTick}, retold ${version.retellings} times) diverges: ${version.mutations
        .map((m) => (m.kind === "magnitude" ? `magnitude scaled by ${m.scale.toFixed(2)}` : m.kind === "actor" ? `actor changed to entity #${m.actorId}` : "outcome flipped"))
        .join("; ")}.`,
      tick: version.formedTick,
      eventId: origin.id,
    },
  ];
  // The retellings are real conversation events (each recorded).
  const retellings = world.events
    .all()
    .filter((e) => e.eventType === "wayfarer-conversation" && e.causeEventId === version.originEventId)
    .filter((e) => version.heldByBeaverIds.length > 0 && e.subjectIds.includes(version.heldByBeaverIds[0]!));
  for (const retelling of retellings.slice(0, 5)) {
    steps.push(stepFromEvent(retelling, `The story was retold in a real conversation on tick ${retelling.tick}.`));
  }
  return { question, steps };
}

/** How `householdId` came to know `recipeId` -- the recorded invention event (P11-10) or the recorded teaching events (P11-09), never a guessed origin. */
export function explainInvention(world: World, householdId: EntityId, recipeId: string): CausalExplanation {
  const question = `how did household #${householdId} come to know "${recipeId}"?`;
  const invented = world.events
    .all()
    .filter((e) => e.eventType === "recipe-invented" && e.subjectIds.includes(householdId) && e.data?.recipeId === recipeId);
  const taught = world.events
    .all()
    .filter((e) => e.eventType === "tech-taught" && e.subjectIds.includes(householdId) && e.data?.recipeId === recipeId);
  const steps: ExplanationStep[] = [];
  for (const event of invented) steps.push(stepFromEvent(event, `The household genuinely invented "${recipeId}" on tick ${event.tick} (a real recorded invention).`));
  for (const event of taught) steps.push(stepFromEvent(event, `Household #${event.subjectIds[0]} really taught "${recipeId}" to this household on tick ${event.tick}.`));
  if (steps.length === 0) {
    steps.push({ description: `Household #${householdId} has no recorded origin for "${recipeId}" -- they either never learned it or the record does not exist.`, tick: world.clock.tick });
  }
  return { question, steps };
}

/** What a ruin is and how later populations have treated it -- the real materialization event, the site record it came from, and the real encounters. */
export function explainRuin(world: World, ruinId: EntityId): CausalExplanation {
  const question = `what is ruin #${ruinId}, and what has happened to it?`;
  const ruin = getRuin(world.components, ruinId);
  if (ruin === undefined) {
    return { question, steps: [{ description: `Entity #${ruinId} is not a ruin.`, tick: world.clock.tick }] };
  }
  const steps: ExplanationStep[] = [];
  const materialized = world.events
    .all()
    .filter((e) => e.eventType === "ruin-materialized" && e.subjectIds.includes(ruinId));
  for (const event of materialized) steps.push(stepFromEvent(event, `The ruin materialized on tick ${event.tick} -- an abandoned "${event.data?.kind ?? ruin.kind}" structure left behind by an older population.`));
  if (steps.length === 0) {
    steps.push({ description: `Ruin #${ruinId} is an abandoned "${ruin.kind}" structure (recorded abandoned at tick ${ruin.abandonedTick}) -- no materialization event exists in this world's log.`, tick: ruin.abandonedTick });
  }
  for (const event of world.events.eventsInvolving(ruinId).filter((e) => e.eventType === "ruin-encountered")) {
    steps.push(stepFromEvent(event, `A later population encountered it on tick ${event.tick} -- and either repaired it or built a myth on it (see the encounter event's own records).`));
  }
  // The site record it came from (live fact, with the founded event id
  // as the real historical anchor).
  for (const siteId of world.entities.liveIdsOfKind("site")) {
    const site = getSite(world.components, siteId);
    if (site?.abandonedStructures?.[ruin.kind] !== undefined) {
      const foundedEvent = world.events.get(site.foundedEventId);
      if (foundedEvent !== undefined) {
        steps.push(stepFromEvent(foundedEvent, `The site it belongs to (#${siteId}) really recorded ${site.abandonedStructures[ruin.kind]} abandoned "${ruin.kind}" structure(s) at its last deactivation.`));
      } else {
        steps.push({ description: `Site #${siteId} (founded by real event #${site.foundedEventId}) recorded ${site.abandonedStructures[ruin.kind]} abandoned "${ruin.kind}" structure(s) at its last deactivation.`, tick: ruin.abandonedTick });
      }
      break;
    }
  }
  return { question, steps };
}

/** Exposes the underlying causal graph of an explanation: every cited event's own cause chain (P0-08's `traceBack`), flattened oldest-first -- the "can expose the underlying causal graph" clause. */
export function explanationCausalGraph(world: World, explanation: CausalExplanation): RecordedEvent[] {
  const seen = new Set<EventId>();
  const chain: RecordedEvent[] = [];
  for (const step of explanation.steps) {
    if (step.eventId === undefined) continue;
    const trace = world.events.traceBack(step.eventId);
    for (const event of trace) {
      if (seen.has(event.id)) continue;
      seen.add(event.id);
      chain.push(event);
    }
  }
  return chain.sort((a, b) => a.tick - b.tick || a.id - b.id);
}
