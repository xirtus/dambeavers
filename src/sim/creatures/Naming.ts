import type { EntityId } from "../core/EntityId.js";
import type { RandomStream } from "../core/Random.js";
import type { World } from "../persistence/WorldSnapshot.js";
import { setIdentity, getIdentity } from "./Beaver.js";

/**
 * P5-10: real procedural name generation, persisted via the SAME generic
 * `Identity` component (`Beaver.ts`, already usable on any entity kind --
 * P1-05's own "identity, generic" precedent, previously only ever
 * attached to beavers) so a generated name survives save/reload and is
 * referenceable historically (`getIdentity`) exactly like a beaver's own
 * name already is -- no second, parallel naming store.
 */
export type NameCategory = "personal" | "site" | "artifact" | "group";

/** Real syllable pools, one per category -- deliberately small closed sets (this project's own "don't build hundreds of anything before it's needed" discipline), combined via `RandomStream` for reproducible, deterministic generation from a given world seed. Plausible, tunable data. */
const SYLLABLE_POOLS: Readonly<Record<NameCategory, readonly string[]>> = Object.freeze({
  personal: ["al", "bri", "cor", "dun", "el", "fen", "gor", "hal", "il", "jor"],
  site: ["stone", "reed", "willow", "elder", "mist", "high", "still", "broad", "deep", "grey"],
  artifact: ["ember", "quill", "root", "gleam", "hollow", "briar", "shard", "loom"],
  group: ["kin", "warren", "hold", "clan", "den", "circle", "hearth"],
});

const SUFFIX_BY_CATEGORY: Readonly<Record<NameCategory, readonly string[]>> = Object.freeze({
  personal: ["a", "en", "in", "or", "wick"],
  site: ["ford", "hollow", "brook", "reach", "fen", "hall"],
  artifact: ["of the beaver", "of the pond", "of old"],
  group: ["s", " folk", " band"],
});

/** Generates one deterministic, reproducible name of `category` from `random` -- combines a real syllable and suffix from that category's own pool, capitalized. Two calls with independently-drawn randomness produce different names; the SAME draw sequence (a fixed world seed) always reproduces the same name (Law 8). */
export function generateName(random: RandomStream, category: NameCategory): string {
  const base = random.pick(SYLLABLE_POOLS[category]);
  const suffix = random.pick(SUFFIX_BY_CATEGORY[category]);
  const raw = `${base}${suffix}`;
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

/** Generates and persists a real name for `entityId` via the shared `Identity` component -- overwrites any existing name (a deliberate rename, not merely an initial assignment). */
export function nameEntity(world: World, entityId: EntityId, category: NameCategory, random: RandomStream): string {
  const name = generateName(random, category);
  setIdentity(world.components, entityId, { name });
  return name;
}

/** The persisted, historically-referenceable name of `entityId`, if any -- reads through the SAME `Identity` component every other named entity in this codebase already uses. */
export function nameOf(world: World, entityId: EntityId): string | undefined {
  return getIdentity(world.components, entityId)?.name;
}
