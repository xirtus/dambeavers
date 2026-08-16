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
import type { World } from "../../src/sim/persistence/WorldSnapshot.js";
import { setLog } from "../../src/sim/labor/Log.js";
import {
  designateConstruction,
  getConstruction,
  setConstruction,
  checkMaterialsDelivered,
} from "../../src/sim/labor/Construction.js";
import { applyDamSegment, removeDamSegmentLayer, getDamSegment, findDamSegmentAt } from "../../src/sim/hydrology/Dam.js";

function buildFlatWorld(sizeX = 14, sizeY = 8, sizeZ = 14, floor = 2): { world: World; materials: MaterialRegistry; water: WaterField } {
  const entities = new EntityIdRegistry();
  const components = new ComponentStore(entities);
  const grid = new WorldGrid({ sizeX, sizeY, sizeZ }, entities);
  const materials = new MaterialRegistry();
  registerStandardMaterials(materials);
  const terrain = new TerrainField(grid, materials);
  for (let x = 0; x < sizeX; x++) {
    for (let z = 0; z < sizeZ; z++) {
      for (let y = 0; y <= floor; y++) terrain.setMaterial(x, y, z, "soil");
    }
  }
  const water = new WaterField(grid);
  const clock = new SimulationClock({ tickRateHz: 20 });
  const random = new RandomStreams(1);
  const events = new EventLog(entities);
  const world: World = { clock, random, entities, components, grid, terrain, events };
  return { world, materials, water };
}

function spawnLog(world: World, x: number, z: number, massKg: number) {
  const id = world.entities.create("log");
  const floor = world.grid.surfaceY(x, z)!;
  world.grid.setEntityPosition(id, x, floor + 1, z);
  setLog(world.components, id, { materialId: "wood", massKg });
  return id;
}

/** Builds a "completed" dam-segment construction directly (bypassing the full haul/labor pipeline, which P1-10's own tests already cover thoroughly) -- this file's own tests are about what a COMPLETED construction does to real terrain/hydrology, not about re-proving P1-10's labor pipeline itself. */
function completedDamSegmentConstruction(world: World, site: { x: number; z: number }): EntityId {
  const constructionId = designateConstruction(world, "dam-segment", site);
  spawnLog(world, site.x, site.z, 60); // >= dam-segment's requiredMassKg
  expect(checkMaterialsDelivered(world, constructionId)).toBe(true);
  const construction = getConstruction(world.components, constructionId)!;
  setConstruction(world.components, constructionId, { ...construction, status: "complete", workDone: construction.workRequired });
  return constructionId;
}

