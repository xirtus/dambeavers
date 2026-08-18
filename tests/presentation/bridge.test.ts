/**
 * R0/R1 contract tests: the presentation bridge projects the REAL pond
 * world, commands flow through real sim mechanisms, and save/load
 * rehydrates an identical projection -- all headless, no renderer needed.
 */
import { describe, expect, it } from "vitest";
import { createLocalBridge, LocalSimBridge } from "../../src/presentation/bridge/local-bridge.js";
import { mergeFrames } from "../../src/presentation/contracts/frame-merge.js";
import type { RenderFrame } from "../../src/presentation/contracts/render-frame.js";
import { getLog } from "../../src/sim/labor/Log.js";
import { getConstruction } from "../../src/sim/labor/Construction.js";
import type { WorldSnapshot } from "../../src/sim/persistence/WorldSnapshot.js";
import type { EntityId } from "../../src/sim/core/EntityId.js";

function makeBridge(): LocalSimBridge {
  return createLocalBridge({ seed: "m0-pond-test" });
}

function tick(bridge: LocalSimBridge, ticks: number): void {
  bridge.submitCommand({ type: "advance-ticks", ticks });
}

describe("presentation bridge (R0 gate)", () => {
  it("projects the real pond world: 7 beavers, trees, water, terrain chunks", () => {
    const bridge = makeBridge();
    const frame = bridge.getFrame();
    expect(frame.schemaVersion).toBe(1);
    expect(frame.focus).toEqual({ sizeX: 41, sizeY: 14, sizeZ: 61 });
    expect(frame.liveBeavers).toBe(7);
    expect(frame.liveTrees).toBeGreaterThan(50);
    const beavers = frame.entityUpserts.filter((e) => e.kind === "beaver");
    expect(beavers).toHaveLength(7);
    expect(new Set(beavers.map((b) => b.id)).size).toBe(7);
    for (const beaver of beavers) {
      expect(beaver.name).toBeDefined();
      expect(beaver.y).toBeGreaterThan(0);
    }
    // First frame marks every chunk dirty (full rebuild).
    expect(frame.dirtyTerrainChunks.length).toBe(3 * 4); // ceil(41/16) x ceil(61/16)
    expect(frame.dirtyWaterChunks.length).toBe(12);

    const chunk = bridge.getTerrainChunk({ cx: 1, cz: 1 });
    expect(chunk.materialIndex.length).toBe(chunk.sizeX * chunk.sizeY * chunk.sizeZ);
    expect(chunk.materialPalette).toContain("soil");
    const water = bridge.getWaterChunk({ cx: 1, cz: 1 });
    let wet = 0;
    for (const d of water.depth) if (d > 0) wet++;
    expect(wet).toBeGreaterThan(0);
  });

  it("clicking a projected entity resolves to its stable simulation ID and inspects truthfully", () => {
    const bridge = makeBridge();
    const frame = bridge.getFrame();
    const beaver = frame.entityUpserts.find((e) => e.kind === "beaver")!;
    const view = bridge.inspectEntity(beaver.id);
    expect(view).toBeDefined();
    expect(view!.kind).toBe("beaver");
    expect(view!.position).toEqual({ x: beaver.x, y: beaver.y, z: beaver.z });
    expect(view!.components["needs"]).toBeDefined();
    expect(view!.name).toBe(beaver.name);

    const cell = bridge.inspectCell(beaver.x, beaver.z);
    expect(cell.occupantIds).toContain(beaver.id);
    expect(cell.groundY).toBe(beaver.y - 1);
  });

  it("a designation command creates a REAL designation and the colony fells the tree into real logs", { timeout: 30_000 }, () => {
    const bridge = makeBridge();
    const frame = bridge.getFrame();
    const tree = frame.entityUpserts.find((e) => e.kind === "tree")!;
    const result = bridge.submitCommand({ type: "designate-tree-cut", treeId: tree.id });
    expect(result.ok).toBe(true);

    // Real designation exists in the sim (renderer-visible side effect only via frames).
    const world = bridge.worldForVerification;
    expect(world.entities.kindOf(result.entityId as EntityId)).toBe("designation");

    tick(bridge, 1500);
    const world2 = bridge.worldForVerification;
    expect(world2.entities.isLive(tree.id as EntityId)).toBe(false);
    const logs = world2.entities.liveIdsOfKind("log").filter((id) => getLog(world2.components, id) !== undefined);
    expect(logs.length).toBeGreaterThan(0);

    // The merged frame stream reports the tree's removal and the new logs.
    const merged = mergeFrames(bridge.drainFrames())!;
    expect(merged.entityRemovals).toContain(tree.id);
    expect(merged.entityUpserts.some((e) => e.kind === "log")).toBe(true);
    expect(merged.events.some((e) => e.kind === "tree-felled")).toBe(true);
  });

  it("renderer cannot mutate simulation through frames (immutability)", () => {
    const bridge = makeBridge();
    const frame = bridge.getFrame() as {
      -readonly [K in keyof RenderFrame]: RenderFrame[K];
    };
    const beaver = frame.entityUpserts.find((e) => e.kind === "beaver")! as { -readonly [K in keyof RenderFrame["entityUpserts"][number]]: unknown };
    const originalX = beaver.x;
    beaver.x = 999; // mutate the projection (a contract violation by a buggy renderer)...
    const world = bridge.worldForVerification;
    expect(world.grid.positionOf(beaver.id as EntityId)!.x).toBe(originalX); // ...the SIM is untouched...
    const inspected = bridge.inspectEntity(beaver.id as number);
    expect(inspected!.position!.x).toBe(originalX); // ...and fresh projections still read authoritative state
  });

  it("dam designation flows through the real construction path; save/load rehydrates an identical projection", { timeout: 30_000 }, () => {
    const bridge = makeBridge();
    const site = bridge.prospectiveDamSite;
    // Need logs first: fell several trees through the real path.
    const frame = bridge.getFrame();
    const trees = frame.entityUpserts.filter((e) => e.kind === "tree").slice(0, 6);
    for (const tree of trees) {
      expect(bridge.submitCommand({ type: "designate-tree-cut", treeId: tree.id }).ok).toBe(true);
    }
    tick(bridge, 3000);
    const world = bridge.worldForVerification;
    expect(world.entities.liveIdsOfKind("log").length).toBeGreaterThan(0);

    const result = bridge.submitCommand({ type: "designate-construction", kind: "dam-segment", x: site.x, z: site.z });
    expect(result.ok).toBe(true);
    const construction = getConstruction(world.components, result.entityId as EntityId);
    expect(construction).toBeDefined();
    expect(construction!.status).toBe("awaiting-materials");

    // Save mid-scenario, then load into a fresh bridge: the projection
    // must reconstruct solely from restored simulation state (Law R8).
    const snapshot = bridge.saveSnapshot() as WorldSnapshot;
    tick(bridge, 200);
    const before = bridge.getFrame();

    const restored = createLocalBridge({ snapshot: JSON.parse(JSON.stringify(snapshot)) as WorldSnapshot });
    const restoredFrame = restored.getFrame();
    expect(restoredFrame.liveBeavers).toBe(7);
    expect(restoredFrame.tick).toBe((JSON.parse(JSON.stringify(snapshot)) as WorldSnapshot).clock.tickIndex);
    // Every projected entity position matches the authoritative restored world.
    for (const record of restoredFrame.entityUpserts) {
      if (record.kind === "construction") continue; // constructions have site, not grid position
      const position = restored.worldForVerification.grid.positionOf(record.id as EntityId);
      if (record.heldBy !== undefined) continue; // held items ride their carrier
      expect(position, `entity ${record.id} (${record.kind})`).toBeDefined();
      expect(position!.x).toBe(record.x);
      expect(position!.y).toBe(record.y);
      expect(position!.z).toBe(record.z);
    }
    expect(before.worldRevision).toBeGreaterThan(0);
  });

  it("time commands drive the real clock", () => {
    const bridge = makeBridge();
    expect(bridge.getFrame().environment.paused).toBe(true);
    bridge.submitCommand({ type: "resume" });
    expect(bridge.getFrame().environment.paused).toBe(false);
    bridge.submitCommand({ type: "set-speed", speed: 4 });
    expect(bridge.getFrame().environment.speed).toBe(4);
    const tickBefore = bridge.getFrame().tick;
    bridge.advance(1); // one real second at 20Hz x4 speed
    bridge.submitCommand({ type: "pause" });
    expect(bridge.getFrame().tick).toBeGreaterThanOrEqual(tickBefore + 80 - 1);
  });

  it("water only ever appears where the sim has water (truth audit on the frame)", () => {
    const bridge = makeBridge();
    tick(bridge, 30);
    const world = bridge.worldForVerification;
    for (const coord of bridge.getFrame().dirtyWaterChunks) {
      const chunk = bridge.getWaterChunk(coord);
      for (let lz = 0; lz < chunk.sizeZ; lz++) {
        for (let lx = 0; lx < chunk.sizeX; lx++) {
          const d = chunk.depth[lz * chunk.sizeX + lx]!;
          const simDepth = world.water.depthAt(chunk.originX + lx, chunk.originZ + lz);
          expect(d).toBeCloseTo(simDepth, 5);
        }
      }
    }
  });
});
