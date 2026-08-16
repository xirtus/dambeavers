import { ComponentStore, defineComponent, type ComponentType } from "../core/ComponentStore.js";
import type { EntityId } from "../core/EntityId.js";
import type { MaterialId } from "../materials/Material.js";

/**
 * A physical log -- P1-08's "physical logs generated from tree mass"
 * requirement, satisfied as a real entity (kind `"log"`, P0-02 identity)
 * with real physical properties (AGENTS.md Law 1.6: physical resources
 * are physical, never an invisible integer counter), not a bundled item
 * stack. Position lives in `WorldGrid` (P0-05), not duplicated here --
 * same "derive/store once" precedent as `Plant`'s own doc comment.
 *
 * Deliberately minimal: just `materialId` and `massKg`, the first two of
 * P1-09's own five-item list ("mass, material, location, holder/container
 * relation, reservation state, movement/hauling cost"). "Location" is
 * `WorldGrid` position (already real, not duplicated); the remaining
 * three -- holder/container relation, reservation state, hauling cost --
 * are P1-09's own job (Physical items and hauling), not invented here
 * ahead of that task (AGENTS.md Law 10). A log that has fallen simply
 * sits at its `WorldGrid` position with no holder until P1-09 gives
 * beavers a way to pick one up.
 */
export interface Log {
  materialId: MaterialId;
  massKg: number;
}
export const LogComponent: ComponentType<Log> = defineComponent<Log>("log");

export function assertValidLog(log: Log): void {
  if (log.materialId.trim().length === 0) {
    throw new RangeError(`log materialId must be non-empty, got ${JSON.stringify(log.materialId)}`);
  }
  if (!(Number.isFinite(log.massKg) && log.massKg > 0)) {
    throw new RangeError(`log massKg must be a positive finite number, got ${log.massKg}`);
  }
}

export function setLog(components: ComponentStore, id: EntityId, log: Log): void {
  assertValidLog(log);
  components.set(id, LogComponent, log);
}

export function getLog(components: ComponentStore, id: EntityId): Log | undefined {
  const log = components.get(id, LogComponent);
  if (log !== undefined) assertValidLog(log);
  return log;
}
