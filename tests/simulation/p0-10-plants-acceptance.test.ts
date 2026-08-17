/**
 * Headless acceptance test for P0-10 — Plants and trees as physical entities.
 *
 * Roadmap acceptance test (DAMN_BEAVERS_MASTER_ROADMAP.md, P0-10):
 *   "two trees of different size/species generate different physical
 *   quantities of wood based on entity state rather than a fixed loot
 *   table."
 *
 * Trees are built here directly via EntityIdRegistry/ComponentStore/
 * WorldGrid/TerrainField (P0-02/P0-03/P0-05/P0-09) plus this task's own
 * PlantSpeciesRegistry/PlantComponent -- there is no tree-spawning system
 * yet (that belongs to a later Phase 1 system layered on top of this).
 */
import { describe, expect, it } from "vitest";
import { EntityIdRegistry } from "../../src/sim/core/EntityId.js";
import { ComponentStore } from "../../src/sim/core/ComponentStore.js";
import { WorldGrid } from "../../src/sim/world/WorldGrid.js";
import { TerrainField } from "../../src/sim/world/TerrainField.js";
import { MaterialRegistry } from "../../src/sim/materials/Material.js";
import { registerStandardMaterials } from "../../src/sim/materials/standardMaterials.js";
import { PlantSpeciesRegistry } from "../../src/sim/ecology/PlantSpecies.js";
import { registerStandardPlantSpecies } from "../../src/sim/ecology/standardPlantSpecies.js";
import { harvestableWoodMassKg, isRootedInSoil, setPlant, getPlant, PlantComponent, type Plant } from "../../src/sim/ecology/Plant.js";
import { EventLog } from "../../src/sim/history/EventLog.js";
import { SimulationClock } from "../../src/sim/core/SimulationClock.js";
import { RandomStreams } from "../../src/sim/core/Random.js";
import { WaterField } from "../../src/sim/hydrology/WaterField.js";
import { Weather } from "../../src/sim/weather/Weather.js";
import { snapshotWorld, restoreWorld, type World } from "../../src/sim/persistence/WorldSnapshot.js";