describe("applyDamSegment", () => {
  it("throws for a construction that isn't a completed 'dam-segment'", () => {
    const { world } = buildFlatWorld();
    const wallId = designateConstruction(world, "wall", { x: 5, z: 5 });
    expect(() => applyDamSegment(world, wallId)).toThrow(RangeError); // wrong kind, not even complete
  });

  it("REGRESSION: throws on a second application of the SAME construction -- never fabricates a second real terrain cell from wood only physically consumed once", () => {
    const { world } = buildFlatWorld();
    const site = { x: 5, z: 5 };
    const naturalSurfaceY = world.grid.surfaceY(site.x, site.z)!;
    const constructionId = completedDamSegmentConstruction(world, site);

    const damId = applyDamSegment(world, constructionId);
    expect(getDamSegment(world.components, damId)!.heightCells).toBe(1);

    expect(() => applyDamSegment(world, constructionId)).toThrow(RangeError);
    expect(getDamSegment(world.components, damId)!.heightCells).toBe(1); // unchanged -- no phantom second cell
    expect(world.terrain.materialAt(site.x, naturalSurfaceY + 2, site.z)).toBeUndefined();
  });

  it("creates a new DamSegment entity and fills exactly one real terrain cell above the natural surface", () => {
    const { world } = buildFlatWorld();
    const site = { x: 5, z: 5 };
    const naturalSurfaceY = world.grid.surfaceY(site.x, site.z)!;
    const constructionId = completedDamSegmentConstruction(world, site);

    const damId = applyDamSegment(world, constructionId);

    const dam = getDamSegment(world.components, damId)!;
    expect(dam).toEqual({ site, materialId: "wood", baseY: naturalSurfaceY, heightCells: 1, structuralIntegrity: 1 });
    expect(world.terrain.materialAt(site.x, naturalSurfaceY + 1, site.z)).toBe("wood");
    expect(world.grid.surfaceY(site.x, site.z)).toBe(naturalSurfaceY + 1); // the site is now genuinely one cell taller
  });

  it("stacks height onto the SAME DamSegment when a second dam-segment construction completes at the same site", () => {
    const { world } = buildFlatWorld();
    const site = { x: 5, z: 5 };
    const naturalSurfaceY = world.grid.surfaceY(site.x, site.z)!;
    const firstConstructionId = completedDamSegmentConstruction(world, site);
    const damId = applyDamSegment(world, firstConstructionId);

    // P1-10's designateConstruction allows reusing a site once the prior
    // construction there is "complete" -- exercise that real path.
    const secondConstructionId = completedDamSegmentConstruction(world, site);
    const secondDamId = applyDamSegment(world, secondConstructionId);

    expect(secondDamId).toBe(damId); // same physical dam, not a second one
    const dam = getDamSegment(world.components, damId)!;
    expect(dam.heightCells).toBe(2);
    expect(dam.baseY).toBe(naturalSurfaceY); // unchanged -- always the ORIGINAL natural surface
    expect(world.terrain.materialAt(site.x, naturalSurfaceY + 1, site.z)).toBe("wood");
    expect(world.terrain.materialAt(site.x, naturalSurfaceY + 2, site.z)).toBe("wood");
    expect(world.grid.surfaceY(site.x, site.z)).toBe(naturalSurfaceY + 2);
  });

  it("findDamSegmentAt locates the live dam at a site, or returns undefined for a bare site", () => {
    const { world } = buildFlatWorld();
    const site = { x: 5, z: 5 };
    expect(findDamSegmentAt(world.entities, world.components, site)).toBeUndefined();
    const constructionId = completedDamSegmentConstruction(world, site);
    const damId = applyDamSegment(world, constructionId);
    expect(findDamSegmentAt(world.entities, world.components, site)).toBe(damId);
    expect(findDamSegmentAt(world.entities, world.components, { x: 9, z: 9 })).toBeUndefined();
  });
});

describe("removeDamSegmentLayer", () => {
  it("throws for an entity with no DamSegment component", () => {
    const { world } = buildFlatWorld();
    const bogus = world.entities.create("dam-segment");
    expect(() => removeDamSegmentLayer(world, bogus)).toThrow(RangeError);
  });

  it("excavates exactly the topmost dam cell and shrinks heightCells by one, leaving the layer(s) below intact", () => {
    const { world } = buildFlatWorld();
    const site = { x: 5, z: 5 };
    const naturalSurfaceY = world.grid.surfaceY(site.x, site.z)!;
    const first = completedDamSegmentConstruction(world, site);
    const damId = applyDamSegment(world, first);
    const second = completedDamSegmentConstruction(world, site);
    applyDamSegment(world, second);
    expect(getDamSegment(world.components, damId)!.heightCells).toBe(2);

    removeDamSegmentLayer(world, damId);

    expect(getDamSegment(world.components, damId)!.heightCells).toBe(1);
    expect(world.terrain.materialAt(site.x, naturalSurfaceY + 2, site.z)).toBeUndefined(); // top layer excavated
    expect(world.terrain.materialAt(site.x, naturalSurfaceY + 1, site.z)).toBe("wood"); // bottom layer untouched
    expect(world.grid.surfaceY(site.x, site.z)).toBe(naturalSurfaceY + 1);
  });

  it("destroys the DamSegment entity once its last cell is removed -- never leaves an empty husk", () => {
    const { world } = buildFlatWorld();
    const site = { x: 5, z: 5 };
    const naturalSurfaceY = world.grid.surfaceY(site.x, site.z)!;
    const constructionId = completedDamSegmentConstruction(world, site);
    const damId = applyDamSegment(world, constructionId);

    removeDamSegmentLayer(world, damId);

    expect(world.entities.isLive(damId)).toBe(false);
    expect(findDamSegmentAt(world.entities, world.components, site)).toBeUndefined();
    expect(world.terrain.materialAt(site.x, naturalSurfaceY + 1, site.z)).toBeUndefined();
    expect(world.grid.surfaceY(site.x, site.z)).toBe(naturalSurfaceY); // back to exactly the natural surface
  });
});
