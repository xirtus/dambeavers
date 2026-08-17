import { ComponentStore, defineComponent, type ComponentType } from "../core/ComponentStore.js";
import type { EntityId, EntityIdRegistry } from "../core/EntityId.js";
import type { ColumnCoordinate } from "./WaterField.js";
import type { MaterialId, MaterialRegistry } from "../materials/Material.js";
import type { World } from "../persistence/WorldSnapshot.js";
import { getConstruction } from "../labor/Construction.js";
import { setGood } from "../economy/Good.js";
import { isSupported, hydraulicStress, stressedIntegrity, type StructuralSegmentView } from "../structures/Structural.js";

/**
 * P1-11: turns a completed `"dam-segment"` construction (P1-10) into a
 * real, physical hydraulic obstruction -- by literally raising real
 * `TerrainField` material at the site, one cell per completed segment, and
 * letting `Flow.ts`'s ALREADY-EXISTING sill-height/permeability formula do
 * the rest. This file adds no new hydraulic mechanism of its own: `stepFlow`
 * (P1-03) already derives obstruction from real terrain geometry and reads
 * the sill's own material `permeability` (P0-07) directly from
 * `TerrainField.materialOrAirAt` -- exactly ARCHITECTURE_CONTRACT §12's
 * "dams affect flow through ordinary structure/material properties... Do
 * not implement a `dam complete -> increase pond` rule." Building a dam
 * with wood (permeability 0.15, vs. open air's 1.0) IS what throttles flow;
 * nothing here computes discharge, sill height, or upstream depth itself.
 *
 * The roadmap's five-item list --
 *   geometry / material / permeability / occupied cross-section / structural integrity
 * -- maps onto real, already-existing or newly-real data, not five separate
 * new mechanisms: geometry and occupied cross-section are `site` +
 * `heightCells` (literally how many real terrain cells are filled, i.e.
 * exactly how much of the column's vertical cross-section is blocked);
 * material and permeability are `materialId` plus whatever `MaterialRegistry`
 * already says about it (P0-07, unchanged, already consulted by `Flow.ts`);
 * structural integrity is a real, honestly-inspectable field that is always
 * `1` today -- no decay/damage system exists yet (AGENTS.md Law 10), the
 * same "real hook, honest constant until a driver exists" discipline
 * `TreeCutting.ts`'s `hasTreeCuttingCapability` and `Needs.ts`'s
 * `thermalComfort` baseline already established.
 */
export interface DamSegment {
  site: ColumnCoordinate;
  materialId: MaterialId;
  /** The site's real terrain surfaceY the FIRST time a dam segment was ever built there, before any dam material was added -- the fixed reference point `applyDamSegment`/`removeDamSegmentLayer` build up from and tear down toward, so removal always targets exactly the dam's own added material and never digs into natural terrain. */
  baseY: number;
  /** How many cells of real, solid dam material currently sit above `baseY` at this site -- the dam's actual height today, always exactly matching what's really filled in `TerrainField` (never a separate counter that could drift). */
  heightCells: number;
  /** 0..1; always `1` today (see this file's own top doc comment) -- a real, inspectable field for a future decay/damage system to actually drive down, not a fictional one. */
  structuralIntegrity: number;
}
export const DamSegmentComponent: ComponentType<DamSegment> = defineComponent<DamSegment>("dam-segment");

export function assertValidDamSegment(dam: DamSegment): void {
  if (!Number.isInteger(dam.site.x) || !Number.isInteger(dam.site.z)) {
    throw new RangeError(`dam segment site must have integer coordinates, got ${JSON.stringify(dam.site)}`);
  }
  if (dam.materialId.trim().length === 0) {
    throw new RangeError(`dam segment materialId must be non-empty, got ${JSON.stringify(dam.materialId)}`);
  }
  if (!Number.isInteger(dam.baseY) || dam.baseY < 0) {
    throw new RangeError(`dam segment baseY must be a non-negative integer, got ${dam.baseY}`);
  }
  if (!Number.isInteger(dam.heightCells) || dam.heightCells < 1) {
    throw new RangeError(`dam segment heightCells must be a positive integer, got ${dam.heightCells}`);
  }
  if (!(Number.isFinite(dam.structuralIntegrity) && dam.structuralIntegrity >= 0 && dam.structuralIntegrity <= 1)) {
    throw new RangeError(`dam segment structuralIntegrity must be between 0 and 1, got ${dam.structuralIntegrity}`);
  }
}

export function setDamSegment(components: ComponentStore, id: EntityId, dam: DamSegment): void {
  assertValidDamSegment(dam);
  components.set(id, DamSegmentComponent, dam);
}

export function getDamSegment(components: ComponentStore, id: EntityId): DamSegment | undefined {
  const dam = components.get(id, DamSegmentComponent);
  if (dam !== undefined) assertValidDamSegment(dam);
  return dam;
}

