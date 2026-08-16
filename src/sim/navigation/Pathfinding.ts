import type { WorldGrid } from "../world/WorldGrid.js";
import type { TerrainField } from "../world/TerrainField.js";
import type { WaterField, ColumnCoordinate } from "../hydrology/WaterField.js";
import { movementCostMultiplier, type MaterialRegistry } from "../materials/Material.js";

/** Extra cost multiplier for swimming versus walking on dry, flat, unit-friction ground -- plausible, tunable balance data, not claimed to be exact. */
const SWIM_COST_MULTIPLIER = 2;
/** How much a 1-cell rise/fall between adjacent columns multiplies movement cost -- plausible, tunable balance data. */
const SLOPE_COST_WEIGHT = 0.5;
/** Extra cost per unit of depth while wading (water within `maxWadingDepth`, not deep enough to require swimming) -- plausible, tunable balance data. Deliberately depth-proportional rather than a flat premium, so a barely-wet column costs close to dry ground while a near-`maxWadingDepth` crossing costs noticeably more. */
const WADE_COST_WEIGHT = 0.6;

/**
 * What a specific agent can do, independent of any specific route -- the
 * roadmap's "unified terrestrial/aquatic navigation" means ONE cost
 * function serves every agent, with agent-specific capability as a
 * PARAMETER, not two separate walking/swimming pathfinders.
 */
export interface NavigationProfile {
  /** Whether this agent can enter water deeper than `maxWadingDepth` at all. */
  canSwim: boolean;
  /** Water depth (inclusive) this agent can still cross by walking/wading; strictly deeper requires `canSwim`. */
  maxWadingDepth: number;
}

export interface PathResult {
  /** Every column visited, start to goal inclusive, in travel order. */
  columns: ColumnCoordinate[];
  /** Total accumulated movement cost (not a physical distance/time unit -- see `edgeCost`'s doc comment). */
  cost: number;
}

function columnKey(x: number, z: number): string {
  return `${x},${z}`;
}

/** Why entering `to` fails for `profile` right now -- `describeEdgeBlock`'s result names, so a debug/explain caller gets a real reason instead of `findPath`/`edgeCost` collapsing every distinct cause down to a bare `undefined` (AGENTS.md Law 4: causality must be able to answer "what blocked it"). */
export type PathBlockReason = "no-ground" | "no-headroom" | "too-deep-to-cross";

/**
 * Whether entering column `to` is blocked for `profile` right now, and
 * why -- `undefined` if it is NOT blocked. Reads the same live
 * authoritative state `edgeCost` costs against (`WorldGrid.surfaceY`,
 * `WaterField.depthAt`), factored out into its own function so
 * `edgeCost`'s passability check and a debug/explain query can never
 * silently diverge from each other.
 *
 * `"no-ground"`: no terrain at all (`surfaceY` undefined -- an
 * ungenerated/open column). `"no-headroom"`: no room to stand within the
 * grid's own vertical extent -- e.g. a column filled with solid material
 * all the way to the top. (A more general "solid ceiling with an air gap
 * underneath" overhang isn't checked here: `WorldGrid.surfaceY` reports
 * only the topmost solid cell in a column, not "the topmost walkable
 * surface with clear headroom above it," and nothing this project has
 * built -- terrain is always a solid-from-the-bottom-up column via
 * `applyHeightfield` -- can currently produce a disconnected floating
 * overhang for that distinction to matter. Revisit if/when a future
 * system can build one.) `"too-deep-to-cross"`: water deeper than this
 * agent can wade AND it can't swim.
 */
export function describeEdgeBlock(
  grid: WorldGrid,
  water: WaterField,
  profile: NavigationProfile,
  to: ColumnCoordinate,
): PathBlockReason | undefined {
  const toFloor = grid.surfaceY(to.x, to.z);
  if (toFloor === undefined) return "no-ground";
  if (toFloor + 1 >= grid.dims.sizeY) return "no-headroom";
  const depth = water.depthAt(to.x, to.z);
  if (depth > profile.maxWadingDepth && !profile.canSwim) return "too-deep-to-cross";
  return undefined;
}

/**
 * The cost of ENTERING column `to` from `from` (adjacent, orthogonally),
 * for the given agent, or `undefined` if `describeEdgeBlock` reports it
 * blocked. Every input here is read live from real authoritative state
 * (`WorldGrid.surfaceY`/`isSolid`, `WaterField.depthAt`,
 * `TerrainField.materialOrAirAt`) -- nothing is cached or
 * separately-flagged, so a changed water level or a newly-excavated cell
 * is reflected the very next time this (or `findPath`) is called, with no
 * invalidation/notification mechanism needed (ARCHITECTURE_CONTRACT §11
 * / M0's navigation contract: "pathfinding must consume current
 * authoritative world state... it should discover changed traversability
 * from world state," not be manually told about it).
 *
 * Passable cost combines three independent multipliers on top of a base
 * cost of 1: the destination's own terrain movement cost
 * (`movementCostMultiplier`, P0-07 -- friction-derived, so a real
 * material property drives "dry walkable ground" cost, not a hardcoded
 * constant), a slope penalty proportional to the floor elevation change
 * between the two columns, and a water-depth premium -- `0` depth costs
 * nothing extra, any wadable depth (`0 < depth <= maxWadingDepth`) adds a
 * cost proportional to how deep ("shallow water," the roadmap's own
 * phrase, is genuinely costlier than dry ground, not free-riding on it),
 * and depth requiring `canSwim` instead applies flat
 * `SWIM_COST_MULTIPLIER` on top of the same terrain cost (so swimming
 * across gravel still costs differently than swimming across open water,
 * rather than swimming being a flat, terrain-blind cost).
 */
