import type { ComponentStore } from "../core/ComponentStore.js";
import type { EntityId, EntityIdRegistry } from "../core/EntityId.js";
import type { WorldGrid } from "../world/WorldGrid.js";
import type { TerrainField } from "../world/TerrainField.js";
import type { WaterField } from "../hydrology/WaterField.js";
import type { MaterialRegistry } from "../materials/Material.js";
import type { NavigationProfile } from "../navigation/Pathfinding.js";
import { currentJobOf, suspendJob } from "../jobs/JobBoard.js";
import { getNeeds, setNeeds, applyNeedsTick, NEED_URGENT_THRESHOLD } from "./Needs.js";
import { tickBeaverNeeds, type NeedsTickResult } from "./BeaverNeeds.js";

/**
 * P1-14: arbitrates between a beaver's survival needs and whatever job
 * (P1-07) it currently holds -- the top of the per-beaver, per-tick
 * decision tree neither `BeaverNeeds.ts` (needs-only) nor `JobBoard.ts`
 * (job-pipeline-only, kind-agnostic) owns by itself. Matches
 * `tickJobForBeaver`'s own documented boundary ("this is a movement/
 * pipeline PRIMITIVE, not a scheduler... that composition is the caller's
 * job") -- this file IS that composition, for exactly the one arbitration
 * rule the roadmap requires: urgent fatigue always wins outright over
 * job work, interrupting it (ARCHITECTURE_CONTRACT §10's own "need
 * becomes urgent" job failure mode, `JobBoard.suspendJob`). Deliberately
 * does NOT also interrupt work for urgent hunger/thirst -- the roadmap's
 * own P1-14 acceptance wording names only "exhausted beavers," and DF-
 * style colony sims routinely let a worker finish out a shift hungry;
 * inventing a broader interruption rule nothing asked for would be
 * exactly the "build ahead of what's needed" AGENTS.md Law 10 forbids.
 *
 * Because job-type tick functions (`tickTreeCutJob`/`tickHaulJob`/
 * `tickBuildJob`, ...) each have their own distinct signature (some need
 * `plantSpecies`, some don't) and this file has no way to know which one
 * applies to an arbitrary held job, `tickBeaverBehavior` never drives a
 * job's own tick function itself -- it only decides WHETHER to (the
 * `"working"` outcome tells the caller "call the job's own tick function
 * this tick, unchanged") or to interrupt it and drive `tickBeaverNeeds`
 * instead. A caller that already knows which job-type tick function
 * applies (a test's own driving loop today; a future real scheduler)
 * composes the two using this function's return value.
 */
export type BeaverBehaviorOutcome =
  | { kind: "job-interrupted"; needsResult: NeedsTickResult }
  | { kind: "working" }
  | { kind: "needs"; needsResult: NeedsTickResult };

/**
 * One simulated tick of arbitration for `id`:
 *
 * 1. If fatigue is urgent AND `id` currently holds a job (`currentJobOf`),
 *    suspend that job (`JobBoard.suspendJob` -- requeued to `"unclaimed"`,
 *    available for another worker, never silently abandoned) and drive
 *    `tickBeaverNeeds` (which will itself produce the `"rest"` intent,
 *    P1-14's own preferred-location logic).
 * 2. Otherwise, if `id` holds a job (fatigue not urgent, or no job at
 *    all -- handled below), apply this tick's ordinary need change with
 *    `wasActive: true` (job work is real activity, the same "was this
 *    beaver actually doing something" signal traveling for a survival
 *    need already produces -- without this, a beaver busy on a job would
 *    never accumulate fatigue at all, since nothing else ticks `Needs`
 *    for it) and return `"working"` so the caller drives the job's own
 *    tick function this tick, unchanged.
 * 3. Otherwise (no job held), drive `tickBeaverNeeds` directly -- ordinary
 *    P1-06/P1-13 survival behavior.
 */
export function tickBeaverBehavior(
  grid: WorldGrid,
  terrain: TerrainField,
  water: WaterField,
  materials: MaterialRegistry,
  entities: EntityIdRegistry,
  components: ComponentStore,
  id: EntityId,
  profile: NavigationProfile,
): BeaverBehaviorOutcome {
  const needs = getNeeds(components, id);
  if (needs === undefined) {
    throw new RangeError(`entity ${id} has no Needs component -- cannot tick`);
  }
  const urgentFatigue = needs.fatigue >= NEED_URGENT_THRESHOLD;
  const currentJob = currentJobOf(entities, components, id);

  if (urgentFatigue && currentJob !== undefined) {
    suspendJob(components, currentJob);
    const needsResult = tickBeaverNeeds(grid, terrain, water, materials, entities, components, id, profile);
    return { kind: "job-interrupted", needsResult };
  }

  if (currentJob !== undefined) {
    setNeeds(components, id, applyNeedsTick(needs, true));
    return { kind: "working" };
  }

  const needsResult = tickBeaverNeeds(grid, terrain, water, materials, entities, components, id, profile);
  return { kind: "needs", needsResult };
}
