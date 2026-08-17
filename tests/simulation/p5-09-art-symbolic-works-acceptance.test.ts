/**
 * Headless acceptance test for P5-09 -- Art and symbolic works.
 *
 * Roadmap acceptance test: "created art can depict actual people,
 * animals, constructions, or past events by stable ID."
 *
 * An artwork is a real physical `Good` whose depiction must resolve to
 * something that genuinely exists or happened (a fabricated id throws).
 * It can depict a live beaver, a live animal, a construction, or a
 * recorded event by stable EntityId, and its quality comes from the SAME
 * P3-17 formula every other crafted good uses.
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
import { spawnBeaver } from "../../src/sim/creatures/Beaver.js";
import { AnimalSpeciesRegistry, registerStandardAnimalSpecies } from "../../src/sim/creatures/AnimalSpecies.js";
import { spawnAnimal } from "../../src/sim/creatures/Animal.js";
import { RecipeRegistry, registerStandardRecipes } from "../../src/sim/economy/Recipe.js";
import { getGood } from "../../src/sim/economy/Good.js";
import { createArtwork, getDepiction } from "../../src/sim/creatures/Art.js";
import { setConstruction } from "../../src/sim/labor/Construction.js";

function buildWorld(): { world: World; materials: MaterialRegistry; recipes: RecipeRegistry } {
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
  const random = new RandomStreams(509);
  const events = new EventLog(entities);
  const recipes = new RecipeRegistry();
  registerStandardRecipes(recipes);
  return { world: { clock, random, entities, components, grid, terrain, events, water, weather }, materials, recipes };
}

describe("P5-09 -- Art and symbolic works", () => {
  it("created art depicts real people, animals, constructions, and past events by stable ID", () => {
    const { world, materials, recipes } = buildWorld();
    const artist = spawnBeaver(world, { name: "Artist", position: { x: 3, y: 3, z: 3 } });

    // Real subjects of all four kinds.
    const subject = spawnBeaver(world, { name: "Subject", position: { x: 4, y: 3, z: 4 } });
    const animalSpecies = new AnimalSpeciesRegistry();
    registerStandardAnimalSpecies(animalSpecies);
    const animalId = spawnAnimal(world, animalSpecies, "rabbit", { x: 5, y: 3, z: 5 });
    const constructionId = world.entities.create("construction");
    setConstruction(world.components, constructionId, { designationId: constructionId, kind: "wall", site: { x: 6, z: 6 }, requiredMaterialId: "wood", requiredMassKg: 1, workDone: 1, workRequired: 1, status: "complete" });
    const eventId = world.events.record({ tick: 0, eventType: "leader-appointed", subjectIds: [subject], location: { x: 4, y: 3, z: 4 } });

    const recipe = recipes.get("carve-trinket");
    const portraitId = createArtwork(world, materials, recipe, 2, { kind: "beaver", id: subject }, artist, { x: 3, y: 3, z: 5 });
    const animalArtId = createArtwork(world, materials, recipe, 2, { kind: "animal", id: animalId }, artist, { x: 3, y: 3, z: 6 });
    const buildArtId = createArtwork(world, materials, recipe, 2, { kind: "construction", id: constructionId }, artist, { x: 3, y: 3, z: 7 });
    const eventArtId = createArtwork(world, materials, recipe, 2, { kind: "event", id: eventId }, artist, { x: 3, y: 3, z: 8 });

    for (const [artId, expected] of [
      [portraitId, { kind: "beaver", id: subject }],
      [animalArtId, { kind: "animal", id: animalId }],
      [buildArtId, { kind: "construction", id: constructionId }],
      [eventArtId, { kind: "event", id: eventId }],
    ] as const) {
      expect(getDepiction(world.components, artId)).toEqual(expected);
      const good = getGood(world.components, artId)!;
      expect(good.goodKind).toBe("artwork");
      expect(good.makerId).toBe(artist);
      expect(good.quality).toBeGreaterThanOrEqual(0);
      expect(good.quality).toBeLessThanOrEqual(1);
    }

    // An artwork cannot depict something that never existed/happened.
    expect(() => createArtwork(world, materials, recipe, 2, { kind: "beaver", id: 999999 }, artist, { x: 3, y: 3, z: 9 })).toThrow(RangeError);
    expect(() => createArtwork(world, materials, recipe, 2, { kind: "event", id: 999998 }, artist, { x: 3, y: 3, z: 9 })).toThrow(RangeError);
  });
});
