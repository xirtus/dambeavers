import { ComponentStore, defineComponent, type ComponentType } from "../core/ComponentStore.js";
import type { EntityId } from "../core/EntityId.js";
import type { ColumnCoordinate } from "../hydrology/WaterField.js";
import type { MaterialId, MaterialRegistry } from "../materials/Material.js";
import type { World } from "../persistence/WorldSnapshot.js";
import { getConstruction } from "../labor/Construction.js";
import { setGood } from "../economy/Good.js";
import { isSupported, hydraulicStress, stressedIntegrity, type StructuralSegmentView } from "./Structural.js";

/**
 * P3-14: turns a completed `"bridge"` construction (P1-10) into real,
 * physical, walkable terrain above water -- the same "reuse the already-
 * real terrain/pathfinding mechanism, add no new one" pattern `Dam.ts`
 * established for `"dam-segment"` (that file's own doc comment applies
 * here verbatim: no new hydraulic OR navigation mechanism is invented,
 * `TerrainField.setMaterial` and P1-04's existing `surfaceY`-based
 * pathfinding already do all the work once real solid material exists at
 * the site). Height is chosen just above the site's CURRENT water
 * surface (or, for a dry span, one above its own floor) so the deck
 * clears the water it's crossing, not an arbitrary fixed height.
 */
export interface BridgeSegment {
  site: ColumnCoordinate;
  materialId: MaterialId;
  y: number;
  structuralIntegrity: number;
  /** Water depth displaced below the deck when this segment was applied -- recorded so a collapsed segment can release that water back into its column rather than silently destroying it (Law 1.6). */
  displacedDepthL: number;
}
export const BridgeSegmentComponent: ComponentType<BridgeSegment> = defineComponent<BridgeSegment>("bridge-segment");

export function assertValidBridgeSegment(bridge: BridgeSegment): void {
  if (!Number.isInteger(bridge.site.x) || !Number.isInteger(bridge.site.z)) {
    throw new RangeError(`bridge segment site must have integer coordinates, got ${JSON.stringify(bridge.site)}`);
  }
  if (bridge.materialId.trim().length === 0) throw new RangeError("bridge segment materialId must be non-empty");
  if (!Number.isInteger(bridge.y)) throw new RangeError(`bridge segment y must be an integer, got ${bridge.y}`);
  if (!(Number.isFinite(bridge.structuralIntegrity) && bridge.structuralIntegrity >= 0 && bridge.structuralIntegrity <= 1)) {
    throw new RangeError(`bridge segment structuralIntegrity must be between 0 and 1, got ${bridge.structuralIntegrity}`);
  }
  if (!(Number.isFinite(bridge.displacedDepthL) && bridge.displacedDepthL >= 0)) {
    throw new RangeError(`bridge segment displacedDepthL must be a non-negative finite number, got ${bridge.displacedDepthL}`);
  }
}

export function setBridgeSegment(components: ComponentStore, id: EntityId, bridge: BridgeSegment): void {
  assertValidBridgeSegment(bridge);
  components.set(id, BridgeSegmentComponent, bridge);
}

export function getBridgeSegment(components: ComponentStore, id: EntityId): BridgeSegment | undefined {
  const bridge = components.get(id, BridgeSegmentComponent);
  if (bridge !== undefined) assertValidBridgeSegment(bridge);
  return bridge;
}

export interface BridgeApplication {
  bridgeSegmentId: EntityId;
}
export const BridgeApplicationComponent: ComponentType<BridgeApplication> = defineComponent<BridgeApplication>("bridge-application");

