import { describe, expect, it } from "vitest";
import { EntityIdRegistry } from "../../src/sim/core/EntityId.js";
import { ComponentStore } from "../../src/sim/core/ComponentStore.js";
import { WorldGrid } from "../../src/sim/world/WorldGrid.js";
import { TerrainField } from "../../src/sim/world/TerrainField.js";
import { MaterialRegistry } from "../../src/sim/materials/Material.js";
import { registerStandardMaterials } from "../../src/sim/materials/standardMaterials.js";
import {
  PlantComponent,
  harvestableWoodMassKg,
  isRootedInSoil,
  setPlant,
  getPlant,
  type Plant,
} from "../../src/sim/ecology/Plant.js";
import type { PlantSpeciesDefinition } from "../../src/sim/ecology/PlantSpecies.js";

const ASPEN: PlantSpeciesDefinition = {
  id: "aspen",
  displayName: "Aspen",
  woodMaterialId: "wood",
  matureTrunkVolumeM3: 0.3,
  matureAgeTicks: 20_000,
};

function makeMaterials(): MaterialRegistry {
  const materials = new MaterialRegistry();
  registerStandardMaterials(materials);
  return materials;
}

describe("PlantComponent", () => {
  it("attaches to an entity via ComponentStore", () => {
    const entities = new EntityIdRegistry();
    const components = new ComponentStore(entities);
    const tree = entities.create("tree");
    const plant: Plant = { speciesId: "aspen", ageTicks: 5000, health: 1 };

    components.set(tree, PlantComponent, plant);
    expect(components.get(tree, PlantComponent)).toEqual(plant);
  });
});

describe("setPlant/getPlant (validated read/write path)", () => {
  it("writes and reads back valid plant state", () => {
    const entities = new EntityIdRegistry();
    const components = new ComponentStore(entities);
    const tree = entities.create("tree");
    const plant: Plant = { speciesId: "aspen", ageTicks: 5000, health: 1 };

    setPlant(components, tree, plant);
    expect(getPlant(components, tree)).toEqual(plant);
  });

  it("returns undefined from getPlant for an entity with no Plant component", () => {
    const entities = new EntityIdRegistry();
    const components = new ComponentStore(entities);
    const tree = entities.create("tree");
    expect(getPlant(components, tree)).toBeUndefined();
  });

  it("setPlant rejects invalid state before it ever reaches ComponentStore -- garbage never becomes authoritative state", () => {
    const entities = new EntityIdRegistry();
    const components = new ComponentStore(entities);
    const tree = entities.create("tree");

    expect(() => setPlant(components, tree, { speciesId: "aspen", ageTicks: -999, health: 1 })).toThrow(RangeError);
    expect(() => setPlant(components, tree, { speciesId: "aspen", ageTicks: 0.5, health: 1 })).toThrow(RangeError);
    expect(() => setPlant(components, tree, { speciesId: "aspen", ageTicks: 0, health: 42 })).toThrow(RangeError);
    // None of the rejected writes actually landed in the store.
    expect(getPlant(components, tree)).toBeUndefined();
  });

  it("getPlant re-validates data that bypassed setPlant (e.g. a hand-corrupted restore), catching it at first read", () => {
    const entities = new EntityIdRegistry();
    const components = new ComponentStore(entities);
    const tree = entities.create("tree");
    // Simulates corrupted data arriving via ComponentStore.fromSnapshot,
    // which never validates component VALUES -- the exact gap setPlant
    // alone can't close, since it only guards writes made through it.
    components.set(tree, PlantComponent, { speciesId: "aspen", ageTicks: -999999, health: 7 });

    expect(() => getPlant(components, tree)).toThrow(RangeError);
  });
});

