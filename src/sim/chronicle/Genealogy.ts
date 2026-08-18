import type { EntityId } from "../core/EntityId.js";
import type { World } from "../persistence/WorldSnapshot.js";
import { getWorldParentage } from "../creatures/Reproduction.js";

/**
 * P8-06: genealogy -- lineage traversed across many generations with NO
 * duplicated and NO broken identity references. Two invariants are
 * enforced by construction and asserted by the acceptance tests:
 *  1. every id any traversal returns is a real, known beaver entity
 *     (`EntityIdRegistry.isKnown` resolves forever after death -- the
 *     project's own "history outlives liveness" contract), and
 *  2. traversals visit each person at most once (visited-set BFS/DFS --
 *     no cycles can duplicate a node, and a corrupted cycle could never
 *     loop forever).
 * Parents of a LIVE person come from their own `Parentage` component
 * (P2-11); parents of a DEAD person (whose components were destroyed
 * with them) come from the recorded `offspring-born` event that names
 * them as its subject -- the same durable record, read two ways.
 */

function assertKnownBeaver(world: World, personId: EntityId): void {
  if (!world.entities.isKnown(personId) || world.entities.kindOf(personId) !== "beaver") {
    throw new RangeError(`entity ${personId} is not a known beaver -- lineage references must resolve forever`);
  }
}

/** The person's parents, from their live Parentage component or (for the dead) their recorded birth event. */
export function parentsOf(world: World, personId: EntityId): EntityId[] {
  assertKnownBeaver(world, personId);
  const parentage = getWorldParentage(world, personId);
  if (parentage !== undefined) {
    for (const parentId of parentage.parentIds) assertKnownBeaver(world, parentId);
    return [...parentage.parentIds];
  }
  const birthEvent = world.events.eventsOfType("offspring-born").find((event) => event.subjectIds.includes(personId));
  if (birthEvent === undefined) return [];
  const parentIds = [...birthEvent.objectIds].slice(0, 2) as EntityId[];
  for (const parentId of parentIds) assertKnownBeaver(world, parentId);
  return parentIds;
}

/** The person's children, from every recorded birth event naming them as a parent. */
export function childrenOf(world: World, personId: EntityId): EntityId[] {
  assertKnownBeaver(world, personId);
  const children: EntityId[] = [];
  for (const event of world.events.eventsOfType("offspring-born")) {
    if (event.objectIds[0] === personId || event.objectIds[1] === personId) {
      const childId = event.subjectIds[0]!;
      assertKnownBeaver(world, childId);
      children.push(childId);
    }
  }
  return children;
}

/** All ancestors up to `maxDepth` generations back, breadth-first, oldest generation first, each person exactly once. */
export function ancestorsOf(world: World, personId: EntityId, maxDepth: number = 64): EntityId[] {
  assertKnownBeaver(world, personId);
  if (!Number.isInteger(maxDepth) || maxDepth < 0) throw new RangeError(`maxDepth must be a non-negative integer, got ${maxDepth}`);
  const seen = new Set<EntityId>([personId]);
  const result: EntityId[] = [];
  let frontier = parentsOf(world, personId);
  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
    const next: EntityId[] = [];
    for (const ancestorId of frontier) {
      if (seen.has(ancestorId)) continue;
      seen.add(ancestorId);
      result.push(ancestorId);
      next.push(...parentsOf(world, ancestorId));
    }
    frontier = next;
  }
  return result;
}

/** All descendants up to `maxDepth` generations down, breadth-first, oldest generation first, each person exactly once. */
export function descendantsOf(world: World, personId: EntityId, maxDepth: number = 64): EntityId[] {
  assertKnownBeaver(world, personId);
  if (!Number.isInteger(maxDepth) || maxDepth < 0) throw new RangeError(`maxDepth must be a non-negative integer, got ${maxDepth}`);
  const seen = new Set<EntityId>([personId]);
  const result: EntityId[] = [];
  let frontier = childrenOf(world, personId);
  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
    const next: EntityId[] = [];
    for (const childId of frontier) {
      if (seen.has(childId)) continue;
      seen.add(childId);
      result.push(childId);
      next.push(...childrenOf(world, childId));
    }
    frontier = next;
  }
  return result;
}

export interface LineageMember {
  personId: EntityId;
  parentIds: EntityId[];
  childIds: EntityId[];
}

/** The full lineage around `personId`: themselves, every ancestor, and every descendant up to `maxGenerations` -- each member listed once with their own parents and children (all real, all resolvable). */
export function familyLineage(world: World, personId: EntityId, maxGenerations: number = 64): LineageMember[] {
  assertKnownBeaver(world, personId);
  const memberIds = new Set<EntityId>([personId, ...ancestorsOf(world, personId, maxGenerations), ...descendantsOf(world, personId, maxGenerations)]);
  return [...memberIds]
    .sort((a, b) => a - b)
    .map((memberId) => ({
      personId: memberId,
      parentIds: parentsOf(world, memberId),
      childIds: childrenOf(world, memberId).sort((a, b) => a - b),
    }));
}

/** How many generations back the oldest recorded ancestor lies (0 = no recorded parents). */
export function generationDepth(world: World, personId: EntityId): number {
  assertKnownBeaver(world, personId);
  let depth = 0;
  const seen = new Set<EntityId>([personId]);
  let frontier = parentsOf(world, personId);
  while (frontier.length > 0) {
    depth++;
    const next: EntityId[] = [];
    for (const ancestorId of frontier) {
      if (seen.has(ancestorId)) continue;
      seen.add(ancestorId);
      next.push(...parentsOf(world, ancestorId));
    }
    frontier = next;
  }
  return depth;
}
