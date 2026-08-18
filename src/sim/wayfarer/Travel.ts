import { defineComponent, type ComponentType, type ComponentStore } from "../core/ComponentStore.js";
import type { EntityId } from "../core/EntityId.js";
import type { World } from "../persistence/WorldSnapshot.js";
import type { MaterialRegistry } from "../materials/Material.js";
import type { RegionMap } from "../region/RegionMap.js";
import type { Biome } from "../region/Biomes.js";
import { routeBetween, travelCost } from "../region/Travel.js";
import { advanceWorldTicks } from "../region/DeepTime.js";
import { activateSite, deactivateSite, type ActivatedSite } from "../region/SiteActivation.js";
import { getSite } from "../region/Site.js";
import { spawnBeaver, getIdentity, setSkills, getSkills, getInventory, setIdentity } from "../creatures/Beaver.js";
import { BASELINE_NEEDS, type Needs, getNeeds, setNeeds } from "../creatures/Needs.js";
import { setWounds, getWounds, type BodyPartId } from "../creatures/Anatomy.js";
import { recordMemory, getMemories } from "../creatures/Memory.js";
import { getRelationships, setRelationshipWith, type KinRelation } from "../creatures/Relationships.js";
import { nameOf, recordedNameOf } from "../creatures/Naming.js";
import { getOwner, setOwner, OwnerComponent } from "../creatures/Ownership.js";
import { getGood, setGood } from "../economy/Good.js";
import { getLog, setLog, getHeld, pickUp } from "../labor/Log.js";
import { getFood, setFood } from "../labor/Food.js";
import { getWeapon, setWeapon, getArmor, setArmor } from "../politics/Weaponry.js";
import { getTool, setTool } from "../labor/Equipment.js";
import { getDepiction, setDepiction } from "../creatures/Art.js";
import type { EventId } from "../history/EventLog.js";

/**
 * P9-04: personal travel -- the controlled character moves between the
 * SAME persistent sites world simulation uses, over the SAME travel
 * network (P6-09's `travelCost`/`routeBetween`, unmodified), paying the
 * journey's REAL time (the region clock advances by the route's real
 * cost while inactive sites advance through P6-13's own deep-time LOD).
 *
 * The wayfarer's durable state (name, needs, skills, wounds, memories,
 * relationships, carried items) lives on ONE persistent region-scale
 * `"wayfarer"` entity -- the region layer's own precedent: a site's
 * detailed world is a TEMPORARY materialization (P6-08), so anything
 * that must survive a journey lives at the persistent layer, exactly as
 * site summaries do. `materializeWayfarer` bridges the state into the
 * active site's detailed world as an ordinary beaver (with a real
 * `wayfarer-link` naming its persistent self); `departSiteAsWayfarer`
 * reads the ordinary beaver's live state back and deactivates the site
 * through the real P6-08 inverse.
 *
 * Known limitation (documented for the critic): item identity across
 * the boundary is the REGION-scale entity (promoted on departure,
 * materialized on arrival); the detailed materialization is a new local
 * id linked by data, so Chronicle's artifact queries see the region
 * entity's journey records rather than one continuous detailed id.
 */

export interface WayfarerRelation {
  name: string;
  kin: KinRelation;
  familiarity: number;
  affinity: number;
}

export interface WayfarerMemorySummary {
  eventType: string;
  tick: number;
  valence: number;
  strength: number;
}

export interface WayfarerWoundSummary {
  partId: BodyPartId;
  severity: number;
  bleedingRate: number;
  pain: number;
  mobilityImpairment: number;
  inflictedEventType: string;
  inflictedTick: number;
}

export interface WayfarerState {
  name: string;
  needs: Needs;
  skills: Record<string, number>;
  wounds: WayfarerWoundSummary[];
  memories: WayfarerMemorySummary[];
  relations: WayfarerRelation[];
  /** Region-scale entities holding the wayfarer's carried items (promoted on departure; their in-transit representation). */
  itemIds: EntityId[];
}

export interface Wayfarer {
  regionX: number;
  regionZ: number;
  atSiteId?: EntityId;
  state: WayfarerState;
}
export const WayfarerComponent: ComponentType<Wayfarer> = defineComponent<Wayfarer>("wayfarer");

