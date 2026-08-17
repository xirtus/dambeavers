import type { EntityId } from "../sim/core/EntityId.js";
import type { World } from "../sim/persistence/WorldSnapshot.js";
import type { WaterField, ColumnCoordinate } from "../sim/hydrology/WaterField.js";
import type { MaterialId } from "../sim/materials/Material.js";
import { inspectEntity, inspectCell, type EntityInspection } from "../sim/debug/DebugInspector.js";
import { getIdentity } from "../sim/creatures/Beaver.js";
import { getNeeds, NEED_URGENT_THRESHOLD, type Needs } from "../sim/creatures/Needs.js";
import { designateTreeCut } from "../sim/labor/TreeCutting.js";
import { designateConstruction as designateConstructionSim, type ConstructionKind } from "../sim/labor/Construction.js";
import { getLifeStage, type LifeStage } from "../sim/creatures/Aging.js";
import { currentJobOf } from "../sim/jobs/JobBoard.js";
import { getJob, type Job } from "../sim/jobs/Job.js";
import { getDesignation } from "../sim/jobs/Designation.js";
import { getRelationships, getHouseholdMembership, type RelationshipEdge } from "../sim/creatures/Relationships.js";
import { deriveMood } from "../sim/creatures/Mood.js";

/**
 * P1-20's "minimal game UI" -- ARCHITECTURE_CONTRACT §1/§2's "presentation
 * layer" (`src/ui/`), which "may depend on simulation interfaces" but the
 * simulation must never depend on. `TextUI` is a thin, real command
 * surface over ALREADY-EXISTING simulation mechanisms (P0-12's
 * `inspectEntity`/`inspectCell`, P1-08's `designateTreeCut`, P1-10's
 * `designateConstruction`, P0-01's `SimulationClock.pause`/`resume`/
 * `setSpeed`) -- it never invents a parallel notion of any of these, only
 * composes and exposes them through one player-facing surface, matching
 * `DebugInspector.ts`'s own doc comment, written at P0-12 time: "A future
 * click-to-inspect UI (P1-20) would resolve a mouse click to an `EntityId`
 * ... and call this."
 *
 * Deliberately TEXT, not graphical: no rendering, no camera transform, no
 * DOM, no ThreeJS -- "camera navigation" here is a real, stateful 2D
 * column position (`cameraX`/`cameraZ`) plus a pure ASCII-grid render of
 * live world state around it, matching Dwarf Fortress's own UI heritage
 * (this project's explicit inspiration) and keeping this file entirely
 * outside `src/presentation/`'s eventual 3D/rendering scope
 * (ARCHITECTURE_CONTRACT §2/§3) -- nothing here touches Three.js, a DOM
 * object, or any renderer state, so it can never violate "simulation must
 * not depend on presentation" (that dependency runs the other way: this
 * file depends on simulation interfaces, never the reverse).
 *
 * The roadmap's own acceptance test -- "Milestone 0 can be completed
 * without debug console commands" -- means every M0 player action needs a
 * real command here, not that this file drives the simulation loop
 * itself (advancing ticks/generating jobs is the SAME manual driving
 * loop every headless acceptance test in this project already performs;
 * there is no automatic systems loop anywhere in the codebase yet -- see
 * P1-18's critic review of `SimulationRunner.ts`).
 */
export class TextUI {
  private readonly world: World;
  private readonly water: WaterField;
  private readonly viewportRadius: number;

  /** [0, 1] real, clamped column position -- "camera navigation," not a visual transform. */
  cameraX: number;
  cameraZ: number;

  /** The currently selected entity, if any -- real UI-owned state (never simulation state; deselecting/reselecting has no effect on `world` itself, matching Law 2's "renderer/UI only observe state"). */
  private selectedEntityId: EntityId | undefined;

