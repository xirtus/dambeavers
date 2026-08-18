/**
 * Headless acceptance test for P9-08 -- Companions.
 *
 * Roadmap acceptance test: "autonomous characters can accompany the
 * player for social/systemic reasons while retaining ordinary AI."
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
import { spawnBeaver } from "../../src/sim/creatures/Beaver.js";
import { setRelationshipWith, relationshipWith } from "../../src/sim/creatures/Relationships.js";
import { getNeeds, setNeeds } from "../../src/sim/creatures/Needs.js";
import { designatePlayerControlled, submitWayfarerCommand, getPlayerControl } from "../../src/sim/wayfarer/Control.js";
import { companionWillingness, inviteCompanion, dismissCompanion, isCompanion, companionsOf, tickCompanion } from "../../src/sim/wayfarer/Companions.js";

const PROFILE: NavigationProfile = { canSwim: true, maxWadingDepth: 0.5 };

function buildWorld(): { world: World; deps: ColonyLoopDeps } {
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
  const random = new RandomStreams(908);
  const events = new EventLog(entities);
  const world: World = { clock, random, entities, components, grid, terrain, events, water, weather };
  const deps: ColonyLoopDeps = { grid, terrain, water, materials, plantSpecies, recipes, animalSpecies, pathogens, entities, components, profile: PROFILE };
  return { world, deps };
}

describe("P9-08 -- Companions", () => {
  it("autonomous characters accompany the player for social/systemic reasons while retaining ordinary AI", () => {
    const { world, deps } = buildWorld();
    const alder = spawnBeaver(world, { name: "Alder", position: { x: 3, y: 3, z: 3 } });
    const mateBeaver = spawnBeaver(world, { name: "Mate", position: { x: 6, y: 3, z: 3 } });
    const stranger = spawnBeaver(world, { name: "Stranger", position: { x: 9, y: 3, z: 3 } });
    designatePlayerControlled(world, alder);

    // Willingness derives from the REAL relationship edge: a stranger
    // will not follow; a mate will.
    expect(companionWillingness(world, alder, stranger)).toBe(0);
    setRelationshipWith(world.components, alder, { withId: mateBeaver, kin: "mate", familiarity: 0.9, affinity: 0.9 });
    setRelationshipWith(world.components, mateBeaver, { withId: alder, kin: "mate", familiarity: 0.9, affinity: 0.9 });
    const willingness = companionWillingness(world, alder, mateBeaver);
    expect(willingness).toBeGreaterThanOrEqual(0.5);
    expect(inviteCompanion(world, alder, stranger)).toBeUndefined();
    const invited = inviteCompanion(world, alder, mateBeaver);
    expect(invited).toBeDefined();
    expect(isCompanion(world.components, mateBeaver)).toBe(true);
    expect(companionsOf(world.components, alder)).toEqual([mateBeaver]);
    expect(world.events.eventsOfType("companion-joined").length).toBe(1);

    // Ordinary AI retained: the companion still arbitrates its own
    // needs through the colony loop (fatigue recovers while following).
    const matePositionBefore = world.grid.positionOf(mateBeaver)!;
    const playerFarAway = { x: 15, z: 15 };
    world.grid.setEntityPosition(alder, playerFarAway.x, 3, playerFarAway.z);
    tickCompanion(deps, world, mateBeaver);
    const matePositionAfter = world.grid.positionOf(mateBeaver)!;
    const distanceBefore = Math.hypot(matePositionBefore.x - playerFarAway.x, matePositionBefore.z - playerFarAway.z);
    const distanceAfter = Math.hypot(matePositionAfter.x - playerFarAway.x, matePositionAfter.z - playerFarAway.z);
    expect(distanceAfter).toBeLessThan(distanceBefore); // one ordinary movement step toward the player

    // The companion's needs tick through the ordinary loop unchanged.
    setNeeds(world.components, mateBeaver, { hunger: 0.5, thirst: 0.5, fatigue: 0.5, thermalComfort: 1 });
    world.clock.advanceTicks(1);
    tickColony(deps, world);
    expect(getNeeds(world.components, mateBeaver)!.fatigue).toBeLessThan(0.5); // rest recovered via ordinary arbitration

    // Dismissal is a real recorded leave.
    dismissCompanion(world, mateBeaver, "test dismissal");
    expect(isCompanion(world.components, mateBeaver)).toBe(false);
    expect(world.events.eventsOfType("companion-left").length).toBe(1);

    // A companion whose player is gone leaves honestly.
    const secondPlayer = spawnBeaver(world, { name: "Player2", position: { x: 12, y: 3, z: 12 } });
    const follower = spawnBeaver(world, { name: "Follower", position: { x: 13, y: 3, z: 12 } });
    setRelationshipWith(world.components, secondPlayer, { withId: follower, kin: "sibling", familiarity: 0.9, affinity: 0.8 });
    setRelationshipWith(world.components, follower, { withId: secondPlayer, kin: "sibling", familiarity: 0.9, affinity: 0.8 });
    inviteCompanion(world, secondPlayer, follower);
    world.entities.destroy(secondPlayer);
    tickCompanion(deps, world, follower);
    expect(isCompanion(world.components, follower)).toBe(false);
    expect(world.events.eventsOfType("companion-left").some((e) => e.subjectIds.includes(follower))).toBe(true);
  });
});
