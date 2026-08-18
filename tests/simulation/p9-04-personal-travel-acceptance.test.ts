/**
 * Headless acceptance test for P9-04 -- Personal travel.
 *
 * Roadmap acceptance test: "the controlled character can move between
 * the same persistent sites used by world simulation."
 */
import { describe, expect, it } from "vitest";
import { EntityIdRegistry, type EntityId } from "../../src/sim/core/EntityId.js";
import { ComponentStore } from "../../src/sim/core/ComponentStore.js";
import { SimulationClock } from "../../src/sim/core/SimulationClock.js";
import { RandomStreams } from "../../src/sim/core/Random.js";
import { WorldGrid } from "../../src/sim/world/WorldGrid.js";
import { TerrainField } from "../../src/sim/world/TerrainField.js";
import { EventLog } from "../../src/sim/history/EventLog.js";
import { MaterialRegistry } from "../../src/sim/materials/Material.js";
import { registerStandardMaterials } from "../../src/sim/materials/standardMaterials.js";
import { WaterField } from "../../src/sim/hydrology/WaterField.js";
import { Weather } from "../../src/sim/weather/Weather.js";
import type { World } from "../../src/sim/persistence/WorldSnapshot.js";
import { snapshotWorld, restoreWorld } from "../../src/sim/persistence/WorldSnapshot.js";
import { ALL_COMPONENT_TYPES } from "../../src/sim/persistence/AllComponentTypes.js";
import { RegionMap } from "../../src/sim/region/RegionMap.js";
import { createSite, getSite } from "../../src/sim/region/Site.js";
import { activateSite } from "../../src/sim/region/SiteActivation.js";
import { setSkills, getSkills } from "../../src/sim/creatures/Beaver.js";
import { setNeeds, getNeeds } from "../../src/sim/creatures/Needs.js";
import { resolveAttack, getWounds } from "../../src/sim/creatures/Anatomy.js";
import { setRelationshipWith, relationshipWith } from "../../src/sim/creatures/Relationships.js";
import { setOwner, OwnerComponent, getOwner } from "../../src/sim/creatures/Ownership.js";
import { setGood } from "../../src/sim/economy/Good.js";
import { nameOf } from "../../src/sim/creatures/Naming.js";
import {
  createWayfarer, getWayfarer, materializeWayfarer, departSiteAsWayfarer, travelToSite, wayfarerBeaverId, WayfarerLinkComponent,
} from "../../src/sim/wayfarer/Travel.js";

function buildRegionWorld(): { world: World; materials: MaterialRegistry; regionMap: RegionMap } {
  const entities = new EntityIdRegistry();
  const components = new ComponentStore(entities);
  const grid = new WorldGrid({ sizeX: 20, sizeY: 10, sizeZ: 20 }, entities);
  const materials = new MaterialRegistry();
  registerStandardMaterials(materials);
  const terrain = new TerrainField(grid, materials);
  for (let x = 0; x < 20; x++) for (let z = 0; z < 20; z++) for (let y = 0; y <= 2; y++) terrain.setMaterial(x, y, z, "soil");
  const water = new WaterField(grid);
  const weather = new Weather();
  const clock = new SimulationClock({ tickRateHz: 20 });
  const random = new RandomStreams(904);
  const events = new EventLog(entities);
  const world: World = { clock, random, entities, components, grid, terrain, events, water, weather };
  return { world, materials, regionMap: new RegionMap(16, 16) };
}

const BIOMES = { forest: 0.8, wetland: 0.7, grassland: 0.5, desert: 0.1, tundra: 0.1, mountain: 0.1 } as const;

