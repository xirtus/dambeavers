import type { EntityId } from "../core/EntityId.js";
import type { World } from "../persistence/WorldSnapshot.js";
import type { RegionMap } from "../region/RegionMap.js";
import type { MaterialRegistry } from "../materials/Material.js";
import { SiteComponent, getSite } from "../region/Site.js";
import { tickCaravans, scheduleTrade } from "./Trade.js";
import { tickMigrationGroups, planMigrations } from "./Migration.js";
import { tickInvestigations } from "./Justice.js";
import { tickSuccession } from "./Government.js";
import { PoliticalEntityComponent } from "./PoliticalEntity.js";
import { tickRaids, lootTarget, targetDefenders, getRaid } from "./Raids.js";
import { RaidComponent } from "./Raids.js";
import { startBattle, tickBattle, getBattle, BattleComponent } from "./Battle.js";
import { getWar, WarComponent, endWar, attachBattleToWar, declareWar } from "./War.js";
import { tickCivilizations } from "./Collapse.js";
import { formCivilization, canFormCivilization } from "./Civilization.js";
import { tickAllWounds } from "../creatures/Anatomy.js";
import { territorialWarCause } from "./WarPlanning.js";

/**
 * The Phase 7 counterpart of `ColonyLoop.tickColony` (whose own doc
 * comment this file's structure deliberately mirrors): ONE composition
 * of every real political subsystem into a per-tick region loop, in a
 * real dependency order -- physical flows first (caravans arrive,
 * new flows dispatch), then people (migrations), then law and
 * government, then violence (raids, battles, wars), then civilization
 * rise/fall, then the bodies those systems wounded. This file invents
 * no simulation mechanic: every call passes through to its owning
 * task's already-real function. Deterministic throughout (all
 * iteration sorted, all randomness from named streams).
 */
export interface PoliticsLoopDeps {
  materials: MaterialRegistry;
}

function siteIds(world: World): EntityId[] {
  return world.components.query(SiteComponent).sort((a, b) => a - b);
}

/**
 * One full political tick over the whole region. Effects are real,
 * persistent `World` state (and, where the region scale interacts with
 * the detailed scale, real detailed entities -- fighters, wounds,
 * deaths). The caller owns advancing the clock, exactly like
 * `ColonyLoop`.
 */
export function tickPolitics(world: World, regionMap: RegionMap, deps: PoliticsLoopDeps): void {
  const sites = siteIds(world);

  // Physical flows: arrivals land, new caravans dispatch.
  tickCaravans(world, regionMap);
  scheduleTrade(world, regionMap, sites);

  // People: migration groups travel; new departures plan.
  tickMigrationGroups(world, regionMap);
  planMigrations(world, regionMap, sites);

  // Law and government: evidence gathers; leadership passes by each
  // polity's own form.
  tickInvestigations(world);
  for (const siteId of sites) tickSuccession(world, siteId);

  // Violence: raids travel/arrive; contested arrivals become real
  // battles; battles fight; wars end when their sides are spent.
  tickRaids(world, regionMap, world.random.stream("politics-raids"));
  resolveRaidArrivals(world);
  tickBattles(world, deps);
  tickWars(world);

  // Civilization rise and fall from the states above.
  tickCivilizationFormation(world);
  tickCivilizations(world);

  // Bodies: wounds bleed, heal, and impair -- wherever combat happened.
  tickAllWounds(world);
}

