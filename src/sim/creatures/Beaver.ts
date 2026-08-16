import { ComponentStore, defineComponent, type ComponentType } from "../core/ComponentStore.js";
import type { EntityId } from "../core/EntityId.js";
import type { CellCoordinate } from "../world/WorldGrid.js";
import type { World } from "../persistence/WorldSnapshot.js";
import type { NavigationProfile } from "../navigation/Pathfinding.js";
import { setNeeds, BASELINE_NEEDS } from "./Needs.js";
import { setNeedFocus, BASELINE_NEED_FOCUS } from "./BeaverNeeds.js";

/**
 * P1-05's beaver creature model: composition over a monolithic class,
 * matching ARCHITECTURE_CONTRACT §6's sketch ("Beaver = Identity +
 * Transform + CreatureBody + Locomotion + Swimmer + Needs + Health +
 * Inventory + Skills + Relationships + JobActor"). "Transform" is
 * `WorldGrid`'s existing entity-position tracking (P0-05) -- not
 * duplicated here.
 *
 * The roadmap's P1-05 entry lists ten "initial beaver components." Eight
 * are attached by `spawnBeaver` below (body, locomotion, swimming,
 * inventory, skills, needs, health, identity/name) -- seven defined in
 * this file, plus P1-06's `Needs` (its shape/decay/urgency logic lives in
 * `Needs.ts`/`BeaverNeeds.ts`, not here; this file only attaches the
 * baseline value at spawn). The remaining two are deliberately NOT built
 * here, each because a dedicated later task already owns designing its
 * real shape and behavior -- inventing a placeholder now would be exactly
 * the speculative-ahead-of-need churn AGENTS.md Law 10 prohibits, and
 * P0-12's `DebugInspector` already documented this same deferral when it
 * was written (its `inspectEntity` doc comment): "current task"/job state
 * belongs to P1-07 (Job/order architecture -- ARCHITECTURE_CONTRACT's own
 * sketch calls this `JobActor`, an as-yet-undesigned registry, not a
 * component this file should improvise), and "relationships" belongs to
 * P1-19 (Relationships baseline). Both attach to these same beaver
 * entities automatically via `ComponentStore`'s generic
 * attach-any-component-to-any-entity mechanism once those tasks build
 * them -- no further changes to this file are expected for those two.
 */

/** A beaver's display identity -- a name, distinct from its permanent numeric `EntityId` (P0-02), which is never player-facing. */
export interface Identity {
  name: string;
}
export const IdentityComponent: ComponentType<Identity> = defineComponent<Identity>("identity");

export function assertValidIdentity(identity: Identity): void {
  if (identity.name.trim().length === 0) {
    throw new RangeError(`identity name must be non-empty, got ${JSON.stringify(identity.name)}`);
  }
}

export function setIdentity(components: ComponentStore, id: EntityId, identity: Identity): void {
  assertValidIdentity(identity);
  components.set(id, IdentityComponent, identity);
}

export function getIdentity(components: ComponentStore, id: EntityId): Identity | undefined {
  const identity = components.get(id, IdentityComponent);
  if (identity !== undefined) assertValidIdentity(identity);
  return identity;
}

/** A beaver's physical body -- currently just mass (kg), the one physical property another system (future hauling/buoyancy math) is likely to need first. Not derived from anything else, unlike `Plant`'s harvestable mass (P0-10): a creature's body isn't grown from a species/age curve the way a tree's trunk is. */
export interface CreatureBody {
  massKg: number;
}
export const CreatureBodyComponent: ComponentType<CreatureBody> = defineComponent<CreatureBody>("creature-body");

/** Average adult beaver mass -- a real, sourceable biological fact (adult beavers run roughly 16-32kg), not tuned gameplay balance data. */
export const DEFAULT_BEAVER_MASS_KG = 20;

export function assertValidCreatureBody(body: CreatureBody): void {
  if (!(Number.isFinite(body.massKg) && body.massKg > 0)) {
    throw new RangeError(`creature body massKg must be a positive finite number, got ${body.massKg}`);
  }
}

export function setCreatureBody(components: ComponentStore, id: EntityId, body: CreatureBody): void {
  assertValidCreatureBody(body);
  components.set(id, CreatureBodyComponent, body);
}

export function getCreatureBody(components: ComponentStore, id: EntityId): CreatureBody | undefined {
  const body = components.get(id, CreatureBodyComponent);
  if (body !== undefined) assertValidCreatureBody(body);
  return body;
}

