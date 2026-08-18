import { ComponentStore, defineComponent, type ComponentType } from "../core/ComponentStore.js";
import type { EntityId } from "../core/EntityId.js";
import type { EventId } from "../history/EventLog.js";
import type { RandomStream } from "../core/Random.js";
import type { World } from "../persistence/WorldSnapshot.js";
import { learnByConversation } from "../creatures/Knowledge.js";

/**
 * P11-07: rumor, distortion, and folklore -- retold knowledge can
 * DIVERGE from authoritative history while the chronicle preserves
 * BOTH. A "believed version" is a real, permanent entity (the same
 * durable-concept-gets-identity pattern as `Belief`/`Job`) whose
 * `originEventId` must resolve to a real recorded event, holding the
 * retold story's MUTATIONS (a scaled magnitude, a swapped actor, a
 * flipped outcome). The authoritative `EventLog` entry is NEVER
 * mutated -- divergence lives only in the believed version, so both
 * remain independently queryable, exactly as the roadmap requires.
 */

export type RumorMutation =
  | { kind: "magnitude"; scale: number }
  | { kind: "actor"; actorId: EntityId }
  | { kind: "outcome-flip" };

export interface BelievedVersion {
  originEventId: EventId;
  mutations: RumorMutation[];
  heldByBeaverIds: EntityId[];
  formedTick: number;
  retellings: number;
}
export const BelievedVersionComponent: ComponentType<BelievedVersion> = defineComponent<BelievedVersion>("believed-version");

export function assertValidBelievedVersion(version: BelievedVersion): void {
  if (!Number.isInteger(version.originEventId) || version.originEventId < 1) {
    throw new RangeError(`believed-version originEventId must be a positive integer, got ${version.originEventId}`);
  }
  if (!Array.isArray(version.mutations)) throw new RangeError("believed-version mutations must be an array");
  for (const mutation of version.mutations) {
    if (mutation.kind === "magnitude") {
      if (!(Number.isFinite(mutation.scale) && mutation.scale > 0)) throw new RangeError(`magnitude mutation scale must be positive, got ${mutation.scale}`);
    } else if (mutation.kind === "actor") {
      if (!Number.isInteger(mutation.actorId) || mutation.actorId < 1) throw new RangeError(`actor mutation actorId must be a positive integer, got ${mutation.actorId}`);
    } else if (mutation.kind !== "outcome-flip") {
      throw new RangeError(`unknown rumor mutation kind ${JSON.stringify(mutation)}`);
    }
  }
  if (!Array.isArray(version.heldByBeaverIds)) throw new RangeError("believed-version heldByBeaverIds must be an array");
  if (!Number.isInteger(version.formedTick) || version.formedTick < 0) throw new RangeError(`believed-version formedTick must be a non-negative integer, got ${version.formedTick}`);
  if (!Number.isInteger(version.retellings) || version.retellings < 0) throw new RangeError(`believed-version retellings must be a non-negative integer, got ${version.retellings}`);
}

export function setBelievedVersion(components: ComponentStore, versionId: EntityId, version: BelievedVersion): void {
  assertValidBelievedVersion(version);
  components.set(versionId, BelievedVersionComponent, version);
}

export function getBelievedVersion(components: ComponentStore, versionId: EntityId): BelievedVersion | undefined {
  const version = components.get(versionId, BelievedVersionComponent);
  if (version !== undefined) assertValidBelievedVersion(version);
  return version;
}

/** Chance a retelling mutates one detail -- rumors distort slowly, not every time. Plausible, tunable balance data. */
export const RUMOR_MUTATION_CHANCE = 0.25;

/** Every believed version of `originEventId`, discovered fresh. */
export function believedVersionsOf(world: World, originEventId: EventId): EntityId[] {
  return world.entities
    .liveIdsOfKind("believed-version")
    .filter((id) => getBelievedVersion(world.components, id)?.originEventId === originEventId);
}

/**
 * A real retelling: the listener learns the event by conversation
 * (P11-06's own route -- the speaker must genuinely know it), and with
 * `RUMOR_MUTATION_CHANCE` one detail of the retold story mutates. The
 * mutated detail is stored in a `"believed-version"` entity held by the
 * listener (extending an existing version they already hold if there is
 * one -- retellings accumulate, they don't fork per telling). The
 * authoritative `EventLog` is untouched. Returns the believed-version
 * id when a mutation occurred (or the listener's existing version got
 * one more retelling), `undefined` for a clean retelling.
 */
export function retellKnowledge(world: World, speakerId: EntityId, listenerId: EntityId, eventId: EventId, random: RandomStream): EntityId | undefined {
  if (!learnByConversation(world, speakerId, listenerId, eventId)) return undefined;
  const existingId = believedVersionsOf(world, eventId).find((id) => getBelievedVersion(world.components, id)?.heldByBeaverIds.includes(listenerId));
  if (existingId !== undefined) {
    const existing = getBelievedVersion(world.components, existingId)!;
    setBelievedVersion(world.components, existingId, { ...existing, retellings: existing.retellings + 1 });
    return existingId;
  }
  if (!random.nextBool(RUMOR_MUTATION_CHANCE)) return undefined;

  const event = world.events.get(eventId)!;
  const mutationKindRoll = random.nextFloat();
  let mutation: RumorMutation;
  if (mutationKindRoll < 0.4) {
    // Magnitude: the story's size scales by a real random factor.
    mutation = { kind: "magnitude", scale: 0.5 + random.nextFloat() };
  } else if (mutationKindRoll < 0.8) {
    // Actor: the story is pinned on a different real entity that was
    // actually involved in the event, or the listener themselves when
    // no one else exists -- never an invented id.
    const candidates = event.subjectIds.filter((id) => id !== speakerId && id !== listenerId);
    mutation = { kind: "actor", actorId: candidates.length > 0 ? candidates[0]! : listenerId };
  } else {
    // Outcome: the ending flips.
    mutation = { kind: "outcome-flip" };
  }
  const versionId = world.entities.create("believed-version");
  setBelievedVersion(world.components, versionId, {
    originEventId: eventId,
    mutations: [mutation],
    heldByBeaverIds: [listenerId],
    formedTick: world.clock.tick,
    retellings: 1,
  });
  return versionId;
}
