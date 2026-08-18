import { ComponentStore, defineComponent, type ComponentType } from "../core/ComponentStore.js";
import type { EntityId } from "../core/EntityId.js";
import type { World } from "../persistence/WorldSnapshot.js";
import { grantTech, techKnowledgeOf, getTechKnowledge, setTechKnowledge } from "../economy/TechKnowledge.js";

/**
 * P11-17: engineering design knowledge -- structures embody design
 * concepts, and builders can copy, modify, improve, or forget them. A
 * `"design"` entity captures a REAL construction's structural pattern
 * (the component kinds the built entity actually carries, read from the
 * entity itself -- never an authored blueprint), is created at first
 * build, is copyable/learnable through the same knowledge ledger as
 * recipes (P11-09's `TechKnowledge`, extended with `designIds`), and is
 * mutable: a modification produces a real DERIVED design whose lineage
 * names its parent.
 */

export interface DesignPattern {
  /** The component type names the source entity actually carried (the real structural pattern). */
  componentKinds: string[];
  /** The construction kind, where the source was a construction. */
  constructionKind?: string;
  /** The pattern's own dimensions in columns, where the source recorded any. */
  widthX?: number;
  widthZ?: number;
}

export interface Design {
  pattern: DesignPattern;
  /** The design this one was copied or modified FROM -- real lineage, absent for a first-build design. */
  derivedFromDesignId?: EntityId;
  recordedTick: number;
}
export const DesignComponent: ComponentType<Design> = defineComponent<Design>("design");

export function assertValidDesign(design: Design): void {
  if (!Array.isArray(design.pattern.componentKinds) || design.pattern.componentKinds.length === 0) {
    throw new RangeError("design pattern componentKinds must be a non-empty array");
  }
  for (const kind of design.pattern.componentKinds) {
    if (kind.trim().length === 0) throw new RangeError("design pattern componentKinds entries must be non-empty");
  }
  if (design.pattern.constructionKind !== undefined && design.pattern.constructionKind.trim().length === 0) {
    throw new RangeError("design pattern constructionKind must be non-empty when present");
  }
  if (design.derivedFromDesignId !== undefined && (!Number.isInteger(design.derivedFromDesignId) || design.derivedFromDesignId < 1)) {
    throw new RangeError(`design derivedFromDesignId must be a positive integer, got ${design.derivedFromDesignId}`);
  }
  if (!Number.isInteger(design.recordedTick) || design.recordedTick < 0) throw new RangeError(`design recordedTick must be a non-negative integer, got ${design.recordedTick}`);
}

export function setDesign(components: ComponentStore, designId: EntityId, design: Design): void {
  assertValidDesign(design);
  components.set(designId, DesignComponent, design);
}

export function getDesign(components: ComponentStore, designId: EntityId): Design | undefined {
  const design = components.get(designId, DesignComponent);
  if (design !== undefined) assertValidDesign(design);
  return design;
}

/** The design ids a household genuinely holds (P11-09's ledger, extended). */
export function designsOf(world: World, householdId: EntityId): EntityId[] {
  const designs: EntityId[] = [];
  for (const knowledgeId of techKnowledgeOf(world, householdId)) {
    const knowledge = getTechKnowledge(world.components, knowledgeId);
    if (knowledge !== undefined) designs.push(...knowledge.designIds);
  }
  return [...new Set(designs)];
}

export function knowsDesign(world: World, householdId: EntityId, designId: EntityId): boolean {
  return designsOf(world, householdId).includes(designId);
}

/**
 * Records a real design from a really-built structure: the pattern is
 * read from the entity's OWN component types (whatever the build
 * actually produced -- a dam-segment carries its own component set, a
 * workshop carries another), and the household that holds it is the
 * grantee. First build creates the design; nobody gets a design for
 * something that was never built.
 */
