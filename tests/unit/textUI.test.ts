import { describe, expect, it } from "vitest";
import { EntityIdRegistry } from "../../src/sim/core/EntityId.js";
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
import { setPlant } from "../../src/sim/ecology/Plant.js";
import { PlantSpeciesRegistry } from "../../src/sim/ecology/PlantSpecies.js";
import { registerStandardPlantSpecies } from "../../src/sim/ecology/standardPlantSpecies.js";
import { spawnBeaver } from "../../src/sim/creatures/Beaver.js";
import { setNeeds, getNeeds, BASELINE_NEEDS } from "../../src/sim/creatures/Needs.js";
import { die } from "../../src/sim/creatures/Mortality.js";
import { setBreath, BASELINE_BREATH } from "../../src/sim/creatures/Respiration.js";
import { getConstruction } from "../../src/sim/labor/Construction.js";
import { getDesignation } from "../../src/sim/jobs/Designation.js";
import { TextUI } from "../../src/ui/TextUI.js";

function buildFlatWorld(sizeX = 12, sizeY = 8, sizeZ = 12, floor = 2): { world: World; water: WaterField; plantSpecies: PlantSpeciesRegistry } {
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
  const weather = new Weather();
  const plantSpecies = new PlantSpeciesRegistry();
  registerStandardPlantSpecies(plantSpecies);
  const clock = new SimulationClock({ tickRateHz: 20 });
  const random = new RandomStreams(1);
  const events = new EventLog(entities);
  const world: World = { clock, random, entities, components, grid, terrain, events, water, weather };
  return { world, water, plantSpecies };
}

function spawnTreeAt(world: World, x: number, z: number, speciesId = "aspen", ageTicks = 20_000) {
  const id = world.entities.create("tree");
  const floor = world.grid.surfaceY(x, z)!;
  world.grid.setEntityPosition(id, x, floor + 1, z);
  setPlant(world.components, id, { speciesId, ageTicks, health: 1 });
  return id;
}

function spawnBeaverAt(world: World, x: number, z: number, name = "Chomper") {
  const floor = world.grid.surfaceY(x, z)!;
  const id = spawnBeaver(world, { name, position: { x, y: floor + 1, z } });
  setBreath(world.components, id, { ...BASELINE_BREATH });
  return id;
}

describe("TextUI pause / speed controls", () => {
  it("pause/resume drive the real SimulationClock", () => {
    const { world, water } = buildFlatWorld();
    const ui = new TextUI(world, water);
    world.clock.resume();
    expect(ui.isPaused).toBe(false);
    ui.pause();
    expect(ui.isPaused).toBe(true);
    expect(world.clock.isPaused).toBe(true);
    ui.resume();
    expect(ui.isPaused).toBe(false);
  });

  it("setSpeed drives the real SimulationClock speed", () => {
    const { world, water } = buildFlatWorld();
    const ui = new TextUI(world, water);
    ui.setSpeed(4);
    expect(ui.speed).toBe(4);
    expect(world.clock.speed).toBe(4);
  });
});

describe("TextUI camera navigation", () => {
  it("starts centered on the map and clamps to real map bounds", () => {
    const { world, water } = buildFlatWorld(12, 8, 12);
    const ui = new TextUI(world, water);
    expect(ui.cameraX).toBe(6);
    expect(ui.cameraZ).toBe(6);
    ui.moveCamera(-100, -100);
    expect(ui.cameraX).toBe(0);
    expect(ui.cameraZ).toBe(0);
    ui.moveCamera(1000, 1000);
    expect(ui.cameraX).toBe(11);
    expect(ui.cameraZ).toBe(11);
  });

  it("setCameraPosition moves directly, still clamped", () => {
    const { world, water } = buildFlatWorld();
    const ui = new TextUI(world, water);
    ui.setCameraPosition(3, 4);
    expect(ui.cameraX).toBe(3);
    expect(ui.cameraZ).toBe(4);
    ui.setCameraPosition(-5, 999);
    expect(ui.cameraX).toBe(0);
    expect(ui.cameraZ).toBe(11);
  });

  it("renderViewport is a real, live-derived ASCII grid showing a real beaver and tree", () => {
    const { world, water } = buildFlatWorld(12, 8, 12);
    spawnBeaverAt(world, 6, 6, "Willow");
    spawnTreeAt(world, 7, 6);
    water.setDepth(8, 6, 1);
    const ui = new TextUI(world, water, 3);
    ui.setCameraPosition(6, 6);
    const rows = ui.renderViewport().split("\n");
    expect(rows).toHaveLength(7); // 3 above + center + 3 below, all in-bounds here
    expect(rows[3]!.length).toBe(7);
    expect(rows[3]![3]).toBe("B"); // beaver at the exact camera-centered column
    expect(rows[3]![4]).toBe("T"); // tree one column east
    expect(rows[3]![5]).toBe("~"); // water two columns east
    expect(rows[3]![0]).toBe("."); // ordinary dry ground elsewhere
  });

  it("renderViewport reflects LIVE state, not a stale snapshot", () => {
    const { world, water } = buildFlatWorld();
    const ui = new TextUI(world, water, 2);
    ui.setCameraPosition(5, 5);
    expect(ui.renderViewport().split("\n")[2]![2]).toBe(".");
    water.setDepth(5, 5, 1);
    expect(ui.renderViewport().split("\n")[2]![2]).toBe("~");
  });

  it("renderViewport shows blank space for a real column with no ground", () => {
    // A grid larger than the terrain actually fills -- x >= 6 has real
    // solid cells nowhere, so its surfaceY is genuinely undefined, not
    // merely low.
    const entities = new EntityIdRegistry();
    const components = new ComponentStore(entities);
    const grid = new WorldGrid({ sizeX: 12, sizeY: 8, sizeZ: 12 }, entities);
    const materials = new MaterialRegistry();
    registerStandardMaterials(materials);
    const terrain = new TerrainField(grid, materials);
    for (let x = 0; x < 6; x++) {
      for (let z = 0; z < 12; z++) {
        for (let y = 0; y <= 2; y++) terrain.setMaterial(x, y, z, "soil");
      }
    }
    const water = new WaterField(grid);
    const weather = new Weather();
    const clock = new SimulationClock({ tickRateHz: 20 });
    const random = new RandomStreams(1);
    const events = new EventLog(entities);
    const world: World = { clock, random, entities, components, grid, terrain, events, water, weather };

    const ui = new TextUI(world, water, 3);
    ui.setCameraPosition(6, 6); // camera itself sits right at the grounded/ungrounded boundary
    const rows = ui.renderViewport().split("\n");
    expect(rows[3]![0]).toBe("."); // x=3, real ground
    expect(rows[3]![rows[3]!.length - 1]).toBe(" "); // x=9, no real ground at all
  });
});

