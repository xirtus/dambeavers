import { ComponentStore, defineComponent, type ComponentType } from "../core/ComponentStore.js";
import type { EntityId } from "../core/EntityId.js";
import type { EventId } from "../history/EventLog.js";
import type { MaterialRegistry } from "../materials/Material.js";
import type { World } from "../persistence/WorldSnapshot.js";
import { setGood } from "../economy/Good.js";
import { qualityOf } from "../economy/Craft.js";
import type { RecipeDefinition } from "../economy/Recipe.js";

/**
 * P5-09: a real crafted `Good` (P3-01, `goodKind: "artwork"`) that
 * ADDITIONALLY carries a `Depiction` -- a stable reference to something
 * that genuinely exists/happened in THIS world: a real beaver/animal
 * entity id, a real construction entity id, or a real `EventId`. Never a
 * generated, disconnected image description -- `assertValidDepiction`
 * requires the referenced id to be real (a known entity, or a real
 * recorded event) at creation time.
 */
export type DepictionKind = "beaver" | "animal" | "construction" | "event";
const VALID_DEPICTION_KINDS: readonly DepictionKind[] = ["beaver", "animal", "construction", "event"];

export interface Depiction {
  kind: DepictionKind;
  id: number;
}
export const DepictionComponent: ComponentType<Depiction> = defineComponent<Depiction>("depiction");

export function assertValidDepiction(depiction: Depiction): void {
  if (!VALID_DEPICTION_KINDS.includes(depiction.kind)) {
    throw new RangeError(`depiction kind must be one of ${VALID_DEPICTION_KINDS.join(", ")}, got ${JSON.stringify(depiction.kind)}`);
  }
  if (!Number.isInteger(depiction.id) || depiction.id < 1) {
    throw new RangeError(`depiction id must be a positive integer, got ${depiction.id}`);
  }
}

export function setDepiction(components: ComponentStore, artworkId: EntityId, depiction: Depiction): void {
  assertValidDepiction(depiction);
  components.set(artworkId, DepictionComponent, depiction);
}

export function getDepiction(components: ComponentStore, artworkId: EntityId): Depiction | undefined {
  const depiction = components.get(artworkId, DepictionComponent);
  if (depiction !== undefined) assertValidDepiction(depiction);
  return depiction;
}

function isRealDepictionTarget(world: World, depiction: Depiction): boolean {
  if (depiction.kind === "event") return world.events.has(depiction.id as EventId);
  return world.entities.isKnown(depiction.id as EntityId);
}

/**
 * Creates a real physical artwork `Good` depicting `depiction`, made by
 * `makerId` of `materialId` -- quality reuses `Craft.ts`'s own `qualityOf`
 * formula (P3-17, unmodified) so an artwork's own quality is the SAME
 * skill/material/process formula every other crafted good already uses,
 * not a separate art-specific quality system. Throws if `depiction`
 * doesn't resolve to something genuinely real (Law 1.6/Law 4: art can
 * only depict what actually exists or happened).
 */
export function createArtwork(
  world: World,
  materials: MaterialRegistry,
  recipe: RecipeDefinition,
  massKg: number,
  depiction: Depiction,
  makerId: EntityId,
  position: { x: number; y: number; z: number },
): EntityId {
  assertValidDepiction(depiction);
  if (!isRealDepictionTarget(world, depiction)) {
    throw new RangeError(`depiction target (${depiction.kind} #${depiction.id}) does not exist -- an artwork cannot depict it`);
  }
  const artworkId = world.entities.create("good");
  world.grid.setEntityPosition(artworkId, position.x, position.y, position.z);
  const quality = qualityOf(materials, world.components, makerId, recipe);
  const materialId = recipe.outputMaterialId ?? recipe.inputMaterialId;
  setGood(world.components, artworkId, { goodKind: "artwork", materialId, massKg, quality, makerId, value: massKg * (0.5 + quality) * 5 });
  setDepiction(world.components, artworkId, depiction);
  return artworkId;
}