export function recordDesign(world: World, builtEntityId: EntityId, householdId: EntityId): EntityId {
  if (!world.entities.isLive(builtEntityId)) throw new RangeError(`entity ${builtEntityId} is not live -- a design must be recorded from a really-built structure`);
  const componentKinds = world.components.typesOf(builtEntityId).map((type) => type.name).sort();
  if (componentKinds.length === 0) throw new RangeError(`entity ${builtEntityId} carries no components -- nothing to record a design from`);
  const constructionKind = componentKinds.includes("construction")
    ? undefined
    : componentKinds.find((kind) => kind.endsWith("-segment")) ?? undefined;
  const designId = world.entities.create("design");
  setDesign(world.components, designId, {
    pattern: { componentKinds, ...(constructionKind !== undefined ? { constructionKind } : {}) },
    recordedTick: world.clock.tick,
  });
  grantTech(world, householdId, { designIds: [designId] });
  world.events.record({
    tick: world.clock.tick,
    eventType: "design-recorded",
    subjectIds: [householdId],
    objectIds: [builtEntityId, designId],
    location: world.grid.positionOf(builtEntityId) ?? { x: 0, y: 0, z: 0 },
    data: { componentKinds },
  });
  return designId;
}

/**
 * A real copy: another household learns a design they genuinely hold a
 * reference to -- the copy is a DERIVED design entity whose lineage
 * names the source (copying is transmission, not re-invention, and the
 * lineage is queryable).
 */
export function copyDesign(world: World, designId: EntityId, toHouseholdId: EntityId): EntityId {
  const source = getDesign(world.components, designId);
  if (source === undefined) throw new RangeError(`entity ${designId} is not a design`);
  const copyId = world.entities.create("design");
  setDesign(world.components, copyId, { pattern: { ...source.pattern }, derivedFromDesignId: designId, recordedTick: world.clock.tick });
  grantTech(world, toHouseholdId, { designIds: [copyId] });
  world.events.record({
    tick: world.clock.tick,
    eventType: "design-copied",
    subjectIds: [toHouseholdId],
    objectIds: [designId, copyId],
    location: { x: 0, y: 0, z: 0 },
  });
  return copyId;
}

/**
 * A real modification: the derived design's pattern changes (dimensions
 * or component set), and the lineage names the parent. The original
 * design is untouched -- improvement derives, it never edits history.
 */
export function modifyDesign(world: World, designId: EntityId, changes: { componentKinds?: string[]; widthX?: number; widthZ?: number }): EntityId {
  const source = getDesign(world.components, designId);
  if (source === undefined) throw new RangeError(`entity ${designId} is not a design`);
  const modifiedId = world.entities.create("design");
  setDesign(world.components, modifiedId, {
    pattern: {
      componentKinds: changes.componentKinds ?? [...source.pattern.componentKinds],
      ...(source.pattern.constructionKind !== undefined ? { constructionKind: source.pattern.constructionKind } : {}),
      ...(changes.widthX !== undefined ? { widthX: changes.widthX } : source.pattern.widthX !== undefined ? { widthX: source.pattern.widthX } : {}),
      ...(changes.widthZ !== undefined ? { widthZ: changes.widthZ } : source.pattern.widthZ !== undefined ? { widthZ: source.pattern.widthZ } : {}),
    },
    derivedFromDesignId: designId,
    recordedTick: world.clock.tick,
  });
  // A derived design is held by everyone who held the parent (a
  // modification of a shared design stays shared).
  for (const knowledgeId of world.entities.liveIdsOfKind("tech-knowledge")) {
    const knowledge = getTechKnowledge(world.components, knowledgeId);
    if (knowledge !== undefined && knowledge.designIds.includes(designId)) {
      setTechKnowledge(world.components, knowledgeId, { ...knowledge, designIds: [...knowledge.designIds, modifiedId] });
    }
  }
  world.events.record({
    tick: world.clock.tick,
    eventType: "design-modified",
    subjectIds: [],
    objectIds: [designId, modifiedId],
    location: { x: 0, y: 0, z: 0 },
    data: { changes: changes.componentKinds ?? "dimensions" },
  });
  return modifiedId;
}

/**
 * Forgetting is real: a household that did not maintain the design
 * loses it from its own ledger (the design entity itself persists in
 * the world -- physical structures built from it remain; only the
 * knowledge is lost, exactly like P11-09's recipes).
 */
export function forgetDesign(world: World, householdId: EntityId, designId: EntityId): void {
  for (const knowledgeId of techKnowledgeOf(world, householdId)) {
    const knowledge = getTechKnowledge(world.components, knowledgeId);
    if (knowledge === undefined) continue;
    if (!knowledge.designIds.includes(designId)) continue;
    setTechKnowledge(world.components, knowledgeId, {
      ...knowledge,
      designIds: knowledge.designIds.filter((id) => id !== designId),
    });
  }
}
