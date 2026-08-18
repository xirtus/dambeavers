/**
 * R1 GATE — "One Pond in Three Dimensions" (threejs_layer.md §29), driven
 * ENTIRELY through the presentation bridge's command/query surface, the
 * same path the 3D client uses. Every numbered step of the gate maps to an
 * assertion below. No renderer needed: the contract IS the boundary the
 * renderer consumes, so proving it here proves the 3D client's data path.
 */
import { describe, expect, it } from "vitest";
import { createLocalBridge, type LocalSimBridge } from "../../src/presentation/bridge/local-bridge.js";
import { mergeFrames } from "../../src/presentation/contracts/frame-merge.js";
import { getLog, getHeld } from "../../src/sim/labor/Log.js";
import { getConstruction } from "../../src/sim/labor/Construction.js";
import { getDamSegment } from "../../src/sim/hydrology/Dam.js";
import { findPath } from "../../src/sim/navigation/Pathfinding.js";
import { WaterField } from "../../src/sim/hydrology/WaterField.js";
import type { EntityId } from "../../src/sim/core/EntityId.js";
import type { WorldSnapshot } from "../../src/sim/persistence/WorldSnapshot.js";

function nearestTrees(bridge: LocalSimBridge, count: number): number[] {
  const dam = bridge.prospectiveDamSite;
  return bridge.getFrame().entityUpserts
    .filter((e) => e.kind === "tree")
    .sort((a, b) => (Math.abs(a.x - dam.x) + Math.abs(a.z - dam.z)) - (Math.abs(b.x - dam.x) + Math.abs(b.z - dam.z)) || a.id - b.id)
    .slice(0, count)
    .map((t) => t.id);
}

