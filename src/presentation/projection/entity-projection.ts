/**
 * Entity projection (threejs_layer.md §3.3): turns live ECS state into
 * immutable RenderEntityRecords. Every field is read from a real
 * component/field; activity classification derives ONLY from authoritative
 * facts (held job's real progress component, persisted NeedFocus, real
 * water depth vs the beaver's real wading limit, and movement between two
 * authoritative ticks). Nothing here writes to the world.
 */
import type { World } from "../../sim/persistence/WorldSnapshot.js";
import type { EntityId } from "../../sim/core/EntityId.js";
import { getIdentity } from "../../sim/creatures/Beaver.js";
import { getSwimmer } from "../../sim/creatures/Beaver.js";
import { getNeedFocus } from "../../sim/creatures/BeaverNeeds.js";
import { getNeeds, NEED_URGENT_THRESHOLD } from "../../sim/creatures/Needs.js";
import { getPlant } from "../../sim/ecology/Plant.js";
import { growthFraction } from "../../sim/ecology/PlantSpecies.js";
import type { PlantSpeciesRegistry } from "../../sim/ecology/PlantSpecies.js";
import { getLog, getHeld } from "../../sim/labor/Log.js";
import { getConstruction } from "../../sim/labor/Construction.js";
import { getDamSegment } from "../../sim/hydrology/Dam.js";
import { currentJobOf } from "../../sim/jobs/JobBoard.js";
import { getTreeCutProgress } from "../../sim/labor/TreeCutting.js";
import { getHaulProgress } from "../../sim/labor/Hauling.js";
import { getBuildProgress } from "../../sim/labor/Construction.js";
import { getDigProgress } from "../../sim/labor/Digging.js";
import { getBurialProgress } from "../../sim/labor/Burial.js";
import { getCraftProgress } from "../../sim/economy/Craft.js";
import type { RenderActivity, RenderEntityRecord } from "../contracts/render-entity.js";

/** Kinds the 3D layer projects in R1. Anything else simply isn't drawn yet (it still exists in the sim, inspectable via queries). */
const PROJECTED_KINDS = new Set(["beaver", "tree", "log", "construction", "dam-segment", "corpse"]);

export interface EntityProjectionContext {
  readonly plantSpecies: PlantSpeciesRegistry;
}

/** Per-entity state carried between projections so revisions bump only on real change, and movement-based activity has a previous authoritative position to compare against. */
export class EntityProjector {
  private readonly revisions = new Map<EntityId, number>();
  private readonly fingerprints = new Map<EntityId, string>();
  private readonly previousCells = new Map<EntityId, string>();
  private nextRevision = 1;

  constructor(private readonly context: EntityProjectionContext) {}

  /** Projects every currently-projectable entity. Returns records with stable per-entity revisions. */
  projectAll(world: World): { records: RenderEntityRecord[]; liveProjectedIds: Set<EntityId> } {
    const records: RenderEntityRecord[] = [];
    const liveProjectedIds = new Set<EntityId>();
    for (const kind of PROJECTED_KINDS) {
      for (const id of world.entities.liveIdsOfKind(kind)) {
        const record = this.projectOne(world, id);
        if (record !== undefined) {
          records.push(record);
          liveProjectedIds.add(id);
        }
      }
    }
    records.sort((a, b) => a.id - b.id);
    return { records, liveProjectedIds };
  }

  /** IDs that were projected before but are no longer projectable (destroyed or kind no longer projected) -> removals. */
  removalsFor(liveProjectedIds: Set<EntityId>): EntityId[] {
    const removals: EntityId[] = [];
    for (const id of this.fingerprints.keys()) {
      if (!liveProjectedIds.has(id)) {
        removals.push(id);
        this.fingerprints.delete(id);
        this.revisions.delete(id);
        this.previousCells.delete(id);
      }
    }
    return removals.sort((a, b) => a - b);
  }

