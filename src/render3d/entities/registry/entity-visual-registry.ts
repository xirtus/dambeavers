/**
 * Entity visual registry (threejs_layer.md §3.4/R2): reconciles merged
 * frame patches into visual controllers keyed by STABLE ENTITY ID. Every
 * selectable thing on screen maps back to its sim id; removals destroy
 * visuals; upserts create/update them. The registry never invents state --
 * it only mirrors the projection.
 */
import { Group, type DataTexture } from "three/webgpu";
import type { RenderEntityRecord } from "../../../presentation/contracts/render-entity.js";
import { BeaverVisual } from "../beavers/beaver-visual.js";
import { TreeInstanceSystem } from "../../world/vegetation/tree-instances.js";
import { LogInstanceSystem } from "../items/log-instances.js";
import { ConstructionVisuals } from "../structures/construction-visuals.js";
import type { VisualClock } from "../../materials/visual-clock.js";

export class EntityVisualRegistry {
  readonly trees: TreeInstanceSystem;
  readonly logs: LogInstanceSystem;
  readonly constructions: ConstructionVisuals;
  private readonly beavers = new Map<number, BeaverVisual>();
  private readonly corpses = new Map<number, BeaverVisual>();
  private readonly records = new Map<number, RenderEntityRecord>();
  /** Authoritative seconds per tick at current speed; set by the app per merged frame so interpolation paces match real tick cadence. */
  tickSeconds = 1 / 20;

  constructor(
    private readonly roots: { entityRoot: Group; vegetationRoot: Group },
    noise: DataTexture,
    clockU: VisualClock,
  ) {
    this.trees = new TreeInstanceSystem(roots.vegetationRoot, clockU);
    this.logs = new LogInstanceSystem(roots.entityRoot);
    this.constructions = new ConstructionVisuals(roots.entityRoot);
    this.noise = noise;
  }

  private readonly noise: DataTexture;

  beaverVisual(id: number): BeaverVisual | undefined {
    return this.beavers.get(id) ?? this.corpses.get(id);
  }

  recordOf(id: number): RenderEntityRecord | undefined {
    return this.records.get(id);
  }

  allRecords(): IterableIterator<RenderEntityRecord> {
    return this.records.values();
  }

  upsert(record: RenderEntityRecord): void {
    this.records.set(record.id, record);
    switch (record.kind) {
      case "tree":
        this.trees.upsert(record);
        break;
      case "log":
        this.logs.upsert(record, (beaverId) => this.beavers.get(beaverId)?.getCarryAnchor());
        break;
      case "construction":
        this.constructions.upsert(record);
        break;
      case "dam-segment":
        break; // real terrain cells -- the terrain mesher renders it
      case "corpse": {
        let visual = this.corpses.get(record.id);
        if (visual === undefined) {
          visual = new BeaverVisual(record.id, this.noise);
          this.roots.entityRoot.add(visual.group);
          this.corpses.set(record.id, visual);
        }
        visual.applyRecord(record, this.tickSeconds);
        break;
      }
      case "beaver":
      default: {
        let visual = this.beavers.get(record.id);
        if (visual === undefined) {
          visual = new BeaverVisual(record.id, this.noise);
          this.roots.entityRoot.add(visual.group);
          this.beavers.set(record.id, visual);
        }
        visual.applyRecord(record, this.tickSeconds);
        break;
      }
    }
  }

  remove(entityId: number): void {
    const record = this.records.get(entityId);
    this.records.delete(entityId);
    this.trees.remove(entityId);
    this.logs.remove(entityId);
    this.constructions.remove(entityId);
    const beaver = this.beavers.get(entityId);
    if (beaver !== undefined) {
      beaver.group.removeFromParent();
      this.beavers.delete(entityId);
    }
    const corpse = this.corpses.get(entityId);
    if (corpse !== undefined) {
      corpse.group.removeFromParent();
      this.corpses.delete(entityId);
    }
    void record;
  }

  /** Per-frame animation/interpolation update. */
  update(dt: number, visualTime: number): void {
    for (const visual of this.beavers.values()) visual.update(dt, visualTime);
    for (const visual of this.corpses.values()) visual.update(dt, visualTime);
  }

  clear(): void {
    this.trees.clear();
    this.logs.clear();
    this.constructions.clear();
    for (const visual of this.beavers.values()) visual.group.removeFromParent();
    for (const visual of this.corpses.values()) visual.group.removeFromParent();
    this.beavers.clear();
    this.corpses.clear();
    this.records.clear();
  }
}