/** Mirrors `Dam.ts`'s own `applyDamSegment` idempotency guard/doc comment verbatim -- see that function for why a second call for the same construction must throw rather than silently double-apply. */
export function applyBridgeSegment(world: World, constructionId: EntityId): EntityId {
  const construction = getConstruction(world.components, constructionId);
  if (construction === undefined || construction.kind !== "bridge" || construction.status !== "complete") {
    throw new RangeError(`construction ${constructionId} is not a completed "bridge" construction -- cannot apply it`);
  }
  if (world.components.has(constructionId, BridgeApplicationComponent)) {
    throw new RangeError(`construction ${constructionId} has already been applied to the terrain -- cannot apply it twice`);
  }
  const { site, requiredMaterialId } = construction;
  const floorY = world.grid.surfaceY(site.x, site.z) ?? -1;
  const waterSurfaceY = world.water.waterSurfaceY(site.x, site.z);
  const deckY = Math.max(floorY, waterSurfaceY === undefined ? floorY : Math.ceil(waterSurfaceY)) + 1;

  // The deck becomes this column's new navigation surface, so the column's
  // stored open-water depth (which `WaterField` always models as resting
  // ON TOP of the floor) must not pretend water sits above the deck --
  // a beaver standing on a deck that clears the water surface is dry.
  // The displaced water is recorded on the segment so a collapsed deck
  // releases it back into the column (Law 1.6), never silently destroying
  // it. Known heightfield approximation: while the deck stands, water
  // physically trapped BENEATH it is not represented in the column depth
  // (the column-height water model cannot hold sub-floor water), so flow
  // through a bridged column pauses until the deck is removed.
  const displacedDepthL = world.water.depthAt(site.x, site.z);
  if (displacedDepthL > 0) world.water.setDepth(site.x, site.z, 0);

  const bridgeId = world.entities.create("bridge-segment");
  setBridgeSegment(world.components, bridgeId, { site, materialId: requiredMaterialId, y: deckY, structuralIntegrity: 1, displacedDepthL });
  world.terrain.setMaterial(site.x, deckY, site.z, requiredMaterialId);
  world.components.set(constructionId, BridgeApplicationComponent, { bridgeSegmentId: bridgeId });
  world.events.record({ tick: world.clock.tick, eventType: "bridge-segment-applied", subjectIds: [bridgeId], objectIds: [constructionId], location: { x: site.x, y: deckY, z: site.z } });
  return bridgeId;
}

/** Removes a bridge segment entirely: excavates its real terrain (the route above water disappears -- P3-14's own literal "structural failure removes it"), releases the water it displaced back into its column (never exceeding water that has since risen -- a flood over the deck stays), and destroys the tracked entity. */
export function removeBridgeSegment(world: World, bridgeId: EntityId): void {
  const bridge = getBridgeSegment(world.components, bridgeId);
  if (bridge === undefined) throw new RangeError(`entity ${bridgeId} has no BridgeSegment component -- cannot remove it`);
  world.terrain.excavate(bridge.site.x, bridge.y, bridge.site.z);
  const currentDepth = world.water.depthAt(bridge.site.x, bridge.site.z);
  world.water.setDepth(bridge.site.x, bridge.site.z, Math.max(currentDepth, bridge.displacedDepthL));
  world.entities.destroy(bridgeId);
}

function segmentViewOf(id: EntityId, bridge: BridgeSegment): StructuralSegmentView {
  return { id, site: bridge.site, y: bridge.y, materialId: bridge.materialId };
}

/**
 * P3-10/P3-11 applied to bridges: one tick of real hydraulic wear (from
 * the water currently flowing beneath the deck) plus a fresh support
 * check (`Structural.isSupported`, chained through every OTHER live
 * bridge segment) -- a segment that's either lost all integrity to
 * accumulated stress OR is no longer connected to solid ground collapses
 * (`removeBridgeSegment`), spawning its material back as real, physical
 * debris rather than erasing it (Law 1.6). Every live bridge segment is
 * the support graph for every other; called once per segment per tick by
 * a driving loop over `entities.liveIdsOfKind("bridge-segment")`.
 */
export function tickBridgeStructure(world: World, materials: MaterialRegistry, bridgeId: EntityId): "intact" | "collapsed" {
  const bridge = getBridgeSegment(world.components, bridgeId);
  if (bridge === undefined) return "intact";

  const allSegments: StructuralSegmentView[] = [];
  for (const id of world.entities.liveIdsOfKind("bridge-segment")) {
    const other = getBridgeSegment(world.components, id);
    if (other !== undefined) allSegments.push(segmentViewOf(id, other));
  }

  const stress = hydraulicStress(world.water.depthAt(bridge.site.x, bridge.site.z));
  const integrity = stressedIntegrity(bridge.structuralIntegrity, stress);
  const supported = isSupported(world.grid, materials, allSegments, segmentViewOf(bridgeId, bridge));

  if (integrity <= 0 || !supported) {
    const floor = world.grid.surfaceY(bridge.site.x, bridge.site.z) ?? bridge.y - 1;
    const debrisId = world.entities.create("good");
    world.grid.setEntityPosition(debrisId, bridge.site.x, floor + 1, bridge.site.z);
    setGood(world.components, debrisId, { goodKind: "debris", materialId: bridge.materialId, massKg: 10 });
    removeBridgeSegment(world, bridgeId);
    return "collapsed";
  }

  setBridgeSegment(world.components, bridgeId, { ...bridge, structuralIntegrity: integrity });
  return "intact";
}

/** Drives every live bridge segment's structural tick once. */
export function tickAllBridgeStructures(world: World, materials: MaterialRegistry): void {
  for (const bridgeId of world.entities.liveIdsOfKind("bridge-segment").sort((a: EntityId, b: EntityId) => a - b)) {
    tickBridgeStructure(world, materials, bridgeId);
  }
}

