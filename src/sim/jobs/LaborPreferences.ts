import { ComponentStore, defineComponent, type ComponentType } from "../core/ComponentStore.js";
import type { EntityId } from "../core/EntityId.js";
import { getDesignation } from "./Designation.js";
import { getJob } from "./Job.js";

/**
 * P2-02's persistent worker-side labor policy. This is not job
 * assignment: it never names a specific job id, worker id, or target.
 * The job board still performs ordinary availability, reachability,
 * distance, and deterministic tie-breaking; this component only answers
 * whether a beaver may perform a labor kind and how strongly that beaver
 * prefers one allowed kind over another.
 */
export type LaborKind = string;

export interface LaborPreferences {
  /**
   * If true, labor kinds not explicitly listed remain allowed. If false,
   * only `allowedLaborKinds` are allowed. Missing component = all allowed.
   */
  allowUnlisted: boolean;
  allowedLaborKinds: readonly LaborKind[];
  /**
   * Higher numbers win before distance in `selectJob`; absent priorities
   * default to 1. A value of 0 is valid: allowed, but lowest priority.
   */
  priorityByLaborKind: Readonly<Record<LaborKind, number>>;
}
export const LaborPreferencesComponent: ComponentType<LaborPreferences> = defineComponent<LaborPreferences>("labor-preferences");

const LABOR_KIND_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

function assertLaborKind(kind: unknown, label: string): void {
  if (typeof kind !== "string") {
    throw new RangeError(`${label} must be a string, got ${JSON.stringify(kind)}`);
  }
  if (!LABOR_KIND_PATTERN.test(kind)) {
    throw new RangeError(`${label} must be lowercase kebab-case, got ${JSON.stringify(kind)}`);
  }
}

function uniqueSortedLaborKinds(kinds: readonly LaborKind[], label: string): LaborKind[] {
  if (!Array.isArray(kinds)) throw new RangeError(`${label} must be an array`);
  const out = new Set<LaborKind>();
  for (const kind of kinds) {
    assertLaborKind(kind, label);
    out.add(kind);
  }
  return [...out].sort();
}

function normalizePreferences(preferences: LaborPreferences): LaborPreferences {
  if (preferences === null || typeof preferences !== "object") throw new RangeError("labor preferences must be an object");
  if (typeof preferences.allowUnlisted !== "boolean") {
    throw new RangeError(`labor preferences allowUnlisted must be boolean, got ${JSON.stringify(preferences.allowUnlisted)}`);
  }
  if (preferences.priorityByLaborKind === null || typeof preferences.priorityByLaborKind !== "object" || Array.isArray(preferences.priorityByLaborKind)) {
    throw new RangeError("labor preferences priorityByLaborKind must be a plain object");
  }
  const priorityByLaborKind: Record<LaborKind, number> = {};
  for (const [kind, priority] of Object.entries(preferences.priorityByLaborKind)) {
    assertLaborKind(kind, "priority labor kind");
    if (!(Number.isFinite(priority) && priority >= 0)) {
      throw new RangeError(`labor priority for ${JSON.stringify(kind)} must be a non-negative finite number, got ${priority}`);
    }
    priorityByLaborKind[kind] = priority;
  }
  return {
    allowUnlisted: preferences.allowUnlisted,
    allowedLaborKinds: uniqueSortedLaborKinds(preferences.allowedLaborKinds, "allowedLaborKinds"),
    priorityByLaborKind: Object.fromEntries(Object.entries(priorityByLaborKind).sort(([a], [b]) => a.localeCompare(b))),
  };
}

export function assertValidLaborPreferences(preferences: LaborPreferences): void {
  normalizePreferences(preferences);
}

export function setLaborPreferences(components: ComponentStore, beaverId: EntityId, preferences: LaborPreferences): void {
  const normalized = normalizePreferences(preferences);
  components.set(beaverId, LaborPreferencesComponent, normalized);
}

export function getLaborPreferences(components: ComponentStore, beaverId: EntityId): LaborPreferences | undefined {
  const preferences = components.get(beaverId, LaborPreferencesComponent);
  if (preferences !== undefined) assertValidLaborPreferences(preferences);
  return preferences;
}

export function setAllowedLabors(components: ComponentStore, beaverId: EntityId, allowedLaborKinds: readonly LaborKind[]): void {
  const existing = getLaborPreferences(components, beaverId);
  setLaborPreferences(components, beaverId, {
    allowUnlisted: false,
    allowedLaborKinds,
    priorityByLaborKind: existing?.priorityByLaborKind ?? {},
  });
}

export function setLaborPriority(components: ComponentStore, beaverId: EntityId, laborKind: LaborKind, priority: number): void {
  assertLaborKind(laborKind, "labor kind");
  const existing = getLaborPreferences(components, beaverId) ?? {
    allowUnlisted: true,
    allowedLaborKinds: [],
    priorityByLaborKind: {},
  };
  setLaborPreferences(components, beaverId, {
    ...existing,
    priorityByLaborKind: { ...existing.priorityByLaborKind, [laborKind]: priority },
  });
}

export function laborKindForDesignationKind(designationKind: string): LaborKind {
  if (designationKind === "go-to") return "general";
  if (designationKind === "cut-tree") return "woodcutting";
  if (designationKind === "haul-item") return "hauling";
  if (designationKind.startsWith("construct-")) return "construction";
  if (designationKind === "bury-corpse") return "burial";
  if (designationKind === "dig") return "digging";
  if (designationKind === "craft") return "crafting";
  return designationKind;
}

export function laborKindForJob(components: ComponentStore, jobId: EntityId): LaborKind {
  const job = getJob(components, jobId);
  if (job === undefined) throw new RangeError(`entity ${jobId} has no Job component -- cannot derive labor kind`);
  const designation = getDesignation(components, job.designationId);
  if (designation === undefined) {
    throw new RangeError(`job ${jobId} references missing designation ${job.designationId} -- cannot derive labor kind`);
  }
  return laborKindForDesignationKind(designation.kind);
}

export function isLaborAllowed(components: ComponentStore, beaverId: EntityId, laborKind: LaborKind): boolean {
  assertLaborKind(laborKind, "labor kind");
  const preferences = getLaborPreferences(components, beaverId);
  if (preferences === undefined) return true;
  return preferences.allowUnlisted || preferences.allowedLaborKinds.includes(laborKind);
}

export function isLaborAllowedForJob(components: ComponentStore, beaverId: EntityId, jobId: EntityId): boolean {
  return isLaborAllowed(components, beaverId, laborKindForJob(components, jobId));
}

export function laborPriority(components: ComponentStore, beaverId: EntityId, laborKind: LaborKind): number {
  assertLaborKind(laborKind, "labor kind");
  return getLaborPreferences(components, beaverId)?.priorityByLaborKind[laborKind] ?? 1;
}

export function laborPriorityForJob(components: ComponentStore, beaverId: EntityId, jobId: EntityId): number {
  return laborPriority(components, beaverId, laborKindForJob(components, jobId));
}