function edgeCost(
  grid: WorldGrid,
  terrain: TerrainField,
  water: WaterField,
  materials: MaterialRegistry,
  from: ColumnCoordinate,
  to: ColumnCoordinate,
  profile: NavigationProfile,
): number | undefined {
  if (describeEdgeBlock(grid, water, profile, to) !== undefined) return undefined;

  const toFloor = grid.surfaceY(to.x, to.z)!;
  const depth = water.depthAt(to.x, to.z);
  const swimming = depth > profile.maxWadingDepth;

  const materialId = terrain.materialOrAirAt(to.x, toFloor, to.z);
  const terrainCost = movementCostMultiplier(materials.get(materialId));

  const fromFloor = grid.surfaceY(from.x, from.z) ?? toFloor;
  const slope = Math.abs(toFloor - fromFloor);
  const slopeCost = 1 + slope * SLOPE_COST_WEIGHT;

  const waterCost = swimming ? SWIM_COST_MULTIPLIER : depth > 0 ? 1 + depth * WADE_COST_WEIGHT : 1;

  return terrainCost * slopeCost * waterCost;
}

interface FrontierEntry {
  x: number;
  z: number;
  cost: number;
  seq: number;
}

/** Binary min-heap over `FrontierEntry`, ordered by (cost, seq) -- the same shape as `SimulationClock`'s `ScheduleHeap` and `WaterField`'s `FrontierHeap`, reused here for the identical reason: O(log n) "next closest column" lookups as the search grows, with a deterministic tiebreak. */
class CostFrontier {
  private readonly items: FrontierEntry[] = [];

  get size(): number {
    return this.items.length;
  }

  private less(a: FrontierEntry, b: FrontierEntry): boolean {
    return a.cost !== b.cost ? a.cost < b.cost : a.seq < b.seq;
  }

  push(entry: FrontierEntry): void {
    this.items.push(entry);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      const parentEntry = this.items[parent]!;
      const current = this.items[i]!;
      if (!this.less(current, parentEntry)) break;
      this.items[i] = parentEntry;
      this.items[parent] = current;
      i = parent;
    }
  }

  pop(): FrontierEntry | undefined {
    const top = this.items[0];
    if (top === undefined) return undefined;
    const last = this.items.pop()!;
    if (this.items.length > 0) {
      this.items[0] = last;
      let i = 0;
      const n = this.items.length;
      for (;;) {
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        let smallest = i;
        if (l < n && this.less(this.items[l]!, this.items[smallest]!)) smallest = l;
        if (r < n && this.less(this.items[r]!, this.items[smallest]!)) smallest = r;
        if (smallest === i) break;
        const a = this.items[i]!;
        const b = this.items[smallest]!;
        this.items[i] = b;
        this.items[smallest] = a;
        i = smallest;
      }
    }
    return top;
  }
}

interface SearchResult {
  bestCost: Map<string, number>;
  cameFrom: Map<string, ColumnCoordinate>;
  columns: Map<string, ColumnCoordinate>;
}

/**
 * The shared Dijkstra relaxation loop behind both `findPath` (which stops
 * as soon as `goalKey` is popped, since Dijkstra guarantees that pop is
 * already the cheapest route to it) and `reachableColumns` (which passes
 * `goalKey: undefined` to explore everything reachable from `start`, for
 * debug/explain purposes). Factored out specifically so those two never
 * read edges through subtly different logic -- both cost every edge via
 * the exact same `edgeCost` call.
 *
 * Every edge cost is >= 0 (`movementCostMultiplier`/slope/water factors
 * are all positive multipliers), so Dijkstra's optimality holds; map
 * sizes at this project's scale (one watershed) don't warrant an A*
 * heuristic's added complexity.
 */