/**
 * Marks a `"dam-segment"` construction entity as already converted into
 * real terrain -- attached to the CONSTRUCTION entity itself (not the
 * `DamSegment` it contributed to), the same "component attached by a
 * different file than the entity's own home module, to mark a
 * cross-cutting fact" pattern `BuildProgress`/`Reservation` already use
 * elsewhere in this codebase. Its sole purpose is `applyDamSegment`'s own
 * idempotency guard, below -- see that function's doc comment for why this
 * exists.
 */
export interface DamApplication {
  damSegmentId: EntityId;
}
export const DamApplicationComponent: ComponentType<DamApplication> = defineComponent<DamApplication>("dam-application");

/** The live `"dam-segment"` entity already occupying `site`, if any -- so a second completed dam-segment construction at the SAME site (P1-10's `designateConstruction` allows reusing a site once the prior construction there is `"complete"`) stacks height onto the existing physical dam rather than creating a second, overlapping one. */
export function findDamSegmentAt(entities: EntityIdRegistry, components: ComponentStore, site: ColumnCoordinate): EntityId | undefined {
  for (const id of entities.liveIdsOfKind("dam-segment")) {
    const dam = getDamSegment(components, id)!;
    if (dam.site.x === site.x && dam.site.z === site.z) return id;
  }
  return undefined;
}

/**
 * Turns a just-completed `"dam-segment"` construction into (or an addition
 * onto) a real physical dam: fills one more real `TerrainField` cell at the
 * site, directly above whatever's currently the topmost dam material there
 * (or, for the first segment at a fresh site, directly above natural
 * terrain). Returns the `DamSegment` entity id (new, or the existing one at
 * this site, now one cell taller). Throws if `constructionId` isn't a
 * genuinely completed `"dam-segment"` construction -- callers should only
 * call this once `tickBuildJob` (P1-10) has actually reported `"built"` for
 * it.
 *
 * Deliberately a separate, explicit call rather than something
 * `Construction.ts`'s own `tickBuildJob` triggers automatically: keeping
 * `Construction.ts` fully generic (it has no idea what a `"dam-segment"`
 * physically does once complete, same as it has no idea what a `"wall"` or
 * `"lodge-segment"` does) versus this file owning exactly the kind-specific
 * physical consequence, mirrors how `ensureMaterialHaul` itself is an
 * explicit per-tick call rather than automatic magic -- no hidden triggers
 * anywhere in this pipeline.
 *
 * Idempotency guard: a `Construction` entity is never destroyed once
 * `"complete"` (`Construction.ts` has no reason to), and `status` alone
 * gives no way to tell "already turned into terrain" from "not yet
 * applied" -- so calling this twice for the SAME `constructionId` would,
 * without a guard, stack a SECOND real terrain cell from wood that was
 * only ever physically consumed once (a genuine Law 1.6 violation:
 * conjuring dam material nobody paid for). `DamApplication` records this
 * fact the moment a construction is actually applied; a second call throws
 * instead of silently fabricating height.
 */
export function applyDamSegment(world: World, constructionId: EntityId): EntityId {
  const construction = getConstruction(world.components, constructionId);
  if (construction === undefined || construction.kind !== "dam-segment" || construction.status !== "complete") {
    throw new RangeError(`construction ${constructionId} is not a completed "dam-segment" construction -- cannot apply it`);
  }
  if (world.components.has(constructionId, DamApplicationComponent)) {
    throw new RangeError(`construction ${constructionId} has already been applied to the terrain -- cannot apply it twice`);
  }
  const { site, requiredMaterialId } = construction;

  const existingId = findDamSegmentAt(world.entities, world.components, site);
  if (existingId !== undefined) {
    const dam = getDamSegment(world.components, existingId)!;
    const newY = dam.baseY + dam.heightCells + 1;
    world.terrain.setMaterial(site.x, newY, site.z, requiredMaterialId);
    setDamSegment(world.components, existingId, { ...dam, heightCells: dam.heightCells + 1 });
    world.components.set(constructionId, DamApplicationComponent, { damSegmentId: existingId });
    recordDamSegmentApplied(world, existingId, constructionId, { x: site.x, y: newY, z: site.z });
    return existingId;
  }

  const baseY = world.grid.surfaceY(site.x, site.z);
  if (baseY === undefined) {
    throw new RangeError(`site (${site.x}, ${site.z}) has no ground -- cannot apply a dam segment there`);
  }
  const damId = world.entities.create("dam-segment");
  setDamSegment(world.components, damId, { site, materialId: requiredMaterialId, baseY, heightCells: 1, structuralIntegrity: 1 });
  world.terrain.setMaterial(site.x, baseY + 1, site.z, requiredMaterialId);
  world.components.set(constructionId, DamApplicationComponent, { damSegmentId: damId });
  recordDamSegmentApplied(world, damId, constructionId, { x: site.x, y: baseY + 1, z: site.z });
  return damId;
}