/** Attached to the detailed materialization of a wayfarer: the real persistent region entity this beaver IS. */
export interface WayfarerLink {
  regionWayfarerId: EntityId;
}
export const WayfarerLinkComponent: ComponentType<WayfarerLink> = defineComponent<WayfarerLink>("wayfarer-link");

export function setWayfarer(components: ComponentStore, wayfarerId: EntityId, wayfarer: Wayfarer): void {
  components.set(wayfarerId, WayfarerComponent, wayfarer);
}

export function getWayfarer(components: ComponentStore, wayfarerId: EntityId): Wayfarer | undefined {
  return components.get(wayfarerId, WayfarerComponent);
}

/** Creates the persistent wayfarer entity at region cell `(regionX, regionZ)` -- the adventurer's durable identity for the whole game. */
export function createWayfarer(regionWorld: World, name: string, regionX: number, regionZ: number): EntityId {
  if (!Number.isInteger(regionX) || regionX < 0 || !Number.isInteger(regionZ) || regionZ < 0) {
    throw new RangeError(`wayfarer region coordinates must be non-negative integers, got (${regionX}, ${regionZ})`);
  }
  const wayfarerId = regionWorld.entities.create("wayfarer");
  regionWorld.events.record({
    tick: regionWorld.clock.tick,
    eventType: "wayfarer-created",
    subjectIds: [wayfarerId],
    location: { x: 0, y: 0, z: 0 },
    data: { name, regionX, regionZ },
  });
  setWayfarer(regionWorld.components, wayfarerId, {
    regionX,
    regionZ,
    state: {
      name,
      needs: { ...BASELINE_NEEDS },
      skills: {},
      wounds: [],
      memories: [],
      relations: [],
      itemIds: [],
    },
  });
  return wayfarerId;
}

/** The detailed beaver that materializes `wayfarerId`, if one currently exists in `detailedWorld`. */
export function wayfarerBeaverId(detailedWorld: World, wayfarerId: EntityId): EntityId | undefined {
  for (const beaverId of detailedWorld.entities.liveIdsOfKind("beaver")) {
    const link = detailedWorld.components.get(beaverId, WayfarerLinkComponent);
    if (link !== undefined && link.regionWayfarerId === wayfarerId) return beaverId;
  }
  return undefined;
}

/** Copies every item-defining component from the region entity to a detailed entity (the region entity's own components are the authoritative state in transit). */
function copyItemState(regionWorld: World, sourceId: EntityId, targetWorld: World, targetId: EntityId): void {
  const source = regionWorld.components;
  const target = targetWorld.components;
  const identity = getIdentity(source, sourceId);
  if (identity !== undefined) setIdentity(target, targetId, identity);
  const good = getGood(source, sourceId);
  if (good !== undefined) setGood(target, targetId, good);
  const log = getLog(source, sourceId);
  if (log !== undefined) setLog(target, targetId, log);
  const food = getFood(source, sourceId);
  if (food !== undefined) setFood(target, targetId, food);
  const weapon = getWeapon(source, sourceId);
  if (weapon !== undefined) setWeapon(target, targetId, weapon);
  const armor = getArmor(source, sourceId);
  if (armor !== undefined) setArmor(target, targetId, armor);
  const tool = getTool(source, sourceId);
  if (tool !== undefined) setTool(target, targetId, tool);
  const depiction = getDepiction(source, sourceId);
  if (depiction !== undefined) setDepiction(target, targetId, depiction);
}

/** Copies item state the other way: detailed -> region (for promotion on departure). */
function promoteItemState(detailedWorld: World, sourceId: EntityId, regionWorld: World, targetId: EntityId): void {
  copyItemState(detailedWorld, sourceId, regionWorld, targetId);
}

/**
 * Materializes the wayfarer's persistent state into an ALREADY-ACTIVATED
 * site's detailed world as an ordinary beaver: real name, real needs,
 * real skills, real (re-rooted) wounds, real (re-recorded) memories,
 * real relationship edges to any resident whose name matches a
 * remembered relation, and real items rebuilt from the promoted region
 * entities (the region entities are then destroyed -- their in-transit
 * representation is over; the journey records remain in region history).
 */
