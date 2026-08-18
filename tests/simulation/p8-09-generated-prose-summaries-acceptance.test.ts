/**
 * Headless acceptance test for P8-09 -- Generated prose summaries.
 *
 * Roadmap acceptance test: "prose never invents a person, motive,
 * event, relationship, or outcome absent from structured history."
 */
import { describe, expect, it } from "vitest";
import { EntityIdRegistry, type EntityId } from "../../src/sim/core/EntityId.js";
import { ComponentStore } from "../../src/sim/core/ComponentStore.js";
import { SimulationClock } from "../../src/sim/core/SimulationClock.js";
import { RandomStreams } from "../../src/sim/core/Random.js";
import { WorldGrid } from "../../src/sim/world/WorldGrid.js";
import { TerrainField } from "../../src/sim/world/TerrainField.js";
import { EventLog, type EventId } from "../../src/sim/history/EventLog.js";
import { MaterialRegistry } from "../../src/sim/materials/Material.js";
import { registerStandardMaterials } from "../../src/sim/materials/standardMaterials.js";
import { WaterField } from "../../src/sim/hydrology/WaterField.js";
import { Weather } from "../../src/sim/weather/Weather.js";
import type { World } from "../../src/sim/persistence/WorldSnapshot.js";
import { snapshotWorld, restoreWorld } from "../../src/sim/persistence/WorldSnapshot.js";
import { ALL_COMPONENT_TYPES } from "../../src/sim/persistence/AllComponentTypes.js";
import { RegionMap } from "../../src/sim/region/RegionMap.js";
import { createSite } from "../../src/sim/region/Site.js";
import { applyDisasterToSite } from "../../src/sim/region/WorldDisasters.js";
import { establishPolity } from "../../src/sim/politics/PoliticalEntity.js";
import { claimTerritory } from "../../src/sim/politics/Territory.js";
import { declareWar, endWar } from "../../src/sim/politics/War.js";
import { spawnBeaver } from "../../src/sim/creatures/Beaver.js";
import { die } from "../../src/sim/creatures/Mortality.js";
import { nameEntity } from "../../src/sim/creatures/Naming.js";
import { summarizeEvent, summarizeLife, summarizeWar, summarizeSite } from "../../src/sim/chronicle/ProseSummaries.js";

function buildWorld(): { world: World; regionMap: RegionMap } {
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
  const random = new RandomStreams(809);
  const events = new EventLog(entities);
  return {
    world: { clock, random, entities, components, grid, terrain, events, water, weather },
    regionMap: new RegionMap(16, 16),
  };
}