/**
 * Records the ONE real, discrete, causally-significant fact `applyDamSegment`
 * itself represents -- real terrain material was just added at a real
 * location -- as a real `EventLog` entry (P0-08), the exact "direct cause"
 * P1-22's causal-explanation query needs an antecedent to point back to
 * when tracing "why did water rise here" or "why did this beaver drown."
 * Before P1-22, NOTHING in this file (or `Flow.ts`/`Construction.ts`)
 * recorded any event at all for a hydraulically-significant terrain
 * change -- a real, genuine gap this task's own causal-chain acceptance
 * test surfaced, not scope creep: Law 4 ("causality must be inspectable")
 * already required every important state change to answer "what
 * happened... where and when," and raising real material that measurably
 * throttles flow (ARCHITECTURE_CONTRACT §12) is exactly that kind of
 * change. No new hydraulic mechanism is added here -- `Flow.ts`'s own
 * formula is still what actually raises water level; this is purely a
 * historical record of the terrain change that formula then responds to.
 */
function recordDamSegmentApplied(world: World, damSegmentId: EntityId, constructionId: EntityId, location: { x: number; y: number; z: number }): void {
  world.events.record({
    tick: world.clock.tick,
    eventType: "dam-segment-applied",
    subjectIds: [damSegmentId],
    objectIds: [constructionId],
    location,
  });
}

/**
 * Removes exactly the TOPMOST cell of real dam material at `damId`'s site
 * (excavates it, restoring open cross-section -- `Flow.ts` sees this the
 * instant it next runs, no separate "recompute hydraulics" step needed) and
 * shrinks `heightCells` by one. Once the dam has no material left
 * (`heightCells` would reach `0`), the `DamSegment` entity itself is
 * destroyed rather than left as an empty, meaningless husk. Throws for an
 * entity with no `DamSegment` component.
 */
export function removeDamSegmentLayer(world: World, damId: EntityId): void {
  const dam = getDamSegment(world.components, damId);
  if (dam === undefined) {
    throw new RangeError(`entity ${damId} has no DamSegment component -- cannot remove a layer from it`);
  }
  const topY = dam.baseY + dam.heightCells;
  world.terrain.excavate(dam.site.x, topY, dam.site.z);
  if (dam.heightCells === 1) {
    world.entities.destroy(damId);
    return;
  }
  setDamSegment(world.components, damId, { ...dam, heightCells: dam.heightCells - 1 });
}

function segmentViewOf(id: EntityId, dam: DamSegment): StructuralSegmentView {
  return { id, site: dam.site, y: dam.baseY + dam.heightCells, materialId: dam.materialId };
}

/**
 * P3-10/P3-11 applied to dams: `Bridge.ts`'s own `tickBridgeStructure`
 * doc comment applies here verbatim -- real hydraulic wear from the
 * water currently pressing against the dam (`Structural.hydraulicStress`,
 * over `WaterField.depthAt`) plus a fresh support check chained through
 * every OTHER live dam segment, driving this segment's own
 * `structuralIntegrity` field down (the exact field `applyDamSegment`'s
 * own file doc comment already reserved for "a future decay/damage
 * system to actually drive down" -- this is that system). On failure,
 * removes exactly one top layer (`removeDamSegmentLayer`) rather than
 * the whole stack at once, so a tall dam degrades progressively, and
 * spawns that layer's material back as real physical debris (Law 1.6).
 */
export function tickDamStructure(world: World, materials: MaterialRegistry, damId: EntityId): "intact" | "collapsed" {
  const dam = getDamSegment(world.components, damId);
  if (dam === undefined) return "intact";

  const allSegments: StructuralSegmentView[] = [];
  for (const id of world.entities.liveIdsOfKind("dam-segment")) {
    const other = getDamSegment(world.components, id);
    if (other !== undefined) allSegments.push(segmentViewOf(id, other));
  }

  const stress = hydraulicStress(world.water.depthAt(dam.site.x, dam.site.z));
  const integrity = stressedIntegrity(dam.structuralIntegrity, stress);
  const supported = isSupported(world.grid, materials, allSegments, segmentViewOf(damId, dam));

  if (integrity <= 0 || !supported) {
    const topY = dam.baseY + dam.heightCells;
    const floor = world.grid.surfaceY(dam.site.x, dam.site.z) ?? topY - 1;
    const debrisId = world.entities.create("good");
    world.grid.setEntityPosition(debrisId, dam.site.x, floor + 1, dam.site.z);
    setGood(world.components, debrisId, { goodKind: "debris", materialId: dam.materialId, massKg: 10 });
    removeDamSegmentLayer(world, damId);
    return "collapsed";
  }

  setDamSegment(world.components, damId, { ...dam, structuralIntegrity: integrity });
  return "intact";
}

/** Drives every live dam segment's structural tick once. */
export function tickAllDamStructures(world: World, materials: MaterialRegistry): void {
  for (const damId of world.entities.liveIdsOfKind("dam-segment").sort((a: EntityId, b: EntityId) => a - b)) {
    tickDamStructure(world, materials, damId);
  }
}
