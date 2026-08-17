import { ComponentStore, defineComponent, type ComponentType } from "../core/ComponentStore.js";
import type { EntityId } from "../core/EntityId.js";
import type { ColumnCoordinate, WaterField } from "../hydrology/WaterField.js";
import type { World } from "../persistence/WorldSnapshot.js";

/**
 * P3-15: a real, physical water wheel (kind `"water-wheel"`, P0-02
 * identity) placed at a site with a chosen downstream neighbor -- power
 * output (`waterWheelPowerOutput`, below) is a formula over REAL,
 * already-existing `WaterField` state (upstream depth, and the head
 * difference to the downstream column), never an invented "generates N
 * power" constant. A wheel over a dry or perfectly flat stretch of water
 * produces genuinely zero power, exactly as a real one would.
 */
export interface WaterWheel {
  site: ColumnCoordinate;
  downstreamSite: ColumnCoordinate;
}
export const WaterWheelComponent: ComponentType<WaterWheel> = defineComponent<WaterWheel>("water-wheel");

export function assertValidWaterWheel(wheel: WaterWheel): void {
  if (!Number.isInteger(wheel.site.x) || !Number.isInteger(wheel.site.z)) {
    throw new RangeError(`water wheel site must have integer coordinates, got ${JSON.stringify(wheel.site)}`);
  }
  if (!Number.isInteger(wheel.downstreamSite.x) || !Number.isInteger(wheel.downstreamSite.z)) {
    throw new RangeError(`water wheel downstreamSite must have integer coordinates, got ${JSON.stringify(wheel.downstreamSite)}`);
  }
  const dx = Math.abs(wheel.site.x - wheel.downstreamSite.x);
  const dz = Math.abs(wheel.site.z - wheel.downstreamSite.z);
  if (dx + dz !== 1) throw new RangeError("water wheel downstreamSite must be orthogonally adjacent to site");
}

export function setWaterWheel(components: ComponentStore, id: EntityId, wheel: WaterWheel): void {
  assertValidWaterWheel(wheel);
  components.set(id, WaterWheelComponent, wheel);
}

export function getWaterWheel(components: ComponentStore, id: EntityId): WaterWheel | undefined {
  const wheel = components.get(id, WaterWheelComponent);
  if (wheel !== undefined) assertValidWaterWheel(wheel);
  return wheel;
}

export function createWaterWheel(world: World, site: ColumnCoordinate, downstreamSite: ColumnCoordinate): EntityId {
  if (world.grid.surfaceY(site.x, site.z) === undefined) throw new RangeError(`site (${site.x}, ${site.z}) has no ground -- cannot place a water wheel there`);
  const id = world.entities.create("water-wheel");
  setWaterWheel(world.components, id, { site, downstreamSite });
  return id;
}

/** Real power output, in an arbitrary but consistent [0, +inf) unit, derived from the flow head (upstream minus downstream depth, floored at 0) and how much upstream water is actually available to fall through that head. Plausible, tunable coefficient. */
export const WATER_POWER_COEFFICIENT = 2;

export function waterWheelPowerOutput(water: WaterField, wheel: WaterWheel): number {
  const upstreamDepth = water.depthAt(wheel.site.x, wheel.site.z);
  const downstreamDepth = water.depthAt(wheel.downstreamSite.x, wheel.downstreamSite.z);
  const head = Math.max(0, upstreamDepth - downstreamDepth);
  return Math.min(upstreamDepth, head) * WATER_POWER_COEFFICIENT;
}