  private projectOne(world: World, id: EntityId): RenderEntityRecord | undefined {
    const kind = world.entities.kindOf(id);
    const position = world.grid.positionOf(id);
    // Held items have no grid position while carried -- their cell is the
    // carrier's, which the renderer resolves via `heldBy` anyway.
    const x = position?.x ?? 0;
    const y = position?.y ?? 0;
    const z = position?.z ?? 0;

    const base = { id, kind, x, y, z, live: true };
    let specific: Partial<RenderEntityRecord>;
    switch (kind) {
      case "beaver":
        specific = this.projectBeaver(world, id, x, z);
        break;
      case "tree": {
        const plant = getPlant(world.components, id);
        if (plant === undefined) return undefined;
        const species = this.context.plantSpecies.get(plant.speciesId);
        specific = {
          speciesId: plant.speciesId,
          growthFraction: growthFraction(species, plant.ageTicks),
          healthFraction: plant.health,
          activity: "idle" as RenderActivity,
        };
        break;
      }
      case "log": {
        const log = getLog(world.components, id);
        if (log === undefined) return undefined;
        const held = getHeld(world.components, id);
        specific = {
          materialId: log.materialId,
          massKg: log.massKg,
          activity: "idle" as RenderActivity,
          ...(held === undefined ? {} : { heldBy: held.by as number }),
        };
        break;
      }
      case "construction": {
        const construction = getConstruction(world.components, id);
        if (construction === undefined) return undefined;
        specific = {
          constructionKind: construction.kind,
          constructionStatus: construction.status,
          constructionProgress: construction.workRequired > 0 ? construction.workDone / construction.workRequired : 0,
          activity: "idle" as RenderActivity,
        };
        break;
      }
      case "dam-segment": {
        const dam = getDamSegment(world.components, id);
        if (dam === undefined) return undefined;
        specific = { damHeightCells: dam.heightCells, materialId: dam.materialId, activity: "idle" as RenderActivity };
        break;
      }
      case "corpse": {
        const corpseName = getIdentity(world.components, id)?.name;
        specific = { activity: "dead" as RenderActivity, ...(corpseName === undefined ? {} : { name: corpseName }) };
        break;
      }
      default:
        return undefined;
    }

    const withoutRevision = { ...base, ...specific };
    const fingerprint = JSON.stringify(withoutRevision);
    let revision = this.revisions.get(id);
    if (this.fingerprints.get(id) !== fingerprint || revision === undefined) {
      revision = this.nextRevision++;
      this.revisions.set(id, revision);
      this.fingerprints.set(id, fingerprint);
    }
    return { ...withoutRevision, revision } as RenderEntityRecord;
  }

  private projectBeaver(world: World, id: EntityId, x: number, z: number): Partial<RenderEntityRecord> {
    const identity = getIdentity(world.components, id);
    const activity = this.classifyBeaverActivity(world, id, x, z);
    return { activity, ...(identity?.name === undefined ? {} : { name: identity.name }) };
  }

  /**
   * Honest activity classification, in priority order -- every branch reads
   * a real component or a real field. Movement ("walking"/"swimming") is
   * detected from the delta between two consecutive AUTHORITATIVE
   * projections, never from animation state (Law R4 runs the other way).
   */
  private classifyBeaverActivity(world: World, id: EntityId, x: number, z: number): RenderActivity {
    const cellKey = `${x},${z}`;
    const moved = this.previousCells.get(id) !== undefined && this.previousCells.get(id) !== cellKey;
    this.previousCells.set(id, cellKey);

    const jobId = currentJobOf(world.entities, world.components, id);
    if (jobId !== undefined) {
      if (getTreeCutProgress(world.components, jobId) !== undefined) return "cutting-tree";
      if (getHaulProgress(world.components, jobId) !== undefined) return "hauling";
      if (getBuildProgress(world.components, jobId) !== undefined) return "building";
      if (getDigProgress(world.components, jobId) !== undefined) return "digging";
      if (getBurialProgress(world.components, jobId) !== undefined) return "burying";
      if (getCraftProgress(world.components, jobId) !== undefined) return "crafting";
    }

    // Swimming/wading state from the REAL water field and the beaver's own
    // real wading limit -- never from a renderer waterline guess.
    const depth = world.water.depthAt(x, z);
    const swimmer = getSwimmer(world.components, id);
    const inDeepWater = swimmer !== undefined && depth > swimmer.maxWadingDepth;
    if (inDeepWater) return "swimming";
    if (moved) return "walking";

    const focus = getNeedFocus(world.components, id);
    if (focus !== undefined) {
      if (focus.current === "hunger") return "eating";
      if (focus.current === "thirst") return "drinking";
    }
    // Rest: the sim persists no "sleeping" flag -- rest is a per-tick
    // intent. But decideIntent's documented first-priority branch makes
    // urgent fatigue ALWAYS produce the rest intent, so "stationary, no
    // job, fatigue at/above the sim's own urgent threshold" is exactly
    // "resting" by the simulation's own rules -- a derived visual fact
    // (Law R5), not an animation-driven guess.
    const needs = getNeeds(world.components, id);
    if (jobId === undefined && needs !== undefined && needs.fatigue >= NEED_URGENT_THRESHOLD) return "sleeping";
    return jobId !== undefined ? "walking" : "idle";
  }
}
