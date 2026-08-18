import { ComponentStore, defineComponent, type ComponentType } from "../core/ComponentStore.js";
import type { EntityId } from "../core/EntityId.js";
import type { EventId } from "../history/EventLog.js";
import type { World } from "../persistence/WorldSnapshot.js";
import type { MaterialRegistry } from "../materials/Material.js";
import type { RandomStream } from "../core/Random.js";
import { organizationMembers } from "./Organization.js";
import { getArmor, armorResistanceOf } from "./Weaponry.js";
import { resolveAttack } from "../creatures/Anatomy.js";
import { skillLevel } from "../creatures/SkillProgression.js";
import { getHealth } from "../creatures/Beaver.js";
import { die } from "../creatures/Mortality.js";
import { bequeathEstate, getOwner } from "../creatures/Ownership.js";
import { getInventory, setInventory } from "../creatures/Beaver.js";

/**
 * P7-15: a site-scale battle is ordinary creatures, ordinary items, and
 * ordinary injuries composed -- the SAME beaver entities, their REAL
 * weapons/armor (P7-11), the REAL combat anatomy (P7-10), the REAL
 * mortality machinery (P1-16's `die`, real corpses, real
 * `"trauma-death"` events), and real persistent aftermath: casualties
 * stay dead, their equipment genuinely drops or passes to heirs
 * (P5-06's own inheritance), wounds persist, and every round/end is a
 * real event. No "battle resolution" script computes a winner from
 * abstract power: the battle IS the sum of its real exchanges.
 */

export interface Battle {
  siteId: EntityId;
  sideAOrgId: EntityId;
  sideBOrgId: EntityId;
  warId?: EntityId;
  status: "ongoing" | "ended";
  beganEventId: EventId;
  endedEventId?: EventId;
  winnerOrgId?: EntityId;
  roundsFought: number;
}
export const BattleComponent: ComponentType<Battle> = defineComponent<Battle>("battle");

export const BATTLE_MAX_ROUNDS = 12;
export const COMBAT_SKILL_FORCE_BONUS = 0.5;

export function assertValidBattle(battle: Battle): void {
  if (!Number.isInteger(battle.siteId) || battle.siteId < 1) throw new RangeError(`battle siteId must be a positive integer, got ${battle.siteId}`);
  if (!Number.isInteger(battle.sideAOrgId) || battle.sideAOrgId < 1) throw new RangeError(`battle sideAOrgId must be a positive integer, got ${battle.sideAOrgId}`);
  if (!Number.isInteger(battle.sideBOrgId) || battle.sideBOrgId < 1) throw new RangeError(`battle sideBOrgId must be a positive integer, got ${battle.sideBOrgId}`);
  if (battle.sideAOrgId === battle.sideBOrgId) throw new RangeError(`battle sides must differ, both ${battle.sideAOrgId}`);
  if (battle.warId !== undefined && (!Number.isInteger(battle.warId) || battle.warId < 1)) throw new RangeError(`battle warId must be a positive integer when present, got ${battle.warId}`);
  if (battle.status !== "ongoing" && battle.status !== "ended") throw new RangeError(`battle status must be ongoing/ended, got ${JSON.stringify(battle.status)}`);
  if (!Number.isInteger(battle.beganEventId) || battle.beganEventId < 1) throw new RangeError(`battle beganEventId must be a positive integer, got ${battle.beganEventId}`);
  if (battle.status === "ended" && (battle.endedEventId === undefined || !Number.isInteger(battle.endedEventId) || battle.endedEventId < 1)) {
    throw new RangeError(`an ended battle must carry a positive endedEventId, got ${battle.endedEventId}`);
  }
  if (battle.status === "ongoing" && battle.endedEventId !== undefined) throw new RangeError("an ongoing battle must not carry an endedEventId");
  if (battle.winnerOrgId !== undefined && (!Number.isInteger(battle.winnerOrgId) || battle.winnerOrgId < 1)) {
    throw new RangeError(`battle winnerOrgId must be a positive integer when present, got ${battle.winnerOrgId}`);
  }
  if (!Number.isInteger(battle.roundsFought) || battle.roundsFought < 0) throw new RangeError(`battle roundsFought must be a non-negative integer, got ${battle.roundsFought}`);
}

export function setBattle(components: ComponentStore, battleId: EntityId, battle: Battle): void {
  assertValidBattle(battle);
  const normalized: Battle = {
    siteId: battle.siteId,
    sideAOrgId: battle.sideAOrgId,
    sideBOrgId: battle.sideBOrgId,
    status: battle.status,
    beganEventId: battle.beganEventId,
    roundsFought: battle.roundsFought,
  };
  if (battle.warId !== undefined) normalized.warId = battle.warId;
  if (battle.endedEventId !== undefined) normalized.endedEventId = battle.endedEventId;
  if (battle.winnerOrgId !== undefined) normalized.winnerOrgId = battle.winnerOrgId;
  components.set(battleId, BattleComponent, normalized);
}