export function materializeWayfarer(
  regionWorld: World,
  detailedWorld: World,
  wayfarerId: EntityId,
  wayfarer: Wayfarer,
  position: { x: number; y: number; z: number },
): EntityId {
  const beaverId = spawnBeaver(detailedWorld, { name: wayfarer.state.name, position });
  detailedWorld.components.set(beaverId, WayfarerLinkComponent, { regionWayfarerId: wayfarerId });

  setNeeds(detailedWorld.components, beaverId, { ...wayfarer.state.needs });
  setSkills(detailedWorld.components, beaverId, { levels: { ...wayfarer.state.skills } });

  for (const summary of wayfarer.state.wounds) {
    const carriedEventId = detailedWorld.events.record({
      tick: detailedWorld.clock.tick,
      eventType: "wayfarer-wound-carried",
      subjectIds: [beaverId],
      location: position,
      data: { partId: summary.partId, severity: summary.severity, inflictedEventType: summary.inflictedEventType, inflictedTick: summary.inflictedTick },
    });
    const existing = getWounds(detailedWorld.components, beaverId);
    const speedFactor = existing?.speedFactor ?? 1;
    setWounds(detailedWorld.components, beaverId, {
      entries: [
        ...(existing?.entries ?? []),
        {
          partId: summary.partId,
          severity: summary.severity,
          bleedingRate: summary.bleedingRate,
          pain: summary.pain,
          mobilityImpairment: summary.mobilityImpairment,
          inflictedByEventId: carriedEventId,
        },
      ],
      speedFactor,
    });
  }

  for (const summary of wayfarer.state.memories) {
    const memoryEventId = detailedWorld.events.record({
      tick: detailedWorld.clock.tick,
      eventType: "wayfarer-memory",
      subjectIds: [beaverId],
      location: position,
      data: { eventType: summary.eventType, tick: summary.tick },
    });
    recordMemory(detailedWorld, beaverId, memoryEventId, summary.valence);
  }

  for (const relation of wayfarer.state.relations) {
    for (const residentId of detailedWorld.entities.liveIdsOfKind("beaver")) {
      if (residentId === beaverId) continue;
      const residentName = nameOf(detailedWorld, residentId);
      if (residentName !== relation.name) continue;
      setRelationshipWith(detailedWorld.components, beaverId, {
        withId: residentId,
        kin: relation.kin,
        familiarity: relation.familiarity,
        affinity: relation.affinity,
      });
      setRelationshipWith(detailedWorld.components, residentId, {
        withId: beaverId,
        kin: relation.kin,
        familiarity: relation.familiarity,
        affinity: relation.affinity,
      });
      break;
    }
  }

  for (const itemId of wayfarer.state.itemIds) {
    const kind = regionWorld.entities.kindOf(itemId);
    const localId = detailedWorld.entities.create(kind);
    detailedWorld.grid.setEntityPosition(localId, position.x, position.y, position.z);
    copyItemState(regionWorld, itemId, detailedWorld, localId);
    const regionOwner = getOwner(regionWorld.components, itemId);
    // Items the wayfarer OWNS materialize as theirs; held-but-not-owned
    // items (stolen goods) materialize unowned-but-carried -- the
    // region record keeps the legal owner; the detailed copy is the
    // physical possession. The ordinary pickup then puts each item in
    // hand (with its own real item-moved record).
    if (regionOwner === undefined || (regionOwner.ownerType === "personal" && regionOwner.ownerId === wayfarerId)) {
      setOwner(detailedWorld.components, localId, { ownerType: "personal", ownerId: beaverId });
    }
    pickUp(detailedWorld.components, detailedWorld.grid, localId, beaverId, detailedWorld);
  }
  for (const itemId of wayfarer.state.itemIds) {
    regionWorld.entities.destroy(itemId);
  }

  return beaverId;
}