  constructor(world: World, water: WaterField, viewportRadius = 8) {
    this.world = world;
    this.water = water;
    this.viewportRadius = viewportRadius;
    this.cameraX = Math.floor(world.grid.dims.sizeX / 2);
    this.cameraZ = Math.floor(world.grid.dims.sizeZ / 2);
  }

  // ---- pause / speed controls ----

  /** `SimulationClock.pause` is literally "the explicit state the UI should drive" per that method's own doc comment, written at P0-01 time. */
  pause(): void {
    this.world.clock.pause();
  }

  resume(): void {
    this.world.clock.resume();
  }

  setSpeed(multiplier: number): void {
    this.world.clock.setSpeed(multiplier);
  }

  get isPaused(): boolean {
    return this.world.clock.isPaused;
  }

  get speed(): number {
    return this.world.clock.speed;
  }

  // ---- camera navigation ----

  /** Moves the camera by a real column offset, clamped to the map's own bounds (never off-map, never a wraparound). */
  moveCamera(dx: number, dz: number): void {
    const dims = this.world.grid.dims;
    this.cameraX = clampInt(this.cameraX + dx, 0, dims.sizeX - 1);
    this.cameraZ = clampInt(this.cameraZ + dz, 0, dims.sizeZ - 1);
  }

  setCameraPosition(x: number, z: number): void {
    const dims = this.world.grid.dims;
    this.cameraX = clampInt(x, 0, dims.sizeX - 1);
    this.cameraZ = clampInt(z, 0, dims.sizeZ - 1);
  }

  /**
   * A real ASCII top-down slice of live world state within
   * `viewportRadius` columns of the camera, one row per `z`, one
   * character per `x`, clipped to the map's own bounds -- derived fresh
   * from `WorldGrid`/`WaterField`/`EntityIdRegistry` every call, never a
   * cached/stale render (the same "discover from live state" discipline
   * this codebase uses everywhere else). Legend, checked in priority
   * order per column: `B` a live beaver stands there, `T` a live tree,
   * `~` real standing water (`WaterField.depthAt > 0`) with no beaver/
   * tree occupying it, `.` real dry ground, ` ` no real ground at all
   * (an ungenerated/off-map column).
   */
  renderViewport(): string {
    const dims = this.world.grid.dims;
    const minX = Math.max(0, this.cameraX - this.viewportRadius);
    const maxX = Math.min(dims.sizeX - 1, this.cameraX + this.viewportRadius);
    const minZ = Math.max(0, this.cameraZ - this.viewportRadius);
    const maxZ = Math.min(dims.sizeZ - 1, this.cameraZ + this.viewportRadius);

    const rows: string[] = [];
    for (let z = minZ; z <= maxZ; z++) {
      let row = "";
      for (let x = minX; x <= maxX; x++) {
        row += this.viewportGlyphAt(x, z);
      }
      rows.push(row);
    }
    return rows.join("\n");
  }

  private viewportGlyphAt(x: number, z: number): string {
    const groundY = this.world.grid.surfaceY(x, z);
    if (groundY === undefined) return " ";
    const occupants = this.world.grid.entitiesAt(x, groundY + 1, z);
    for (const id of occupants) {
      if (this.world.entities.kindOf(id) === "beaver") return "B";
    }
    for (const id of occupants) {
      if (this.world.entities.kindOf(id) === "tree") return "T";
    }
    if (this.water.depthAt(x, z) > 0) return "~";
    return ".";
  }

  // ---- select / inspect ----

  /** Selects a live entity of kind `"beaver"` -- the roadmap's "select/inspect beaver" bullet, kept a distinct, validated command from `selectObject` (below) so a UI caller can't accidentally select a log/tree/construction through the beaver-specific affordance. */
  selectBeaver(id: EntityId): void {
    if (this.world.entities.kindOf(id) !== "beaver") {
      throw new RangeError(`entity ${id} is not a beaver -- cannot select it as one`);
    }
    this.selectedEntityId = id;
  }

