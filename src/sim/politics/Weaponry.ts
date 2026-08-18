import { ComponentStore, defineComponent, type ComponentType } from "../core/ComponentStore.js";
import type { EntityId } from "../core/EntityId.js";
import type { World } from "../persistence/WorldSnapshot.js";
import type { MaterialRegistry } from "../materials/Material.js";
import { getGood } from "../economy/Good.js";
import { getInventory } from "../creatures/Beaver.js";
import { resolveAttack, type BodyPartId } from "../creatures/Anatomy.js";
import type { RandomStream } from "../core/Random.js";
import type { EventId } from "../history/EventLog.js";

/**
 * P7-11: injury resolution is a real formula over MATERIAL, GEOMETRY,
 * ATTACK, ARMOR, and TISSUE properties -- weapons and armor are
 * components attached to ordinary goods (P3-18/P3-17 provenance
 * untouched: a weapon is still a real, persistent item with material,
 * mass, and quality), and the numbers come from the item's own real
 * properties: a weapon's force from its material's density/hardness and
 * its geometry (length, edge), armor's resistance from its material's
 * hardness, thickness, and coverage. No per-item "damage" stat is ever
 * authored -- identical-looking gear made of different real materials
 * resolves differently because the materials differ.
 */

export type WeaponKind = "club" | "spear" | "axe";

export interface Weapon {
  kind: WeaponKind;
  /** Geometry: overall length (m) -- reach and leverage in the force formula. */
  length: number;
  /** Geometry: edge sharpness 0..1 -- clubs are 0, axes approach 1. */
  edgeSharpness: number;
}
export const WeaponComponent: ComponentType<Weapon> = defineComponent<Weapon>("weapon");

export interface Armor {
  /** Coverage 0..1: the chance/degree to which the armor actually intercepts a blow. */
  coverage: number;
  /** Thickness (cm) -- how much material stands between the blow and tissue. */
  thickness: number;
}
export const ArmorComponent: ComponentType<Armor> = defineComponent<Armor>("armor");

const WEAPON_KINDS: readonly WeaponKind[] = ["club", "spear", "axe"];

export function assertValidWeapon(weapon: Weapon): void {
  if (!WEAPON_KINDS.includes(weapon.kind)) throw new RangeError(`weapon kind must be one of ${WEAPON_KINDS.join(", ")}, got ${JSON.stringify(weapon.kind)}`);
  if (!(Number.isFinite(weapon.length) && weapon.length > 0 && weapon.length <= 5)) throw new RangeError(`weapon length must be in (0, 5], got ${weapon.length}`);
  if (!(Number.isFinite(weapon.edgeSharpness) && weapon.edgeSharpness >= 0 && weapon.edgeSharpness <= 1)) {
    throw new RangeError(`weapon edgeSharpness must be in [0, 1], got ${weapon.edgeSharpness}`);
  }
}

export function setWeapon(components: ComponentStore, itemId: EntityId, weapon: Weapon): void {
  assertValidWeapon(weapon);
  components.set(itemId, WeaponComponent, weapon);
}

export function getWeapon(components: ComponentStore, itemId: EntityId): Weapon | undefined {
  const weapon = components.get(itemId, WeaponComponent);
  if (weapon !== undefined) assertValidWeapon(weapon);
  return weapon;
}

export function assertValidArmor(armor: Armor): void {
  if (!(Number.isFinite(armor.coverage) && armor.coverage > 0 && armor.coverage <= 1)) throw new RangeError(`armor coverage must be in (0, 1], got ${armor.coverage}`);
  if (!(Number.isFinite(armor.thickness) && armor.thickness > 0 && armor.thickness <= 10)) throw new RangeError(`armor thickness must be in (0, 10], got ${armor.thickness}`);
}

export function setArmor(components: ComponentStore, itemId: EntityId, armor: Armor): void {
  assertValidArmor(armor);
  components.set(itemId, ArmorComponent, armor);
}

export function getArmor(components: ComponentStore, itemId: EntityId): Armor | undefined {
  const armor = components.get(itemId, ArmorComponent);
  if (armor !== undefined) assertValidArmor(armor);
  return armor;
}

export const UNARMED_FORCE = 1.5;
export const WEAPON_FORCE_SCALE = 0.25;
export const ARMOR_RESISTANCE_SCALE = 0.3;

