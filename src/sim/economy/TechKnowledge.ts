import { ComponentStore, defineComponent, type ComponentType } from "../core/ComponentStore.js";
import type { EntityId } from "../core/EntityId.js";
import type { World } from "../persistence/WorldSnapshot.js";

/**
 * P11-09: technological knowledge as culture -- what a settlement can
 * BUILD is what that settlement has genuinely discovered or learned,
 * never what the player's recipe book knows. A `"tech-knowledge"`
 * entity (durable-concept-gets-identity, like `Belief`) names the real
 * recipes and construction kinds its holding households understand, in
 * the same `heldBy...Ids` shape `Belief.ts` established. `Craft.ts`
 * execution is gated on it (a beaver whose household lacks the recipe
 * is not eligible for the job), and knowledge propagates the same way
 * every other kind of knowledge does -- a real teaching act between
 * households (P11-06's route family), not a global unlock.
 */

export interface TechKnowledge {
  recipeIds: string[];
  /** Real construction/structure kinds understood (e.g. "dam-segment", "bridge-segment") -- the P11-11 infrastructure-memory gate reads this. */
  understoodKinds: string[];
  /** Design entities the household holds (P11-17) -- engineering knowledge is culture too. */
  designIds: EntityId[];
  heldByHouseholdIds: EntityId[];
  learnedTick: number;
}
export const TechKnowledgeComponent: ComponentType<TechKnowledge> = defineComponent<TechKnowledge>("tech-knowledge");

export function assertValidTechKnowledge(knowledge: TechKnowledge): void {
  if (!Array.isArray(knowledge.recipeIds)) throw new RangeError("tech-knowledge recipeIds must be an array");
  for (const recipeId of knowledge.recipeIds) {
    if (recipeId.trim().length === 0) throw new RangeError("tech-knowledge recipeIds entries must be non-empty");
  }
  if (!Array.isArray(knowledge.understoodKinds)) throw new RangeError("tech-knowledge understoodKinds must be an array");
  if (!Array.isArray(knowledge.designIds)) throw new RangeError("tech-knowledge designIds must be an array");
  for (const designId of knowledge.designIds) {
    if (!Number.isInteger(designId) || designId < 1) throw new RangeError(`tech-knowledge designIds entries must be positive integers, got ${JSON.stringify(designId)}`);
  }
  if (!Array.isArray(knowledge.heldByHouseholdIds)) throw new RangeError("tech-knowledge heldByHouseholdIds must be an array");
  for (const householdId of knowledge.heldByHouseholdIds) {
    if (!Number.isInteger(householdId) || householdId < 1) throw new RangeError(`tech-knowledge heldByHouseholdIds entries must be positive integers, got ${JSON.stringify(householdId)}`);
  }
  if (!Number.isInteger(knowledge.learnedTick) || knowledge.learnedTick < 0) throw new RangeError(`tech-knowledge learnedTick must be a non-negative integer, got ${knowledge.learnedTick}`);
}

export function setTechKnowledge(components: ComponentStore, knowledgeId: EntityId, knowledge: TechKnowledge): void {
  assertValidTechKnowledge(knowledge);
  components.set(knowledgeId, TechKnowledgeComponent, knowledge);
}

export function getTechKnowledge(components: ComponentStore, knowledgeId: EntityId): TechKnowledge | undefined {
  const knowledge = components.get(knowledgeId, TechKnowledgeComponent);
  if (knowledge !== undefined) assertValidTechKnowledge(knowledge);
  return knowledge;
}

/** Every tech-knowledge entity `householdId` holds -- discovered fresh, never cached (the `beliefsOf` pattern). */
export function techKnowledgeOf(world: World, householdId: EntityId): EntityId[] {
  return world.entities
    .liveIdsOfKind("tech-knowledge")
    .filter((id) => getTechKnowledge(world.components, id)?.heldByHouseholdIds.includes(householdId) ?? false);
}

/** Does `householdId` genuinely know `recipeId`? A household with no tech-knowledge entities knows nothing (an isolated settlement builds nothing it never learned). */
export function knowsRecipe(world: World, householdId: EntityId, recipeId: string): boolean {
  return techKnowledgeOf(world, householdId).some((id) => getTechKnowledge(world.components, id)?.recipeIds.includes(recipeId) ?? false);
}

/** Does `householdId` genuinely understand construction `kind`? (The P11-11 repair gate.) */
export function understandsKind(world: World, householdId: EntityId, kind: string): boolean {
  return techKnowledgeOf(world, householdId).some((id) => getTechKnowledge(world.components, id)?.understoodKinds.includes(kind) ?? false);
}

/** Grants `householdId` a recipe and/or construction kind -- the founding/invention path (P11-10's `attemptInvention` calls this). Merges into the household's existing entity where one exists; idempotent per item. */
export function grantTech(world: World, householdId: EntityId, items: { recipeIds?: readonly string[]; understoodKinds?: readonly string[]; designIds?: readonly EntityId[] }): EntityId {
  const existingId = techKnowledgeOf(world, householdId)[0];
  if (existingId === undefined) {
    const knowledgeId = world.entities.create("tech-knowledge");
    setTechKnowledge(world.components, knowledgeId, {
      recipeIds: [...(items.recipeIds ?? [])],
      understoodKinds: [...(items.understoodKinds ?? [])],
      designIds: [...(items.designIds ?? [])],
      heldByHouseholdIds: [householdId],
      learnedTick: world.clock.tick,
    });
    return knowledgeId;
  }
  const existing = getTechKnowledge(world.components, existingId)!;
  setTechKnowledge(world.components, existingId, {
    recipeIds: [...new Set([...existing.recipeIds, ...(items.recipeIds ?? [])])],
    understoodKinds: [...new Set([...existing.understoodKinds, ...(items.understoodKinds ?? [])])],
    designIds: [...new Set([...existing.designIds, ...(items.designIds ?? [])])],
    heldByHouseholdIds: existing.heldByHouseholdIds,
    learnedTick: existing.learnedTick,
  });
  return existingId;
}

/**
 * A real teaching act: `fromHouseholdId` teaches `toHouseholdId` a
 * recipe (or construction kind) it GENUINELY holds -- propagation, not
 * invention (the taught household's knowledge comes from the teacher's
 * actual knowledge). Returns false when the teacher doesn't know it.
 */
export function teachTech(world: World, fromHouseholdId: EntityId, toHouseholdId: EntityId, item: { recipeId?: string; kind?: string }): boolean {
  const itemKind = item.recipeId !== undefined ? "recipe" : item.kind !== undefined ? "kind" : undefined;
  if (itemKind === undefined) throw new RangeError("teachTech requires a recipeId or a kind");
  const teacherKnows =
    itemKind === "recipe" ? knowsRecipe(world, fromHouseholdId, item.recipeId!) : understandsKind(world, fromHouseholdId, item.kind!);
  if (!teacherKnows) return false;
  grantTech(
    world,
    toHouseholdId,
    itemKind === "recipe" ? { recipeIds: [item.recipeId!] } : { understoodKinds: [item.kind!] },
  );
  // The propagation itself is recorded -- a real causal trace for
  // P11-12's explanation layer ("how did this settlement learn this?").
  world.events.record({
    tick: world.clock.tick,
    eventType: "tech-taught",
    subjectIds: [fromHouseholdId, toHouseholdId],
    objectIds: [],
    location: { x: 0, y: 0, z: 0 },
    data: item.recipeId !== undefined ? { recipeId: item.recipeId } : { kind: item.kind },
  });
  return true;
}