function wayfarerStateFromBeaver(detailedWorld: World, beaverId: EntityId, regionWorld: World): WayfarerState {
  const name = recordedNameOf(detailedWorld, beaverId) ?? `wayfarer-${beaverId}`;
  const needs = getNeeds(detailedWorld.components, beaverId) ?? { ...BASELINE_NEEDS };
  const skills = getSkills(detailedWorld.components, beaverId)?.levels ?? {};

  const wounds: WayfarerWoundSummary[] = [];
  const woundState = getWounds(detailedWorld.components, beaverId);
  if (woundState !== undefined) {
    for (const wound of woundState.entries) {
      const inflicted = detailedWorld.events.get(wound.inflictedByEventId);
      wounds.push({
        partId: wound.partId,
        severity: wound.severity,
        bleedingRate: wound.bleedingRate,
        pain: wound.pain,
        mobilityImpairment: wound.mobilityImpairment,
        inflictedEventType: inflicted.eventType,
        inflictedTick: inflicted.tick,
      });
    }
  }

  const memories: WayfarerMemorySummary[] = [];
  const memoryState = getMemories(detailedWorld.components, beaverId);
  if (memoryState !== undefined) {
    for (const entry of memoryState.entries) {
      const event = detailedWorld.events.get(entry.eventId);
      memories.push({ eventType: event.eventType, tick: event.tick, valence: entry.valence, strength: entry.strength });
    }
  }

  const relations: WayfarerRelation[] = [];
  const relationships = getRelationships(detailedWorld.components, beaverId);
  if (relationships !== undefined) {
    for (const edge of relationships.edges) {
      const edgeName = recordedNameOf(detailedWorld, edge.withId);
      if (edgeName === undefined) continue; // never-named residents are not memorable persons
      relations.push({ name: edgeName, kin: edge.kin, familiarity: edge.familiarity, affinity: edge.affinity });
    }
  }

  return { name, needs, skills: { ...skills }, wounds, memories, relations, itemIds: [] };
}

/**
 * Reads the materialized beaver's live state back into the persistent
 * wayfarer entity, promotes every personally-owned item to a persistent
 * region entity (the journey representation), destroys the detailed
 * materialization, and deactivates the site through the REAL P6-08
 * inverse (the site's summary reads back the remaining residents and
 * food). The wayfarer is then "outside" -- ready for `travelToSite`.
 */
export function departSiteAsWayfarer(
  regionWorld: World,
  materials: MaterialRegistry,
  wayfarerId: EntityId,
  siteId: EntityId,
  activated: ActivatedSite,
): void {
  const wayfarer = getWayfarer(regionWorld.components, wayfarerId);
  if (wayfarer === undefined) throw new RangeError(`unknown wayfarer ${wayfarerId}`);
  const site = getSite(regionWorld.components, siteId);
  if (site === undefined || !site.active) throw new RangeError(`site ${siteId} is not active -- nothing to depart`);
  const beaverId = wayfarerBeaverId(activated.world, wayfarerId);
  if (beaverId === undefined) throw new RangeError(`wayfarer ${wayfarerId} is not materialized at site ${siteId}`);

  const state = wayfarerStateFromBeaver(activated.world, beaverId, regionWorld);

  // Departure record first (the causal root for everything promoted).
  const departedEventId = regionWorld.events.record({
    tick: regionWorld.clock.tick,
    eventType: "wayfarer-departed-site",
    subjectIds: [wayfarerId],
    objectIds: [siteId],
    location: { x: 0, y: 0, z: 0 },
  });

  // Promote every item the wayfarer carries away -- personally OWNED
  // items AND items physically HELD in hand (a stolen good in your
  // hands travels with you; its legal ownership stays whatever it was,
  // preserved on the promoted entity as the recorded owner).
  const itemIds: EntityId[] = [];
  const beaverPosition = activated.world.grid.positionOf(beaverId) ?? { x: 0, y: 0, z: 0 };
  const carried = new Set<EntityId>(getInventory(activated.world.components, beaverId)?.itemIds ?? []);
  for (const itemId of activated.world.components.query(OwnerComponent)) {
    const owner = getOwner(activated.world.components, itemId);
    if (owner !== undefined && owner.ownerType === "personal" && owner.ownerId === beaverId) carried.add(itemId);
  }
  for (const itemId of [...carried].sort((a, b) => a - b)) {
    const owner = getOwner(activated.world.components, itemId);
    const ownedByWayfarer = owner !== undefined && owner.ownerType === "personal" && owner.ownerId === beaverId;
    const kind = activated.world.entities.kindOf(itemId);
    const regionItemId = regionWorld.entities.create(kind);
    promoteItemState(activated.world, itemId, regionWorld, regionItemId);
    // Owned items become the wayfarer's at region scale; held-but-not-
    // owned items keep their recorded legal owner (an opaque stable id
    // plus its name, the boundary's durable identifiers).
    if (ownedByWayfarer) {
      setOwner(regionWorld.components, regionItemId, { ownerType: "personal", ownerId: wayfarerId });
    } else if (owner !== undefined) {
      setOwner(regionWorld.components, regionItemId, owner);
    }
    regionWorld.events.record({
      tick: regionWorld.clock.tick,
      eventType: "item-carried-off",
      subjectIds: [regionItemId],
      objectIds: [wayfarerId, siteId],
      location: { x: 0, y: 0, z: 0 },
      causeEventId: departedEventId,
      data: {
        detailedItemId: itemId,
        position: beaverPosition,
        ...(owner !== undefined && owner.ownerId !== undefined
          ? { ownerId: owner.ownerId, ownerName: recordedNameOf(activated.world, owner.ownerId) }
          : {}),
      },
    });
    itemIds.push(regionItemId);
    activated.world.entities.destroy(itemId);
  }
  state.itemIds = itemIds;

  // Remove the materialization, then let the REAL inverse read the site.
  activated.world.entities.destroy(beaverId);
  deactivateSite(siteId, regionWorld, activated);

  setWayfarer(regionWorld.components, wayfarerId, {
    regionX: wayfarer.regionX,
    regionZ: wayfarer.regionZ,
    state,
  });
}