export function getBattle(components: ComponentStore, battleId: EntityId): Battle | undefined {
  const battle = components.get(battleId, BattleComponent);
  if (battle !== undefined) assertValidBattle(battle);
  return battle;
}

/**
 * Starts a real battle at `siteId` between two real military
 * organizations (their real members will fight), optionally as part of
 * a real war (P7-16). Records `"battle-began"` chained to `causeEventId`
 * (the raid arrival or war declaration that brought them together).
 */
export function startBattle(world: World, siteId: EntityId, sideAOrgId: EntityId, sideBOrgId: EntityId, warId?: EntityId, causeEventId?: EventId): EntityId {
  const battleId = world.entities.create("battle");
  const beganEventId = world.events.record({
    tick: world.clock.tick,
    eventType: "battle-began",
    subjectIds: [sideAOrgId, sideBOrgId],
    objectIds: [siteId, battleId],
    location: { x: 0, y: 0, z: 0 },
    ...(causeEventId !== undefined ? { causeEventId } : {}),
  });
  setBattle(world.components, battleId, {
    siteId,
    sideAOrgId,
    sideBOrgId,
    ...(warId !== undefined ? { warId } : {}),
    status: "ongoing",
    beganEventId,
    roundsFought: 0,
  });
  return battleId;
}

/** The live fighters on a side -- real beaver members of the side's organization, never a spawned combat double. */
function liveFighters(world: World, orgId: EntityId): EntityId[] {
  return organizationMembers(world.components, orgId).filter((id) => world.entities.isLive(id)).sort((a, b) => a - b);
}

/**
 * A fighter's real per-attack force: their equipped weapon's force
 * (P7-11) scaled by their own real combat skill (P2-03/P7-14) -- skill
 * genuinely matters because the number is the fighter's own.
 */
function fighterForce(world: World, materials: MaterialRegistry, fighterId: EntityId, weaponForce: number): number {
  return weaponForce * (COMBAT_SKILL_FORCE_BONUS + skillLevel(world.components, fighterId, "combat"));
}

/** Real post-mortem handling: personal items pass to heirs (P5-06), org-issued equipment returns to the org pool. */
function handleFighterDeath(world: World, fighterId: EntityId, orgId: EntityId): void {
  const inventory = getInventory(world.components, fighterId);
  if (inventory !== undefined) {
    const returning = inventory.itemIds.filter((itemId) => {
      const owner = getOwner(world.components, itemId);
      return owner !== undefined && owner.ownerType === "institutional" && owner.ownerId === orgId;
    });
    if (returning.length > 0) setInventory(world.components, fighterId, { itemIds: inventory.itemIds.filter((id) => !returning.includes(id)) });
  }
  bequeathEstate(world, fighterId);
}

/**
 * One round of the battle: the two sides' live fighters pair off in
 * real deterministic order (alternating who strikes first by round
 * parity), each exchange resolves through ordinary weapons/armor/
 * tissue mechanics (P7-10/P7-11, unmodified), and a fighter reduced to
 * zero health dies through the ordinary mortality machinery (real
 * corpse, real `"trauma-death"`). The battle ends the round one side
 * has no fighters left (or at the round cap, by real surviving
 * numbers). Every end is a real `"battle-ended"` event chained to the
 * battle's beginning. Returns the winner org id, or undefined for an
 * inconclusive end.
 */
