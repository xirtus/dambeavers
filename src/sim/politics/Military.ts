import { ComponentStore, defineComponent, type ComponentType } from "../core/ComponentStore.js";
import type { EntityId } from "../core/EntityId.js";
import type { EventId } from "../history/EventLog.js";
import type { World } from "../persistence/WorldSnapshot.js";
import type { MaterialRegistry } from "../materials/Material.js";
import { organizationMembers, organizationAssets, getOrganization } from "./Organization.js";
import { practiceSkill, skillLevel } from "../creatures/SkillProgression.js";
import { getInventory } from "../creatures/Beaver.js";
import { getWeapon, getArmor, attackForceOf } from "./Weaponry.js";
import { getHeld, pickUp, HeldComponent } from "../labor/Log.js";

/**
 * P7-14: military organizations are ORDINARY organizations (P7-01's own
 * entities, unmodified) whose members are ordinary beavers -- there is
 * no separate combat-only creature model anywhere. A unit trains by
 * practicing the same real skill system every other labor uses
 * (P2-03), equips by assigning the organization's own shared-asset
 * goods into member inventories (P7-01/P5-06, still org-owned), and
 * receives mission objectives as real, persistent data assigned by a
 * real commander (recorded as events).
 */

export type MissionKind = "raid" | "defend" | "conquer";

export interface MissionObjective {
  kind: MissionKind;
  targetSiteId?: EntityId;
  assignedByEventId: EventId;
}

export interface MilitaryUnit {
  objective?: MissionObjective;
  trainedTick?: number;
}
export const MilitaryUnitComponent: ComponentType<MilitaryUnit> = defineComponent<MilitaryUnit>("military-unit");

const MISSION_KINDS: readonly MissionKind[] = ["raid", "defend", "conquer"];

export const COMBAT_SKILL_NAME = "combat";
export const TRAINING_WORK_PER_TICK = 1;

export function assertValidMilitaryUnit(unit: MilitaryUnit): void {
  if (unit.objective !== undefined) {
    if (!MISSION_KINDS.includes(unit.objective.kind)) {
      throw new RangeError(`mission kind must be one of ${MISSION_KINDS.join(", ")}, got ${JSON.stringify(unit.objective.kind)}`);
    }
    if (unit.objective.targetSiteId !== undefined && (!Number.isInteger(unit.objective.targetSiteId) || unit.objective.targetSiteId < 1)) {
      throw new RangeError(`mission targetSiteId must be a positive integer when present, got ${unit.objective.targetSiteId}`);
    }
    if (!Number.isInteger(unit.objective.assignedByEventId) || unit.objective.assignedByEventId < 1) {
      throw new RangeError(`mission assignedByEventId must be a positive integer, got ${unit.objective.assignedByEventId}`);
    }
  }
  if (unit.trainedTick !== undefined && (!Number.isInteger(unit.trainedTick) || unit.trainedTick < 0)) {
    throw new RangeError(`military-unit trainedTick must be a non-negative integer when present, got ${unit.trainedTick}`);
  }
}

export function setMilitaryUnit(components: ComponentStore, organizationId: EntityId, unit: MilitaryUnit): void {
  assertValidMilitaryUnit(unit);
  const normalized: MilitaryUnit = {};
  if (unit.objective !== undefined) {
    normalized.objective = {
      kind: unit.objective.kind,
      assignedByEventId: unit.objective.assignedByEventId,
      ...(unit.objective.targetSiteId !== undefined ? { targetSiteId: unit.objective.targetSiteId } : {}),
    };
  }
  if (unit.trainedTick !== undefined) normalized.trainedTick = unit.trainedTick;
  components.set(organizationId, MilitaryUnitComponent, normalized);
}

export function getMilitaryUnit(components: ComponentStore, organizationId: EntityId): MilitaryUnit | undefined {
  const unit = components.get(organizationId, MilitaryUnitComponent);
  if (unit !== undefined) assertValidMilitaryUnit(unit);
  return unit;
}

/** Registers an ordinary organization as a military unit (real data: an org with this component IS a unit). */
export function formMilitaryUnit(world: World, organizationId: EntityId): void {
  if (getOrganization(world.components, organizationId) === undefined) throw new RangeError(`unknown organization ${organizationId}`);
  setMilitaryUnit(world.components, organizationId, {});
}

/**
 * One tick of training: every live member practices the real `combat`
 * skill (the SAME `practiceSkill` P2-03's crafting and every other
 * labor uses -- training is ordinary skill practice, not a hidden
 * level-up). Returns the total work practiced.
 */
export function trainUnit(world: World, organizationId: EntityId, work: number = TRAINING_WORK_PER_TICK): number {
  let practiced = 0;
  for (const memberId of organizationMembers(world.components, organizationId)) {
    if (!world.entities.isLive(memberId)) continue;
    practiceSkill(world.components, memberId, COMBAT_SKILL_NAME, work);
    practiced += work;
  }
  const unit = getMilitaryUnit(world.components, organizationId);
  if (unit !== undefined) setMilitaryUnit(world.components, organizationId, { ...unit, trainedTick: world.clock.tick });
  return practiced;
}

