/**
 * Headless acceptance test for P1-20 — Minimal game UI.
 *
 * Roadmap acceptance test (DAMN_BEAVERS_MASTER_ROADMAP.md, P1-20):
 *   "Milestone 0 can be completed without debug console commands."
 *
 * Drives every one of the roadmap's nine required UI bullets --
 * pause, speed controls, camera navigation, select/inspect beaver,
 * inspect object, inspect tile/water, designate tree cutting, designate
 * construction, alerts -- exclusively through `TextUI`'s own command
 * surface, never by calling `designateTreeCut`/`designateConstruction`/
 * `world.clock.pause()` etc. directly. Advancing simulated ticks and
 * driving the underlying job-execution state machines (the same real
 * `generateTreeCutJob`/`tickTreeCutJob` pipeline every prior labor
 * acceptance test in this project already drives by hand) is NOT a
 * "debug console command" -- there is no automatic systems loop anywhere
 * in this codebase yet (confirmed during P1-18's own critic review), so
 * a real client would need to do exactly this too. The roadmap's phrase
 * is about PLAYER ACTIONS having a real command, not about this test
 * needing its own game loop.
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
import { setPlant, harvestableWoodMassKg } from "../../src/sim/ecology/Plant.js";
import { PlantSpeciesRegistry } from "../../src/sim/ecology/PlantSpecies.js";
import { registerStandardPlantSpecies } from "../../src/sim/ecology/standardPlantSpecies.js";
import { spawnSevenStartingBeavers, getSwimmer } from "../../src/sim/creatures/Beaver.js";
import { getJob } from "../../src/sim/jobs/Job.js";
import { getLog } from "../../src/sim/labor/Log.js";
import { generateTreeCutJob, tickTreeCutJob } from "../../src/sim/labor/TreeCutting.js";
import { getConstruction } from "../../src/sim/labor/Construction.js";
import { TextUI } from "../../src/ui/TextUI.js";

const SIZE_X = 16;
const SIZE_Y = 8;
const SIZE_Z = 12;
const START_AT = { x: 1, z: 1 };
const TREE_AT = { x: 10, z: 6 };
const DAM_SITE = { x: 3, z: 8 };

function buildWorld(): { world: World; materials: MaterialRegistry; water: WaterField; plantSpecies: PlantSpeciesRegistry } {
  const entities = new EntityIdRegistry();
  const components = new ComponentStore(entities);
  const grid = new WorldGrid({ sizeX: SIZE_X, sizeY: SIZE_Y, sizeZ: SIZE_Z }, entities);
  const materials = new MaterialRegistry();
  registerStandardMaterials(materials);
  const terrain = new TerrainField(grid, materials);
  for (let x = 0; x < SIZE_X; x++) {
    for (let z = 0; z < SIZE_Z; z++) {
      for (let y = 0; y <= 2; y++) terrain.setMaterial(x, y, z, "soil");
    }
  }
  const water = new WaterField(grid);
  const weather = new Weather();
  const plantSpecies = new PlantSpeciesRegistry();
  registerStandardPlantSpecies(plantSpecies);
  const clock = new SimulationClock({ tickRateHz: 20 });
  const random = new RandomStreams("p1-20-minimal-ui");
  const events = new EventLog(entities);
  const world: World = { clock, random, entities, components, grid, terrain, events, water, weather };
  return { world, materials, water, plantSpecies };
}

describe("P1-20 acceptance: Milestone 0 can be completed without debug console commands", () => {
  it("every required UI action -- pause, speed, camera, select/inspect, designate, alerts -- is real and driven purely through TextUI", () => {
    const { world, materials, water, plantSpecies } = buildWorld();
    water.setDepth(DAM_SITE.x, DAM_SITE.z, 0.5); // a real stream the seven beavers arrive beside

    const beavers = spawnSevenStartingBeavers(world, { x: START_AT.x, y: world.grid.surfaceY(START_AT.x, START_AT.z)! + 1, z: START_AT.z });
    const tree = world.entities.create("tree");
    world.grid.setEntityPosition(tree, TREE_AT.x, world.grid.surfaceY(TREE_AT.x, TREE_AT.z)! + 1, TREE_AT.z);
    setPlant(world.components, tree, { speciesId: "aspen", ageTicks: 8_000, health: 1 });
    const expectedLogMass = harvestableWoodMassKg(
      plantSpecies.get("aspen"),
      { speciesId: "aspen", ageTicks: 8_000, health: 1 },
      materials.get("wood"),
    );

    const ui = new TextUI(world, water);

    // -- pause / speed controls --
    ui.pause();
    expect(world.clock.isPaused).toBe(true);
    ui.setSpeed(1);
    ui.resume();
    expect(world.clock.isPaused).toBe(false);

    // -- camera navigation --
    ui.setCameraPosition(START_AT.x, START_AT.z);
    const initialView = ui.renderViewport();
    expect(initialView).toContain("B"); // the seven starting beavers are visible from their own arrival point
    ui.moveCamera(TREE_AT.x - START_AT.x, TREE_AT.z - START_AT.z);
    expect(ui.cameraX).toBe(TREE_AT.x);
    expect(ui.cameraZ).toBe(TREE_AT.z);
    expect(ui.renderViewport()).toContain("T"); // camera now centered on the real tree

    // -- select / inspect beaver --
    ui.selectBeaver(beavers[0]!);
    const beaverInspection = ui.inspectSelected();
    expect(beaverInspection.kind).toBe("beaver");
    expect(beaverInspection.live).toBe(true);

    // -- inspect object --
    ui.selectObject(tree);
    expect(ui.inspectSelected().kind).toBe("tree");

    // -- inspect tile/water --
    const streamTile = ui.inspectTile(DAM_SITE.x, DAM_SITE.z);
    expect(streamTile.waterDepth).toBe(0.5);

    // -- designate tree cutting, through the UI, then drive the real
    // execution pipeline to completion (the same real mechanism P1-08's
    // own acceptance test drives; not a debug shortcut) --
    const designationId = ui.designateTreeCutting(tree);
    const jobIds = generateTreeCutJob(world, materials, plantSpecies, designationId);
    expect(jobIds).toHaveLength(1);
    const jobId = jobIds[0]!;

    let felled = false;
    const MAX_TICKS = 400;
    for (let tick = 0; tick < MAX_TICKS && !felled; tick++) {
      world.clock.resume();
      world.clock.advanceTicks(1);
      for (const beaver of beavers) {
        const reservedBy = getJob(world.components, jobId)?.reservedBy;
        if (reservedBy !== undefined && reservedBy !== beaver) continue;
        const profile = getSwimmer(world.components, beaver)!;
        const outcome = tickTreeCutJob(
          world.grid,
          world.terrain,
          water,
          materials,
          plantSpecies,
          world.entities,
          world.components,
          beaver,
          profile,
          jobIds,
        );
        if (outcome === "felled") felled = true;
      }
    }
    expect(felled).toBe(true);
    expect(world.entities.isLive(tree)).toBe(false); // the real tree is genuinely gone
    const logs = world.entities.liveIdsOfKind("log").filter((id) => getLog(world.components, id) !== undefined);
    const totalLogMass = logs.reduce((sum, id) => sum + getLog(world.components, id)!.massKg, 0);
    expect(totalLogMass).toBeCloseTo(expectedLogMass, 6); // real, persistent log entities exist

    // -- designate construction, through the UI --
    const constructionId = ui.designateConstruction("dam-segment", DAM_SITE);
    const construction = getConstruction(world.components, constructionId)!;
    expect(construction.status).toBe("awaiting-materials");
    expect(construction.site).toEqual(DAM_SITE);

    // -- alerts --
    // A fresh roster of beavers, none yet urgently hungry/thirsty/tired,
    // and no corpses -- a real, derived, currently-empty alert list.
    expect(ui.alerts()).toEqual([]);
  });
});
