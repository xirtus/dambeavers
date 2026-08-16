import type { World } from "../persistence/WorldSnapshot.js";
import { applyHeightfield, type StrataLayer } from "../world/TerrainField.js";
import type { PlantSpeciesRegistry } from "../ecology/PlantSpecies.js";
import { setPlant, isRootedInSoil } from "../ecology/Plant.js";
import type { EntityId } from "../core/EntityId.js";
import type { CellCoordinate } from "../world/WorldGrid.js";

const SOIL_MATERIAL_ID = "soil";
const ROCK_MATERIAL_ID = "stone";
const CHANNEL_HALF_WIDTH = 2;
const BANK_WIDTH = 3; // channel edge to bank edge: dist in (2, 5]
const FLOODPLAIN_WIDTH = 5; // bank edge to floodplain edge: dist in (5, 10]
const UPLAND_CAP_DISTANCE = 10; // beyond this, elevation plateaus (upland)
const RISE_PER_DISTANCE = 0.35; // valley-wall slope, elevation units per lateral cell
const MIN_SIZE_X = 20;
const MIN_SIZE_Z = 20;
const MIN_SIZE_Y = 10;

export type ColumnKind = "channel" | "bank" | "floodplain" | "upland";

export interface WatershedGeneratorOptions {
  /** Species to draw from when spawning trees -- caller-supplied (e.g. via `registerStandardPlantSpecies`), the same pattern `MaterialRegistry` uses elsewhere: this generator doesn't own species data. */
  species: PlantSpeciesRegistry;
  /** [0, 1] probability an eligible dry-ground column gets a tree. Defaults to 0.12 -- sparse enough that "one small map" doesn't become a solid thicket, dense enough that 100 seeds reliably produce harvestable trees. */
  treeDensity?: number;
}

/**
 * The generated map's descriptive layout data -- everything about the
 * generation that isn't already queryable from `world.grid`/`world.terrain`
 * directly (elevation, solidity, and material ARE real terrain state,
 * read via those; classification and the stream/pond markers are NOT
 * encoded anywhere in terrain, so this is where they live). Immutable
 * once generation finishes: this describes a one-shot generation result,
 * not a live system with its own persistence -- if a later system (e.g.
 * P1-02) needs to remember "this was the original channel," it should
 * capture whatever of this it needs into its own persistent state, the
 * same way nothing here is expected to survive a save/reload on its own.
 */
export interface WatershedLayout {
  dimensions: { sizeX: number; sizeY: number; sizeZ: number };
  /** Integer channel centerline x for every z in [0, sizeZ). The stream's path across the map -- by construction, defined and connected for every z. */
  channelCenterlineX: readonly number[];
  /** Classifies a column by its lateral distance from the channel centerline at that z. Pure function of the same parameters used to shape terrain -- never a separately-maintained/cacheable flag that could drift from the actual generated elevation. */
  classify(x: number, z: number): ColumnKind;
  /** Where the stream enters the map (z = 0, on the centerline) -- the roadmap's "stream source/input." */
  streamSource: CellCoordinate;
  /**
   * A representative channel column range flagged as a plausible future
   * dam/pond site -- a placement HEURISTIC only (the map's central third,
   * away from the source/exit edges). No hydrology is simulated here
   * (P1-02/P1-03's job); this is descriptive map data, not a hydraulic
   * computation, and should not be read as "this WILL be a pond."
   */
  prospectiveDamSite: { zStart: number; zEnd: number; x: number };
  /** Every tree entity spawned during generation, in creation order. */
  treeIds: EntityId[];
}

