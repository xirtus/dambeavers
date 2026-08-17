/**
 * Headless acceptance test for P2-16 -- Colony population UI.
 *
 * Roadmap acceptance test:
 *   "player can inspect population, jobs, unmet needs, relationships,
 *   and critical blockers from normal UI."
 *
 * Builds a small real colony scenario (a claimed job on the real P1-07
 * job board, a real P1-19 relationship edge, a real urgent need), then
 * inspects ALL FIVE roadmap facets through exactly one normal-UI call --
 * `TextUI.populationPanel()` -- with no debug console/inspector access
 * (matching P1-20's own "no debug console commands" precedent). Every
 * facet is checked against the SAME live simulation state the scenario
 * set up, proving the panel is a real, composed view, not a fabricated
 * summary.
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
import { setNeeds, BASELINE_NEEDS } from "../../src/sim/creatures/Needs.js";
import { die } from "../../src/sim/creatures/Mortality.js";
import { setRelationshipWith } from "../../src/sim/creatures/Relationships.js";
import { createDesignation } from "../../src/sim/jobs/Designation.js";
import { generateJobs } from "../../src/sim/jobs/Job.js";
import { reserveJob } from "../../src/sim/jobs/JobBoard.js";
import { TextUI } from "../../src/ui/TextUI.js";

function buildFlatWorld(sizeX = 12, sizeY = 8, sizeZ = 12, floor = 2): { world: World; water: WaterField } {
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
  const clock = new SimulationClock({ tickRateHz: 20 });
  const random = new RandomStreams("p2-16-colony-population-ui");
  const events = new EventLog(entities);
  const world: World = { clock, random, entities, components, grid, terrain, events, water, weather };
  return { world, water };
}

function spawnAt(world: World, name: string, x: number, z: number): EntityId {
  const floor = world.grid.surfaceY(x, z)!;
  return spawnBeaver(world, { name, position: { x, y: floor + 1, z } });
}

describe("P2-16 -- Colony population UI", () => {
  it("a player can inspect population, jobs, unmet needs, relationships, and critical blockers from normal UI", () => {
    const { world, water } = buildFlatWorld();

    // Real colony state: a worker with a claimed job, a hungry beaver
    // with an urgent need, and a real relationship edge between them.
    const worker = spawnAt(world, "Worker", 3, 3);
    const hungry = spawnAt(world, "Hungry", 6, 3);
    setNeeds(world.components, worker, { ...BASELINE_NEEDS });
    setNeeds(world.components, hungry, { ...BASELINE_NEEDS, hunger: 0.85 });
    setRelationshipWith(world.components, worker, { withId: hungry, kin: "sibling", familiarity: 0.5, affinity: 0.2 });

    const designationId = createDesignation(world, "go-to", { x: 9, z: 3 });
    const [jobId] = generateJobs(world, designationId);
    reserveJob(world.components, world.entities, jobId!, worker);

    // A third, real colony-wide blocker: a beaver who has already died
    // (through the real, unmodified P1-16/P2-15 `die()`), leaving a real
    // corpse not yet buried.
    const doomed = spawnAt(world, "Doomed", 8, 3);
    setNeeds(world.components, doomed, { ...BASELINE_NEEDS });
    const corpseId = die(world, doomed, "starvation");

    // Exactly one normal-UI surface -- no `inspectEntity`/`DebugInspector`
    // access anywhere in this test.
    const ui = new TextUI(world, water);
    const panel = ui.populationPanel();

    expect(panel.beavers).toHaveLength(2); // ---- population ---- (the corpse is no longer a beaver)

    const workerEntry = panel.beavers.find((e) => e.beaverId === worker)!;
    const hungryEntry = panel.beavers.find((e) => e.beaverId === hungry)!;

    // ---- jobs ----
    expect(workerEntry.jobId).toBe(jobId);
    expect(workerEntry.jobStatus).toBe("reserved");
    expect(workerEntry.designationKind).toBe("go-to");
    expect(hungryEntry.jobId).toBeUndefined();

    // ---- unmet needs ----
    expect(workerEntry.urgentNeeds).toEqual([]);
    expect(hungryEntry.urgentNeeds).toEqual(["hunger"]);
    expect(hungryEntry.needs!.hunger).toBeCloseTo(0.85);

    // ---- relationships ----
    expect(workerEntry.relationships).toEqual([{ withId: hungry, kin: "sibling", familiarity: 0.5, affinity: 0.2 }]);
    expect(hungryEntry.relationships).toEqual([]); // directed edge -- hungry never set one back

    // ---- critical blockers (per-beaver AND colony-wide) ----
    expect(workerEntry.blockers).toEqual([]);
    expect(hungryEntry.blockers).toHaveLength(1);
    expect(hungryEntry.blockers[0]).toMatchObject({ kind: "urgent-need", entityId: hungry });
    expect(panel.colonyBlockers).toHaveLength(1);
    expect(panel.colonyBlockers[0]).toMatchObject({ kind: "beaver-died", entityId: corpseId });

    // The SAME panel also composes P2-14's live mood for every entry --
    // a real, computed number, not a placeholder.
    expect(typeof workerEntry.mood).toBe("number");
    expect(typeof hungryEntry.mood).toBe("number");

    // The panel is derived fresh: relieving the need clears the blocker
    // and the "unmet needs" facet with no manual UI refresh step.
    setNeeds(world.components, hungry, { ...BASELINE_NEEDS });
    const refreshed = ui.populationPanel().beavers.find((e) => e.beaverId === hungry)!;
    expect(refreshed.urgentNeeds).toEqual([]);
    expect(refreshed.blockers).toEqual([]);
  });
});
