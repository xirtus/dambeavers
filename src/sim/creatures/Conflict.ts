import type { EntityId } from "../core/EntityId.js";
import type { World } from "../persistence/WorldSnapshot.js";
import type { RandomStream } from "../core/Random.js";
import { relationshipWith, setRelationshipWith } from "./Relationships.js";
import { socialBond } from "./RelationshipTypes.js";
import { conflictProneness } from "./Stress.js";
import { applyTrauma } from "./Mortality.js";
import { isSociallyIdle } from "./SocialInteraction.js";
import { recordMemory } from "./Memory.js";

/**
 * P5-14: grudges/stress producing real arguments or fights through the
 * SAME general decision shape `SocialInteraction.ts` already established
 * for POSITIVE encounters (idle, adjacent live beavers -- deterministic
 * pairing, no scripted "these two specific beavers fight now" event).
 * Two live rivals (`RelationshipTypes.ts`'s own real `socialBond`
 * classification, P5-04) both under real chronic stress
 * (`Stress.ts`'s `conflictProneness`, P5-03) can produce a conflict --
 * the roadmap's own literal "grudges/stress... through general decision
 * systems," never a bespoke crime/drama script.
 */
function manhattan(ax: number, az: number, bx: number, bz: number): number {
  return Math.abs(ax - bx) + Math.abs(az - bz);
}

/** Per-tick probability an eligible rival pair's combined conflict-proneness escalates to a real fight rather than a milder argument. Plausible, tunable balance data. */
export const FIGHT_ESCALATION_PROBABILITY = 0.15;
export const CONFLICT_TRAUMA_AMOUNT = 0.1;
/** Real relationship damage from an argument -- affinity worsens, grudge accumulates (P5-04's own optional field, first real writer). Plausible, tunable balance data. */
export const CONFLICT_AFFINITY_PENALTY = 0.1;
export const CONFLICT_GRUDGE_GAIN = 0.2;

export type ConflictKind = "argument" | "fight";

export interface ConflictResult {
  participantIds: [EntityId, EntityId];
  kind: ConflictKind;
  eventId: number;
}

function worsenedEdge(existing: ReturnType<typeof relationshipWith>, withId: EntityId): NonNullable<typeof existing> {
  const base = existing ?? { withId, kin: "unrelated" as const, familiarity: 0.3, affinity: -0.3 };
  return {
    ...base,
    affinity: Math.max(-1, base.affinity - CONFLICT_AFFINITY_PENALTY),
    grudge: Math.min(1, (base.grudge ?? 0) + CONFLICT_GRUDGE_GAIN),
  };
}

/**
 * One tick of conflict scheduling over `candidateIds` (deterministic,
 * sorted): pairs up idle, adjacent, real rivals whose combined
 * `conflictProneness` clears a real threshold, rolls a real escalation
 * probability for `"fight"` (real trauma applied via `Mortality.ts`'s
 * own `applyTrauma`, unmodified) vs. `"argument"` (relationship-only),
 * worsens both sides' relationship edge (affinity down, grudge up), and
 * records BOTH a real memory (P5-02) and a real event for each.
 */
export function tickConflicts(world: World, random: RandomStream, candidateIds: readonly EntityId[]): ConflictResult[] {
  const results: ConflictResult[] = [];
  const used = new Set<EntityId>();
  const sorted = [...candidateIds].sort((a, b) => a - b);

  for (const beaverId of sorted) {
    if (used.has(beaverId) || !world.entities.isLive(beaverId) || !isSociallyIdle(world, beaverId)) continue;
    const position = world.grid.positionOf(beaverId);
    if (position === undefined) continue;
    const proneness = conflictProneness(world.components, beaverId);
    if (proneness < 0.3) continue;

    for (const otherId of sorted) {
      if (otherId === beaverId || used.has(otherId) || !world.entities.isLive(otherId) || !isSociallyIdle(world, otherId)) continue;
      const otherPosition = world.grid.positionOf(otherId);
      if (otherPosition === undefined || manhattan(position.x, position.z, otherPosition.x, otherPosition.z) > 1) continue;
      if (socialBond(relationshipWith(world.components, beaverId, otherId)) !== "rival") continue;
      const combinedProneness = (proneness + conflictProneness(world.components, otherId)) / 2;
      if (combinedProneness < 0.3) continue;

      const kind: ConflictKind = random.nextBool(FIGHT_ESCALATION_PROBABILITY * combinedProneness) ? "fight" : "argument";
      if (kind === "fight") {
        applyTrauma(world, beaverId, CONFLICT_TRAUMA_AMOUNT);
        applyTrauma(world, otherId, CONFLICT_TRAUMA_AMOUNT);
      }
      setRelationshipWith(world.components, beaverId, worsenedEdge(relationshipWith(world.components, beaverId, otherId), otherId));
      setRelationshipWith(world.components, otherId, worsenedEdge(relationshipWith(world.components, otherId, beaverId), beaverId));

      const eventId = world.events.record({
        tick: world.clock.tick,
        eventType: kind === "fight" ? "beaver-fight" : "beaver-argument",
        subjectIds: [beaverId, otherId],
        location: position,
      });
      recordMemory(world, beaverId, eventId, -0.5);
      recordMemory(world, otherId, eventId, -0.5);

      used.add(beaverId);
      used.add(otherId);
      results.push({ participantIds: [beaverId, otherId], kind, eventId });
      break;
    }
  }
  return results;
}