/**
 * Generates one small watershed map into `world`'s existing terrain grid
 * (dimensions come from `world.grid`, not from this function -- compose
 * with `SimulationRunner.createWorld` to pick map size). Produces, per the
 * roadmap: a stream source/input, a channel, banks, a floodplain,
 * elevation gradient, soil/rock strata, trees, dry ground, and a
 * prospective pond area marker.
 *
 * Deliberately does NOT simulate water, flow, or navigation -- those are
 * P1-02/P1-03/P1-04, not yet built. "Stream," "pond," and "traversable"
 * here describe TERRAIN GEOMETRY only (a channel-shaped depression, a
 * plausible impoundment site, a bounded per-step elevation change) --
 * nothing here creates a water entity or answers a real pathfinding query.
 *
 * Elevation is built from two independent, smooth components so the
 * roadmap's acceptance test (100 seeds all produce a connected downhill
 * stream and at least one traversable bank) holds by construction, not by
 * chance:
 *
 *  - `baseElevation(z)`: strictly a function of `z`, linearly decreasing
 *    from near the top of the grid (source) to near the bottom (exit),
 *    with a per-`z`-step slope always < 1 elevation unit -- so ANY column
 *    followed at a FIXED lateral distance from the centerline (the
 *    centerline itself, or a fixed bank offset) decreases monotonically
 *    with bounded per-step size, regardless of how the channel meanders.
 *    The slope-under-1 guarantee is derived from BOTH `sizeY` and `sizeZ`
 *    (see `topY`/`bottomY` below) specifically so it holds for any valid
 *    grid dimensions this function accepts, not only the one map size
 *    this file happens to be tested against -- a fixed elevation range
 *    chosen without regard to `sizeZ` would let a caller with a small
 *    `sizeZ` (still >= `MIN_SIZE_Z`) generate a near-vertical streambed.
 *  - `RISE_PER_DISTANCE * dist(x, z)`: the valley cross-section, a
 *    function of lateral distance from the (meandering) centerline only.
 *    Following a path that stays at a CONSTANT lateral distance from the
 *    centerline (as the two paths this function returns/tests do) cancels
 *    this term to a constant offset, which does not change the
 *    monotonicity or step-boundedness of `baseElevation(z)`.
 *
 * The meander itself (`centerlineX(z)`) only moves the centerline's `x`
 * position with `z` -- it never appears in `baseElevation`, so it cannot
 * introduce an uphill step along the centerline or a fixed-offset bank
 * path no matter how it's parameterized per seed.
 */