describe("P9-04 -- Personal travel", () => {
  it("the controlled character moves between the same persistent sites used by world simulation", () => {
    const { world, materials, regionMap } = buildRegionWorld();
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) regionMap.setElevation(x, z, 0);

    const siteA = createSite(world, regionMap, 2, 2, 6, 120);
    const siteB = createSite(world, regionMap, 12, 2, 8, 200);

    // The persistent adventurer starts beside site A.
    const wayfarerId = createWayfarer(world, "Fenwick", 2, 2);
    const activatedA = activateSite(siteA, materials, world);
    const beaverAtA = materializeWayfarer(world, activatedA.world, wayfarerId, getWayfarer(world.components, wayfarerId)!, { x: 5, y: 3, z: 5 });
    expect(nameOf(activatedA.world, beaverAtA)).toBe("Fenwick");
    expect(activatedA.world.components.get(beaverAtA, WayfarerLinkComponent)?.regionWayfarerId).toBe(wayfarerId);

    // The adventurer LIVES at site A: skills, needs, a real wound, a
    // real friendship, and a real carried item.
    setSkills(activatedA.world.components, beaverAtA, { levels: { swimming: 2 } });
    setNeeds(activatedA.world.components, beaverAtA, { hunger: 0.4, thirst: 0.3, fatigue: 0.1, thermalComfort: 1 });
    const resident = activatedA.beaverIds.find((id) => id !== beaverAtA)!;
    setRelationshipWith(activatedA.world.components, beaverAtA, { withId: resident, kin: "sibling", familiarity: 0.9, affinity: 0.8 });
    setRelationshipWith(activatedA.world.components, resident, { withId: beaverAtA, kin: "sibling", familiarity: 0.9, affinity: 0.8 });
    resolveAttack(activatedA.world, resident, beaverAtA, 4, 0, activatedA.world.random.stream("wound"), undefined);
    const amulet = activatedA.world.entities.create("good");
    activatedA.world.grid.setEntityPosition(amulet, 6, 3, 6);
    setGood(activatedA.world.components, amulet, { goodKind: "artwork", materialId: "wood", massKg: 2, makerId: beaverAtA });
    setOwner(activatedA.world.components, amulet, { ownerType: "personal", ownerId: beaverAtA });

    // Departure: the wayfarer's live state is read back, the site's
    // summary deactivates through the REAL inverse, and the wayfarer is
    // "outside" with carried items promoted to region entities.
    const clockBefore = world.clock.tick;
    departSiteAsWayfarer(world, materials, wayfarerId, siteA, activatedA);
    const wayfarer = getWayfarer(world.components, wayfarerId)!;
    expect(wayfarer.atSiteId).toBeUndefined();
    expect(wayfarer.state.name).toBe("Fenwick");
    expect(wayfarer.state.skills).toEqual({ swimming: 2 });
    expect(wayfarer.state.needs.hunger).toBe(0.4);
    expect(wayfarer.state.wounds.length).toBe(1);
    expect(wayfarer.state.relations.some((r) => r.kin === "sibling")).toBe(true);
    expect(wayfarer.state.itemIds.length).toBe(1);
    expect(getSite(world.components, siteA)!.active).toBe(false);
    expect(getSite(world.components, siteA)!.populationCount).toBe(6); // the wayfarer left; residents remain
    expect(world.events.eventsOfType("wayfarer-departed-site").length).toBe(1);
    expect(world.events.eventsOfType("item-carried-off").length).toBe(1);

    // The journey pays the route's REAL travel cost in region time.
    const travel = travelToSite(world, regionMap, materials, wayfarerId, siteB, () => "forest", BIOMES);
    expect(travel.travelTicks).toBe(10); // Chebyshev distance 10, flat terrain => cost 10
    expect(world.clock.tick).toBe(clockBefore + 10);
    const arrivals = world.events.eventsOfType("wayfarer-arrived");
    expect(arrivals.length).toBe(1);
    expect(arrivals[0]!.causeEventId).toBe(world.events.eventsOfType("wayfarer-journey-started")[0]!.id);

    // At the destination, the SAME persistent character is materialized:
    // same name, same skills, same needs, same carried wound, same
    // remembered friendship (re-attached to the resident it names), and
    // the carried item is real and theirs.
    const beaverAtB = travel.beaverId;
    expect(nameOf(travel.activated.world, beaverAtB)).toBe("Fenwick");
    expect(travel.activated.world.components.get(beaverAtB, WayfarerLinkComponent)?.regionWayfarerId).toBe(wayfarerId);
    expect(getSkills(travel.activated.world.components, beaverAtB)?.levels).toEqual({ swimming: 2 });
    expect(getNeeds(travel.activated.world.components, beaverAtB)?.hunger).toBe(0.4);
    expect(getWounds(travel.activated.world.components, beaverAtB)?.entries.length).toBe(1);
    const owned = travel.activated.world.components.query(OwnerComponent).find((itemId) => {
      const owner = getOwner(travel.activated.world.components, itemId);
      return owner !== undefined && owner.ownerType === "personal" && owner.ownerId === beaverAtB;
    });
    expect(owned).toBeDefined();
    expect(getWayfarer(world.components, wayfarerId)!.atSiteId).toBe(siteB);
  });

  it("the wayfarer entity survives save/reload mid-journey", () => {
    const { world, materials, regionMap } = buildRegionWorld();
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) regionMap.setElevation(x, z, 0);
    const siteA = createSite(world, regionMap, 2, 2, 6, 120);
    const siteB = createSite(world, regionMap, 12, 2, 8, 200);
    const wayfarerId = createWayfarer(world, "Fenwick", 2, 2);
    const activatedA = activateSite(siteA, materials, world);
    const beaverAtA = materializeWayfarer(world, activatedA.world, wayfarerId, getWayfarer(world.components, wayfarerId)!, { x: 5, y: 3, z: 5 });
    setSkills(activatedA.world.components, beaverAtA, { levels: { combat: 3 } });
    departSiteAsWayfarer(world, materials, wayfarerId, siteA, activatedA);

    const restored = restoreWorld(snapshotWorld(world), { componentTypes: ALL_COMPONENT_TYPES, materials });
    const restoredWayfarer = getWayfarer(restored.components, wayfarerId)!;
    expect(restoredWayfarer.state.name).toBe("Fenwick");
    expect(restoredWayfarer.state.skills).toEqual({ combat: 3 });

    const regionMap2 = new RegionMap(16, 16);
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) regionMap2.setElevation(x, z, 0);
    const travel = travelToSite(restored, regionMap2, materials, wayfarerId, siteB, () => "forest", BIOMES);
    expect(nameOf(travel.activated.world, travel.beaverId)).toBe("Fenwick");
  });
});