  /** Selects any non-beaver entity -- the roadmap's "inspect object" bullet (a log, tree, construction, fish, household, ...). Deliberately does not require the entity to still be LIVE: inspecting a destroyed entity's final recorded state (e.g. a felled tree, a completed-then-cancelled construction) is a legitimate use, matching `inspectEntity`'s own `live: false` support. */
  selectObject(id: EntityId): void {
    if (this.world.entities.kindOf(id) === "beaver") {
      throw new RangeError(`entity ${id} is a beaver -- use selectBeaver, not selectObject`);
    }
    this.selectedEntityId = id;
  }

  deselect(): void {
    this.selectedEntityId = undefined;
  }

  get selected(): EntityId | undefined {
    return this.selectedEntityId;
  }

  /** Full raw authoritative state for whichever entity is currently selected -- P0-12's `inspectEntity`, exactly the mechanism its own doc comment named this task as the intended caller of. */
  inspectSelected(): EntityInspection {
    if (this.selectedEntityId === undefined) {
      throw new RangeError("nothing is currently selected -- call selectBeaver/selectObject first");
    }
    return inspectEntity(this.world, this.selectedEntityId);
  }

  /**
   * The roadmap's "inspect tile/water" bullet -- a column-level query
   * P0-12's own `inspectCell` deliberately left out (that file's doc
   * comment explicitly named "water" as future UI work, not something it
   * attempts). Composes `inspectCell` (the ground cell's own
   * material/solidity, at `groundY` itself) with a separate live entity
   * query at `groundY + 1` (the SAME "standing on top of the ground"
   * convention every spawn function in this codebase already uses --
   * `spawnBeaver`/`spawnTree`/`viewportGlyphAt` above -- so `occupantIds`
   * actually finds the beavers/trees/items standing on this tile, not the
   * ground cell's own, ordinarily-empty `entityIds`) and `WaterField.depthAt`
   * (P1-02). Reads three already-real sources, invents none, matching
   * this project's "UI only observes, never owns, simulation state"
   * discipline (Law 2).
   */
  inspectTile(x: number, z: number): TileInspection {
    const groundY = this.world.grid.surfaceY(x, z);
    const cell = groundY !== undefined ? inspectCell(this.world, x, groundY, z) : undefined;
    const occupantIds = groundY !== undefined ? this.world.grid.entitiesAt(x, groundY + 1, z) : [];
    return { x, z, groundY, cell, occupantIds, waterDepth: this.water.depthAt(x, z) };
  }

  // ---- designate ----

  /** The roadmap's "designate tree cutting" bullet -- a thin, direct pass-through to P1-08's own `designateTreeCut`; this file invents no new designation logic. */
  designateTreeCutting(treeId: EntityId): EntityId {
    return designateTreeCut(this.world, treeId);
  }

  /** The roadmap's "designate construction" bullet -- a thin, direct pass-through to P1-10's own `designateConstruction`. */
  designateConstruction(kind: ConstructionKind, site: ColumnCoordinate): EntityId {
    return designateConstructionSim(this.world, kind, site);
  }

  // ---- alerts ----