describe("TextUI select / inspect", () => {
  it("selectBeaver validates kind and enables inspectSelected", () => {
    const { world, water } = buildFlatWorld();
    const beaver = spawnBeaverAt(world, 3, 3, "Alder");
    const ui = new TextUI(world, water);
    ui.selectBeaver(beaver);
    expect(ui.selected).toBe(beaver);
    const inspection = ui.inspectSelected();
    expect(inspection.id).toBe(beaver);
    expect(inspection.kind).toBe("beaver");
    expect(inspection.live).toBe(true);
  });

  it("selectBeaver rejects a non-beaver entity", () => {
    const { world, water } = buildFlatWorld();
    const tree = spawnTreeAt(world, 3, 3);
    const ui = new TextUI(world, water);
    expect(() => ui.selectBeaver(tree)).toThrow(RangeError);
  });

  it("selectObject validates kind (rejects a beaver) and enables inspectSelected", () => {
    const { world, water } = buildFlatWorld();
    const tree = spawnTreeAt(world, 3, 3);
    const beaver = spawnBeaverAt(world, 4, 4);
    const ui = new TextUI(world, water);
    ui.selectObject(tree);
    expect(ui.inspectSelected().kind).toBe("tree");
    expect(() => ui.selectObject(beaver)).toThrow(RangeError);
  });

  it("selectObject allows inspecting a destroyed entity's final state", () => {
    const { world, water } = buildFlatWorld();
    const beaver = spawnBeaverAt(world, 3, 3);
    setNeeds(world.components, beaver, { ...BASELINE_NEEDS });
    const corpseId = die(world, beaver, "starvation");
    const ui = new TextUI(world, water);
    ui.selectObject(corpseId);
    const inspection = ui.inspectSelected();
    expect(inspection.kind).toBe("corpse");
    expect(inspection.live).toBe(true);
  });

  it("inspectSelected throws when nothing is selected", () => {
    const { world, water } = buildFlatWorld();
    const ui = new TextUI(world, water);
    expect(() => ui.inspectSelected()).toThrow(RangeError);
  });

  it("deselect clears the current selection", () => {
    const { world, water } = buildFlatWorld();
    const beaver = spawnBeaverAt(world, 3, 3);
    const ui = new TextUI(world, water);
    ui.selectBeaver(beaver);
    ui.deselect();
    expect(ui.selected).toBeUndefined();
    expect(() => ui.inspectSelected()).toThrow(RangeError);
  });

  it("inspectTile reports real terrain, water, and a real standing occupant for a grounded column", () => {
    const { world, water } = buildFlatWorld();
    const beaver = spawnBeaverAt(world, 5, 5);
    water.setDepth(5, 5, 0.4);
    const ui = new TextUI(world, water);
    const tile = ui.inspectTile(5, 5);
    expect(tile.groundY).toBe(world.grid.surfaceY(5, 5));
    expect(tile.cell?.material).toBe("soil");
    expect(tile.occupantIds).toContain(beaver);
    expect(tile.waterDepth).toBe(0.4);
  });

  it("inspectTile reports undefined cell and no occupants for an in-bounds column with no real ground, but still reports water depth", () => {
    // A grid larger than the terrain actually fills, matching the
    // renderViewport "no ground" test above -- x >= 6 is genuinely
    // ungenerated (surfaceY undefined), not merely out of bounds.
    const entities = new EntityIdRegistry();
    const components = new ComponentStore(entities);
    const grid = new WorldGrid({ sizeX: 12, sizeY: 8, sizeZ: 12 }, entities);
    const materials = new MaterialRegistry();
    registerStandardMaterials(materials);
    const terrain = new TerrainField(grid, materials);
    for (let x = 0; x < 6; x++) {
      for (let z = 0; z < 12; z++) {
        for (let y = 0; y <= 2; y++) terrain.setMaterial(x, y, z, "soil");
      }
    }
    const water = new WaterField(grid);
    const weather = new Weather();
    water.setDepth(9, 6, 0.2); // real standing water can still exist over ungenerated ground
    const clock = new SimulationClock({ tickRateHz: 20 });
    const random = new RandomStreams(1);
    const events = new EventLog(entities);
    const world: World = { clock, random, entities, components, grid, terrain, events, water, weather };

    const ui = new TextUI(world, water);
    const tile = ui.inspectTile(9, 6);
    expect(tile.groundY).toBeUndefined();
    expect(tile.cell).toBeUndefined();
    expect(tile.occupantIds).toEqual([]);
    expect(tile.waterDepth).toBe(0.2);
  });
});