function runDijkstra(
  grid: WorldGrid,
  terrain: TerrainField,
  water: WaterField,
  materials: MaterialRegistry,
  start: ColumnCoordinate,
  profile: NavigationProfile,
  goalKey: string | undefined,
): SearchResult {
  const dims = grid.dims;
  const bestCost = new Map<string, number>();
  const cameFrom = new Map<string, ColumnCoordinate>();
  const columns = new Map<string, ColumnCoordinate>();
  const frontier = new CostFrontier();
  let seq = 0;

  const startKey = columnKey(start.x, start.z);
  bestCost.set(startKey, 0);
  columns.set(startKey, { x: start.x, z: start.z });
  frontier.push({ x: start.x, z: start.z, cost: 0, seq: seq++ });

  while (frontier.size > 0) {
    const current = frontier.pop()!;
    const currentKey = columnKey(current.x, current.z);
    if (current.cost > (bestCost.get(currentKey) ?? Infinity)) continue; // stale heap entry
    if (currentKey === goalKey) break; // cheapest possible route to the goal is now settled

    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = current.x + dx;
      const nz = current.z + dz;
      if (nx < 0 || nx >= dims.sizeX || nz < 0 || nz >= dims.sizeZ) continue;

      const step = edgeCost(grid, terrain, water, materials, current, { x: nx, z: nz }, profile);
      if (step === undefined) continue;

      const candidateCost = current.cost + step;
      const key = columnKey(nx, nz);
      if (candidateCost < (bestCost.get(key) ?? Infinity)) {
        bestCost.set(key, candidateCost);
        cameFrom.set(key, { x: current.x, z: current.z });
        columns.set(key, { x: nx, z: nz });
        frontier.push({ x: nx, z: nz, cost: candidateCost, seq: seq++ });
      }
    }
  }

  return { bestCost, cameFrom, columns };
}

function validateProfile(profile: NavigationProfile): void {
  if (!Number.isFinite(profile.maxWadingDepth) || profile.maxWadingDepth < 0) {
    throw new RangeError(`maxWadingDepth must be a non-negative finite number, got ${profile.maxWadingDepth}`);
  }
}

function requireColumnInBounds(grid: WorldGrid, label: string, c: ColumnCoordinate): void {
  const dims = grid.dims;
  if (c.x < 0 || c.x >= dims.sizeX || c.z < 0 || c.z >= dims.sizeZ) {
    throw new RangeError(`${label} column (${c.x}, ${c.z}) is out of bounds`);
  }
}

/**
 * Finds the lowest-cost route from `start` to `goal` for the given
 * agent `profile`, or `undefined` if none exists right now.
 *
 * A fresh search every call, deliberately: no path cache, no
 * invalidation bookkeeping. Since `edgeCost` reads live world state,
 * calling this again after water rises or terrain changes automatically
 * reflects the new reality -- "discover changed traversability from
 * world state," not "be told about it."
 *
 * `start` itself is never cost/passability-checked (an agent already
 * standing somewhere is given, not validated) -- only cells the search
 * moves INTO are.
 */
export function findPath(
  grid: WorldGrid,
  terrain: TerrainField,
  water: WaterField,
  materials: MaterialRegistry,
  start: ColumnCoordinate,
  goal: ColumnCoordinate,
  profile: NavigationProfile,
): PathResult | undefined {
  requireColumnInBounds(grid, "start", start);
  requireColumnInBounds(grid, "goal", goal);
  validateProfile(profile);

  if (start.x === goal.x && start.z === goal.z) {
    return { columns: [{ x: start.x, z: start.z }], cost: 0 };
  }

  const goalKey = columnKey(goal.x, goal.z);
  const { bestCost, cameFrom } = runDijkstra(grid, terrain, water, materials, start, profile, goalKey);
  const cost = bestCost.get(goalKey);
  if (cost === undefined) return undefined;

  const columns: ColumnCoordinate[] = [];
  let cursor: ColumnCoordinate | undefined = { x: goal.x, z: goal.z };
  while (cursor !== undefined) {
    columns.push(cursor);
    cursor = cameFrom.get(columnKey(cursor.x, cursor.z));
  }
  columns.reverse();
  return { columns, cost };
}

/**
 * Every column reachable from `start` for `profile`, with its cheapest
 * cost -- the full Dijkstra frontier with no goal and no early exit,
 * exposed purely for debug/explain purposes (AGENTS.md Law 4: causality
 * must be able to answer "what blocked it"). When `findPath` returns
 * `undefined`, a caller can check whether the goal appears here at all
 * (if not, the goal genuinely isn't connected to `start` for this
 * `profile`) and use `describeEdgeBlock` on the columns bordering what IS
 * reachable to see exactly which reason stopped the search there --
 * rather than only ever getting `findPath`'s bare `undefined`. Not wired
 * into any UI here; a presentation layer for this is P1-20's job.
 */
export function reachableColumns(
  grid: WorldGrid,
  terrain: TerrainField,
  water: WaterField,
  materials: MaterialRegistry,
  start: ColumnCoordinate,
  profile: NavigationProfile,
): Array<{ column: ColumnCoordinate; cost: number }> {
  requireColumnInBounds(grid, "start", start);
  validateProfile(profile);

  const { bestCost, columns } = runDijkstra(grid, terrain, water, materials, start, profile, undefined);
  return [...bestCost.entries()].map(([key, cost]) => ({ column: columns.get(key)!, cost }));
}
