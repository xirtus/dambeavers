import { ComponentStore, defineComponent, type ComponentType } from "../core/ComponentStore.js";
import type { EntityId } from "../core/EntityId.js";
import type { ColumnCoordinate } from "../hydrology/WaterField.js";
import type { World } from "../persistence/WorldSnapshot.js";

/**
 * P3-01: a real, physical work site (kind `"workshop"`, P0-02 identity)
 * a recipe can be run at. `workshopKind` is an open string matched
 * against `RecipeDefinition.workshopKind` (P3-02) -- adding a new
 * workshop kind is a data change (define recipes that name it), never a
 * code change to this file or `Craft.ts`.
 */
export interface Workshop {
  workshopKind: string;
  site: ColumnCoordinate;
}
export const WorkshopComponent: ComponentType<Workshop> = defineComponent<Workshop>("workshop");

const WORKSHOP_KIND_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

export function assertValidWorkshop(workshop: Workshop): void {
  if (!WORKSHOP_KIND_PATTERN.test(workshop.workshopKind)) {
    throw new RangeError(`workshop workshopKind must be non-empty lowercase kebab-case, got ${JSON.stringify(workshop.workshopKind)}`);
  }
  if (!Number.isInteger(workshop.site.x) || !Number.isInteger(workshop.site.z)) {
    throw new RangeError(`workshop site must have integer coordinates, got ${JSON.stringify(workshop.site)}`);
  }
}

export function setWorkshop(components: ComponentStore, id: EntityId, workshop: Workshop): void {
  assertValidWorkshop(workshop);
  components.set(id, WorkshopComponent, workshop);
}

export function getWorkshop(components: ComponentStore, id: EntityId): Workshop | undefined {
  const workshop = components.get(id, WorkshopComponent);
  if (workshop !== undefined) assertValidWorkshop(workshop);
  return workshop;
}

/** Places a new workshop of `workshopKind` at `site`. Throws if the site has no real ground. */
export function createWorkshop(world: World, workshopKind: string, site: ColumnCoordinate): EntityId {
  if (world.grid.surfaceY(site.x, site.z) === undefined) {
    throw new RangeError(`site (${site.x}, ${site.z}) has no ground -- cannot place a workshop there`);
  }
  const id = world.entities.create("workshop");
  setWorkshop(world.components, id, { workshopKind, site });
  return id;
}
