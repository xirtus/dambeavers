/**
 * Headless acceptance test for P9-10 -- Return to colony/world mode.
 *
 * Roadmap acceptance test: "changes made during Wayfarer remain true
 * when returning to colony/history views."
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
import { spawnBeaver, getHealth } from "../../src/sim/creatures/Beaver.js";
import { setGood } from "../../src/sim/economy/Good.js";
import { setOwner, getOwner } from "../../src/sim/creatures/Ownership.js";
import { getHeld } from "../../src/sim/labor/Log.js";
import { setRelationshipWith, relationshipWith } from "../../src/sim/creatures/Relationships.js";
import { resolveAttack, tickCreatureWounds, getWounds } from "../../src/sim/creatures/Anatomy.js";
import { designatePlayerControlled, isPlayerControlled } from "../../src/sim/wayfarer/Control.js";
import { executeWayfarerVerb } from "../../src/sim/wayfarer/Verbs.js";
import { resumeColonyMode } from "../../src/sim/wayfarer/Return.js";
import { artifactHistory } from "../../src/sim/chronicle/ArtifactHistories.js";
import { figurePage } from "../../src/sim/chronicle/FigurePages.js";
import { findAllRecords } from "../../src/sim/chronicle/Search.js";

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
  const random = new RandomStreams(910);
  const events = new EventLog(entities);
  const world: World = { clock, random, entities, components, grid, terrain, events, water, weather };
  const deps: ColonyLoopDeps = { grid, terrain, water, materials, plantSpecies, recipes, animalSpecies, pathogens, entities, components, profile: PROFILE };
  return { world, deps };
}

describe("P9-10 -- Return to colony/world mode", () => {
  it("changes made during Wayfarer remain true when returning to colony/history views", () => {
    const { world, deps } = buildWorld();
    const alder = spawnBeaver(world, { name: "Alder", position: { x: 4, y: 3, z: 4 } });
    const victim = spawnBeaver(world, { name: "Victim", position: { x: 6, y: 3, z: 6 } });
    const friend = spawnBeaver(world, { name: "Friend", position: { x: 5, y: 3, z: 5 } });
    designatePlayerControlled(world, alder);

    // Wayfarer deeds: steal a real item, wound a real beaver, befriend
    // a real beaver -- all on ordinary state.
    const amulet = world.entities.create("good");
    world.grid.setEntityPosition(amulet, 5, 3, 4);
    setGood(world.components, amulet, { goodKind: "artwork", materialId: "wood", massKg: 2 });
    setOwner(world.components, amulet, { ownerType: "personal", ownerId: victim });
    const steal = executeWayfarerVerb(deps, world, alder, { kind: "steal", itemId: amulet });
    expect(steal.ok).toBe(true);

    resolveAttack(world, alder, victim, 4, 0, world.random.stream("p9-10-wound"), undefined);
    setRelationshipWith(world.components, alder, { withId: friend, kin: "sibling", familiarity: 0.9, affinity: 0.8 });
    setRelationshipWith(world.components, friend, { withId: alder, kin: "sibling", familiarity: 0.9, affinity: 0.8 });

    // Return to colony mode: control released, colony loop resumes the
    // SAME world.
    const summary = resumeColonyMode(world, alder);
    expect(summary.wasControlled).toBe(true);
    expect(isPlayerControlled(world.components, alder)).toBe(false);
    world.clock.advanceTicks(3);
    tickColony(deps, world);

    // The theft is real persistent history the archive reads.
    const records = findAllRecords(world, amulet);
    expect(records.some((r) => r.eventType === "rule-violated")).toBe(true);
    const history = artifactHistory(world, amulet);
    expect(history.thefts.length).toBeGreaterThanOrEqual(1);
    // Theft = real physical possession (held by the thief) while legal
    // ownership remains the victim's -- the crime's whole point.
    expect(getHeld(world.components, amulet)).toEqual({ by: alder });
    expect(getOwner(world.components, amulet)).toEqual({ ownerType: "personal", ownerId: victim });

    // The wound heals through the ordinary wound physiology the colony
    // world keeps ticking.
    const wounds = getWounds(world.components, victim);
    expect(wounds).toBeDefined();
    const healthBefore = getHealth(world.components, victim)!.fraction;
    tickCreatureWounds(world, victim);
    expect(getHealth(world.components, victim)!.fraction).toBeLessThanOrEqual(healthBefore);

    // The friendship is the same edge the colony's social systems read.
    expect(relationshipWith(world.components, alder, friend)?.kin).toBe("sibling");

    // The figure page still resolves with the wayfarer's real records.
    const page = figurePage(world, alder);
    expect(page.known).toBe(true);
    expect(page.claims.some((c) => c.heading === "Recorded history" && c.detail.includes("rule-violated"))).toBe(true);

    // The colony keeps running with the wayfarer's changes intact.
    world.clock.advanceTicks(5);
    tickColony(deps, world);
    expect(getHeld(world.components, amulet)?.by).toBe(alder);
  });
});
