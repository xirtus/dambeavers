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
import type { NavigationProfile } from "../../src/sim/navigation/Pathfinding.js";
import { spawnBeaver, getLocomotion, setLocomotion } from "../../src/sim/creatures/Beaver.js";
import { getDesignation, setDesignation } from "../../src/sim/jobs/Designation.js";
import { getJob, setJob } from "../../src/sim/jobs/Job.js";
import { setLog, getLog, getHeld, getReservation } from "../../src/sim/labor/Log.js";
import { designateHaul, generateHaulJob, getHaulProgress, isEligibleForHaul, setHaulProgress, tickHaulJob } from "../../src/sim/labor/Hauling.js";
import { getFood, setFood } from "../../src/sim/labor/Food.js";

const PROFILE: NavigationProfile = { canSwim: true, maxWadingDepth: 0.5 };

function buildFlatWorld(sizeX = 14, sizeY = 8, sizeZ = 14, floor = 2): { world: World; materials: MaterialRegistry; water: WaterField } {
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
  const random = new RandomStreams(1);
  const events = new EventLog(entities);
  const world: World = { clock, random, entities, components, grid, terrain, events, water, weather };
  return { world, materials, water };
}

function spawnAt(world: World, x: number, z: number, name = "Worker") {
  const floor = world.grid.surfaceY(x, z)!;
  return spawnBeaver(world, { name, position: { x, y: floor + 1, z } });
}

function spawnLog(world: World, x: number, z: number, massKg = 15) {
  const id = world.entities.create("log");
  const floor = world.grid.surfaceY(x, z)!;
  world.grid.setEntityPosition(id, x, floor + 1, z);
  setLog(world.components, id, { materialId: "wood", massKg });
  return id;
}

function spawnFood(world: World, x: number, z: number, massKg = 1) {
  const id = world.entities.create("food");
  const floor = world.grid.surfaceY(x, z)!;
  world.grid.setEntityPosition(id, x, floor + 1, z);
  setFood(world.components, id, { nutritionValue: 0.4, materialId: "plant-matter", massKg });
  return id;
}

function wallOffColumn(world: World, x: number, sizeZ: number): void {
  for (let z = 0; z < sizeZ; z++) {
    for (let y = 3; y < world.grid.dims.sizeY; y++) world.terrain.setMaterial(x, y, z, "stone");
  }
}

describe("designateHaul", () => {
  it("creates a 'haul-item' designation targeting the destination and the item", () => {
    const { world } = buildFlatWorld();
    const item = spawnLog(world, 4, 4);
    const id = designateHaul(world, item, { x: 9, z: 9 });
    expect(getDesignation(world.components, id)).toEqual({ kind: "haul-item", target: { x: 9, z: 9 }, status: "active", targetEntity: item });
  });

  it("P2-07: accepts a physical food item as an ordinary haulable item", () => {
    const { world } = buildFlatWorld();
    const item = spawnFood(world, 4, 4);
    const id = designateHaul(world, item, { x: 9, z: 9 });
    expect(getDesignation(world.components, id)).toMatchObject({ kind: "haul-item", targetEntity: item });
  });

  it("throws for a non-item entity", () => {
    const { world } = buildFlatWorld();
    const beaver = spawnAt(world, 0, 0);
    expect(() => designateHaul(world, beaver, { x: 1, z: 1 })).toThrow(RangeError);
  });

  it("throws for an item that is already held", () => {
    const { world, materials, water } = buildFlatWorld();
    const beaver = spawnAt(world, 4, 4);
    const item = spawnLog(world, 4, 4);
    const designationId = designateHaul(world, item, { x: 9, z: 9 });
    const jobId = generateHaulJob(world, designationId)[0]!;
    tickHaulJob(world.grid, world.terrain, water, materials, world.entities, world.components, beaver, PROFILE, [jobId]); // picks up immediately (already adjacent)
    expect(getHeld(world.components, item)).toBeDefined();
    expect(() => designateHaul(world, item, { x: 1, z: 1 })).toThrow(RangeError);
  });
});

