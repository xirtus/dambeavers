/**
 * Headless acceptance test for P3-10 -- Structural support.
 *
 * Roadmap acceptance test: "unsupported structures fail according to
 * support/strength rules rather than construction type scripts."
 *
 * `Structural.isSupported` is one kind-agnostic BFS rule applied to a
 * plain segment list: grounded directly, or chain-connected at the same
 * height to a grounded segment within a span derived from the segment's
 * own material `strength`. Dam segments and bridge segments share the
 * IDENTICAL rule (no per-construction-type script), and the rule drives
 * real collapse through `tickBridgeStructure`.
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
import { setConstruction } from "../../src/sim/labor/Construction.js";
import { setDamSegment, getDamSegment } from "../../src/sim/hydrology/Dam.js";
import { setBridgeSegment, applyBridgeSegment, tickBridgeStructure, getBridgeSegment } from "../../src/sim/structures/Bridge.js";
import { isSupported, type StructuralSegmentView } from "../../src/sim/structures/Structural.js";
import { getGood } from "../../src/sim/economy/Good.js";

function buildWorld(): { world: World; materials: MaterialRegistry } {
  const entities = new EntityIdRegistry();
  const components = new ComponentStore(entities);
  const grid = new WorldGrid({ sizeX: 20, sizeY: 12, sizeZ: 20 }, entities);
  const materials = new MaterialRegistry();
  registerStandardMaterials(materials);
  const terrain = new TerrainField(grid, materials);
  for (let x = 0; x < 20; x++) for (let z = 0; z < 20; z++) for (let y = 0; y <= 2; y++) terrain.setMaterial(x, y, z, "soil");
  const water = new WaterField(grid);
  const weather = new Weather();
  const clock = new SimulationClock({ tickRateHz: 20 });
  const random = new RandomStreams(110);
  const events = new EventLog(entities);
  return { world: { clock, random, entities, components, grid, terrain, events, water, weather }, materials };
}

function damView(world: World, x: number, z: number, materialId: string): StructuralSegmentView {
  const id = world.entities.create("dam-segment");
  setDamSegment(world.components, id, { site: { x, z }, materialId, baseY: 2, heightCells: 1, structuralIntegrity: 1 });
  return { id, site: { x, z }, y: 4, materialId };
}

function bridgeView(world: World, x: number, z: number, materialId: string): StructuralSegmentView {
  const id = world.entities.create("bridge-segment");
  setBridgeSegment(world.components, id, { site: { x, z }, materialId, y: 4, structuralIntegrity: 1, displacedDepthL: 0 });
  return { id, site: { x, z }, y: 4, materialId };
}

describe("P3-10 -- Structural support", () => {
  it("support follows one strength-derived rule for every construction kind", () => {
    const { world, materials } = buildWorld();
    // Segments at y=4 -- all in open air above the y=2 floor.
    const a = damView(world, 5, 5, "wood"); // grounded: solid placed directly beneath it
    world.terrain.setMaterial(5, 3, 5, "soil");
    const b = bridgeView(world, 6, 5, "wood"); // chained through a (hop 1)
    const c = damView(world, 7, 5, "wood"); // chained a->b->c (hop 2)
    const d = bridgeView(world, 8, 5, "wood"); // hop 3 == wood's real span of 3
    const e = damView(world, 9, 5, "wood"); // hop 4 > wood's span of 3
    const lone = damView(world, 12, 12, "wood"); // no neighbors, not grounded

    const segments = [a, b, c, d, e, lone];
    expect(isSupported(world.grid, materials, segments, a)).toBe(true); // grounded directly
    expect(isSupported(world.grid, materials, segments, b)).toBe(true); // one hop through a dam segment -- a bridge segment is supported BY a dam segment, same rule
    expect(isSupported(world.grid, materials, segments, c)).toBe(true); // two hops
    expect(isSupported(world.grid, materials, segments, d)).toBe(true); // three hops: wood's real strength-derived span
    expect(isSupported(world.grid, materials, segments, e)).toBe(false); // beyond the material's real span
    expect(isSupported(world.grid, materials, segments, lone)).toBe(false); // floating with nothing to chain to

    // The SAME segment geometry with a stronger material (stone, strength
    // 6) spans further -- the rule is over material properties, never a
    // construction-type table.
    const eStone = bridgeView(world, 9, 5, "stone");
    const stoneSegments = [a, b, c, d, eStone];
    expect(isSupported(world.grid, materials, stoneSegments, eStone)).toBe(true);
  });

  it("an unsupported real bridge segment collapses under the shared rule, removing its deck", () => {
    const { world, materials } = buildWorld();
    const site = { x: 15, z: 15 };
    const constructionId = world.entities.create("construction");
    setConstruction(world.components, constructionId, { designationId: constructionId, kind: "bridge", site, requiredMaterialId: "wood", requiredMassKg: 1, workDone: 1, workRequired: 1, status: "complete" });
    const bridgeId = applyBridgeSegment(world, constructionId);
    const bridge = getBridgeSegment(world.components, bridgeId)!;
    expect(world.terrain.materialAt(site.x, bridge.y, site.z)).toBe("wood");

    // Grounded while the floor cell beneath the deck is solid: intact.
    expect(tickBridgeStructure(world, materials, bridgeId)).toBe("intact");

    // Excavate the support out from under the deck -> the shared support
    // rule fails the segment and the real deck terrain is removed.
    world.terrain.excavate(site.x, bridge.y - 1, site.z);
    expect(tickBridgeStructure(world, materials, bridgeId)).toBe("collapsed");
    expect(world.terrain.materialAt(site.x, bridge.y, site.z)).toBeUndefined();
    expect(world.entities.isLive(bridgeId)).toBe(false);

    // The material reappears as real physical debris, never erased.
    const debris = world.entities.liveIdsOfKind("good").map((id) => getGood(world.components, id)!).filter((g) => g.goodKind === "debris");
    expect(debris.length).toBeGreaterThan(0);
    expect(debris[0]!.materialId).toBe("wood");
  });
});