describe("P0-10 acceptance: trees generate wood mass from entity state, not a fixed loot table", () => {
  it("two trees of different species/age yield different, entity-state-derived wood masses", () => {
    const entities = new EntityIdRegistry();
    const components = new ComponentStore(entities);
    const grid = new WorldGrid({ sizeX: 5, sizeY: 5, sizeZ: 5 }, entities);
    const materials = new MaterialRegistry();
    registerStandardMaterials(materials);
    const terrain = new TerrainField(grid, materials);
    const species = new PlantSpeciesRegistry();
    registerStandardPlantSpecies(species);

    // Plant two soil patches for the two trees to be rooted in.
    terrain.setMaterial(1, 0, 1, "soil");
    terrain.setMaterial(3, 0, 3, "soil");

    // Tree A: a young aspen.
    const treeA = entities.create("tree");
    grid.setEntityPosition(treeA, 1, 1, 1);
    const plantA: Plant = { speciesId: "aspen", ageTicks: 4000, health: 1 };
    setPlant(components, treeA, plantA);

    // Tree B: a mature willow -- a different species AND a different age/size.
    const treeB = entities.create("tree");
    grid.setEntityPosition(treeB, 3, 1, 3);
    const plantB: Plant = { speciesId: "willow", ageTicks: 12_000, health: 1 };
    setPlant(components, treeB, plantB);

    // -- both trees possess: species, position, age, size, wood material, health, root/soil relation, harvestable mass --
    for (const [tree, plant, cell] of [
      [treeA, plantA, { x: 1, y: 1, z: 1 }],
      [treeB, plantB, { x: 3, y: 1, z: 3 }],
    ] as const) {
      expect(entities.kindOf(tree)).toBe("tree");
      expect(grid.positionOf(tree)).toEqual(cell);
      const stored = getPlant(components, tree)!;
      expect(stored.ageTicks).toBe(plant.ageTicks); // age
      expect(species.has(stored.speciesId)).toBe(true); // species
      const speciesDef = species.get(stored.speciesId);
      expect(materials.has(speciesDef.woodMaterialId)).toBe(true); // wood material
      expect(stored.health).toBeGreaterThan(0); // health
      expect(isRootedInSoil(grid, terrain, cell, "soil")).toBe(true); // root/soil relation
    }

    // -- harvestable mass is computed from entity state, and differs between the two trees --
    const wood = materials.get("wood");
    const speciesA = species.get(plantA.speciesId);
    const speciesB = species.get(plantB.speciesId);
    const massA = harvestableWoodMassKg(speciesA, plantA, wood);
    const massB = harvestableWoodMassKg(speciesB, plantB, wood);

    expect(massA).toBeGreaterThan(0);
    expect(massB).toBeGreaterThan(0);
    expect(massA).not.toBeCloseTo(massB, 3); // genuinely different quantities

    // -- proof this is state-driven, not a fixed loot table: redefine the
    // world's understanding of "aspen" (a balance-patch-style data edit,
    // same technique P0-07's acceptance test used for materials) and
    // confirm the SAME plant state now yields a different mass with zero
    // code changes --
    const patchedSpecies = new PlantSpeciesRegistry();
    patchedSpecies.define({ ...speciesA, matureTrunkVolumeM3: speciesA.matureTrunkVolumeM3 * 10 });
    const patchedMassA = harvestableWoodMassKg(patchedSpecies.get("aspen"), plantA, wood);
    expect(patchedMassA).toBeCloseTo(massA * 10, 6);

    // -- and purely aging the SAME tree (no species change) changes its yield too --
    const olderPlantA: Plant = { ...plantA, ageTicks: speciesA.matureAgeTicks };
    const olderMassA = harvestableWoodMassKg(speciesA, olderPlantA, wood);
    expect(olderMassA).toBeGreaterThan(massA);
  });

  it("a tree's Plant data survives a real save/reload through WorldSnapshot with no special-casing", () => {
    const entities = new EntityIdRegistry();
    const components = new ComponentStore(entities);
    const grid = new WorldGrid({ sizeX: 3, sizeY: 3, sizeZ: 3 }, entities);
    const materials = new MaterialRegistry();
    registerStandardMaterials(materials);
    const terrain = new TerrainField(grid, materials);
    const events = new EventLog(entities);
    const world: World = {
      clock: new SimulationClock(),
      random: new RandomStreams(1),
      entities,
      components,
      grid,
      terrain,
      events,
      water: new WaterField(grid),
      weather: new Weather(),
    };
    const tree = entities.create("tree");
    setPlant(components, tree, { speciesId: "willow", ageTicks: 3000, health: 0.9 });

    const json = JSON.stringify(snapshotWorld(world));
    const restored = restoreWorld(JSON.parse(json), {
      componentTypes: new Map([["plant", PlantComponent]]),
      materials: (() => {
        const m = new MaterialRegistry();
        registerStandardMaterials(m);
        return m;
      })(),
    });

    expect(getPlant(restored.components, tree)).toEqual({ speciesId: "willow", ageTicks: 3000, health: 0.9 });
  });

  it("getPlant rejects a corrupted Plant value that reached the store via a snapshot restore, not just via setPlant", () => {
    // Mirrors the critic-found gap: ComponentStore.fromSnapshot never
    // validates component VALUES, so a hand-corrupted save can restore
    // garbage Plant state with no error until something reads it.
    const entities = new EntityIdRegistry();
    const components = new ComponentStore(entities);
    const tree = entities.create("tree");
    components.set(tree, PlantComponent, { speciesId: "willow", ageTicks: -50, health: 1 });
    const snapshot = components.toSnapshot();

    const restoredEntities = EntityIdRegistry.fromSnapshot(entities.toSnapshot());
    const restoredComponents = ComponentStore.fromSnapshot(
      snapshot,
      restoredEntities,
      new Map([["plant", PlantComponent]]),
    );
    // fromSnapshot itself does not throw -- the corruption is only in the
    // component VALUE, which ComponentStore never inspects.
    expect(() => getPlant(restoredComponents, tree)).toThrow(RangeError);
  });
});