/**
 * The real force an attacker's blow delivers: unarmed base force, or --
 * with a weapon -- its material's own density and hardness, its length
 * (leverage), and its edge sharpness, scaled. A stone axe genuinely
 * hits harder than a wooden club because stone's real material
 * properties differ.
 */
export function attackForceOf(materials: MaterialRegistry, components: ComponentStore, weaponId?: EntityId): number {
  if (weaponId === undefined) return UNARMED_FORCE;
  const weapon = getWeapon(components, weaponId);
  const good = getGood(components, weaponId);
  if (weapon === undefined || good === undefined) return UNARMED_FORCE;
  const material = materials.get(good.materialId);
  if (material === undefined) return UNARMED_FORCE;
  const mass = good.massKg;
  const impact = (material.hardness / 2) * (0.5 + weapon.edgeSharpness);
  const leverage = weapon.length;
  return UNARMED_FORCE + mass * leverage * impact * WEAPON_FORCE_SCALE;
}

/**
 * The real resistance a defender's armor provides: its material's own
 * hardness, its thickness, and its coverage -- worn armor that doesn't
 * cover the struck area provides nothing (coverage is real, not a
 * flat bonus).
 */
export function armorResistanceOf(materials: MaterialRegistry, components: ComponentStore, armorId?: EntityId): number {
  if (armorId === undefined) return 0;
  const armor = getArmor(components, armorId);
  const good = getGood(components, armorId);
  if (armor === undefined || good === undefined) return 0;
  const material = materials.get(good.materialId);
  if (material === undefined) return 0;
  return material.hardness * armor.thickness * armor.coverage * ARMOR_RESISTANCE_SCALE;
}

/** The first weapon carried in a creature's inventory, if any -- real equipment, not a hidden "attack" stat. */
export function heldWeapon(components: ComponentStore, creatureId: EntityId): EntityId | undefined {
  const inventory = getInventory(components, creatureId);
  if (inventory === undefined) return undefined;
  return inventory.itemIds.find((itemId) => getWeapon(components, itemId) !== undefined);
}

/** The first armor carried in a creature's inventory, if any. */
export function wornArmor(components: ComponentStore, creatureId: EntityId): EntityId | undefined {
  const inventory = getInventory(components, creatureId);
  if (inventory === undefined) return undefined;
  return inventory.itemIds.find((itemId) => getArmor(components, itemId) !== undefined);
}

export interface CombatExchange {
  partId: BodyPartId;
  severity: number;
  wounded: boolean;
  woundEventId?: EventId;
}

/**
 * One complete armed exchange: the attacker's real force (weapon or
 * unarmed) meets the defender's real armor resistance, then the
 * defender's own struck tissue (P7-10's `resolveAttack`, unmodified) --
 * material, geometry, attack, armor, and tissue together determine the
 * injury. No authored damage numbers anywhere in the chain.
 */
export function resolveCombatExchange(
  world: World,
  materials: MaterialRegistry,
  attackerId: EntityId,
  defenderId: EntityId,
  random: RandomStream,
  causeEventId?: EventId,
): CombatExchange {
  const weaponId = heldWeapon(world.components, attackerId);
  const armorId = wornArmor(world.components, defenderId);
  const force = attackForceOf(materials, world.components, weaponId);
  const armorResistance = armorResistanceOf(materials, world.components, armorId);
  const resolution = resolveAttack(world, attackerId, defenderId, force, armorResistance, random, causeEventId);
  const exchange: CombatExchange = { partId: resolution.partId, severity: resolution.severity, wounded: resolution.wounded };
  if (resolution.woundEventId !== undefined) exchange.woundEventId = resolution.woundEventId;
  return exchange;
}

/** Marks a real good as a weapon of `kind` with the given geometry (the item's own material supplies the rest of the physics). */
export function makeWeapon(components: ComponentStore, itemId: EntityId, kind: WeaponKind, length: number, edgeSharpness: number): void {
  setWeapon(components, itemId, { kind, length, edgeSharpness });
}

/** Marks a real good as armor with the given coverage and thickness (the item's own material supplies the rest of the physics). */
export function makeArmor(components: ComponentStore, itemId: EntityId, coverage: number, thickness: number): void {
  setArmor(components, itemId, { coverage, thickness });
}
