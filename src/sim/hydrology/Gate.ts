import { ComponentStore, defineComponent, type ComponentType } from "../core/ComponentStore.js";
import type { EntityId } from "../core/EntityId.js";
import type { ColumnCoordinate } from "./WaterField.js";
import type { MaterialId } from "../materials/Material.js";
import type { World } from "../persistence/WorldSnapshot.js";

/**
 * P3-12: a controllable physical obstruction -- `Dam.ts`'s own file doc
 * comment applies here verbatim ("this file adds no new hydraulic
 * mechanism of its own"): a gate is real `TerrainField` material at a
 * fixed site/height that `open`/`close` simply adds or removes,
 * letting `Flow.ts`'s already-existing sill-height/permeability formula
 * do everything else. Opening a gate closed with dense, low-permeability
 * material throttles flow exactly as much as removing any other real
 * obstruction would -- P3-12's own literal acceptance test ("opening/
 * closing a physical gate changes flow through ordinary obstruction
 * geometry").
 */
export interface Gate {
  site: ColumnCoordinate;
  y: number;
  materialId: MaterialId;
  isOpen: boolean;
}
export const GateComponent: ComponentType<Gate> = defineComponent<Gate>("gate");

export function assertValidGate(gate: Gate): void {
  if (!Number.isInteger(gate.site.x) || !Number.isInteger(gate.site.z)) {
    throw new RangeError(`gate site must have integer coordinates, got ${JSON.stringify(gate.site)}`);
  }
  if (!Number.isInteger(gate.y)) throw new RangeError(`gate y must be an integer, got ${gate.y}`);
  if (gate.materialId.trim().length === 0) throw new RangeError("gate materialId must be non-empty");
  if (typeof gate.isOpen !== "boolean") throw new RangeError("gate isOpen must be a boolean");
}

export function setGate(components: ComponentStore, id: EntityId, gate: Gate): void {
  assertValidGate(gate);
  components.set(id, GateComponent, gate);
}

export function getGate(components: ComponentStore, id: EntityId): Gate | undefined {
  const gate = components.get(id, GateComponent);
  if (gate !== undefined) assertValidGate(gate);
  return gate;
}

/** Places a new gate at `site`/`y`, starting closed (real material immediately obstructs the sill). Throws if the site has no ground below the gate's own cell (nothing physical to mount a gate frame on) or `y` is already occupied by other real terrain. */
export function createGate(world: World, site: ColumnCoordinate, y: number, materialId: MaterialId): EntityId {
  if (world.grid.surfaceY(site.x, site.z) === undefined && y <= 0) {
    throw new RangeError(`site (${site.x}, ${site.z}) has no ground to mount a gate on`);
  }
  if (world.terrain.materialAt(site.x, y, site.z) !== undefined) {
    throw new RangeError(`cell (${site.x}, ${y}, ${site.z}) is already occupied -- cannot place a gate there`);
  }
  const id = world.entities.create("gate");
  world.terrain.setMaterial(site.x, y, site.z, materialId);
  setGate(world.components, id, { site, y, materialId, isOpen: false });
  return id;
}

/** Opens `gateId`: excavates its real material, freeing the sill (`Flow.ts` sees the change the instant it next runs). Idempotent -- opening an already-open gate is a no-op. */
export function openGate(world: World, gateId: EntityId): void {
  const gate = getGate(world.components, gateId);
  if (gate === undefined) throw new RangeError(`entity ${gateId} has no Gate component -- cannot open it`);
  if (gate.isOpen) return;
  world.terrain.excavate(gate.site.x, gate.y, gate.site.z);
  setGate(world.components, gateId, { ...gate, isOpen: true });
  world.events.record({ tick: world.clock.tick, eventType: "gate-opened", subjectIds: [gateId], objectIds: [], location: { x: gate.site.x, y: gate.y, z: gate.site.z } });
}

/** Closes `gateId`: restores its real material at the sill. Idempotent -- closing an already-closed gate is a no-op. */
export function closeGate(world: World, gateId: EntityId): void {
  const gate = getGate(world.components, gateId);
  if (gate === undefined) throw new RangeError(`entity ${gateId} has no Gate component -- cannot close it`);
  if (!gate.isOpen) return;
  world.terrain.setMaterial(gate.site.x, gate.y, gate.site.z, gate.materialId);
  setGate(world.components, gateId, { ...gate, isOpen: false });
  world.events.record({ tick: world.clock.tick, eventType: "gate-closed", subjectIds: [gateId], objectIds: [], location: { x: gate.site.x, y: gate.y, z: gate.site.z } });
}
