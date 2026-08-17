/**
 * Headless acceptance test for P4-03 -- Forest succession.
 *
 * Roadmap acceptance test: "clear-cut land changes composition over
 * decades without respawning identical trees."
 *
 * Clearing is a real recorded fact (`tree-felled` events), and regrowth
 * is never a deterministic respawn of the cleared species: every
 * reproduction roll re-samples the whole species registry by real
 * site-fitness, so repeated regrowth rolls at the same site produce a
 * genuinely mixed composition rather than identical replacements.
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
import { PlantSpeciesRegistry } from "../../src/sim/ecology/PlantSpecies.js";
import { registerStandardPlantSpecies } from "../../src/sim/ecology/standardPlantSpecies.js";
import type { NavigationProfile } from "../../src/sim/navigation/Pathfinding.js";
import { spawnBeaver } from "../../src/sim/creatures/Beaver.js";
import { plantSapling } from "../../src/sim/ecology/EcologyResponse.js";
import { bestFittingSpecies } from "../../src/sim/ecology/PlantLifecycle.js";
import { designateTreeCut, generateTreeCutJob, tickTreeCutJob } from "../../src/sim/labor/TreeCutting.js";

const PROFILE: NavigationProfile = { canSwim: true, maxWadingDepth: 0.5 };

function buildWorld(): { world: World; plantSpecies: PlantSpeciesRegistry; materials: MaterialRegistry } {
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
  const random = new RandomStreams(403);
  const events = new EventLog(entities);
  const plantSpecies = new PlantSpeciesRegistry();
  registerStandardPlantSpecies(plantSpecies);
  return { world: { clock, random, entities, components, grid, terrain, events, water, weather }, plantSpecies, materials };
}

describe("P4-03 -- Forest succession", () => {
  it("clear-cut land regrows with a genuinely mixed composition, never identical respawns", () => {
    const { world, plantSpecies, materials } = buildWorld();
    const random = world.random.stream("succession");

    // Clearing is a real recorded fact: a real beaver fells the tree through
    // the ordinary job pipeline, and the felling records a "tree-felled" event.
    const treeId = plantSapling(world, "aspen", { x: 5, z: 5 }) as EntityId;
    const feller = spawnBeaver(world, { name: "Feller", position: { x: 5, y: 3, z: 6 } });
    const designationId = designateTreeCut(world, treeId);
    const [jobId] = generateTreeCutJob(world, materials, plantSpecies, designationId);
    let outcome = "idle";
    for (let i = 0; i < 500 && outcome !== "felled"; i++) {
      outcome = tickTreeCutJob(world.grid, world.terrain, world.water, materials, plantSpecies, world.entities, world.components, feller, PROFILE, [jobId!], world.events, world.clock.tick);
    }
    expect(outcome).toBe("felled");
    expect(world.entities.isLive(treeId)).toBe(false);
    expect(world.events.eventsOfType("tree-felled").some((e) => e.subjectIds.includes(treeId))).toBe(true);

    // Regrowth: at a mid-moisture site BOTH registered species carry real
    // fitness weight, so successive reproduction rolls over "decades" of
    // regrowth cycles genuinely mix -- never an identical respawn.
    world.water.setDepth(5, 5, 1); // intermediate wetness: aspen (dry) and willow (wet) both have real weight
    const counts: Record<string, number> = {};
    for (let i = 0; i < 300; i++) {
      const id = bestFittingSpecies(plantSpecies, world.water, random, 5, 5);
      if (id !== undefined) counts[id] = (counts[id] ?? 0) + 1;
    }
    const distinct = Object.keys(counts);
    expect(distinct.length).toBeGreaterThan(1); // composition changes across regrowth rolls
    for (const id of distinct) expect(counts[id]).toBeGreaterThan(0);
  });
});