describe("TextUI designate tree cutting / construction", () => {
  it("designateTreeCutting creates a real designation via the real P1-08 mechanism", () => {
    const { world, water } = buildFlatWorld();
    const tree = spawnTreeAt(world, 4, 4);
    const ui = new TextUI(world, water);
    const designationId = ui.designateTreeCutting(tree);
    const designation = getDesignation(world.components, designationId)!;
    expect(designation.kind).toBe("cut-tree");
    expect(designation.targetEntity).toBe(tree);
  });

  it("designateConstruction creates a real construction via the real P1-10 mechanism", () => {
    const { world, water } = buildFlatWorld();
    const ui = new TextUI(world, water);
    const constructionId = ui.designateConstruction("wall", { x: 5, z: 5 });
    const construction = getConstruction(world.components, constructionId)!;
    expect(construction.kind).toBe("wall");
    expect(construction.site).toEqual({ x: 5, z: 5 });
    expect(construction.status).toBe("awaiting-materials");
  });

  it("designateConstruction rejects a site with no real ground, exactly like the underlying mechanism", () => {
    const { world, water } = buildFlatWorld();
    const ui = new TextUI(world, water);
    expect(() => ui.designateConstruction("wall", { x: 999, z: 999 })).toThrow(RangeError);
  });
});

describe("TextUI alerts", () => {
  it("reports no alerts for well-fed, living beavers", () => {
    const { world, water } = buildFlatWorld();
    spawnBeaverAt(world, 3, 3);
    const ui = new TextUI(world, water);
    expect(ui.alerts()).toEqual([]);
  });

  it("reports an urgent-need alert once a real need crosses NEED_URGENT_THRESHOLD", () => {
    const { world, water } = buildFlatWorld();
    const beaver = spawnBeaverAt(world, 3, 3, "Sedge");
    setNeeds(world.components, beaver, { ...BASELINE_NEEDS, hunger: 0.75 });
    const ui = new TextUI(world, water);
    const alerts = ui.alerts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.kind).toBe("urgent-need");
    expect(alerts[0]!.entityId).toBe(beaver);
    expect(alerts[0]!.message).toContain("Sedge");
    expect(alerts[0]!.message).toContain("hunger");
  });

  it("does NOT alert on thermalComfort -- BeaverNeeds.ts's own documented rule that it never drives an intent", () => {
    const { world, water } = buildFlatWorld();
    spawnBeaverAt(world, 3, 3);
    const beaver = world.entities.liveIdsOfKind("beaver")[0]!;
    setNeeds(world.components, beaver, { ...BASELINE_NEEDS, thermalComfort: 0.1 });
    const ui = new TextUI(world, water);
    expect(ui.alerts()).toEqual([]);
  });

  it("reports a beaver-died alert for a real corpse entity", () => {
    const { world, water } = buildFlatWorld();
    const beaver = spawnBeaverAt(world, 3, 3);
    setNeeds(world.components, beaver, { ...BASELINE_NEEDS });
    const corpseId = die(world, beaver, "starvation");
    const ui = new TextUI(world, water);
    const alerts = ui.alerts();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toEqual({ kind: "beaver-died", entityId: corpseId, message: `A corpse (entity ${corpseId}) lies unattended` });
  });

  it("alerts are derived fresh every call -- a resolved need clears its own alert with no manual dismissal", () => {
    const { world, water } = buildFlatWorld();
    const beaver = spawnBeaverAt(world, 3, 3);
    setNeeds(world.components, beaver, { ...BASELINE_NEEDS, thirst: 0.9 });
    const ui = new TextUI(world, water);
    expect(ui.alerts()).toHaveLength(1);
    setNeeds(world.components, beaver, { ...BASELINE_NEEDS, thirst: 0 });
    expect(ui.alerts()).toEqual([]);
  });
});