/** Engaged raids: undefended targets are looted; defended targets become real battles (once). */
function resolveRaidArrivals(world: World): void {
  for (const raidId of world.components.query(RaidComponent).sort((a, b) => a - b)) {
    const raid = getRaid(world.components, raidId);
    if (raid === undefined || raid.phase !== "engaged") continue;
    const defenders = targetDefenders(world, raid.targetSiteId);
    if (defenders === undefined || raid.unitOrgId === undefined) {
      lootTarget(world, raidId);
      continue;
    }
    const alreadyFighting = world.components.query(BattleComponent).some((battleId) => {
      const battle = getBattle(world.components, battleId);
      return battle !== undefined && battle.status === "ongoing" && battle.siteId === raid.targetSiteId;
    });
    if (alreadyFighting) continue;
    const battleId = startBattle(world, raid.targetSiteId, raid.unitOrgId, defenders, undefined, raid.arrivalEventId);
    // A real raid against a real settlement escalates into real war
    // when territorial stakes exist between them.
    if (raid.originSiteId !== undefined) {
      const cause = territorialWarCause(world, raid.originSiteId, raid.targetSiteId);
      if (cause !== undefined) {
        const warId = declareWar(world, raid.originSiteId, raid.targetSiteId, "raid-escalation", cause);
        attachBattleToWar(world, battleId, warId);
      }
    }
  }
}

/** One round per ongoing battle; a battle's end resolves the raid that triggered it (loot for the raiders' victory, repulse otherwise). */
function tickBattles(world: World, deps: PoliticsLoopDeps): void {
  for (const battleId of world.components.query(BattleComponent).sort((a, b) => a - b)) {
    const battle = getBattle(world.components, battleId);
    if (battle === undefined || battle.status !== "ongoing") continue;
    const winner = tickBattle(world, deps.materials, battleId, world.random.stream(`politics-battle-${battleId}`));
    if (winner === undefined) continue;
    for (const raidId of world.components.query(RaidComponent).sort((a, b) => a - b)) {
      const raid = getRaid(world.components, raidId);
      if (raid === undefined || raid.phase !== "engaged" || raid.targetSiteId !== battle.siteId) continue;
      if (raid.unitOrgId !== undefined && winner === raid.unitOrgId) {
        lootTarget(world, raidId);
      } else {
        world.events.record({
          tick: world.clock.tick,
          eventType: "raid-repelled",
          subjectIds: [raidId],
          objectIds: [battle.siteId, battleId],
          location: { x: 0, y: 0, z: 0 },
          ...(battle.endedEventId !== undefined ? { causeEventId: battle.endedEventId } : {}),
        });
        world.entities.destroy(raidId);
      }
    }
  }
}

/**
 * Wars whose side is spent end with the other side the winner -- real
 * outcome, real treaty (P7-16). "Spent" = at most one inhabitant: a
 * settlement down to a lone survivor cannot prosecute a war, and the
 * migration planner's own "leave at least one behind" rule means real
 * spent settlements never quite reach zero while any inbound group is
 * in flight -- the war ends when the fighting capacity genuinely does.
 */
function tickWars(world: World): void {
  for (const warId of world.components.query(WarComponent).sort((a, b) => a - b)) {
    const war = getWar(world.components, warId);
    if (war === undefined || war.status !== "ongoing") continue;
    const [aId, bId] = war.participantIds;
    const aSpent = (getSite(world.components, aId)?.populationCount ?? 0) <= 1;
    const bSpent = (getSite(world.components, bId)?.populationCount ?? 0) <= 1;
    if (aSpent && !bSpent) endWar(world, warId, bId);
    else if (bSpent && !aSpent) endWar(world, warId, aId);
  }
}

/** Civilizations form from real preconditions (P7-17): any pair of polities that genuinely relates and shares a bond. */
function tickCivilizationFormation(world: World): void {
  const polities = world.components.query(PoliticalEntityComponent).sort((a, b) => a - b);
  for (let i = 0; i < polities.length; i++) {
    for (let j = i + 1; j < polities.length; j++) {
      const pair = [polities[i]!, polities[j]!];
      if (!canFormCivilization(world, pair)) continue;
      const alreadyMembers = world.components.query(CivilizationMarker).some((civilizationId) => {
        const civilization = getCivilization(world.components, civilizationId);
        return civilization !== undefined && civilization.status === "active" && pair.every((siteId) => civilization.memberSiteIds.includes(siteId));
      });
      if (alreadyMembers) continue;
      formCivilization(world, pair, [], world.random.stream("politics-civilization"));
    }
  }
}

import { CivilizationComponent, getCivilization } from "./Civilization.js";
const CivilizationMarker = CivilizationComponent;

export { siteIds };
