import type { EntityId } from "../core/EntityId.js";
import type { EventId } from "../history/EventLog.js";
import type { World } from "../persistence/WorldSnapshot.js";
import { getSite, SiteComponent } from "../region/Site.js";
import { hasFoodShortage } from "../politics/Trade.js";
import { CaravanComponent, getCaravan } from "../politics/Trade.js";
import { AccusationComponent, getAccusation, isConfined, ConfinementComponent } from "../politics/Justice.js";
import { WarComponent, getWar, warHistory } from "../politics/War.js";
import { allHistoricalFigures, isHistoricalFigure } from "../creatures/HistoricalFigure.js";
import { getOwner } from "../creatures/Ownership.js";
import { getGood } from "../economy/Good.js";
import { recordedNameOf } from "../creatures/Naming.js";

/**
 * P9-09: quests as world situations -- objectives reference ACTUAL world
 * entities/problems rather than spawning disposable quest copies. A
 * "situation" is just a derived description of real state: the real
 * stolen item and its real accusation, the real shortage and the real
 * site, the real confined prisoner, the real war casualty chain, the
 * real caravan in transit, the real historical figure standing in the
 * world. Its id is composed of REAL ids; its progress is the real state
 * changing through the ordinary systems; nothing is spawned, copied, or
 * tracked in parallel.
 */

export type SituationKind = "recover-stolen-item" | "aid-shortage" | "rescue-prisoner" | "avenge-fallen" | "deliver-caravan" | "meet-figure";

export interface WorldSituation {
  id: string;
  kind: SituationKind;
  description: string;
  /** The real entities the situation is about. */
  targetIds: EntityId[];
  /** The real recorded events the situation stems from. */
  eventIds: EventId[];
  resolved: boolean;
}

function describe(world: World, id: EntityId): string {
  const name = recordedNameOf(world, id);
  return name !== undefined ? `"${name}" (#${id})` : `#${id}`;
}

/** Every real world situation currently relevant, derived fresh. Deterministic (sorted by id). */
export function worldSituations(world: World): WorldSituation[] {
  const situations: WorldSituation[] = [];

  // Recover stolen items: real violations naming a real item, joined
  // with the real accusations that carry it as evidence.
  for (const accusationId of world.components.query(AccusationComponent)) {
    const accusation = getAccusation(world.components, accusationId);
    if (accusation === undefined || accusation.evidenceItemId === undefined) continue;
    if (accusation.status === "judged") continue;
    const itemId = accusation.evidenceItemId;
    const owner = getOwner(world.components, itemId);
    const good = getGood(world.components, itemId);
    const recovered = owner?.ownerType !== "personal" || owner.ownerId !== accusation.accusedId;
    situations.push({
      id: `recover-stolen-item-${itemId}`,
      kind: "recover-stolen-item",
      description:
        `Recover ${good !== undefined ? `the ${good.goodKind}` : "the stolen item"} ${describe(world, itemId)} from ${describe(world, accusation.accusedId)} -- a real accusation (#${accusationId}) holds it as evidence of a real recorded violation.`,
      targetIds: [itemId, accusation.accusedId, accusationId],
      eventIds: [accusation.violationEventId, accusation.filedEventId],
      resolved: recovered,
    });
  }

  // Aid shortages: real sites genuinely short on food.
  for (const siteId of world.components.query(SiteComponent)) {
    const site = getSite(world.components, siteId);
    if (site === undefined) continue;
    if (!hasFoodShortage(world, siteId)) continue;
    situations.push({
      id: `aid-shortage-${siteId}`,
      kind: "aid-shortage",
      description: `${describe(world, siteId)} is in real food shortage (${site.storedFoodKg}kg stored for ${site.populationCount} inhabitants).`,
      targetIds: [siteId],
      eventIds: [],
      resolved: false,
    });
  }

  // Rescue prisoners: real confined persons.
  for (const confinedId of world.components.query(ConfinementComponent)) {
    if (!isConfined(world, confinedId)) continue;
    situations.push({
      id: `rescue-prisoner-${confinedId}`,
      kind: "rescue-prisoner",
      description: `${describe(world, confinedId)} is really confined until tick ${world.components.get(confinedId, ConfinementComponent)!.untilTick}.`,
      targetIds: [confinedId],
      eventIds: [],
      resolved: false,
    });
  }

  // Avenge the fallen: real battle casualties, joined with their real war.
  for (const warId of world.components.query(WarComponent)) {
    const war = getWar(world.components, warId);
    if (war === undefined) continue;
    const history = warHistory(world, warId);
    const casualties = world.events
      .eventsOfType("battle-casualty")
      .filter((event) => event.objectIds.some((id) => history.some((h) => h.eventType === "battle-began" && h.objectIds.includes(id))));
    if (casualties.length === 0) continue;
    const resolved = war.status === "ended";
    situations.push({
      id: `avenge-fallen-${warId}`,
      kind: "avenge-fallen",
      description: `${casualties.length} real battle ${casualties.length === 1 ? "casualty" : "casualties"} of the war between ${war.participantIds.map((id) => describe(world, id)).join(" and ")} ${resolved ? "(war over)" : "(war ongoing)"}.`,
      targetIds: [warId, ...casualties.map((event) => event.subjectIds[0]!)],
      eventIds: casualties.map((event) => event.id),
      resolved,
    });
  }

  // Deliver caravans: real goods in transit.
  for (const caravanId of world.components.query(CaravanComponent)) {
    const caravan = getCaravan(world.components, caravanId);
    if (caravan === undefined) continue;
    situations.push({
      id: `deliver-caravan-${caravanId}`,
      kind: "deliver-caravan",
      description: `A real caravan (#${caravanId}) is in transit from ${describe(world, caravan.originSiteId)} to ${describe(world, caravan.destinationSiteId)} (${caravan.foodKg}kg food, ${caravan.goodIds.length} goods).`,
      targetIds: [caravanId, caravan.originSiteId, caravan.destinationSiteId],
      eventIds: [caravan.departedEventId],
      resolved: false,
    });
  }

  // Meet historical figures: real live figures standing in the world.
  for (const figureId of allHistoricalFigures(world)) {
    if (!world.entities.isLive(figureId)) continue;
    situations.push({
      id: `meet-figure-${figureId}`,
      kind: "meet-figure",
      description: `${describe(world, figureId)} is a real historical figure (P5-15) currently alive in the world.`,
      targetIds: [figureId],
      eventIds: [],
      resolved: false,
    });
  }

  return situations.sort((a, b) => a.id.localeCompare(b.id));
}

/** The situation's current status, derived from the same real state (a situation resolves only when the world genuinely changed). */
export function situationStatus(world: World, situationId: string): { exists: boolean; resolved?: boolean; description?: string } {
  const situation = worldSituations(world).find((s) => s.id === situationId);
  if (situation === undefined) return { exists: false };
  return { exists: true, resolved: situation.resolved, description: situation.description };
}

/** Whether `figureId` is a real historical figure (P5-15's own threshold) -- the gate's "meet descendants of simulated figures" check. */
export function isKnownHistoricalFigure(world: World, figureId: EntityId): boolean {
  return world.entities.isKnown(figureId) && world.entities.kindOf(figureId) === "beaver" && isHistoricalFigure(world, figureId);
}
