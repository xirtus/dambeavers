import { ComponentStore, defineComponent, type ComponentType } from "../core/ComponentStore.js";
import type { EntityId } from "../core/EntityId.js";
import type { ColumnCoordinate } from "../hydrology/WaterField.js";
import type { World } from "../persistence/WorldSnapshot.js";

/**
 * P1-07's job/order architecture, stage 1 (AGENTS.md Law 1.5 /
 * ARCHITECTURE_CONTRACT §10): "Designation / system need." A player's
 * persistent intent -- "go here," and, once later tasks exist, "cut this
 * tree," "build this wall" -- represented as a real entity (kind
 * `"designation"`, P0-02 identity) rather than a transient request
 * object, precisely so it OUTLIVES whatever worker is currently assigned
 * to it (this task's own literal acceptance test). `kind` is an open
 * string, matching `EntityKind`'s own "properties, not identity"
 * extensibility (P0-07's precedent): a future designation kind never
 * requires editing this file, only `Job.ts`'s `generateJobs` to know how
 * to expand it.
 *
 * Deliberately just `"go-to"` is meaningfully implemented today (Job.ts's
 * `generateJobs`) -- P1-08/P1-09/P1-10 (tree cutting, hauling,
 * construction) will each add their own `kind` and their own
 * `generateJobs` handling when they exist, not before (AGENTS.md Law 10).
 */
export interface Designation {
  kind: string;
  target: ColumnCoordinate;
  status: "active" | "cancelled" | "completed";
}
export const DesignationComponent: ComponentType<Designation> = defineComponent<Designation>("designation");

export function assertValidDesignation(designation: Designation): void {
  if (designation.kind.trim().length === 0) {
    throw new RangeError(`designation kind must be non-empty, got ${JSON.stringify(designation.kind)}`);
  }
  if (!Number.isInteger(designation.target.x) || !Number.isInteger(designation.target.z)) {
    throw new RangeError(`designation target must have integer coordinates, got ${JSON.stringify(designation.target)}`);
  }
  if (designation.status !== "active" && designation.status !== "cancelled" && designation.status !== "completed") {
    throw new RangeError(`designation status must be "active", "cancelled", or "completed", got ${JSON.stringify(designation.status)}`);
  }
}

export function setDesignation(components: ComponentStore, id: EntityId, designation: Designation): void {
  assertValidDesignation(designation);
  components.set(id, DesignationComponent, designation);
}

export function getDesignation(components: ComponentStore, id: EntityId): Designation | undefined {
  const designation = components.get(id, DesignationComponent);
  if (designation !== undefined) assertValidDesignation(designation);
  return designation;
}

/** Creates one designation entity: a real, permanently-identified order (P0-02) that exists independently of any worker. */
export function createDesignation(world: World, kind: string, target: ColumnCoordinate): EntityId {
  const id = world.entities.create("designation");
  setDesignation(world.components, id, { kind, target, status: "active" });
  return id;
}
