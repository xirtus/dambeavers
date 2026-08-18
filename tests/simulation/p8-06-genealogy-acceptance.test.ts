/**
 * Headless acceptance test for P8-06 -- Genealogy.
 *
 * Roadmap acceptance test: "lineage can be traversed across many
 * generations with no duplicated or broken identity references."
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
import { snapshotWorld, restoreWorld } from "../../src/sim/persistence/WorldSnapshot.js";
import { ALL_COMPONENT_TYPES } from "../../src/sim/persistence/AllComponentTypes.js";
import { RegionMap } from "../../src/sim/region/RegionMap.js";
import { createSite } from "../../src/sim/region/Site.js";
import { advanceWorldTicks } from "../../src/sim/region/DeepTime.js";
import { spawnBeaver } from "../../src/sim/creatures/Beaver.js";
import { produceOffspring } from "../../src/sim/creatures/Reproduction.js";
import { createHousehold, setHouseholdMembership, setRelationshipWith } from "../../src/sim/creatures/Relationships.js";
import { createZone } from "../../src/sim/spaces/FunctionalSpace.js";
import { claimSleepSpace, createSleepSpace } from "../../src/sim/spaces/SleepSpace.js";
import { setConstruction } from "../../src/sim/labor/Construction.js";
import { die } from "../../src/sim/creatures/Mortality.js";
import { parentsOf, childrenOf, ancestorsOf, descendantsOf, familyLineage, generationDepth } from "../../src/sim/chronicle/Genealogy.js";

function buildWorld(): { world: World; materials: MaterialRegistry; regionMap: RegionMap } {
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
  const random = new RandomStreams(806);
  const events = new EventLog(entities);
  return {
    world: { clock, random, entities, components, grid, terrain, events, water, weather },
    materials,
    regionMap: new RegionMap(16, 16),
  };
}

function spawnAt(world: World, name: string, x: number, z: number): EntityId {
  const floor = world.grid.surfaceY(x, z)!;
  return spawnBeaver(world, { name, position: { x, y: floor + 1, z } });
}

function completeConstruction(world: World, kind: "wall" | "lodge-segment", x: number, z: number): EntityId {
  const id = world.entities.create("construction");
  setConstruction(world.components, id, {
    designationId: id, kind, site: { x, z }, requiredMaterialId: "wood", requiredMassKg: 1, workDone: 1, workRequired: 1, status: "complete",
  });
  return id;
}

function lodgeFor(world: World, parentA: EntityId, parentB: EntityId, x: number, z: number): EntityId {
  const zoneId = createZone(world, { cells: [{ x, z }, { x: x + 1, z }], declaredFunction: "general-zone" });
  for (const wall of [{ x: x - 1, z }, { x, z: z - 1 }, { x, z: z + 1 }, { x: x + 1, z: z - 1 }, { x: x + 1, z: z + 1 }, { x: x + 2, z }]) {
    completeConstruction(world, "wall", wall.x, wall.z);
  }
  completeConstruction(world, "lodge-segment", x, z);
  const left = createSleepSpace(world, { zoneId, kind: "nest", cell: { x, z } });
  const right = createSleepSpace(world, { zoneId, kind: "nest", cell: { x: x + 1, z } });
  claimSleepSpace(world, parentA, left);
  claimSleepSpace(world, parentB, right);
  return zoneId;
}

function mate(world: World, a: EntityId, b: EntityId): void {
  setRelationshipWith(world.components, a, { withId: b, kin: "mate", familiarity: 1, affinity: 0.9 });
  setRelationshipWith(world.components, b, { withId: a, kin: "mate", familiarity: 1, affinity: 0.9 });
  const household = createHousehold(world);
  setHouseholdMembership(world.components, a, { householdId: household });
  setHouseholdMembership(world.components, b, { householdId: household });
}

describe("P8-06 -- Genealogy", () => {
  it("lineage traverses across many generations with no duplicated or broken identity references", () => {
    const { world } = buildWorld();

    // Generation 0: founders.
    const gen0A = spawnAt(world, "Gen0A", 3, 3);
    const gen0B = spawnAt(world, "Gen0B", 4, 3);
    mate(world, gen0A, gen0B);
    lodgeFor(world, gen0A, gen0B, 3, 3);
    const gen1 = produceOffspring(world, gen0A, gen0B, { birthIntervalTicks: 0 }).offspringId;
    world.clock.advanceTicks(100);

    // Generation 1: gen1 mates with an outsider.
    const gen1Mate = spawnAt(world, "Gen1Mate", 7, 3);
    mate(world, gen1, gen1Mate);
    lodgeFor(world, gen1, gen1Mate, 7, 3);
    const gen2 = produceOffspring(world, gen1, gen1Mate, { birthIntervalTicks: 0 }).offspringId;
    world.clock.advanceTicks(100);

    // Generation 2: gen2 mates with an outsider.
    const gen2Mate = spawnAt(world, "Gen2Mate", 11, 3);
    mate(world, gen2, gen2Mate);
    lodgeFor(world, gen2, gen2Mate, 11, 3);
    const gen3 = produceOffspring(world, gen2, gen2Mate, { birthIntervalTicks: 0 }).offspringId;
    world.clock.advanceTicks(100);

    // A middle-generation beaver dies -- traversal must still work
    // through recorded history (their birth event), not live components.
    die(world, gen1, "starvation");

    // Direct relations.
    expect(parentsOf(world, gen1)).toEqual([gen0A, gen0B]);
    expect(childrenOf(world, gen0A)).toContain(gen1);
    expect(childrenOf(world, gen1)).toContain(gen2);

    // Ancestors of the youngest: exactly every earlier generation, once.
    const ancestors = ancestorsOf(world, gen3);
    expect(ancestors).toContain(gen0A);
    expect(ancestors).toContain(gen0B);
    expect(ancestors).toContain(gen1);
    expect(ancestors).toContain(gen1Mate);
    expect(ancestors).toContain(gen2);
    expect(ancestors).toContain(gen2Mate);
    expect(new Set(ancestors).size).toBe(ancestors.length); // no duplicates
    expect(ancestors).not.toContain(gen3);

    // Descendants of the founders: exactly the three later generations.
    const descendants = descendantsOf(world, gen0A);
    expect(descendants).toContain(gen1);
    expect(descendants).toContain(gen2);
    expect(descendants).toContain(gen3);
    expect(new Set(descendants).size).toBe(descendants.length);
    expect(descendants).not.toContain(gen0B); // a mate, not a descendant

    // Generation depth.
    expect(generationDepth(world, gen0A)).toBe(0);
    expect(generationDepth(world, gen1)).toBe(1);
    expect(generationDepth(world, gen3)).toBe(3);

    // The whole family, each member once, every reference resolvable.
    const lineage = familyLineage(world, gen3, 8);
    const ids = lineage.map((member) => member.personId);
    expect(new Set(ids).size).toBe(ids.length); // no duplicated members
    for (const member of lineage) {
      // No broken identity references: every parent/child resolves as a
      // known beaver, forever.
      for (const id of [member.personId, ...member.parentIds, ...member.childIds]) {
        expect(world.entities.isKnown(id)).toBe(true);
        expect(world.entities.kindOf(id)).toBe("beaver");
      }
    }

    // Unknown ids throw -- lineage cannot silently fabricate relatives.
    expect(() => parentsOf(world, 999_999 as EntityId)).toThrow(RangeError);
  });

  it("lineage survives centuries of deep time and save/reload", () => {
    const { world, regionMap } = buildWorld();
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) regionMap.setElevation(x, z, 0);

    const gen0A = spawnAt(world, "FounderA", 3, 3);
    const gen0B = spawnAt(world, "FounderB", 4, 3);
    mate(world, gen0A, gen0B);
    lodgeFor(world, gen0A, gen0B, 3, 3);
    const gen1 = produceOffspring(world, gen0A, gen0B, { birthIntervalTicks: 0 }).offspringId;
    world.clock.advanceTicks(200);
    const gen1Mate = spawnAt(world, "FounderMate", 7, 3);
    mate(world, gen1, gen1Mate);
    lodgeFor(world, gen1, gen1Mate, 7, 3);
    const gen2 = produceOffspring(world, gen1, gen1Mate, { birthIntervalTicks: 0 }).offspringId;

    const lineageBefore = familyLineage(world, gen2, 8);
    const descendantsBefore = descendantsOf(world, gen0A);

    // A real offscreen site absorbs the deep-time advance (P6-13's own
    // mechanism); the registry and event log -- and therefore every
    // lineage reference -- survive it by construction.
    const site = createSite(world, regionMap, 4, 4, 20, 300);
    advanceWorldTicks(world, 100 * 48_000, () => "forest", { forest: 0.8, wetland: 0.7, grassland: 0.5, desert: 0.1, tundra: 0.1, mountain: 0.1 });

    const descendantsAfter = descendantsOf(world, gen0A);
    expect(descendantsAfter).toEqual(descendantsBefore);
    for (const id of [...descendantsAfter, gen0A, gen0B, gen1, gen1Mate]) {
      expect(world.entities.isKnown(id)).toBe(true);
    }
    expect(site).toBeDefined();

    // Save/reload: the same lineage, bit for bit.
    const restored = restoreWorld(snapshotWorld(world), { componentTypes: ALL_COMPONENT_TYPES, materials: buildWorld().materials });
    expect(familyLineage(restored, gen2, 8)).toEqual(lineageBefore);
    expect(descendantsOf(restored, gen0A)).toEqual(descendantsAfter);
  });
});