/** Every "event #N" id a summary mentions must be a real recorded event, and every line's own record ids must resolve. */
function expectTraceable(summary: { lines: Array<{ text: string; recordIds: readonly EventId[] }> }, world: World): void {
  for (const line of summary.lines) {
    for (const recordId of line.recordIds) {
      expect(world.events.has(recordId), `line record ${recordId} must exist: "${line.text}"`).toBe(true);
    }
    for (const match of line.text.matchAll(/event #(\d+)/g)) {
      expect(world.events.has(Number(match[1]) as EventId), `"${line.text}" mentions a real event`).toBe(true);
    }
  }
}

describe("P8-09 -- Generated prose summaries", () => {
  it("prose never invents a person, motive, event, relationship, or outcome absent from structured history", () => {
    const { world, regionMap } = buildWorld();
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) regionMap.setElevation(x, z, 0);

    // A real lived history.
    const siteA = createSite(world, regionMap, 2, 2, 10, 100);
    const siteB = createSite(world, regionMap, 3, 2, 10, 100);
    establishPolity(world, siteA);
    establishPolity(world, siteB);
    nameEntity(world, siteA, "site", world.random.stream("p8-09-a"));
    nameEntity(world, siteB, "site", world.random.stream("p8-09-b"));
    claimTerritory(world, regionMap, siteA, 1);
    claimTerritory(world, regionMap, siteB, 1); // real overlap, so the war has contested cells to cede
    const claimEvent = world.events.eventsOfType("territory-claimed").find((e) => e.subjectIds.includes(siteA))!.id;
    world.clock.advanceTicks(10);
    const warId = declareWar(world, siteA, siteB, "territory", claimEvent);
    world.clock.advanceTicks(10);
    const warEndedEvent = endWar(world, warId, siteA);
    world.clock.advanceTicks(10);
    applyDisasterToSite(world, siteA, { kind: "flood", regionX: 2, regionZ: 2, severity: 0.5 });

    const alder = spawnBeaver(world, { name: "Alder", position: { x: 4, y: 3, z: 4 } });
    world.clock.advanceTicks(10);
    die(world, alder, "starvation");

    // A planted decoy who appears in NO record any summary draws from.
    spawnBeaver(world, { name: "Zorb", position: { x: 14, y: 3, z: 14 } });

    // War summary: every line traceable, names only real participants.
    const war = summarizeWar(world, warId);
    expectTraceable(war, world);
    const siteAName = world.components.get(siteA, ALL_COMPONENT_TYPES.get("identity")!) as { name?: string } | undefined;
    const siteBName = world.components.get(siteB, ALL_COMPONENT_TYPES.get("identity")!) as { name?: string } | undefined;
    expect(war.title).toContain(siteAName!.name!);
    expect(war.title).toContain(siteBName!.name!);
    expect(war.lines.join(" ")).not.toContain("Zorb");
    // The declaration line cites the real cause event.
    const declarationLine = war.lines[0]!;
    expect(declarationLine.text).toContain(`cause event #${claimEvent}`);
    expect(declarationLine.recordIds).toContain(world.events.eventsOfType("war-declared")[0]!.id);
    // The cession line reports the real recorded cell count.
    expect(war.lines.some((line) => line.text.includes("6 cell"))).toBe(true);
    // The end line names the real winner.
    expect(war.lines.some((line) => line.text.includes(siteAName!.name!))).toBe(true);

    // Life summary: no invented person, no invented events.
    const life = summarizeLife(world, alder);
    expectTraceable(life, world);
    expect(life.title).toContain("Alder");
    expect(life.lines.join(" ")).not.toContain("Zorb");
    expect(life.lines.some((line) => line.text.includes("starvation death"))).toBe(true);
    expect(life.lines.some((line) => line.text.includes("no recorded birth"))).toBe(true);

    // Site summary: founding numbers come from the recorded payload.
    const site = summarizeSite(world, siteA);
    expectTraceable(site, world);
    expect(site.lines.join(" ")).not.toContain("Zorb");
    expect(site.lines.some((line) => line.text.includes("founding population of 10"))).toBe(true);
    expect(site.lines.some((line) => line.text.includes("flood"))).toBe(true);
    expect(site.lines.some((line) => line.text.includes("war"))).toBe(true);

    // Event summary for the war end.
    const eventSummary = summarizeEvent(world, warEndedEvent);
    expectTraceable(eventSummary, world);
    expect(eventSummary.lines.some((line) => line.text.includes("war ended"))).toBe(true);

    // Determinism: identical output from identical state.
    expect(summarizeWar(world, warId)).toEqual(war);
    expect(summarizeLife(world, alder)).toEqual(life);
    expect(summarizeSite(world, siteA)).toEqual(site);

    // An unknown subject produces an honest empty summary, not lore.
    const unknown = summarizeLife(world, 999_999 as EntityId);
    expect(unknown.lines).toEqual([]);
    expect(unknown.title).toContain("Unknown");
  });

  it("prose summaries survive save/reload identically", () => {
    const { world, regionMap } = buildWorld();
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) regionMap.setElevation(x, z, 0);
    const siteA = createSite(world, regionMap, 2, 2, 10, 100);
    const siteB = createSite(world, regionMap, 3, 2, 10, 100);
    establishPolity(world, siteA);
    establishPolity(world, siteB);
    nameEntity(world, siteA, "site", world.random.stream("p8-09-c"));
    nameEntity(world, siteB, "site", world.random.stream("p8-09-d"));
    claimTerritory(world, regionMap, siteA, 1);
    claimTerritory(world, regionMap, siteB, 1); // real overlap, so the war has contested cells to cede
    const claimEvent = world.events.eventsOfType("territory-claimed").find((e) => e.subjectIds.includes(siteA))!.id;
    world.clock.advanceTicks(10);
    const warId = declareWar(world, siteA, siteB, "territory", claimEvent);
    world.clock.advanceTicks(10);
    endWar(world, warId, siteA);

    const beforeWar = summarizeWar(world, warId);
    const beforeSite = summarizeSite(world, siteA);
    const materials = new MaterialRegistry();
    registerStandardMaterials(materials);
    const restored = restoreWorld(snapshotWorld(world), { componentTypes: ALL_COMPONENT_TYPES, materials });
    expect(summarizeWar(restored, warId)).toEqual(beforeWar);
    expect(summarizeSite(restored, siteA)).toEqual(beforeSite);
  });
});