describe("harvestableWoodMassKg", () => {
  it("is a positive quantity derived from species + age, not a fixed lookup", () => {
    const materials = makeMaterials();
    const wood = materials.get("wood");
    const young: Plant = { speciesId: "aspen", ageTicks: 5000, health: 1 };
    const old: Plant = { speciesId: "aspen", ageTicks: 20_000, health: 1 };

    const youngMass = harvestableWoodMassKg(ASPEN, young, wood);
    const oldMass = harvestableWoodMassKg(ASPEN, old, wood);

    expect(youngMass).toBeGreaterThan(0);
    expect(oldMass).toBeGreaterThan(youngMass); // older tree of the same species yields more wood
    expect(oldMass).toBeCloseTo(wood.density * ASPEN.matureTrunkVolumeM3, 6);
  });

  it("differs between two species at the identical age, purely from species data", () => {
    const materials = makeMaterials();
    const wood = materials.get("wood");
    const willow: PlantSpeciesDefinition = {
      id: "willow",
      displayName: "Willow",
      woodMaterialId: "wood",
      matureTrunkVolumeM3: 0.6,
      matureAgeTicks: 12_000,
    };
    // Same age on both -- harvestableWoodMassKg takes PlantSpeciesProperties
    // directly and never consults speciesId itself, so each plant object's
    // speciesId matches the species it's actually passed with, for clarity.
    const aspenAt12k: Plant = { speciesId: "aspen", ageTicks: 12_000, health: 1 };
    const willowAt12k: Plant = { speciesId: "willow", ageTicks: 12_000, health: 1 };

    const aspenMass = harvestableWoodMassKg(ASPEN, aspenAt12k, wood);
    const willowMass = harvestableWoodMassKg(willow, willowAt12k, wood);
    expect(willowMass).toBeGreaterThan(aspenMass);
  });

  it("rejects an invalid plant state (negative age, out-of-range health)", () => {
    const materials = makeMaterials();
    const wood = materials.get("wood");
    expect(() => harvestableWoodMassKg(ASPEN, { speciesId: "aspen", ageTicks: -1, health: 1 }, wood)).toThrow(
      RangeError,
    );
    expect(() => harvestableWoodMassKg(ASPEN, { speciesId: "aspen", ageTicks: 0, health: 1.5 }, wood)).toThrow(
      RangeError,
    );
  });
});

describe("isRootedInSoil", () => {
  it("is true when the cell directly below is the given soil material", () => {
    const entities = new EntityIdRegistry();
    const grid = new WorldGrid({ sizeX: 3, sizeY: 3, sizeZ: 3 }, entities);
    const materials = makeMaterials();
    const terrain = new TerrainField(grid, materials);
    terrain.setMaterial(1, 0, 1, "soil");

    expect(isRootedInSoil(grid, terrain, { x: 1, y: 1, z: 1 }, "soil")).toBe(true);
  });

  it("is false when the cell below is a different material", () => {
    const entities = new EntityIdRegistry();
    const grid = new WorldGrid({ sizeX: 3, sizeY: 3, sizeZ: 3 }, entities);
    const materials = makeMaterials();
    const terrain = new TerrainField(grid, materials);
    terrain.setMaterial(1, 0, 1, "stone");

    expect(isRootedInSoil(grid, terrain, { x: 1, y: 1, z: 1 }, "soil")).toBe(false);
  });

  it("is false when there is no cell below (at the grid floor)", () => {
    const entities = new EntityIdRegistry();
    const grid = new WorldGrid({ sizeX: 3, sizeY: 3, sizeZ: 3 }, entities);
    const materials = makeMaterials();
    const terrain = new TerrainField(grid, materials);

    expect(isRootedInSoil(grid, terrain, { x: 1, y: 0, z: 1 }, "soil")).toBe(false);
  });

  it("becomes false after the supporting soil is excavated -- a real causal consequence, not a scripted flag", () => {
    const entities = new EntityIdRegistry();
    const grid = new WorldGrid({ sizeX: 3, sizeY: 3, sizeZ: 3 }, entities);
    const materials = makeMaterials();
    const terrain = new TerrainField(grid, materials);
    terrain.setMaterial(1, 0, 1, "soil");
    expect(isRootedInSoil(grid, terrain, { x: 1, y: 1, z: 1 }, "soil")).toBe(true);

    terrain.excavate(1, 0, 1);
    expect(isRootedInSoil(grid, terrain, { x: 1, y: 1, z: 1 }, "soil")).toBe(false);
  });
});
