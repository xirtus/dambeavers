import { ComponentStore, defineComponent, type ComponentType } from "../core/ComponentStore.js";
import type { EntityId } from "../core/EntityId.js";
import type { EventId } from "../history/EventLog.js";
import type { World } from "../persistence/WorldSnapshot.js";

/**
 * P5-02: a real, persisted per-beaver record of significant past events --
 * each entry names a real `EventId` (P0-08, resolvable forever via
 * `EventLog.traceBack`/`eventsInvolving`), a signed valence (how it felt),
 * and a strength that decays over time (persistence: a fresh memory
 * influences behavior strongly, an old one fades). This is deliberately
 * distinct from `Mood.ts`'s own live event re-scan (P2-14's `eventContribution`,
 * a fixed 500-tick window over ALL events involving a beaver) -- that
 * mechanism answers "how do recent events feel right now"; `Memory.ts`
 * answers "what does this beaver actually REMEMBER, with its own
 * persistent strength," the substrate `Stress.ts` (P5-03) needs for
 * chronic (not merely recent) adverse conditions.
 */
export interface MemoryEntry {
  eventId: EventId;
  valence: number;
  strength: number;
  recordedTick: number;
}

export interface Memories {
  entries: MemoryEntry[];
}
export const MemoriesComponent: ComponentType<Memories> = defineComponent<Memories>("memories");

function assertUnitSigned(value: number, label: string): void {
  if (!(value >= -1 && value <= 1)) throw new RangeError(`${label} must be in [-1, 1], got ${value}`);
}

export function assertValidMemories(memories: Memories): void {
  if (!Array.isArray(memories.entries)) throw new RangeError("memories entries must be an array");
  for (const entry of memories.entries) {
    if (!Number.isInteger(entry.eventId) || entry.eventId < 1) throw new RangeError(`memory eventId must be a positive integer, got ${entry.eventId}`);
    assertUnitSigned(entry.valence, "memory valence");
    if (!(entry.strength >= 0 && entry.strength <= 1)) throw new RangeError(`memory strength must be in [0, 1], got ${entry.strength}`);
    if (!Number.isInteger(entry.recordedTick) || entry.recordedTick < 0) throw new RangeError(`memory recordedTick must be a non-negative integer, got ${entry.recordedTick}`);
  }
}

export function setMemories(components: ComponentStore, beaverId: EntityId, memories: Memories): void {
  assertValidMemories(memories);
  components.set(beaverId, MemoriesComponent, memories);
}

export function getMemories(components: ComponentStore, beaverId: EntityId): Memories | undefined {
  const memories = components.get(beaverId, MemoriesComponent);
  if (memories !== undefined) assertValidMemories(memories);
  return memories;
}

/** How much a memory's own `strength` decays per tick -- deliberately slow (persistence, the roadmap's own word) so a strongly-felt event remains influential for a genuinely long time, not just this session's short live-event window. Plausible, tunable balance data. */
export const MEMORY_DECAY_PER_TICK = 0.0002;
/** A memory below this strength is forgotten (removed) -- keeps the list from growing unboundedly over a long-running colony. */
export const MEMORY_FORGOTTEN_STRENGTH = 0.02;
/** Cap on how many memories one beaver retains at once -- when a new significant memory arrives past this cap, the weakest existing one is displaced. Plausible, tunable balance data (real memory is finite). */
export const MAX_MEMORIES = 20;

/**
 * Records a new significant memory for `beaverId` -- initial strength
 * scales with `|valence|` (a strongly-felt event is remembered more
 * vividly than a barely-noticeable one, a real formula, never a flat
 * constant). If already at `MAX_MEMORIES`, displaces the current weakest
 * entry rather than growing without bound.
 */
export function recordMemory(world: World, beaverId: EntityId, eventId: EventId, valence: number): void {
  assertUnitSigned(valence, "memory valence");
  const existing = getMemories(world.components, beaverId) ?? { entries: [] };
  const entry: MemoryEntry = { eventId, valence, strength: Math.min(1, 0.3 + Math.abs(valence) * 0.7), recordedTick: world.clock.tick };
  let entries = [...existing.entries, entry];
  if (entries.length > MAX_MEMORIES) {
    entries = entries.sort((a, b) => b.strength - a.strength).slice(0, MAX_MEMORIES);
  }
  setMemories(world.components, beaverId, { entries });
}

/** One simulated tick of memory decay for `beaverId`: every entry's `strength` fades toward 0, and entries that have faded below `MEMORY_FORGOTTEN_STRENGTH` are actually forgotten (removed). */
export function tickMemoryDecay(world: World, beaverId: EntityId): void {
  const memories = getMemories(world.components, beaverId);
  if (memories === undefined || memories.entries.length === 0) return;
  const entries = memories.entries
    .map((entry) => ({ ...entry, strength: entry.strength - MEMORY_DECAY_PER_TICK }))
    .filter((entry) => entry.strength >= MEMORY_FORGOTTEN_STRENGTH);
  setMemories(world.components, beaverId, { entries });
}

/** Real, aggregate signed influence of everything `beaverId` currently remembers -- each entry's `valence` weighted by its own current `strength`, averaged (never unboundedly summed, so having many mild memories doesn't dwarf one vivid one). `0` for a beaver with no memories. Consumed by `Stress.ts` (P5-03) for chronic effects, distinct from `Mood.ts`'s own live-event window. */
export function memoryInfluence(components: ComponentStore, beaverId: EntityId): number {
  const memories = getMemories(components, beaverId);
  if (memories === undefined || memories.entries.length === 0) return 0;
  const weightedSum = memories.entries.reduce((sum, e) => sum + e.valence * e.strength, 0);
  const totalStrength = memories.entries.reduce((sum, e) => sum + e.strength, 0);
  return totalStrength > 0 ? weightedSum / totalStrength : 0;
}

/** Drives memory decay for every live beaver once. */
export function tickAllMemoryDecay(world: World): void {
  for (const beaverId of world.entities.liveIdsOfKind("beaver").sort((a: EntityId, b: EntityId) => a - b)) {
    tickMemoryDecay(world, beaverId);
  }
}