  /**
   * The roadmap's "alerts" bullet -- a real, derived list of noteworthy
   * conditions read fresh from live simulation state every call, never a
   * manually-pushed message queue (AGENTS.md Law 1.1: a "systems, not
   * scripted outcomes" alert list must be computed from real state, not
   * authored). Two real signals exist in the simulation today to derive
   * alerts from without inventing a new one: `Needs`'s own urgency
   * threshold (`NEED_URGENT_THRESHOLD`, the exact value
   * `BeaverNeeds.decideIntent` already uses to decide a beaver must act)
   * for hunger/thirst/fatigue -- deliberately NOT `thermalComfort`, since
   * `BeaverNeeds.ts`'s own doc comment states outright that
   * "`thermalComfort` never drives an intent," so treating it as urgent
   * here would invent a semantics the simulation itself doesn't have --
   * and the real, physical presence of a `"corpse"` entity (P1-16's
   * `die()`) for "a beaver died." Both are genuinely live-derived: an
   * alert disappears the instant its underlying condition does (a fed
   * beaver, a cleared-away corpse), never a persistent flag this file
   * would have to remember to clear itself.
   */
  alerts(): Alert[] {
    const result: Alert[] = [];
    for (const id of this.world.entities.liveIdsOfKind("beaver")) {
      const needs = getNeeds(this.world.components, id);
      if (needs === undefined) continue;
      const name = getIdentity(this.world.components, id)?.name ?? `beaver ${id}`;
      for (const field of URGENT_NEED_FIELDS) {
        if (needs[field] >= NEED_URGENT_THRESHOLD) {
          result.push({ kind: "urgent-need", entityId: id, message: `${name} has urgent ${field} (${needs[field].toFixed(2)})` });
        }
      }
    }
    for (const id of this.world.entities.liveIdsOfKind("corpse")) {
      // P2-15's `die()` now always auto-creates real body-handling work the
      // instant a corpse exists (`Burial.ts`) -- a corpse is never
      // literally unattended in the job-board sense anymore, only not yet
      // buried, so this message says exactly that rather than implying
      // nobody has responded at all.
      result.push({ kind: "beaver-died", entityId: id, message: `A corpse (entity ${id}) has not yet been buried` });
    }
    return result;
  }

  // ---- population panel ----

  /**
   * P2-16's "colony population UI": ONE composed, real, live-derived view
   * over the whole colony, answering the roadmap's own literal five-item
   * list -- population, jobs, unmet needs, relationships, and critical
   * blockers -- without inventing a single new mechanism. Every field is
   * a thin pass-through to an already-real, already-tested simulation
   * query (`JobBoard.currentJobOf`, P1-06 `Needs`, P2-14 `deriveMood`,
   * P1-19 `Relationships`/household membership, this same file's own
   * `alerts()`), matching every other `TextUI.ts` method's "compose,
   * never own, simulation state" discipline (Law 2). Recomputed fresh on
   * every call, never cached -- a beaver that just finished eating or
   * just got assigned a job is reflected the very next call.
   *
   * `beavers[].blockers` is each beaver's OWN alerts (e.g. its own
   * urgent need); `colonyBlockers` is every OTHER alert `alerts()`
   * produces that isn't scoped to any single live beaver -- today, an
   * unburied corpse (P2-15's `"beaver-died"` alert, whose `entityId` is
   * the CORPSE, never a living beaver, so it could never otherwise appear
   * in any per-beaver row). Without this second list, "critical
   * blockers" -- the roadmap's own wording, not qualified "per-beaver" --
   * would be silently incomplete for anyone using this one panel as their
   * whole normal-UI surface.
   */
  populationPanel(): ColonyPopulation {
    const alerts = this.alerts();
    const beaverIds = this.world.entities.liveIdsOfKind("beaver").sort((a, b) => a - b);
    const beaverIdSet = new Set(beaverIds);
    const beavers = beaverIds.map((beaverId): PopulationEntry => {
      const identity = getIdentity(this.world.components, beaverId);
      const lifeStageState = getLifeStage(this.world.components, beaverId);
      const jobId = currentJobOf(this.world.entities, this.world.components, beaverId);
      let jobStatus: Job["status"] | undefined;
      let designationKind: string | undefined;
      if (jobId !== undefined) {
        const job = getJob(this.world.components, jobId)!;
        jobStatus = job.status;
        designationKind = getDesignation(this.world.components, job.designationId)?.kind;
      }
      const needs = getNeeds(this.world.components, beaverId);
      const urgentNeeds = needs === undefined ? [] : URGENT_NEED_FIELDS.filter((field) => needs[field] >= NEED_URGENT_THRESHOLD);
      const householdId = getHouseholdMembership(this.world.components, beaverId)?.householdId;
      const relationships = getRelationships(this.world.components, beaverId)?.edges ?? [];
      return {
        beaverId,
        name: identity?.name ?? `beaver ${beaverId}`,
        ...(lifeStageState === undefined ? {} : { lifeStage: lifeStageState.stage }),
        ...(jobId === undefined ? {} : { jobId, jobStatus: jobStatus!, ...(designationKind === undefined ? {} : { designationKind }) }),
        // Shallow copies -- both `Needs` and `RelationshipEdge` are flat
        // value objects (P0-03's own JSON-plain component contract), so a
        // shallow copy is a full defensive copy here. Without this, a UI
        // caller mutating a returned row (`entry.needs.hunger = 0`) would
        // silently rewrite live `ComponentStore` state with no
        // validation and no event trail -- exactly the unaudited-write
        // risk `DebugInspector.ts`'s own `deepCopyJsonPlain` exists to
        // prevent (its doc comment states the same guarantee this method
        // now matches).
        ...(needs === undefined ? {} : { needs: { ...needs } }),
        urgentNeeds,
        mood: deriveMood(this.world, beaverId).mood,
        relationships: relationships.map((edge) => ({ ...edge })),
        ...(householdId === undefined ? {} : { householdId }),
        blockers: alerts.filter((alert) => alert.entityId === beaverId),
      };
    });
    const colonyBlockers = alerts.filter((alert) => !beaverIdSet.has(alert.entityId));
    return { beavers, colonyBlockers };
  }
}