/** A beaver's overland movement budget -- in the exact same abstract per-edge cost units `edgeCost`/`findPath` (P1-04) use ("not a physical distance/time unit," see `PathResult`'s own doc comment), spendable per `advanceTowards` (`BeaverLocomotion.ts`) call. Plausible, tunable balance data; deliberately does NOT yet encode any beaver-specific walk-vs-swim efficiency difference (real beavers are far more capable swimmers than walkers) -- P1-04's `SWIM_COST_MULTIPLIER` is a single global constant today, and giving one species its own cost curve is a real future refinement, not something to improvise here. */
export interface Locomotion {
  speed: number;
}
export const LocomotionComponent: ComponentType<Locomotion> = defineComponent<Locomotion>("locomotion");
export const DEFAULT_BEAVER_SPEED = 2;

export function assertValidLocomotion(locomotion: Locomotion): void {
  if (!(Number.isFinite(locomotion.speed) && locomotion.speed > 0)) {
    throw new RangeError(`locomotion speed must be a positive finite number, got ${locomotion.speed}`);
  }
}

export function setLocomotion(components: ComponentStore, id: EntityId, locomotion: Locomotion): void {
  assertValidLocomotion(locomotion);
  components.set(id, LocomotionComponent, locomotion);
}

export function getLocomotion(components: ComponentStore, id: EntityId): Locomotion | undefined {
  const locomotion = components.get(id, LocomotionComponent);
  if (locomotion !== undefined) assertValidLocomotion(locomotion);
  return locomotion;
}

/**
 * A beaver's water capability -- deliberately the SAME shape as P1-04's
 * `NavigationProfile` (`canSwim`, `maxWadingDepth`), not a parallel
 * near-duplicate: a `Swimmer` value is directly usable anywhere a
 * `NavigationProfile` is expected (see `BeaverLocomotion.ts`), so the two
 * can never drift out of sync with each other.
 */
export type Swimmer = NavigationProfile;
export const SwimmerComponent: ComponentType<Swimmer> = defineComponent<Swimmer>("swimmer");
/** Beavers are semi-aquatic; every starting beaver can swim by default. */
export const DEFAULT_BEAVER_CAN_SWIM = true;
/** Plausible wading depth before a beaver-sized creature must switch to swimming. Tunable balance data. */
export const DEFAULT_BEAVER_MAX_WADING_DEPTH = 0.4;

export function assertValidSwimmer(swimmer: Swimmer): void {
  if (!(Number.isFinite(swimmer.maxWadingDepth) && swimmer.maxWadingDepth >= 0)) {
    throw new RangeError(`swimmer maxWadingDepth must be a non-negative finite number, got ${swimmer.maxWadingDepth}`);
  }
}

export function setSwimmer(components: ComponentStore, id: EntityId, swimmer: Swimmer): void {
  assertValidSwimmer(swimmer);
  components.set(id, SwimmerComponent, swimmer);
}

export function getSwimmer(components: ComponentStore, id: EntityId): Swimmer | undefined {
  const swimmer = components.get(id, SwimmerComponent);
  if (swimmer !== undefined) assertValidSwimmer(swimmer);
  return swimmer;
}

/** What physical items (Law 1.6: physical resources are physical) this beaver currently carries, by `EntityId`. Starts empty for every beaver -- no item-entity kind exists to reference yet (Logs are P1-09's job); this is the beaver-side half of that future relationship, ready for P1-09 to populate. The ITEM's own "holder/container relation" is that task's concern, not this component's. */
export interface Inventory {
  itemIds: EntityId[];
}
export const InventoryComponent: ComponentType<Inventory> = defineComponent<Inventory>("inventory");

export function assertValidInventory(inventory: Inventory): void {
  const seen = new Set<EntityId>();
  for (const itemId of inventory.itemIds) {
    if (!Number.isInteger(itemId) || itemId < 1) {
      throw new RangeError(`inventory itemIds must be positive integers, got ${itemId}`);
    }
    if (seen.has(itemId)) {
      throw new RangeError(`inventory itemIds must not contain duplicates, got repeated id ${itemId}`);
    }
    seen.add(itemId);
  }
}

export function setInventory(components: ComponentStore, id: EntityId, inventory: Inventory): void {
  assertValidInventory(inventory);
  components.set(id, InventoryComponent, inventory);
}

export function getInventory(components: ComponentStore, id: EntityId): Inventory | undefined {
  const inventory = components.get(id, InventoryComponent);
  if (inventory !== undefined) assertValidInventory(inventory);
  return inventory;
}

/** Skill levels by open-ended name ("properties, not identity" -- P0-07's own precedent -- rather than a fixed enum a future skill can't be added to without editing this file). Starts empty: nothing consumes or grants skill levels yet (that arrives with the tasks that actually use them, e.g. P1-08 tree cutting), so seeding plausible-looking starting values now would be exactly the "invented data with no consumer" smell AGENTS.md warns against. */
export interface Skills {
  levels: Record<string, number>;
}
export const SkillsComponent: ComponentType<Skills> = defineComponent<Skills>("skills");