export function generateWatershed(world: World, options: WatershedGeneratorOptions): WatershedLayout {
  const dims = world.grid.dims;
  if (dims.sizeX < MIN_SIZE_X || dims.sizeZ < MIN_SIZE_Z || dims.sizeY < MIN_SIZE_Y) {
    throw new RangeError(
      `generateWatershed requires a grid at least ${MIN_SIZE_X}x${MIN_SIZE_Y}x${MIN_SIZE_Z} (sizeX x sizeY x sizeZ), got ${dims.sizeX}x${dims.sizeY}x${dims.sizeZ}`,
    );
  }
  const treeDensity = options.treeDensity ?? 0.12;
  if (!(treeDensity >= 0) || !(treeDensity <= 1)) {
    throw new RangeError(`treeDensity must be in [0, 1], got ${treeDensity}`);
  }

  const genRandom = world.random.stream("watershed-generation");
  const treeRandom = world.random.stream("watershed-trees");

  // -- meander parameters: only ever shift the centerline's x position, never elevation directly (see the class doc comment) --
  const meanderAmplitude = genRandom.nextFloat() * 3 + 3; // [3, 6)
  const meanderWavelength = genRandom.nextFloat() * 15 + 20; // [20, 35)
  const meanderPhase = genRandom.nextFloat() * Math.PI * 2;
  const centerBaseX = Math.floor(dims.sizeX / 2);

  const channelCenterlineX: number[] = [];
  for (let z = 0; z < dims.sizeZ; z++) {
    const raw = centerBaseX + meanderAmplitude * Math.sin((2 * Math.PI * z) / meanderWavelength + meanderPhase);
    channelCenterlineX.push(Math.round(raw));
  }

  // -- elevation: baseElevation(z) is strictly a function of z, slope < 1/step by construction --
  // `elevationRange` is capped by BOTH the vertical budget (sizeY, so the
  // upland cross-section rise never reaches applyHeightfield's own clamp)
  // AND `sizeZ - 2` (so slopePerZ = elevationRange / (sizeZ - 1) is always
  // strictly < 1, however small a valid sizeZ is) -- deriving it from only
  // one of the two would let the other dimension silently break the
  // slope-under-1 guarantee for some otherwise-valid map size.
  const bottomY = 2; // headroom below for bedrock beneath the channel bed
  const verticalHeadroom = dims.sizeY - 7; // upland's cross-section rise (<=3.5) must still clear the top with margin
  const elevationRange = Math.max(1, Math.min(verticalHeadroom, dims.sizeZ - 2));
  const topY = bottomY + elevationRange;
  const slopePerZ = elevationRange / (dims.sizeZ - 1);
  function baseElevation(z: number): number {
    return topY - z * slopePerZ;
  }

  function distanceFromCenterline(x: number, z: number): number {
    return Math.abs(x - channelCenterlineX[z]!);
  }

  function heightAt(x: number, z: number): number {
    const dist = Math.min(distanceFromCenterline(x, z), UPLAND_CAP_DISTANCE);
    return baseElevation(z) + RISE_PER_DISTANCE * dist;
  }

  function classify(x: number, z: number): ColumnKind {
    const dist = distanceFromCenterline(x, z);
    if (dist <= CHANNEL_HALF_WIDTH) return "channel";
    if (dist <= CHANNEL_HALF_WIDTH + BANK_WIDTH) return "bank";
    if (dist <= CHANNEL_HALF_WIDTH + BANK_WIDTH + FLOODPLAIN_WIDTH) return "floodplain";
    return "upland";
  }

  const strata: StrataLayer[] = [
    { materialId: SOIL_MATERIAL_ID, depth: 2 },
    { materialId: ROCK_MATERIAL_ID, depth: 1000 },
  ];
  applyHeightfield(world.terrain, heightAt, strata);

  // -- trees: on dry ground (non-channel columns), rooted on the always-soil surface --
  const treeIds: EntityId[] = [];
  const speciesIds = options.species.all().map((s) => s.id);
  if (speciesIds.length > 0) {
    for (let x = 0; x < dims.sizeX; x++) {
      for (let z = 0; z < dims.sizeZ; z++) {
        if (classify(x, z) === "channel") continue;
        if (!treeRandom.nextBool(treeDensity)) continue;
        const surfaceY = world.grid.surfaceY(x, z);
        if (surfaceY === undefined || surfaceY + 1 >= dims.sizeY) continue; // no room to stand a tree above the surface
        const position: CellCoordinate = { x, y: surfaceY + 1, z };
        if (!isRootedInSoil(world.grid, world.terrain, position, SOIL_MATERIAL_ID)) continue;

        const speciesId = treeRandom.pick(speciesIds);
        const tree = world.entities.create("tree");
        world.grid.setEntityPosition(tree, position.x, position.y, position.z);
        setPlant(world.components, tree, { speciesId, ageTicks: 0, health: 1 });
        treeIds.push(tree);
      }
    }
  }

  const damSiteZStart = Math.floor(dims.sizeZ / 3);
  const damSiteZEnd = Math.floor((2 * dims.sizeZ) / 3);
  const damSiteMidZ = Math.floor((damSiteZStart + damSiteZEnd) / 2);

  return {
    dimensions: { ...dims },
    // Defensive copy: `classify` closes over the internal `channelCenterlineX`
    // array, not this returned one -- a caller mutating the returned array
    // (TS `readonly` is compile-time-only, not real protection; see
    // WorldGrid.positionOf's and DebugInspector's identical precedent) must
    // never be able to retroactively change what `classify` answers.
    channelCenterlineX: [...channelCenterlineX],
    classify,
    streamSource: { x: channelCenterlineX[0]!, y: Math.round(heightAt(channelCenterlineX[0]!, 0)), z: 0 },
    prospectiveDamSite: { zStart: damSiteZStart, zEnd: damSiteZEnd, x: channelCenterlineX[damSiteMidZ]! },
    treeIds: [...treeIds],
  };
}