const URGENT_NEED_FIELDS: Array<"hunger" | "thirst" | "fatigue"> = ["hunger", "thirst", "fatigue"];

export type AlertKind = "urgent-need" | "beaver-died";

export interface Alert {
  kind: AlertKind;
  entityId: EntityId;
  message: string;
}

export interface ColonyPopulation {
  beavers: PopulationEntry[];
  /** Every `alerts()` entry not scoped to any single live beaver -- e.g. an unburied corpse. See `populationPanel`'s own doc comment. */
  colonyBlockers: Alert[];
}

export interface PopulationEntry {
  beaverId: EntityId;
  name: string;
  /** Absent for a beaver with no `LifeStage` state -- see `Aging.ts`'s own documented deferral for starting/ad-hoc beavers. */
  lifeStage?: LifeStage;
  jobId?: EntityId;
  jobStatus?: Job["status"];
  /** The underlying designation's raw `kind` string (e.g. `"cut-tree"`, `"bury-corpse"`) -- absent only if the job's own designation was somehow destroyed out from under it. */
  designationKind?: string;
  /** Absent only for a beaver with no `Needs` component at all (never true for an ordinarily-spawned beaver). */
  needs?: Needs;
  urgentNeeds: Array<"hunger" | "thirst" | "fatigue">;
  /** P2-14's live-derived `[-1, 1]` mood -- always computable for a live beaver (falls back to neutral baseline traits if none were assigned). */
  mood: number;
  relationships: RelationshipEdge[];
  householdId?: EntityId;
  /** This beaver's own subset of `alerts()` -- the roadmap's "critical blockers," filtered to the ones concerning THIS specific beaver. */
  blockers: Alert[];
}

export interface TileInspection {
  x: number;
  z: number;
  /** The column's real ground elevation, or `undefined` if this column has no ground at all (an ungenerated/off-map tile). */
  groundY: number | undefined;
  cell: ReturnType<typeof inspectCell> | undefined;
  /** Entities standing ON this tile (at `groundY + 1`), distinct from `cell.entityIds` -- see `inspectTile`'s own doc comment. Empty when `groundY` is undefined. */
  occupantIds: EntityId[];
  waterDepth: number;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

// Re-exported so a UI caller never needs to reach into `src/sim` directly
// for these two simple, JSON-plain lookup types.
export type { MaterialId };