describe("R1 gate: One Pond in Three Dimensions (through the bridge)", () => {
  it("performs the whole pond arc through real commands", { timeout: 60_000 }, () => {
    const bridge = createLocalBridge({ seed: "m0-pond-test" });
    const world = bridge.worldForVerification;

    // (1)-(3) render a real watershed with real terrain, stream, 7 beavers.
    const frame = bridge.getFrame();
    expect(frame.liveBeavers).toBe(7);
    expect(frame.liveTrees).toBeGreaterThan(400);
    expect(frame.dirtyTerrainChunks.length).toBeGreaterThan(0);
    const waterChunk = bridge.getWaterChunk({ cx: 1, cz: 1 });
    expect([...waterChunk.depth].some((d) => d > 0)).toBe(true);

    // (4) inspect real cells/entities by stable ID.
    const beaver = frame.entityUpserts.find((e) => e.kind === "beaver")!;
    const inspection = bridge.inspectEntity(beaver.id);
    expect(inspection!.name).toBe(beaver.name);
    expect(inspection!.components["needs"]).toBeDefined();
    const cell = bridge.inspectCell(beaver.x, beaver.z);
    expect(cell.occupantIds).toContain(beaver.id);

    // (5) designate a real tree through the normal command path;
    // (6) ordinary AI chooses the cutting job; (7) tree -> real logs.
    const trees = nearestTrees(bridge, 6);
    for (const treeId of trees) {
      expect(bridge.submitCommand({ type: "designate-tree-cut", treeId }).ok).toBe(true);
    }
    bridge.submitCommand({ type: "advance-ticks", ticks: 1400 });
    for (const treeId of trees) {
      expect(world.entities.isLive(treeId as EntityId)).toBe(false);
    }
    const logs = world.entities.liveIdsOfKind("log").filter((id) => getLog(world.components, id) !== undefined);
    expect(logs.length).toBeGreaterThan(0);
    const merged1 = mergeFrames(bridge.drainFrames())!;
    expect(merged1.events.some((e) => e.kind === "tree-felled")).toBe(true);

    // (8) a real beaver hauls a real log (held item = the real log id).
    const dam = bridge.prospectiveDamSite;
    expect(bridge.submitCommand({ type: "designate-construction", kind: "dam-segment", x: dam.x, z: dam.z }).ok).toBe(true);
    let sawCarried = false;
    for (let chunk = 0; chunk < 60 && !sawCarried; chunk++) {
      bridge.submitCommand({ type: "advance-ticks", ticks: 25 });
      if (world.entities.liveIdsOfKind("log").some((id) => getHeld(world.components, id) !== undefined)) sawCarried = true;
    }
    expect(sawCarried).toBe(true);

    // (9)-(11) dam order -> delivered materials -> completion through the
    // authoritative construction state, then application to real terrain.
    // Save mid-scenario (16) and reconstruct (17)-(18).
    const snapshotMid = bridge.saveSnapshot() as WorldSnapshot;

    // Build the full row, three levels, like a player: re-designate as sites free up.
    for (let round = 0; round < 6; round++) {
      for (let dx = -2; dx <= 2; dx++) {
        bridge.submitCommand({ type: "designate-construction", kind: "dam-segment", x: dam.x + dx, z: dam.z });
      }
      bridge.submitCommand({ type: "advance-ticks", ticks: 900 });
    }
    const applied = world.events.eventsOfType("dam-segment-applied").length;
    expect(applied).toBeGreaterThanOrEqual(5);
    const firstDam = world.entities.liveIdsOfKind("dam-segment")[0]!;
    expect(getDamSegment(world.components, firstDam)).toBeDefined();

    // (12) upstream water rose because the hydrology says so.
    const upstream = { x: world.entities && dam.x, z: dam.z - 2 };
    const depthAfter = world.water.depthAt(upstream.x, upstream.z);
    expect(depthAfter).toBeGreaterThan(0.15);

    // (13) routes change: a dry path that existed before the pond now
    // reports deep water for a non-swimmer, while a swimmer still crosses.
    const swim = { canSwim: true, maxWadingDepth: 0.4 };
    const noSwim = { canSwim: false, maxWadingDepth: 1 };
    const acrossA = { x: dam.x, z: dam.z - 2 };
    const acrossB = { x: dam.x, z: dam.z + 2 };
    const dryField = new WaterField(world.grid); // bone dry control
    const pathDry = findPath(world.grid, world.terrain, dryField, bridgeMaterials(bridge), acrossA, acrossB, noSwim);
    expect(pathDry).toBeDefined();
    const pathFloodedNoSwim = findPath(world.grid, world.terrain, world.water, bridgeMaterials(bridge), acrossA, acrossB, noSwim);
    const pathFloodedSwim = findPath(world.grid, world.terrain, world.water, bridgeMaterials(bridge), acrossA, acrossB, swim);
    // non-swimmer either fails entirely or must route differently than the dry straight line
    if (pathFloodedNoSwim !== undefined) {
      expect(JSON.stringify(pathFloodedNoSwim)).not.toBe(JSON.stringify(pathDry));
    }
    expect(pathFloodedSwim).toBeDefined();

    // (14) ecology reacts: some trees died from the flooding (real plant-died events) OR health dropped.
    const plantDeaths = world.events.eventsOfType("plant-died").length;
    expect(plantDeaths).toBeGreaterThan(0);

    // (15) causal chain via the Why? inspector.
    const why = bridge.whyWaterRose(upstream.x, upstream.z);
    expect(why.steps.length).toBeGreaterThan(0);

    // (16)-(18) save mid-scenario, reload, and get the same projection back.
    const restored = createLocalBridge({ snapshot: JSON.parse(JSON.stringify(snapshotMid)) as WorldSnapshot });
    const restoredFrame = restored.getFrame();
    const liveFrame = bridge.getFrame();
    // the restored world is an EARLIER tick (mid-scenario save), compare against the saved tick
    expect(restoredFrame.tick).toBe(snapshotMid.clock.tickIndex);
    expect(restoredFrame.liveBeavers).toBe(7);
    // projection identity: every restored entity's position matches its authoritative restored state
    for (const record of restoredFrame.entityUpserts) {
      if (record.kind === "construction") continue;
      const pos = restored.worldForVerification.grid.positionOf(record.id as EntityId);
      if (record.heldBy !== undefined) continue;
      expect(pos, `restored entity ${record.id}`).toBeDefined();
      expect(pos!.x).toBe(record.x);
      expect(pos!.z).toBe(record.z);
    }
    expect(liveFrame.tick).toBeGreaterThan(restoredFrame.tick);
  });
});

function bridgeMaterials(bridge: LocalSimBridge) {
  return bridge.materialsForVerification!;
}