describe("generateHaulJob", () => {
  it("creates one job in the 'to-item' phase, targeting the item's current column", () => {
    const { world } = buildFlatWorld();
    const item = spawnLog(world, 4, 4);
    const designationId = designateHaul(world, item, { x: 9, z: 9 });

    const [jobId] = generateHaulJob(world, designationId);

    expect(getJob(world.components, jobId!)).toEqual({ designationId, target: { x: 4, z: 4 }, status: "unclaimed" });
    expect(getHaulProgress(world.components, jobId!)).toEqual({ itemId: item, destination: { x: 9, z: 9 }, phase: "to-item" });
  });

  it("throws for a designation that isn't 'haul-item'", () => {
    const { world } = buildFlatWorld();
    const designationId = world.entities.create("designation");
    setDesignation(world.components, designationId, { kind: "go-to", target: { x: 1, z: 1 }, status: "active" });
    expect(() => generateHaulJob(world, designationId)).toThrow(RangeError);
  });
});

describe("tickHaulJob", () => {
  it("returns 'idle' when there are no candidate jobs", () => {
    const { world, materials, water } = buildFlatWorld();
    const beaver = spawnAt(world, 0, 0);
    const outcome = tickHaulJob(world.grid, world.terrain, water, materials, world.entities, world.components, beaver, PROFILE, []);
    expect(outcome).toBe("idle");
  });

  it("travels to the item before picking it up", () => {
    const { world, materials, water } = buildFlatWorld();
    const beaver = spawnAt(world, 0, 0);
    const item = spawnLog(world, 5, 0);
    const [jobId] = generateHaulJob(world, designateHaul(world, item, { x: 9, z: 0 }));

    const outcome = tickHaulJob(world.grid, world.terrain, water, materials, world.entities, world.components, beaver, PROFILE, [jobId!]);

    expect(outcome).toBe("assigned");
    expect(getHeld(world.components, item)).toBeUndefined(); // not picked up yet -- still traveling
    expect(getReservation(world.components, item)).toEqual({ by: beaver });
  });

  it("picks the item up on arrival, moving it into Inventory and starting the 'to-destination' leg", () => {
    const { world, materials, water } = buildFlatWorld();
    const beaver = spawnAt(world, 4, 4);
    const item = spawnLog(world, 4, 4); // already adjacent -- picks up same tick as assignment
    const [jobId] = generateHaulJob(world, designateHaul(world, item, { x: 9, z: 9 }));

    const outcome = tickHaulJob(world.grid, world.terrain, water, materials, world.entities, world.components, beaver, PROFILE, [jobId!]);

    expect(outcome).toBe("picked-up");
    expect(getHeld(world.components, item)).toEqual({ by: beaver });
    expect(world.grid.positionOf(item)).toBeUndefined();
    expect(getHaulProgress(world.components, jobId!)!.phase).toBe("to-destination");
  });

  it("a heavier item slows the beaver down more than a lighter one over the carry leg", () => {
    // A high base speed so the difference is actually visible within one
    // tick -- `advanceTowards`'s own "always advance at least one column"
    // guarantee means a low base speed masks any multiplier difference
    // entirely (both would advance exactly one column regardless).
    const { world: worldLight, materials, water } = buildFlatWorld();
    const beaverLight = spawnAt(worldLight, 4, 4);
    setLocomotion(worldLight.components, beaverLight, { speed: 10 });
    const lightItem = spawnLog(worldLight, 4, 4, 2);
    const [jobLight] = generateHaulJob(worldLight, designateHaul(worldLight, lightItem, { x: 12, z: 4 }));
    tickHaulJob(worldLight.grid, worldLight.terrain, water, materials, worldLight.entities, worldLight.components, beaverLight, PROFILE, [jobLight!]); // pick up
    tickHaulJob(worldLight.grid, worldLight.terrain, water, materials, worldLight.entities, worldLight.components, beaverLight, PROFILE, [jobLight!]); // carry 1 tick
    const lightProgressX = worldLight.grid.positionOf(beaverLight)!.x;

    const { world: worldHeavy } = buildFlatWorld();
    const beaverHeavy = spawnAt(worldHeavy, 4, 4);
    setLocomotion(worldHeavy.components, beaverHeavy, { speed: 10 });
    const heavyItem = spawnLog(worldHeavy, 4, 4, 200);
    const [jobHeavy] = generateHaulJob(worldHeavy, designateHaul(worldHeavy, heavyItem, { x: 12, z: 4 }));
    tickHaulJob(worldHeavy.grid, worldHeavy.terrain, water, materials, worldHeavy.entities, worldHeavy.components, beaverHeavy, PROFILE, [jobHeavy!]);
    tickHaulJob(worldHeavy.grid, worldHeavy.terrain, water, materials, worldHeavy.entities, worldHeavy.components, beaverHeavy, PROFILE, [jobHeavy!]);
    const heavyProgressX = worldHeavy.grid.positionOf(beaverHeavy)!.x;

    expect(heavyProgressX - 4).toBeLessThan(lightProgressX - 4); // heavier load makes less progress in the same tick
  });

  it("restores the beaver's true base Locomotion.speed after a carry tick -- never leaves it permanently reduced", () => {
    const { world, materials, water } = buildFlatWorld();
    const beaver = spawnAt(world, 4, 4);
    const baseSpeed = getLocomotion(world.components, beaver)!.speed;
    const item = spawnLog(world, 4, 4, 50);
    const [jobId] = generateHaulJob(world, designateHaul(world, item, { x: 9, z: 4 }));
    tickHaulJob(world.grid, world.terrain, water, materials, world.entities, world.components, beaver, PROFILE, [jobId!]); // pick up
    tickHaulJob(world.grid, world.terrain, water, materials, world.entities, world.components, beaver, PROFILE, [jobId!]); // carry

    expect(getLocomotion(world.components, beaver)!.speed).toBe(baseSpeed);
  });

  it("delivers the item at the destination, clears its Reservation, and completes the job AND designation", () => {
    const { world, materials, water } = buildFlatWorld();
    const beaver = spawnAt(world, 4, 4);
    const item = spawnLog(world, 4, 4);
    const designationId = designateHaul(world, item, { x: 6, z: 4 });
    const [jobId] = generateHaulJob(world, designationId);

    let outcome: string;
    let iterations = 0;
    do {
      outcome = tickHaulJob(world.grid, world.terrain, water, materials, world.entities, world.components, beaver, PROFILE, [jobId!]);
      iterations++;
      expect(iterations).toBeLessThan(100);
    } while (outcome !== "delivered" && outcome !== "failed" && outcome !== "requeued");

    expect(outcome).toBe("delivered");
    expect(getHeld(world.components, item)).toBeUndefined();
    expect(getReservation(world.components, item)).toBeUndefined();
    expect(world.grid.positionOf(item)).toEqual({ x: 6, y: world.grid.surfaceY(6, 4)! + 1, z: 4 });
    expect(getLog(world.components, item)).toBeDefined(); // still a real physical item, just relocated
    expect(getJob(world.components, jobId!)!.status).toBe("completed");
    expect(getDesignation(world.components, designationId)!.status).toBe("completed");
  });

  it("P2-07: delivers a food item without converting it into a log or losing food data", () => {
    const { world, materials, water } = buildFlatWorld();
    const beaver = spawnAt(world, 4, 4);
    const item = spawnFood(world, 4, 4, 2);
    const designationId = designateHaul(world, item, { x: 6, z: 4 });
    const [jobId] = generateHaulJob(world, designationId);

    let outcome: string;
    let iterations = 0;
    do {
      outcome = tickHaulJob(world.grid, world.terrain, water, materials, world.entities, world.components, beaver, PROFILE, [jobId!]);
      iterations++;
      expect(iterations).toBeLessThan(100);
    } while (outcome !== "delivered" && outcome !== "failed" && outcome !== "requeued");

    expect(outcome).toBe("delivered");
    expect(world.grid.positionOf(item)).toEqual({ x: 6, y: world.grid.surfaceY(6, 4)! + 1, z: 4 });
    expect(getFood(world.components, item)).toEqual({ nutritionValue: 0.4, materialId: "plant-matter", massKg: 2 });
    expect(getLog(world.components, item)).toBeUndefined();
    expect(getDesignation(world.components, designationId)!.status).toBe("completed");
  });

  it("requeues (item stays where it was) if the item becomes unreachable AFTER reservation, mid-journey to pick it up", () => {
    // selectJob's own reachability check (P1-07's fixed livelock bug)
    // means an ALREADY-unreachable item is never selected in the first
    // place -- so this exercises the surviving code path: reserved while
    // reachable, then the route closes before arrival.
    const { world, materials, water } = buildFlatWorld(8, 8, 3, 2);
    const beaver = spawnAt(world, 0, 0);
    const item = spawnLog(world, 6, 0);
    const [jobId] = generateHaulJob(world, designateHaul(world, item, { x: 9, z: 0 }));

    const first = tickHaulJob(world.grid, world.terrain, water, materials, world.entities, world.components, beaver, PROFILE, [jobId!]);
    expect(first).toBe("assigned");

    wallOffColumn(world, 3, 3);

    const outcome = tickHaulJob(world.grid, world.terrain, water, materials, world.entities, world.components, beaver, PROFILE, [jobId!]);

    expect(outcome).toBe("requeued");
    expect(getJob(world.components, jobId!)!.status).toBe("unclaimed");
    expect(getReservation(world.components, item)).toBeUndefined();
    expect(world.grid.positionOf(item)).toEqual({ x: 6, y: world.grid.surfaceY(6, 0)! + 1, z: 0 }); // untouched
  });

  it("drops the item where the beaver stands (never vanishes) and fails the job if the destination becomes unreachable mid-carry", () => {
    const { world, materials, water } = buildFlatWorld(8, 8, 3, 2);
    const beaver = spawnAt(world, 1, 0);
    const item = spawnLog(world, 1, 0);
    const [jobId] = generateHaulJob(world, designateHaul(world, item, { x: 6, z: 0 }));
    tickHaulJob(world.grid, world.terrain, water, materials, world.entities, world.components, beaver, PROFILE, [jobId!]); // pick up

    wallOffColumn(world, 3, 3);

    const outcome = tickHaulJob(world.grid, world.terrain, water, materials, world.entities, world.components, beaver, PROFILE, [jobId!]);

    expect(outcome).toBe("failed");
    expect(getJob(world.components, jobId!)!.status).toBe("failed");
    expect(getHeld(world.components, item)).toBeUndefined(); // dropped, not phantom-held
    expect(getReservation(world.components, item)).toBeUndefined();
    const beaverPosition = world.grid.positionOf(beaver)!;
    expect(world.grid.positionOf(item)).toEqual(beaverPosition); // right where the beaver gave up
  });

  it("fails outright if the item is destroyed out from under an in-progress 'to-item' pursuit", () => {
    const { world, materials, water } = buildFlatWorld();
    const beaver = spawnAt(world, 0, 0);
    const item = spawnLog(world, 6, 0);
    const [jobId] = generateHaulJob(world, designateHaul(world, item, { x: 9, z: 0 }));
    tickHaulJob(world.grid, world.terrain, water, materials, world.entities, world.components, beaver, PROFILE, [jobId!]); // travel

    world.entities.destroy(item); // defensive scenario

    const outcome = tickHaulJob(world.grid, world.terrain, water, materials, world.entities, world.components, beaver, PROFILE, [jobId!]);
    expect(outcome).toBe("failed");
    expect(getJob(world.components, jobId!)!.status).toBe("failed");
  });

  it("REGRESSION: deleting the assigned hauler mid-carry does not delete the designation; a second beaver reclaiming the stale job fails HONESTLY rather than silently 'delivering' an item it never actually picked up", () => {
    // A known, documented limitation (see tickHaulJob's own doc comment
    // on the "to-destination" phase's defensive check): WorldGrid/
    // ComponentStore clear a destroyed beaver's position/components via
    // onDestroy subscriptions registered at world-construction time, long
    // before any labor-type module could hook in -- so by the time this
    // scenario is observable, the item's real-world location (cleared at
    // pickup) is unrecoverable. Real recovery (e.g. dropping a dead
    // beaver's held items at its last position) needs a real death system
    // (P1-16) to decide what happens to a corpse's inventory; this test
    // exists to prove the FAILURE MODE is honest (a clearly-failed job,
    // the item never silently teleported to a "delivered" destination it
    // never reached) rather than a silent correctness bug.
    const { world, materials, water } = buildFlatWorld();
    const first = spawnAt(world, 4, 4, "First");
    const second = spawnAt(world, 4, 2, "Second");
    const item = spawnLog(world, 4, 4);
    const designationId = designateHaul(world, item, { x: 8, z: 4 });
    const [jobId] = generateHaulJob(world, designationId);

    tickHaulJob(world.grid, world.terrain, water, materials, world.entities, world.components, first, PROFILE, [jobId!]); // pick up
    expect(getHeld(world.components, item)).toEqual({ by: first });

    world.entities.destroy(first);

    expect(world.entities.isLive(designationId)).toBe(true);
    expect(getDesignation(world.components, designationId)!.status).toBe("active");

    const outcome = tickHaulJob(world.grid, world.terrain, water, materials, world.entities, world.components, second, PROFILE, [jobId!]);

    expect(outcome).toBe("failed"); // NOT "delivered" -- second never actually held the item
    expect(getJob(world.components, jobId!)!.status).toBe("failed");
    // The designation itself still survives -- a fresh haul could be
    // re-designated once a future system locates the item again.
    expect(getDesignation(world.components, designationId)!.status).toBe("active");
  });

  it("REGRESSION: two independent designations on the SAME item never crash or clobber each other's reservation -- the second beaver waits (idle) instead", () => {
    // Reproduces a real Critical bug found by this task's own critic
    // review: designateHaul only checked Held, and job selection only
    // checked JOB status, never the underlying ITEM's own state -- so two
    // separate designations for one item could both be reserved by
    // different beavers, and whichever arrived second crashed on an
    // unguarded `grid.positionOf(itemId)!` once the first had already
    // picked the item up (clearing its position), silently overwriting
    // the item's Reservation on the way there.
    const { world, materials, water } = buildFlatWorld();
    const first = spawnAt(world, 4, 4, "First");
    const second = spawnAt(world, 4, 6, "Second");
    const item = spawnLog(world, 4, 4); // adjacent to `first` -- picks up on its very first tick

    const jobOne = generateHaulJob(world, designateHaul(world, item, { x: 9, z: 4 }))[0]!;

    const outcomeFirst = tickHaulJob(world.grid, world.terrain, water, materials, world.entities, world.components, first, PROFILE, [jobOne]);
    expect(outcomeFirst).toBe("picked-up");
    expect(getHeld(world.components, item)).toEqual({ by: first });
    expect(getReservation(world.components, item)).toEqual({ by: first });

    // A second designation/job for the SAME item, now already held by `first`.
    // (designateHaul itself would reject this given the item's live
    // Reservation -- construct job two directly to prove the EXECUTION
    // layer is independently safe too, not just relying on the earlier
    // designateHaul guard.)
    const secondDesignationId = world.entities.create("designation");
    setDesignation(world.components, secondDesignationId, { kind: "haul-item", target: { x: 1, z: 1 }, status: "active", targetEntity: item });
    const jobTwo = world.entities.create("job");
    setJob(world.components, jobTwo, { designationId: secondDesignationId, target: { x: 4, z: 4 }, status: "unclaimed" });
    setHaulProgress(world.components, jobTwo, { itemId: item, destination: { x: 1, z: 1 }, phase: "to-item" });

    expect(() =>
      tickHaulJob(world.grid, world.terrain, water, materials, world.entities, world.components, second, PROFILE, [jobTwo]),
    ).not.toThrow();

    const outcomeSecond = tickHaulJob(world.grid, world.terrain, water, materials, world.entities, world.components, second, PROFILE, [jobTwo]);
    expect(outcomeSecond).toBe("idle"); // correctly excluded, not crashed
    expect(getJob(world.components, jobTwo)!.status).toBe("unclaimed"); // untouched
    expect(getReservation(world.components, item)).toEqual({ by: first }); // NOT clobbered by second
  });

  it("excludes a job whose target item is no longer live at all -- a real gap found by the Phase 2 gate soak test", () => {
    // P2-08's FoodSpoilage can destroy a Food item entirely, out from
    // under a haul job generated for it before it ever gets claimed --
    // a real interaction no prior test exercised. Before the fix,
    // isEligibleForHaul only checked held/reservation state (never
    // liveness itself), so a fresh assignment for a destroyed item's
    // job crashed with an uncaught ComponentStore error the instant
    // tickHaulJob tried to write a Reservation onto a dead entity,
    // instead of failing to select it in the first place.
    const { world, materials, water } = buildFlatWorld();
    const worker = spawnAt(world, 3, 3);
    const item = spawnFood(world, 5, 5);
    const jobId = generateHaulJob(world, designateHaul(world, item, { x: 9, z: 4 }))[0]!;

    world.entities.destroy(item); // simulates spoilage destroying it first

    expect(isEligibleForHaul(world.entities, world.components, worker, jobId)).toBe(false);
    expect(() => tickHaulJob(world.grid, world.terrain, water, materials, world.entities, world.components, worker, PROFILE, [jobId])).not.toThrow();
    expect(tickHaulJob(world.grid, world.terrain, water, materials, world.entities, world.components, worker, PROFILE, [jobId])).toBe("idle");
    expect(getJob(world.components, jobId)!.status).toBe("unclaimed"); // never touched, not crashed mid-write
  });
});