export function assertValidSkills(skills: Skills): void {
  for (const [name, level] of Object.entries(skills.levels)) {
    if (!(Number.isFinite(level) && level >= 0)) {
      throw new RangeError(`skill level for "${name}" must be a non-negative finite number, got ${level}`);
    }
  }
}

export function setSkills(components: ComponentStore, id: EntityId, skills: Skills): void {
  assertValidSkills(skills);
  components.set(id, SkillsComponent, skills);
}

export function getSkills(components: ComponentStore, id: EntityId): Skills | undefined {
  const skills = components.get(id, SkillsComponent);
  if (skills !== undefined) assertValidSkills(skills);
  return skills;
}

/** [0, 1] fraction, 1 = full health -- the same shape/convention as `Plant.health` (P0-10). Nothing reduces it yet (P1-16 Basic injury and death owns that); it exists now purely so this beaver-model task ships a complete, inspectable entity, matching `Plant.health`'s own precedent of existing before any damage system did. */
export interface Health {
  fraction: number;
}
export const HealthComponent: ComponentType<Health> = defineComponent<Health>("health");

export function assertValidHealth(health: Health): void {
  if (!(health.fraction >= 0) || !(health.fraction <= 1)) {
    throw new RangeError(`health fraction must be in [0, 1], got ${health.fraction}`);
  }
}

export function setHealth(components: ComponentStore, id: EntityId, health: Health): void {
  assertValidHealth(health);
  components.set(id, HealthComponent, health);
}

export function getHealth(components: ComponentStore, id: EntityId): Health | undefined {
  const health = components.get(id, HealthComponent);
  if (health !== undefined) assertValidHealth(health);
  return health;
}

export interface SpawnBeaverOptions {
  name: string;
  position: CellCoordinate;
}

/** Creates one beaver: a real, permanently-identified entity (`world.entities.create("beaver")`, P0-02) placed in the world (P0-05) and given every component this task owns, each at a plausible default. */
export function spawnBeaver(world: World, options: SpawnBeaverOptions): EntityId {
  const id = world.entities.create("beaver");
  world.grid.setEntityPosition(id, options.position.x, options.position.y, options.position.z);
  setIdentity(world.components, id, { name: options.name });
  setCreatureBody(world.components, id, { massKg: DEFAULT_BEAVER_MASS_KG });
  setLocomotion(world.components, id, { speed: DEFAULT_BEAVER_SPEED });
  setSwimmer(world.components, id, { canSwim: DEFAULT_BEAVER_CAN_SWIM, maxWadingDepth: DEFAULT_BEAVER_MAX_WADING_DEPTH });
  setInventory(world.components, id, { itemIds: [] });
  setSkills(world.components, id, { levels: {} });
  setHealth(world.components, id, { fraction: 1 });
  setNeeds(world.components, id, { ...BASELINE_NEEDS });
  setNeedFocus(world.components, id, { ...BASELINE_NEED_FOCUS });
  return id;
}

/**
 * A curated name pool, not a procedural generator: seven names is a small,
 * fixed, narratively-visible set (the roadmap's "seven starting beavers"),
 * where hand-picked, distinct, pronounceable names serve players far
 * better than assembling syllables at random. More than seven entries so
 * repeat playthroughs with different seeds see different starting rosters.
 */
export const STARTER_BEAVER_NAMES: readonly string[] = [
  "Willow",
  "Alder",
  "Birch",
  "Sedge",
  "Chomper",
  "Dabble",
  "Rill",
  "Cattail",
  "Mossy",
  "Puddle",
  "Timber",
  "Reed",
];

/**
 * Spawns exactly seven starting beavers (the roadmap's literal M0
 * requirement) at `position`, each with a distinct name drawn from
 * `STARTER_BEAVER_NAMES` via a dedicated named random substream
 * (`world.random.stream`, P0-04) -- so the roster is deterministic for a
 * given world seed, and introducing this substream can never perturb any
 * other subsystem's draw sequence. All seven start at the SAME position
 * (`WorldGrid` already supports multiple entities sharing one cell --
 * P0-05), matching the roadmap's own narrative ("seven beavers arrive
 * beside a stream": one arrival point, not seven scattered spawns).
 */
export function spawnSevenStartingBeavers(world: World, position: CellCoordinate): EntityId[] {
  const STARTING_BEAVER_COUNT = 7;
  if (STARTER_BEAVER_NAMES.length < STARTING_BEAVER_COUNT) {
    throw new RangeError(
      `STARTER_BEAVER_NAMES must contain at least ${STARTING_BEAVER_COUNT} names, has ${STARTER_BEAVER_NAMES.length}`,
    );
  }
  const nameRandom = world.random.stream("beaver-naming");
  const names = nameRandom.shuffle(STARTER_BEAVER_NAMES).slice(0, STARTING_BEAVER_COUNT);
  return names.map((name) => spawnBeaver(world, { name, position }));
}