export function tickBattle(world: World, materials: MaterialRegistry, battleId: EntityId, random: RandomStream): EntityId | undefined {
  const battle = getBattle(world.components, battleId);
  if (battle === undefined || battle.status !== "ongoing") return battle?.winnerOrgId;

  const sideA = liveFighters(world, battle.sideAOrgId);
  const sideB = liveFighters(world, battle.sideBOrgId);
  if (sideA.length === 0 || sideB.length === 0) {
    return endBattle(world, battleId, sideA.length > 0 ? battle.sideAOrgId : sideB.length > 0 ? battle.sideBOrgId : undefined);
  }

  const pairs = Math.min(sideA.length, sideB.length);
  const aStrikesFirst = battle.roundsFought % 2 === 0;
  for (let i = 0; i < pairs; i++) {
    const first = aStrikesFirst ? sideA[i]! : sideB[i]!;
    const second = aStrikesFirst ? sideB[i]! : sideA[i]!;
    for (const [attackerId, defenderId] of [[first, second], [second, first]] as const) {
      if (!world.entities.isLive(attackerId) || !world.entities.isLive(defenderId)) continue;
      // Real exchange: attacker's own weapon force x own combat skill,
      // against defender's own armor and own struck tissue (P7-10/11).
      const weaponId = heldWeaponId(world, attackerId);
      const weaponForce = weaponId === undefined ? 1 : weaponForceOf(world, materials, weaponId);
      const force = fighterForce(world, materials, attackerId, weaponForce);
      const armorId = wornArmorId(world, defenderId);
      const armorResistance = armorId === undefined ? 0 : armorResistanceValue(world, materials, armorId);
      resolveAttack(world, attackerId, defenderId, force, armorResistance, random, battle.beganEventId);
      const health = getHealth(world.components, defenderId);
      if (health !== undefined && health.fraction <= 0 && world.entities.isLive(defenderId)) {
        handleFighterDeath(world, defenderId, defenderSide(world, battle, defenderId));
        // A real, recorded casualty event chained to the battle itself --
        // the persistent causal record battles own (the ordinary death
        // event still fires through P1-16's own machinery).
        world.events.record({
          tick: world.clock.tick,
          eventType: "battle-casualty",
          subjectIds: [defenderId],
          objectIds: [battleId],
          location: world.grid.positionOf(defenderId) ?? { x: 0, y: 0, z: 0 },
          causeEventId: battle.beganEventId,
        });
        die(world, defenderId, "trauma");
      }
    }
  }

  const afterA = liveFighters(world, battle.sideAOrgId);
  const afterB = liveFighters(world, battle.sideBOrgId);
  setBattle(world.components, battleId, { ...battle, roundsFought: battle.roundsFought + 1 });

  if (afterA.length === 0 || afterB.length === 0) {
    return endBattle(world, battleId, afterA.length > 0 ? battle.sideAOrgId : afterB.length > 0 ? battle.sideBOrgId : undefined);
  }
  if (battle.roundsFought + 1 >= BATTLE_MAX_ROUNDS) {
    return endBattle(world, battleId, afterA.length > afterB.length ? battle.sideAOrgId : afterB.length > afterA.length ? battle.sideBOrgId : undefined);
  }
  return undefined;
}

function defenderSide(world: World, battle: Battle, fighterId: EntityId): EntityId {
  return organizationMembers(world.components, battle.sideAOrgId).includes(fighterId) ? battle.sideAOrgId : battle.sideBOrgId;
}

import { getWeapon, attackForceOf } from "./Weaponry.js";
function heldWeaponId(world: World, fighterId: EntityId): EntityId | undefined {
  const inventory = getInventory(world.components, fighterId);
  if (inventory === undefined) return undefined;
  return inventory.itemIds.find((itemId) => getWeapon(world.components, itemId) !== undefined);
}
function weaponForceOf(world: World, materials: MaterialRegistry, weaponId: EntityId): number {
  return attackForceOf(materials, world.components, weaponId);
}
function wornArmorId(world: World, fighterId: EntityId): EntityId | undefined {
  const inventory = getInventory(world.components, fighterId);
  if (inventory === undefined) return undefined;
  return inventory.itemIds.find((itemId) => getArmor(world.components, itemId) !== undefined);
}
function armorResistanceValue(world: World, materials: MaterialRegistry, armorId: EntityId): number {
  return armorResistanceOf(materials, world.components, armorId);
}

/** Ends the battle with a real recorded outcome; the winner (if any) is persisted on the battle entity. */
export function endBattle(world: World, battleId: EntityId, winnerOrgId?: EntityId): EntityId | undefined {
  const battle = getBattle(world.components, battleId);
  if (battle === undefined) throw new RangeError(`unknown battle ${battleId}`);
  if (battle.status === "ended") return battle.winnerOrgId;
  const endedEventId = world.events.record({
    tick: world.clock.tick,
    eventType: "battle-ended",
    subjectIds: [battle.sideAOrgId, battle.sideBOrgId],
    objectIds: [battle.siteId, battleId, ...(winnerOrgId !== undefined ? [winnerOrgId] : [])],
    location: { x: 0, y: 0, z: 0 },
    causeEventId: battle.beganEventId,
  });
  const ended: Battle = {
    ...battle,
    status: "ended",
    endedEventId,
    ...(winnerOrgId !== undefined ? { winnerOrgId } : {}),
  };
  setBattle(world.components, battleId, ended);
  return winnerOrgId;
}

/** Every battle belonging to a war (real composition: the war's battles are its actual battles). */
export function battlesOfWar(world: World, warId: EntityId): EntityId[] {
  const battles: EntityId[] = [];
  for (const battleId of world.components.query(BattleComponent)) {
    const battle = getBattle(world.components, battleId);
    if (battle !== undefined && battle.warId === warId) battles.push(battleId);
  }
  return battles.sort((a, b) => a - b);
}

/** The real persistent casualties of a battle: every fighter named by a recorded `"battle-casualty"` event chained to this battle (real deaths, real events). */
export function battleCasualties(world: World, battleId: EntityId): EntityId[] {
  const battle = getBattle(world.components, battleId);
  if (battle === undefined) return [];
  const casualties: EntityId[] = [];
  for (const event of world.events.eventsOfType("battle-casualty")) {
    if (!event.objectIds.includes(battleId)) continue;
    if (event.causeEventId !== battle.beganEventId) continue;
    casualties.push(...event.subjectIds);
  }
  return [...new Set(casualties)].sort((a, b) => a - b);
}
