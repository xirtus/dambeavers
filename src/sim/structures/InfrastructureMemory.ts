import { ComponentStore, defineComponent, type ComponentType } from "../core/ComponentStore.js";
import type { EntityId } from "../core/EntityId.js";
import type { EventId } from "../history/EventLog.js";
import type { World } from "../persistence/WorldSnapshot.js";
import { understandsKind } from "../economy/TechKnowledge.js";
import { formBelief } from "../creatures/Belief.js";
import { setConstruction, type ConstructionKind } from "../labor/Construction.js";
import { getHouseholdMembership } from "../creatures/Relationships.js";

/**
 * P11-11: infrastructure memory -- later societies can encounter,
 * misunderstand, reuse, repair, or mythologize abandoned constructions
 * from older civilizations. A `"ruin"` is a real physical entity left
 * behind when a site's detailed world deactivates with structures
 * standing (the structure-count breakdown recorded on the `Site`); a
 * later reactivation materializes real ruin entities from that record.
 * Encountering a ruin branches on the ENCOUNTERING household's own real
 * `TechKnowledge`: households that understand the construction's kind
 * genuinely repair/reuse it (real work, a real construction entity);
 * households that don't mythologize it (a real `Belief` founded on the
 * real encounter event -- never an authored legend about a structure
 * the sim didn't actually record).
 */

export interface Ruin {
  kind: string;
  abandonedTick: number;
}
export const RuinComponent: ComponentType<Ruin> = defineComponent<Ruin>("ruin");

export function assertValidRuin(ruin: Ruin): void {
  if (ruin.kind.trim().length === 0) throw new RangeError("ruin kind must be non-empty");
  if (!Number.isInteger(ruin.abandonedTick) || ruin.abandonedTick < 0) throw new RangeError(`ruin abandonedTick must be a non-negative integer, got ${ruin.abandonedTick}`);
}

export function setRuin(components: ComponentStore, ruinId: EntityId, ruin: Ruin): void {
  assertValidRuin(ruin);
  components.set(ruinId, RuinComponent, ruin);
}

export function getRuin(components: ComponentStore, ruinId: EntityId): Ruin | undefined {
  const ruin = components.get(ruinId, RuinComponent);
  if (ruin !== undefined) assertValidRuin(ruin);
  return ruin;
}

/** Places a real ruin entity for one abandoned structure of `kind`. */
export function materializeRuin(world: World, kind: string, position: { x: number; y: number; z: number }): EntityId {
  const ruinId = world.entities.create("ruin");
  world.grid.setEntityPosition(ruinId, position.x, position.y, position.z);
  setRuin(world.components, ruinId, { kind, abandonedTick: world.clock.tick });
  // The materialization itself is recorded -- the causal trace P11-12's
  // explanation layer cites when asked "what IS this ruin?".
  world.events.record({
    tick: world.clock.tick,
    eventType: "ruin-materialized",
    subjectIds: [ruinId],
    objectIds: [],
    location: position,
    data: { kind },
  });
  return ruinId;
}

export interface RuinEncounterResult {
  ok: boolean;
  reason?: string;
  eventId?: EventId;
  /** The new entity produced: the repaired construction, or the belief the myth formed. */
  producedEntityId?: EntityId;
}

/**
 * A beaver encounters an abandoned construction. With real
 * `TechKnowledge` of the ruin's kind (P11-09), the household REPAIRS it:
 * the ruin becomes a real construction entity with real work required
 * (a genuine reuse, not a teleport-to-fixed). Without that knowledge,
 * the household MYTHOLOGIZES it: a real encounter event is recorded and
 * a real `Belief` is founded on that event (P5-08's own
 * origin-event-must-be-real rule) -- the myth's distortion accumulates
 * through P11-07's retelling machinery, never by editing history.
 */
export function encounterRuin(world: World, beaverId: EntityId, ruinId: EntityId): RuinEncounterResult {
  const ruin = getRuin(world.components, ruinId);
  if (ruin === undefined) return { ok: false, reason: `entity ${ruinId} is not a ruin` };
  const membership = getHouseholdMembership(world.components, beaverId);
  const position = world.grid.positionOf(ruinId) ?? { x: 0, y: 0, z: 0 };
  const eventId = world.events.record({
    tick: world.clock.tick,
    eventType: "ruin-encountered",
    subjectIds: [beaverId],
    objectIds: [ruinId],
    location: position,
    data: { ruinKind: ruin.kind },
  });

  if (membership !== undefined && understandsKind(world, membership.householdId, ruin.kind) && ["wall", "lodge-segment", "bridge", "dam-segment"].includes(ruin.kind)) {
    // Real repair/reuse: the ruin becomes a real construction with real
    // work AND real material hauling required (awaiting-materials, the
    // ordinary construction path), and the ruin entity itself is
    // consumed by the act. Only ruins whose kind is a real construction
    // kind are repairable through the construction path -- any other
    // ruin falls through to the mythologize branch below (a household
    // that cannot rebuild it still makes a story of it, like every
    // other population encountering what it does not understand).
    const constructionId = world.entities.create("construction");
    world.grid.setEntityPosition(constructionId, position.x, position.y, position.z);
    setConstruction(world.components, constructionId, {
      designationId: constructionId,
      kind: ruin.kind as ConstructionKind,
      site: { x: position.x, z: position.z },
      requiredMaterialId: "wood",
      requiredMassKg: 1,
      workDone: 0,
      workRequired: 4,
      status: "awaiting-materials",
    });
    world.entities.destroy(ruinId);
    return { ok: true, eventId, producedEntityId: constructionId };
  }

  if (membership === undefined) {
    return { ok: false, reason: "you have no household to hold a myth about it", eventId };
  }
  const beliefId = formBelief(world, eventId, membership.householdId);
  return { ok: true, eventId, producedEntityId: beliefId };
}
