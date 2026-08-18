/**
 * Headless acceptance test for P9-07 -- Personal reputation and consequences.
 *
 * Roadmap acceptance test: "crimes, aid, violence, theft, kinship, and
 * heroism alter persistent social/history state."
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
import type { NavigationProfile } from "../../src/sim/navigation/Pathfinding.js";
import { PlantSpeciesRegistry } from "../../src/sim/ecology/PlantSpecies.js";
import { registerStandardPlantSpecies } from "../../src/sim/ecology/standardPlantSpecies.js";
import { RecipeRegistry, registerStandardRecipes } from "../../src/sim/economy/Recipe.js";
import { AnimalSpeciesRegistry, registerStandardAnimalSpecies } from "../../src/sim/creatures/AnimalSpecies.js";
import { PathogenRegistry, registerStandardPathogens } from "../../src/sim/creatures/Disease.js";
import { spawnBeaver, setSkills } from "../../src/sim/creatures/Beaver.js";
import { setGood } from "../../src/sim/economy/Good.js";
import { setOwner } from "../../src/sim/creatures/Ownership.js";
import { makeWeapon } from "../../src/sim/politics/Weaponry.js";
import { reputationOf } from "../../src/sim/creatures/Reputation.js";
import { setRelationshipWith } from "../../src/sim/creatures/Relationships.js";
import { getHeld, pickUp } from "../../src/sim/labor/Log.js";
import { formBelief, performRitual } from "../../src/sim/creatures/Belief.js";
import { createHousehold, setHouseholdMembership } from "../../src/sim/creatures/Relationships.js";
import { playerSteal, wayfarerDeeds } from "../../src/sim/wayfarer/Consequences.js";
import { playerAttack } from "../../src/sim/wayfarer/Combat.js";

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
  const random = new RandomStreams(907);
  const events = new EventLog(entities);
  const world: World = { clock, random, entities, components, grid, terrain, events, water, weather };
  const deps: ColonyLoopDeps = { grid, terrain, water, materials, plantSpecies, recipes, animalSpecies, pathogens, entities, components, profile: PROFILE };
  return { world, deps };
}

describe("P9-07 -- Personal reputation and consequences", () => {
  it("crimes, aid, violence, theft, kinship, and heroism alter persistent social/history state", () => {
    const { world, deps } = buildWorld();
    const alder = spawnBeaver(world, { name: "Alder", position: { x: 4, y: 3, z: 4 } });
    const victim = spawnBeaver(world, { name: "Victim", position: { x: 6, y: 3, z: 6 } });
    const witness = spawnBeaver(world, { name: "Witness", position: { x: 5, y: 3, z: 5 } });

    // THEFT: a real violation record + real physical taking; reputation
    // drops because the recorded violation EXISTS (P5-13's own weights).
    const amulet = world.entities.create("good");
    world.grid.setEntityPosition(amulet, 5, 3, 4);
    setGood(world.components, amulet, { goodKind: "artwork", materialId: "wood", massKg: 2 });
    setOwner(world.components, amulet, { ownerType: "personal", ownerId: victim });
    const reputationBefore = reputationOf(world, alder);
    const steal = playerSteal(deps, world, alder, amulet);
    expect(steal.ok).toBe(true);
    expect(world.events.eventsOfType("rule-violated").some((e) => e.subjectIds.includes(alder) && e.objectIds.includes(amulet))).toBe(true);
    expect(getHeld(world.components, amulet)).toEqual({ by: alder }); // really taken
    expect(reputationOf(world, alder)).toBeLessThan(reputationBefore);

    // VIOLENCE: a real wound record against a real victim.
    setSkills(world.components, alder, { levels: { combat: 1 } });
    const club = world.entities.create("good");
    world.grid.setEntityPosition(club, 4, 3, 5);
    setGood(world.components, club, { goodKind: "club", materialId: "wood", massKg: 10 });
    makeWeapon(world.components, club, "club", 2, 0.2);
    pickUp(world.components, world.grid, club, alder, world); // the attacker really holds it
    world.grid.setEntityPosition(victim, 4, 3, 5);
    const attack = playerAttack(world, deps.materials, alder, victim, world.random.stream("p9-07-attack"));
    expect(attack.wounded).toBe(true);
    expect(world.events.eventsOfType("wound-inflicted").length).toBeGreaterThan(0);

    // KINSHIP: real edges persist.
    setRelationshipWith(world.components, alder, { withId: witness, kin: "sibling", familiarity: 0.9, affinity: 0.8 });
    expect(wayfarerDeeds(world, alder).kinCount).toBeGreaterThanOrEqual(1);

    // AID: a real ritual with real participants.
    const household = createHousehold(world);
    setHouseholdMembership(world.components, alder, { householdId: household });
    setHouseholdMembership(world.components, witness, { householdId: household });
    const belief = formBelief(world, world.events.eventsOfType("rule-violated")[0]!.id, household);
    performRitual(world, belief, [alder, witness]);
    expect(wayfarerDeeds(world, alder).aidGiven).toBeGreaterThanOrEqual(1);

    // The deed summary is derived from the SAME records Chronicle reads.
    const deeds = wayfarerDeeds(world, alder);
    expect(deeds.violationsCommitted).toBeGreaterThanOrEqual(1);
    expect(deeds.woundsInflicted).toBeGreaterThanOrEqual(1);
    expect(deeds.reputation).toBeLessThan(0); // net-negative from the theft

    // Stealing from no one fails honestly.
    const strayLog = world.entities.create("log");
    world.grid.setEntityPosition(strayLog, 8, 3, 8);
    expect(playerSteal(deps, world, alder, strayLog).ok).toBe(false);
  });
});