/**
 * Equips the unit from its OWN shared assets (P7-01): the organization's
 * institutionally-owned weapons/armor are assigned into its live
 * members' inventories (still org-owned -- issued equipment, not gifted
 * property). Deterministic: members and assets both iterate sorted.
 *
 * Issuance goes through the REAL pickup machinery (`Log.pickUp`): a
 * ground-held item is physically picked up (its `Held` component set,
 * its grid position cleared, the move recorded when world context
 * exists) -- never silently spliced into an inventory in a state a
 * later `drop`/death could crash on. Each asset is issued to at most
 * ONE member per pass (the union of every member's inventory is the
 * "already issued" set, so one org spear can't be in two soldiers'
 * hands), and an asset already in someone's hands is skipped. A stale
 * `Held` pointing at a dead holder (defensive: old states written
 * before this fix) is cleared first so the item can be legitimately
 * picked up again.
 */
export function equipUnit(world: World, organizationId: EntityId): void {
  const members = organizationMembers(world.components, organizationId).filter((id) => world.entities.isLive(id));
  const weapons = organizationAssets(world, organizationId).filter((itemId) => getWeapon(world.components, itemId) !== undefined);
  const armors = organizationAssets(world, organizationId).filter((itemId) => getArmor(world.components, itemId) !== undefined);
  const alreadyIssued = new Set<EntityId>();
  for (const memberId of members) {
    const inventory = getInventory(world.components, memberId);
    if (inventory !== undefined) for (const itemId of inventory.itemIds) alreadyIssued.add(itemId);
  }
  const issue = (itemId: EntityId, memberId: EntityId): void => {
    if (alreadyIssued.has(itemId)) return;
    const held = getHeld(world.components, itemId);
    if (held !== undefined && world.entities.isLive(held.by)) return; // in someone's live hands already
    if (held !== undefined && !world.entities.isLive(held.by)) {
      world.components.remove(itemId, HeldComponent); // stale holder -- the item is genuinely free again
    }
    pickUp(world.components, world.grid, itemId, memberId, world);
    alreadyIssued.add(itemId);
  };
  for (const memberId of members) {
    const inventory = getInventory(world.components, memberId);
    if (inventory === undefined) continue;
    // At most one new item per member per pass: the gear spreads across
    // the unit (a weapon to the first member who lacks one, else armor)
    // instead of the first member in id order hoarding every asset.
    const weapon = weapons.find((itemId) => !alreadyIssued.has(itemId) && !inventory.itemIds.includes(itemId));
    if (weapon !== undefined) {
      issue(weapon, memberId);
      continue;
    }
    const armor = armors.find((itemId) => !alreadyIssued.has(itemId) && !inventory.itemIds.includes(itemId));
    if (armor !== undefined) issue(armor, memberId);
  }
}

/**
 * Assigns a real mission objective to the unit, recorded as a
 * `"mission-assigned"` event (subject = the unit, object = the target
 * when named) -- objectives are data other systems (raids P7-13,
 * battles P7-15) act on; nothing here puppeteers a single soldier.
 */
export function assignMission(world: World, organizationId: EntityId, kind: MissionKind, assignedById: EntityId, targetSiteId?: EntityId): void {
  const unit = getMilitaryUnit(world.components, organizationId);
  if (unit === undefined) throw new RangeError(`organization ${organizationId} is not a military unit`);
  const assignedByEventId = world.events.record({
    tick: world.clock.tick,
    eventType: "mission-assigned",
    subjectIds: [organizationId],
    objectIds: [assignedById, ...(targetSiteId !== undefined ? [targetSiteId] : [])],
    location: world.grid.positionOf(assignedById) ?? { x: 0, y: 0, z: 0 },
  });
  setMilitaryUnit(world.components, organizationId, {
    ...unit,
    objective: { kind, assignedByEventId, ...(targetSiteId !== undefined ? { targetSiteId } : {}) },
  });
}

/** Clears a unit's current objective (mission complete/aborted -- the unit keeps existing). */
export function clearMission(world: World, organizationId: EntityId): void {
  const unit = getMilitaryUnit(world.components, organizationId);
  if (unit === undefined) return;
  const cleared: MilitaryUnit = unit.trainedTick !== undefined ? { trainedTick: unit.trainedTick } : {};
  setMilitaryUnit(world.components, organizationId, cleared);
}

/**
 * The unit's real combat strength: the sum over its live members of
 * their real combat skill and their real equipped weapon force --
 * derived fresh from ordinary state, never a stored power number.
 */
export function unitStrength(world: World, materials: MaterialRegistry, organizationId: EntityId): number {
  let strength = 0;
  for (const memberId of organizationMembers(world.components, organizationId)) {
    if (!world.entities.isLive(memberId)) continue;
    strength += 1 + skillLevel(world.components, memberId, COMBAT_SKILL_NAME);
    const inventory = getInventory(world.components, memberId);
    if (inventory !== undefined) {
      for (const itemId of inventory.itemIds) {
        if (getWeapon(world.components, itemId) !== undefined) strength += attackForceOf(materials, world.components, itemId);
      }
    }
  }
  return strength;
}