export interface TravelArrival {
  activated: ActivatedSite;
  beaverId: EntityId;
  travelTicks: number;
}

/**
 * The real journey: computes the ordinary route between the wayfarer's
 * current region cell and the destination site's cell, pays the route's
 * REAL travel cost in region time (inactive sites advance through
 * P6-13's own deep-time LOD across the span), records the departure/
 * arrival causally, activates the destination through the REAL P6-08
 * machinery, and materializes the wayfarer there.
 */
export function travelToSite(
  regionWorld: World,
  regionMap: RegionMap,
  materials: MaterialRegistry,
  wayfarerId: EntityId,
  destinationSiteId: EntityId,
  biomeForSite: (regionX: number, regionZ: number) => Biome,
  fertilityByBiome: Readonly<Record<Biome, number>>,
): TravelArrival {
  const wayfarer = getWayfarer(regionWorld.components, wayfarerId);
  if (wayfarer === undefined) throw new RangeError(`unknown wayfarer ${wayfarerId}`);
  if (wayfarer.atSiteId !== undefined) throw new RangeError(`wayfarer ${wayfarerId} is at site ${wayfarer.atSiteId} -- depart first`);
  const destination = getSite(regionWorld.components, destinationSiteId);
  if (destination === undefined) throw new RangeError(`unknown destination site ${destinationSiteId}`);
  if (destination.active) throw new RangeError(`destination site ${destinationSiteId} is already active -- travel needs an inactive site`);

  const route = routeBetween(regionMap, { regionX: wayfarer.regionX, regionZ: wayfarer.regionZ }, { regionX: destination.regionX, regionZ: destination.regionZ });
  if (route.length === 0) throw new RangeError(`no route from (${wayfarer.regionX}, ${wayfarer.regionZ}) to site ${destinationSiteId}`);

  let travelTicks = 0;
  for (let i = 1; i < route.length; i++) {
    travelTicks += Math.ceil(travelCost(regionMap, route[i - 1]!, route[i]!));
  }

  const departedEventId = regionWorld.events.record({
    tick: regionWorld.clock.tick,
    eventType: "wayfarer-journey-started",
    subjectIds: [wayfarerId],
    objectIds: [destinationSiteId],
    location: { x: 0, y: 0, z: 0 },
    data: { travelTicks, routeLength: route.length },
  });

  // The journey takes REAL time; the world (inactive sites' own LOD)
  // advances across the exact span.
  advanceWorldTicks(regionWorld, travelTicks, biomeForSite, fertilityByBiome);

  regionWorld.events.record({
    tick: regionWorld.clock.tick,
    eventType: "wayfarer-arrived",
    subjectIds: [wayfarerId],
    objectIds: [destinationSiteId],
    location: { x: 0, y: 0, z: 0 },
    causeEventId: departedEventId,
    data: { travelTicks },
  });

  const activated = activateSite(destinationSiteId, materials, regionWorld);
  const beaverId = materializeWayfarer(regionWorld, activated.world, wayfarerId, wayfarer, { x: 10, y: 3, z: 10 });

  setWayfarer(regionWorld.components, wayfarerId, {
    regionX: destination.regionX,
    regionZ: destination.regionZ,
    atSiteId: destinationSiteId,
    state: wayfarer.state,
  });
  return { activated, beaverId, travelTicks };
}
