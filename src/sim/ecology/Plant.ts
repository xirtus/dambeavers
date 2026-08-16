import { ComponentStore, defineComponent, type ComponentType } from "../core/ComponentStore.js";
import type { EntityId } from "../core/EntityId.js";
import { massOf, type MaterialId, type MaterialProperties } from "../materials/Material.js";
import type { CellCoordinate, WorldGrid } from "../world/WorldGrid.js";
import type { TerrainField } from "../world/TerrainField.js";
import { growthFraction, trunkVolumeM3, type PlantSpeciesProperties } from "./PlantSpecies.js";

/**
 * A plant/tree's own mutable state, per P0-10's roadmap entry: species
 * (`speciesId`, referencing `PlantSpeciesRegistry`), age, and health.
 * Position lives in `WorldGrid` (P0-05) -- not duplicated here -- and
 * "size"/"wood material"/"harvestable mass" are DERIVED from `speciesId` +
 * `ageTicks` via `trunkVolumeM3`/`harvestableWoodMassKg` below, not
 * separately stored fields that could drift out of sync with age, the
 * same "derive, don't duplicate" choice P0-09 made for terrain solidity.
 */
export interface Plant {
  speciesId: string;
  /** Simulation ticks since this plant was created. Never wall-clock (ARCHITECTURE_CONTRACT §17). */
  ageTicks: number;
  /** [0, 1] fraction, 1 = full health. Not derived from age -- damage/disease (later ecology systems) can reduce it independently of growth. */
  health: number;
}

export const PlantComponent: ComponentType<Plant> = defineComponent<Plant>("plant");

/**
 * Exported so both the write and read paths below can share it (and so
 * any future code with a legitimate reason to construct/inspect a `Plant`
 * value directly can validate it too). `ComponentStore` itself deliberately
 * never validates component VALUES (only id/type existence -- see its own
 * doc comment on the JSON-plain value contract being "a hard convention,"
 * not runtime-enforced, to avoid taxing every `set()`/restore call for a
 * per-domain concern), so this domain-level check is the only place
 * `Plant` data is actually validated. Bypassing `setPlant`/`getPlant`
 * below (e.g. calling `components.set(id, PlantComponent, ...)` directly)
 * skips this entirely -- including on save/restore, where a hand-edited or
 * corrupted snapshot's component values are never re-validated by
 * `ComponentStore.fromSnapshot` either.
 */
export function assertValidPlant(plant: Plant): void {
  if (!Number.isInteger(plant.ageTicks) || plant.ageTicks < 0) {
    throw new RangeError(`plant ageTicks must be a non-negative integer, got ${plant.ageTicks}`);
  }
  if (!(plant.health >= 0) || !(plant.health <= 1)) {
    throw new RangeError(`plant health must be in [0, 1], got ${plant.health}`);
  }
}

/** Validated write path for `Plant` component data. Prefer this over raw `components.set(id, PlantComponent, ...)` so invalid state (negative/fractional age, out-of-range health) is rejected at the point of write instead of silently becoming authoritative state that only fails later, inside some unrelated derived-value call. */
export function setPlant(components: ComponentStore, id: EntityId, plant: Plant): void {
  assertValidPlant(plant);
  components.set(id, PlantComponent, plant);
}

/** Validated read path for `Plant` component data -- re-validates on every read (including data that arrived via `ComponentStore.fromSnapshot`, which `setPlant`'s write-time check never sees), so corrupted state is caught at the first point anything actually looks at it rather than deep inside an unrelated helper. Returns `undefined` if the entity carries no `Plant` component, matching `ComponentStore.get`'s own convention. */
export function getPlant(components: ComponentStore, id: EntityId): Plant | undefined {
  const plant = components.get(id, PlantComponent);
  if (plant !== undefined) assertValidPlant(plant);
  return plant;
}

/**
 * Physical wood mass (kg) this plant would yield if harvested right now --
 * `massOf` (P0-07) applied to its current, growth-scaled trunk volume.
 * Computed fresh from entity state every call, never stored: two trees
 * differ here purely because their species data and/or age differ,
 * satisfying P0-10's acceptance test ("different physical quantities of
 * wood based on entity state rather than a fixed loot table") by
 * construction -- there is no lookup table for this function to consult.
 */
export function harvestableWoodMassKg(species: PlantSpeciesProperties, plant: Plant, wood: MaterialProperties): number {
  assertValidPlant(plant);
  return massOf(wood, trunkVolumeM3(species, plant.ageTicks));
}

/**
 * "Root/soil relation" (P0-10's roadmap wording): whether the cell
 * directly below `cell` currently contains `soilMaterialId`. Not baked in
 * as a hardcoded "soil" string -- the caller supplies which `MaterialId`
 * counts as soil for their world, keeping this a query over real terrain
 * state (P0-09) rather than a scripted assumption. Since `TerrainField`
 * keeps `WorldGrid.solid` genuinely in sync with material presence, this
 * relation changes correctly and automatically if the supporting soil is
 * later excavated -- no separate bookkeeping to keep it accurate.
 */
export function isRootedInSoil(
  grid: WorldGrid,
  terrain: TerrainField,
  cell: CellCoordinate,
  soilMaterialId: MaterialId,
): boolean {
  const below = grid.below(cell.x, cell.y, cell.z);
  if (below === undefined) return false;
  return terrain.materialAt(below.x, below.y, below.z) === soilMaterialId;
}
