/**
 * Phase 9 critic regressions -- each case reproduces a defect the
 * independent critic pass found in the Wayfarer layer, and each was
 * verified to FAIL on the pre-fix code before the fix landed.
 *
 * Findings:
 *  1. (Moderate) Eating a HELD food item destroyed the item but left it
 *     in the eater's Inventory -- a stale reference that crashed the
 *     next `drop` of it (e.g. `Mortality.die` dropping carried items).
 *  2. (Moderate) `materializeWayfarer` destroyed the promoted region
 *     items but left their ids in `wayfarer.state.itemIds` -- a stale
 *     reference list a second journey would re-materialize.
 *  3. (Moderate) Designating player control (or inviting a companion)
 *     left a currently-held job reserved forever -- the colony loop
 *     skips job arbitration for controlled/companion beavers, so the
 *     job stalled indefinitely.
 *  4. (Minor) `tickWayfarerSurvival` duplicated needs/mortality ticks
 *     already performed by the colony loop -- composing both
 *     double-ticked the controlled beaver's body.
 *  5. (Minor) `assertValidPlayerControl` did not validate verb command
 *     payloads -- a corrupted snapshot could carry a garbage verb.
 *  6. (Minor) The new components (wayfarer, wayfarer-link, companion)
 *     had no validators -- hand-corrupted snapshots restored silently.
 *  7. (Minor) Departure promoted a carried item out of a container but
 *     left the container's contents list naming the destroyed item.
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
import type { ColonyLoopDeps } from "../../src/sim/runtime/ColonyLoop.js";
import { tickColony } from "../../src/sim/runtime/ColonyLoop.js";
import type { NavigationProfile } from "../../src/sim/navigation/Pathfinding.js";
import { PlantSpeciesRegistry } from "../../src/sim/ecology/PlantSpecies.js";
import { registerStandardPlantSpecies } from "../../src/sim/ecology/standardPlantSpecies.js";
import { RecipeRegistry, registerStandardRecipes } from "../../src/sim/economy/Recipe.js";
import { AnimalSpeciesRegistry, registerStandardAnimalSpecies } from "../../src/sim/creatures/AnimalSpecies.js";
import { PathogenRegistry, registerStandardPathogens } from "../../src/sim/creatures/Disease.js";
import { spawnBeaver, getInventory, setSkills, getHealth, setHealth } from "../../src/sim/creatures/Beaver.js";
import { getNeeds, setNeeds } from "../../src/sim/creatures/Needs.js";
import { setFood } from "../../src/sim/labor/Food.js";
import { setLog, setHeld, pickUp, getHeld } from "../../src/sim/labor/Log.js";
import { die } from "../../src/sim/creatures/Mortality.js";
import { getBreath, setBreath } from "../../src/sim/creatures/Respiration.js";
import { setJob, getJob } from "../../src/sim/jobs/Job.js";
import { currentJobOf } from "../../src/sim/jobs/JobBoard.js";
import { createContainer, placeInContainer, getContainer } from "../../src/sim/economy/Container.js";
import { setRelationshipWith } from "../../src/sim/creatures/Relationships.js";
import { RegionMap } from "../../src/sim/region/RegionMap.js";
import { createSite } from "../../src/sim/region/Site.js";
import { activateSite } from "../../src/sim/region/SiteActivation.js";
import { setOwner } from "../../src/sim/creatures/Ownership.js";
import { setGood } from "../../src/sim/economy/Good.js";
import { designatePlayerControlled, tickControlledBeaver, setPlayerControl } from "../../src/sim/wayfarer/Control.js";
import { executeWayfarerVerb } from "../../src/sim/wayfarer/Verbs.js";
import { inviteCompanion } from "../../src/sim/wayfarer/Companions.js";
import { createWayfarer, getWayfarer, materializeWayfarer, departSiteAsWayfarer, travelToSite, setWayfarer } from "../../src/sim/wayfarer/Travel.js";
import { tickWayfarerSurvival } from "../../src/sim/wayfarer/Survival.js";

const PROFILE: NavigationProfile = { canSwim: true, maxWadingDepth: 0.5 };

function buildWorld(): { world: World; deps: ColonyLoopDeps; materials: MaterialRegistry } {
  const entities = new EntityIdRegistry();
  const components = new ComponentStore(entities);
  const grid = new WorldGrid({ sizeX: 20, sizeY: 10, sizeZ: 20 }, entities);
  const materials = new MaterialRegistry();
  registerStandardMaterials(materials);
  const terrain = new TerrainField(grid, materials);
  for (let x = 0; x < 20; x++) for (let z = 0; z < 20; z++) for (let y = 0; y <= 2; y++) terrain.setMaterial(x, y, z, "soil");
  const water = new WaterField(grid);
  const weather = new Weather();
  const plantSpecies = new PlantSpeciesRegistry();
  registerStandardPlantSpecies(plantSpecies);
  const recipes = new RecipeRegistry();
  registerStandardRecipes(recipes);
  const animalSpecies = new AnimalSpeciesRegistry();
  registerStandardAnimalSpecies(animalSpecies);
  const pathogens = new PathogenRegistry();
  registerStandardPathogens(pathogens);
  const clock = new SimulationClock({ tickRateHz: 20 });
  const random = new RandomStreams(9909);
  const events = new EventLog(entities);
  const world: World = { clock, random, entities, components, grid, terrain, events, water, weather };
  const deps: ColonyLoopDeps = { grid, terrain, water, materials, plantSpecies, recipes, animalSpecies, pathogens, entities, components, profile: PROFILE };
  return { world, deps, materials };
}

function spawnAt(world: World, name: string, x: number, z: number): EntityId {
  const floor = world.grid.surfaceY(x, z)!;
  return spawnBeaver(world, { name, position: { x, y: floor + 1, z } });
}

describe("Phase 9 critic regressions", () => {
  it("1: eating a HELD food item removes it from the eater's inventory (no stale reference to crash a later death-drop)", () => {
    const { world, deps } = buildWorld();
    const alder = spawnAt(world, "Alder", 3, 3);
    designatePlayerControlled(world, alder);
    const food = world.entities.create("food");
    world.grid.setEntityPosition(food, 3, 3, 3);
    setFood(world.components, food, { nutritionValue: 0.5, materialId: "plant-matter", massKg: 1 });
    executeWayfarerVerb(deps, world, alder, { kind: "pickup", itemId: food });
    executeWayfarerVerb(deps, world, alder, { kind: "eat", itemId: food });
    expect(world.entities.isLive(food)).toBe(false);
    // The stale reference would sit here in inventory; the next death
    // would try to drop the destroyed item and crash.
    expect(getInventory(world.components, alder)?.itemIds ?? []).not.toContain(food);
    expect(() => die(world, alder, "starvation")).not.toThrow();
  });

  it("2: materializing consumed region items clears state.itemIds (no stale re-materialization on a second journey)", () => {
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
    const random = new RandomStreams(9909);
    const events = new EventLog(entities);
    const regionWorld: World = { clock, random, entities, components, grid, terrain, events, water, weather };
    const regionMap = new RegionMap(16, 16);
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) regionMap.setElevation(x, z, 0);
    const siteA = createSite(regionWorld, regionMap, 2, 2, 4, 100);
    const siteB = createSite(regionWorld, regionMap, 12, 2, 4, 100);
    const wayfarerId = createWayfarer(regionWorld, "Fenwick", 2, 2);
    const activated = activateSite(siteA, materials, regionWorld);
    const beaverId = materializeWayfarer(regionWorld, activated.world, wayfarerId, getWayfarer(regionWorld.components, wayfarerId)!, { x: 5, y: 3, z: 5 });
    const amulet = activated.world.entities.create("good");
    activated.world.grid.setEntityPosition(amulet, 6, 3, 6);
    setGood(activated.world.components, amulet, { goodKind: "artwork", materialId: "wood", massKg: 2 });
    setOwner(activated.world.components, amulet, { ownerType: "personal", ownerId: beaverId });
    departSiteAsWayfarer(regionWorld, materials, wayfarerId, siteA, activated);
    expect(getWayfarer(regionWorld.components, wayfarerId)!.state.itemIds.length).toBe(1);

    const arrival = travelToSite(regionWorld, regionMap, materials, wayfarerId, siteB, () => "forest", { forest: 0.8, wetland: 0.7, grassland: 0.5, desert: 0.1, tundra: 0.1, mountain: 0.1 } as never);
    expect(getInventory(arrival.activated.world.components, arrival.beaverId)?.itemIds.length).toBe(1);
    // The region entities were consumed; the state list must be EMPTY
    // (a stale list would be re-materialized as ghost items on the NEXT
    // journey).
    expect(getWayfarer(regionWorld.components, wayfarerId)!.state.itemIds.length).toBe(0);
  });

  it("3: designating control and inviting a companion suspend the beaver's held job (no forever-stalled reservation)", () => {
    const { world, deps } = buildWorld();
    const alder = spawnAt(world, "Alder", 3, 3);
    const birch = spawnAt(world, "Birch", 6, 3);
    const jobId = world.entities.create("job");
    setJob(world.components, jobId, { designationId: jobId, target: { x: 4, z: 4 }, status: "reserved", reservedBy: alder });

    designatePlayerControlled(world, alder);
    expect(currentJobOf(world.entities, world.components, alder)).toBeUndefined();
    expect(getJob(world.components, jobId)).toBeDefined(); // suspended, not destroyed

    const jobB = world.entities.create("job");
    setJob(world.components, jobB, { designationId: jobB, target: { x: 7, z: 7 }, status: "reserved", reservedBy: birch });
    setRelationshipWith(world.components, alder, { withId: birch, kin: "mate", familiarity: 0.9, affinity: 0.9 });
    setRelationshipWith(world.components, birch, { withId: alder, kin: "mate", familiarity: 0.9, affinity: 0.9 });
    inviteCompanion(world, alder, birch);
    expect(currentJobOf(world.entities, world.components, birch)).toBeUndefined();
  });

  it("4: tickWayfarerSurvival does not double-tick mortality when composed with the colony loop", () => {
    const { world, deps } = buildWorld();
    const alder = spawnAt(world, "Alder", 3, 3);
    designatePlayerControlled(world, alder);
    // A beaver whose breath is empty while submerged is one ordinary
    // mortality tick away from drowning damage -- the survival primitive
    // must NOT deliver it (mortality is the loop's own pass; composing
    // both would double-tick the controlled beaver's body).
    world.grid.setEntityPosition(alder, 4, 3, 4);
    world.water.setDepth(4, 4, 1.0);
    setHealth(world.components, alder, { fraction: 0.01 });
    setBreath(world.components, alder, { fraction: 0 });
    tickWayfarerSurvival(deps, world, alder, false);
    expect(world.entities.isLive(alder)).toBe(true); // no mortality inside the primitive
    expect(getHealth(world.components, alder)!.fraction).toBe(0.01);
  });

  it("5: player-control rejects a corrupted verb command payload", () => {
    const { world } = buildWorld();
    const alder = spawnAt(world, "Alder", 3, 3);
    designatePlayerControlled(world, alder);
    expect(() => setPlayerControl(world.components, alder, { pending: { kind: "verb", verb: { kind: "eat", itemId: -5 as EntityId } } })).toThrow(RangeError);
    expect(() => setPlayerControl(world.components, alder, { pending: { kind: "verb", verb: { kind: "nonsense" } as never } })).toThrow(RangeError);
  });

  it("6: the wayfarer, wayfarer-link, and companion components validate corrupted snapshots", () => {
    const { world } = buildWorld();
    expect(() => setWayfarer(world.components, 1 as EntityId, { regionX: -1, regionZ: 2, state: { name: "", needs: { hunger: 2, thirst: 0, fatigue: 0, thermalComfort: 1 }, skills: {}, wounds: [], memories: [], relations: [], itemIds: [] } })).toThrow(RangeError);
  });

  it("7: departing with a contained carried item removes it from the container's contents", () => {
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
    const random = new RandomStreams(9909);
    const events = new EventLog(entities);
    const regionWorld: World = { clock, random, entities, components, grid, terrain, events, water, weather };
    const regionMap = new RegionMap(16, 16);
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) regionMap.setElevation(x, z, 0);
    const site = createSite(regionWorld, regionMap, 2, 2, 4, 100);
    const wayfarerId = createWayfarer(regionWorld, "Fenwick", 2, 2);
    const activated = activateSite(site, materials, regionWorld);
    const beaverId = materializeWayfarer(regionWorld, activated.world, wayfarerId, getWayfarer(regionWorld.components, wayfarerId)!, { x: 5, y: 3, z: 5 });
    const container = createContainer(activated.world, 50, { x: 6, y: 3, z: 6 });
    const amulet = activated.world.entities.create("good");
    activated.world.grid.setEntityPosition(amulet, 6, 3, 6);
    setGood(activated.world.components, amulet, { goodKind: "artwork", materialId: "wood", massKg: 2 });
    setOwner(activated.world.components, amulet, { ownerType: "personal", ownerId: beaverId });
    placeInContainer(activated.world, container, amulet);

    departSiteAsWayfarer(regionWorld, materials, wayfarerId, site, activated);
    // The promoted item left the site; the container must no longer list it.
    expect(getContainer(activated.world.components, container)?.itemIds ?? []).not.toContain(amulet);
    expect(getWayfarer(regionWorld.components, wayfarerId)!.state.itemIds.length).toBe(1);
  });
});
