import { describe, expect, it } from "vitest";
import { EntityIdRegistry } from "../../src/sim/core/EntityId.js";
import { ComponentStore } from "../../src/sim/core/ComponentStore.js";
import { WorldGrid } from "../../src/sim/world/WorldGrid.js";
import { TerrainField } from "../../src/sim/world/TerrainField.js";
import { MaterialRegistry } from "../../src/sim/materials/Material.js";
import { registerStandardMaterials } from "../../src/sim/materials/standardMaterials.js";
import { WaterField } from "../../src/sim/hydrology/WaterField.js";
import type { NavigationProfile } from "../../src/sim/navigation/Pathfinding.js";
import { setLocomotion, setSwimmer, setIdentity } from "../../src/sim/creatures/Beaver.js";
import { setNeeds, getNeeds, BASELINE_NEEDS, NEED_URGENT_THRESHOLD, HUNGER_DECAY_PER_TICK, THIRST_DECAY_PER_TICK } from "../../src/sim/creatures/Needs.js";
import { decideIntent, tickBeaverNeeds, setNeedFocus, getNeedFocus, EAT_TREE_HEALTH_COST, applyThermalTick } from "../../src/sim/creatures/BeaverNeeds.js";
import { setPlant, getPlant } from "../../src/sim/ecology/Plant.js";
import { setFood, getFood } from "../../src/sim/labor/Food.js";
import { setHeld, setReservation } from "../../src/sim/labor/Log.js";
import { setConstruction } from "../../src/sim/labor/Construction.js";

function buildFlatWorld(sizeX = 10, sizeY = 8, sizeZ = 10, floor = 2) {
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
  return { entities, components, grid, terrain, materials, water };
}

const PROFILE: NavigationProfile = { canSwim: true, maxWadingDepth: 0.5 };

function spawnTestCreature(world: ReturnType<typeof buildFlatWorld>, at: { x: number; z: number }, needs = BASELINE_NEEDS) {
  const id = world.entities.create("beaver");
  const floor = world.grid.surfaceY(at.x, at.z)!;
  world.grid.setEntityPosition(id, at.x, floor + 1, at.z);
  setIdentity(world.components, id, { name: "Test Beaver" });
  setLocomotion(world.components, id, { speed: 5 });
  setSwimmer(world.components, id, PROFILE);
  setNeeds(world.components, id, { ...needs });
  setNeedFocus(world.components, id, { current: "none" });
  return id;
}

function spawnTree(world: ReturnType<typeof buildFlatWorld>, at: { x: number; z: number }) {
  const id = world.entities.create("tree");
  const floor = world.grid.surfaceY(at.x, at.z)!;
  world.grid.setEntityPosition(id, at.x, floor + 1, at.z);
  setPlant(world.components, id, { speciesId: "aspen", ageTicks: 8_000, health: 1 });
  return id;
}

const URGENT = NEED_URGENT_THRESHOLD + 0.1;

function decide(world: ReturnType<typeof buildFlatWorld>, needs: typeof BASELINE_NEEDS, focus: "hunger" | "thirst" | "none", at: { x: number; z: number }) {
  return decideIntent(needs, focus, world.entities, world.components, world.grid, world.terrain, world.water, world.materials, PROFILE, at);
}

describe("decideIntent", () => {
  it("returns 'idle' when every need is below the urgency threshold", () => {
    const world = buildFlatWorld();
    const { intent, nextFocus } = decide(world, BASELINE_NEEDS, "none", { x: 5, z: 5 });
    expect(intent).toEqual({ kind: "idle" });
    expect(nextFocus).toBe("none");
  });

  it("returns 'seek-food' targeting the nearest live tree when hunger is the most urgent need", () => {
    const world = buildFlatWorld();
    const near = spawnTree(world, { x: 6, z: 5 });
    spawnTree(world, { x: 9, z: 9 }); // farther away -- must not be chosen
    const needs = { hunger: URGENT, thirst: 0, fatigue: 0, thermalComfort: 1 };

    const { intent, nextFocus } = decide(world, needs, "none", { x: 5, z: 5 });

    expect(intent).toEqual({ kind: "seek-food", target: near });
    expect(nextFocus).toBe("hunger");
  });

  it("returns 'seek-water' targeting the nearest wet column when thirst is the most urgent need", () => {
    const world = buildFlatWorld();
    world.water.setDepth(6, 5, 0.3);
    world.water.setDepth(9, 9, 0.3); // farther away -- must not be chosen
    const needs = { hunger: 0, thirst: URGENT, fatigue: 0, thermalComfort: 1 };

    const { intent, nextFocus } = decide(world, needs, "none", { x: 5, z: 5 });

    expect(intent).toEqual({ kind: "seek-water", target: { x: 6, z: 5 } });
    expect(nextFocus).toBe("thirst");
  });

  it("returns 'rest' when fatigue is the most urgent need, leaving any existing focus untouched for resumption", () => {
    const world = buildFlatWorld();
    const needs = { hunger: 0, thirst: 0, fatigue: URGENT, thermalComfort: 1 };
    const { intent, nextFocus } = decide(world, needs, "hunger", { x: 5, z: 5 });
    expect(intent).toEqual({ kind: "rest" });
    expect(nextFocus).toBe("hunger"); // unchanged, so hunger resumes once fatigue passes
  });

  it("fatigue wins outright over hunger/thirst even when its raw value is lower -- exhaustion always takes priority", () => {
    const world = buildFlatWorld();
    spawnTree(world, { x: 6, z: 5 });
    world.water.setDepth(7, 5, 0.3);
    const needs = { hunger: 0.75, thirst: 0.95, fatigue: URGENT, thermalComfort: 1 }; // fatigue is numerically the LOWEST of the three
    const { intent } = decide(world, needs, "none", { x: 5, z: 5 });
    expect(intent).toEqual({ kind: "rest" });
  });

  it("with no existing focus, the higher raw value wins when neither has been reached yet", () => {
    const world = buildFlatWorld();
    spawnTree(world, { x: 6, z: 5 });
    world.water.setDepth(7, 5, 0.3);
    const needs = { hunger: 0.75, thirst: 0.95, fatigue: 0, thermalComfort: 1 };
    const { intent } = decide(world, needs, "none", { x: 5, z: 5 });
    expect(intent.kind).toBe("seek-water");
  });

  it("with no existing focus, prefers a not-yet-reached urgent need over one already reached, even though the already-reached one has the higher raw value", () => {
    const world = buildFlatWorld();
    spawnTree(world, { x: 8, z: 8 }); // far away -- not yet reached
    world.water.setDepth(5, 5, 0.3); // the beaver is standing exactly here -- already reached
    const needs = { hunger: 0.75, thirst: 0.95, fatigue: 0, thermalComfort: 1 }; // thirst has the higher value...
    const { intent, nextFocus } = decide(world, needs, "none", { x: 5, z: 5 });
    expect(intent.kind).toBe("seek-food"); // ...but hunger wins, because thirst's target is already reached
    expect(nextFocus).toBe("hunger");
  });

  it("falls back to 'idle' when hunger is urgent but no tree exists anywhere", () => {
    const world = buildFlatWorld();
    const needs = { hunger: URGENT, thirst: 0, fatigue: 0, thermalComfort: 1 };
    const { intent } = decide(world, needs, "none", { x: 5, z: 5 });
    expect(intent).toEqual({ kind: "idle" });
  });

  it("falls back to 'idle' when thirst is urgent but the whole map is dry", () => {
    const world = buildFlatWorld();
    const needs = { hunger: 0, thirst: URGENT, fatigue: 0, thermalComfort: 1 };
    const { intent } = decide(world, needs, "none", { x: 5, z: 5 });
    expect(intent).toEqual({ kind: "idle" });
  });

  it("thermalComfort never drives an intent, however low it is", () => {
    const world = buildFlatWorld();
    const needs = { hunger: 0, thirst: 0, fatigue: 0, thermalComfort: 0 };
    const { intent } = decide(world, needs, "none", { x: 5, z: 5 });
    expect(intent).toEqual({ kind: "idle" });
  });

  it("is a deterministic pure function of its inputs", () => {
    const world = buildFlatWorld();
    spawnTree(world, { x: 6, z: 5 });
    const needs = { hunger: URGENT, thirst: 0, fatigue: 0, thermalComfort: 1 };
    const a = decide(world, needs, "none", { x: 5, z: 5 });
    const b = decide(world, needs, "none", { x: 5, z: 5 });
    expect(b).toEqual(a);
  });

  describe("sticky focus (anti-oscillation)", () => {
    it("keeps pursuing the SAME focus even though the other urgent need's target is closer -- no per-tick re-derivation", () => {
      const world = buildFlatWorld();
      spawnTree(world, { x: 5, z: 6 }); // adjacent -- closer than the water
      world.water.setDepth(9, 9, 0.3); // far away, but already committed to
      const needs = { hunger: URGENT, thirst: URGENT, fatigue: 0, thermalComfort: 1 };

      const { intent } = decide(world, needs, "thirst", { x: 5, z: 5 });

      expect(intent.kind).toBe("seek-water"); // stayed on thirst, didn't defect to the closer tree
    });

    it("re-derives once the sticky focus's need is no longer urgent", () => {
      const world = buildFlatWorld();
      spawnTree(world, { x: 6, z: 5 });
      const needs = { hunger: URGENT, thirst: 0.2, fatigue: 0, thermalComfort: 1 }; // thirst no longer urgent
      const { intent, nextFocus } = decide(world, needs, "thirst", { x: 5, z: 5 });
      expect(intent.kind).toBe("seek-food");
      expect(nextFocus).toBe("hunger");
    });

    it("REGRESSION: an unreachable focus target is excluded, not merely deprioritized -- the beaver pursues the OTHER need instead of retrying forever", () => {
      // Wall off a tree behind solid terrain so it's a real target that exists but can never be reached.
      const world = buildFlatWorld(10, 8, 10, 2);
      for (let z = 0; z < 10; z++) {
        for (let y = 3; y < 8; y++) world.terrain.setMaterial(3, y, z, "stone"); // an unbroken wall
      }
      spawnTree(world, { x: 8, z: 5 }); // on the far, unreachable side of the wall
      world.water.setDepth(2, 5, 0.3); // reachable, near side
      const needs = { hunger: URGENT, thirst: URGENT, fatigue: 0, thermalComfort: 1 };

      const { intent, nextFocus } = decide(world, needs, "none", { x: 1, z: 5 });

      expect(intent.kind).toBe("seek-water");
      expect(nextFocus).toBe("thirst");
    });

    it("REGRESSION: a sticky focus that becomes unreachable mid-pursuit is dropped in favor of the other urgent need, not retried forever", () => {
      const world = buildFlatWorld(10, 8, 10, 2);
      for (let z = 0; z < 10; z++) {
        for (let y = 3; y < 8; y++) world.terrain.setMaterial(3, y, z, "stone");
      }
      spawnTree(world, { x: 8, z: 5 }); // unreachable
      world.water.setDepth(2, 5, 0.3); // reachable

      const needs = { hunger: URGENT, thirst: URGENT, fatigue: 0, thermalComfort: 1 };
      // Sticky focus is "hunger" (as if committed before the wall existed / before this was discovered) -- decideIntent must not trust it blindly.
      const { intent, nextFocus } = decide(world, needs, "hunger", { x: 1, z: 5 });

      expect(intent.kind).toBe("seek-water");
      expect(nextFocus).toBe("thirst");
    });
  });
});

describe("tickBeaverNeeds", () => {
  it("throws for an entity with no Needs component", () => {
    const world = buildFlatWorld();
    const id = world.entities.create("beaver");
    world.grid.setEntityPosition(id, 0, world.grid.surfaceY(0, 0)! + 1, 0);
    setLocomotion(world.components, id, { speed: 1 });
    setSwimmer(world.components, id, PROFILE);
    setNeedFocus(world.components, id, { current: "none" });
    expect(() =>
      tickBeaverNeeds(world.grid, world.terrain, world.water, world.materials, world.entities, world.components, id, PROFILE),
    ).toThrow(RangeError);
  });

  it("throws for an entity with no NeedFocus component", () => {
    const world = buildFlatWorld();
    const id = world.entities.create("beaver");
    world.grid.setEntityPosition(id, 0, world.grid.surfaceY(0, 0)! + 1, 0);
    setLocomotion(world.components, id, { speed: 1 });
    setSwimmer(world.components, id, PROFILE);
    setNeeds(world.components, id, { ...BASELINE_NEEDS });
    expect(() =>
      tickBeaverNeeds(world.grid, world.terrain, world.water, world.materials, world.entities, world.components, id, PROFILE),
    ).toThrow(RangeError);
  });

  it("when idle (no urgent need), applies plain time-based decay and does not move", () => {
    const world = buildFlatWorld();
    const id = spawnTestCreature(world, { x: 5, z: 5 });
    const before = world.grid.positionOf(id);

    const result = tickBeaverNeeds(
      world.grid,
      world.terrain,
      world.water,
      world.materials,
      world.entities,
      world.components,
      id,
      PROFILE,
    );

    expect(result.intent).toEqual({ kind: "idle" });
    expect(result.movement).toBeUndefined();
    expect(world.grid.positionOf(id)).toEqual(before);
    expect(result.needs.hunger).toBeGreaterThan(0); // time-based decay still applied
    expect(getNeeds(world.components, id)).toEqual(result.needs); // persisted
    expect(getNeedFocus(world.components, id)).toEqual({ current: "none" });
  });

  it("when hunger is urgent, actually moves the beaver toward the nearest tree and fatigue accumulates from that travel, committing focus to hunger", () => {
    const world = buildFlatWorld();
    const tree = spawnTree(world, { x: 8, z: 5 });
    const id = spawnTestCreature(world, { x: 5, z: 5 }, { hunger: URGENT, thirst: 0, fatigue: 0, thermalComfort: 1 });
    const before = world.grid.positionOf(id)!;

    const result = tickBeaverNeeds(
      world.grid,
      world.terrain,
      world.water,
      world.materials,
      world.entities,
      world.components,
      id,
      PROFILE,
    );

    expect(result.intent).toEqual({ kind: "seek-food", target: tree });
    expect(result.movement).toBeDefined();
    expect(result.movement!.outcome === "moved" || result.movement!.outcome === "arrived").toBe(true);
    expect(world.grid.positionOf(id)).not.toEqual(before); // genuinely moved
    expect(result.needs.fatigue).toBeGreaterThan(0); // travel cost real fatigue
    expect(getNeedFocus(world.components, id)!.current).toBe(result.movement!.outcome === "arrived" ? "none" : "hunger");
  });

  it("when fatigue is urgent, rests in place and fatigue recovers", () => {
    const world = buildFlatWorld();
    const id = spawnTestCreature(world, { x: 5, z: 5 }, { hunger: 0, thirst: 0, fatigue: URGENT, thermalComfort: 1 });
    const before = world.grid.positionOf(id);

    const result = tickBeaverNeeds(
      world.grid,
      world.terrain,
      world.water,
      world.materials,
      world.entities,
      world.components,
      id,
      PROFILE,
    );

    expect(result.intent).toEqual({ kind: "rest" });
    expect(result.movement).toBeUndefined();
    expect(world.grid.positionOf(id)).toEqual(before);
    expect(result.needs.fatigue).toBeLessThan(URGENT); // recovered rather than worsened
  });

  it("excludes a destroyed tree from consideration -- only live trees are valid targets", () => {
    const world = buildFlatWorld();
    const dead = spawnTree(world, { x: 6, z: 5 });
    const alive = spawnTree(world, { x: 8, z: 8 });
    world.entities.destroy(dead);
    const needs = { hunger: URGENT, thirst: 0, fatigue: 0, thermalComfort: 1 };

    const { intent } = decide(world, needs, "none", { x: 5, z: 5 });

    expect(intent).toEqual({ kind: "seek-food", target: alive });
  });

  it("REGRESSION: does not oscillate tick-by-tick between two nearby, simultaneously-urgent resources -- commits to one, arrives, THEN switches", () => {
    // A slow-enough creature over a long-enough distance that reaching
    // EITHER target genuinely takes several ticks (real, multi-tick
    // travel) -- the case that actually distinguishes "committed to one
    // pursuit across many ticks" from "so fast every target is reached in
    // a single tick regardless," which wouldn't exercise stickiness at
    // all.
    const world = buildFlatWorld(25, 8, 25);
    const tree = spawnTree(world, { x: 20, z: 5 });
    world.water.setDepth(22, 5, 0.3); // two columns beyond the tree
    const id = spawnTestCreature(world, { x: 2, z: 5 }, { hunger: URGENT, thirst: URGENT + 0.1, fatigue: 0, thermalComfort: 1 });
    setLocomotion(world.components, id, { speed: 1.5 }); // exactly one dry-flat edge (cost 1.5) per tick

    const columnsVisited: string[] = [];
    // (intent kind, whether that tick's travel was still genuinely en
    // route i.e. outcome "moved") for each tick -- what actually
    // distinguishes "committed" from "oscillating" is NOT whether the
    // beaver ever alternates at all (once both resources are reached,
    // repeatedly re-visiting whichever is more urgent is the honest,
    // correct behavior with no consumption system to ever resolve either
    // one -- confirmed by tracing a disposable probe script's full
    // tick-by-tick output during this test's own development). What must
    // NEVER happen is switching intent kind on the tick immediately after
    // a "moved" (still-traveling, not yet arrived/concluded) outcome --
    // THAT is the actual tick-by-tick ping-pong bug this task's own
    // development found and fixed.
    const steps: Array<{ kind: string; stillEnRoute: boolean }> = [];
    for (let tick = 0; tick < 60; tick++) {
      const result = tickBeaverNeeds(
        world.grid,
        world.terrain,
        world.water,
        world.materials,
        world.entities,
        world.components,
        id,
        PROFILE,
      );
      const pos = world.grid.positionOf(id)!;
      columnsVisited.push(`${pos.x},${pos.z}`);
      steps.push({ kind: result.intent.kind, stillEnRoute: result.movement?.outcome === "moved" });
    }

    // Both the tree's column and the water's column must actually have
    // been reached at some point (real progress, not endless shuttling
    // one step short of both).
    expect(columnsVisited).toContain(`${20},5`);
    expect(columnsVisited).toContain(`${22},5`);

    // Fatigue is allowed to interrupt an en-route pursuit with "rest" at
    // any time (that's the designed, correct override -- exhaustion beats
    // errands) -- so only check for illegitimate switches BETWEEN the two
    // pursuit kinds themselves.
    for (let i = 1; i < steps.length; i++) {
      const previous = steps[i - 1]!;
      const current = steps[i]!;
      const bothPursuits =
        (previous.kind === "seek-food" || previous.kind === "seek-water") &&
        (current.kind === "seek-food" || current.kind === "seek-water");
      if (previous.stillEnRoute && bothPursuits) {
        expect(current.kind).toBe(previous.kind); // still traveling last tick -> must not have defected to the other need
      }
    }
  });

  it("REGRESSION: an unreachable need is never re-selected forever once the other need has been reached -- both eventually get attention", () => {
    const world = buildFlatWorld(10, 8, 10, 2);
    for (let z = 0; z < 10; z++) {
      for (let y = 3; y < 8; y++) world.terrain.setMaterial(3, y, z, "stone");
    }
    spawnTree(world, { x: 8, z: 5 }); // unreachable
    world.water.setDepth(2, 5, 0.3); // reachable
    const id = spawnTestCreature(world, { x: 1, z: 5 }, { hunger: URGENT, thirst: URGENT, fatigue: 0, thermalComfort: 1 });

    let reachedWater = false;
    for (let tick = 0; tick < 20; tick++) {
      const result = tickBeaverNeeds(
        world.grid,
        world.terrain,
        world.water,
        world.materials,
        world.entities,
        world.components,
        id,
        PROFILE,
      );
      expect(result.intent.kind).not.toBe("seek-food"); // the unreachable tree must never be chosen
      if (result.movement?.outcome === "arrived") reachedWater = true;
    }

    expect(reachedWater).toBe(true);
  });
});

function spawnCompletedLodge(world: ReturnType<typeof buildFlatWorld>, at: { x: number; z: number }) {
  const designationId = world.entities.create("designation");
  const id = world.entities.create("construction");
  setConstruction(world.components, id, {
    designationId,
    kind: "lodge-segment",
    site: at,
    requiredMaterialId: "wood",
    requiredMassKg: 40,
    workDone: 20,
    workRequired: 20,
    status: "complete",
  });
  return id;
}

function spawnFood(world: ReturnType<typeof buildFlatWorld>, at: { x: number; z: number }, nutritionValue = 0.4) {
  const id = world.entities.create("food");
  const floor = world.grid.surfaceY(at.x, at.z)!;
  world.grid.setEntityPosition(id, at.x, floor + 1, at.z);
  setFood(world.components, id, { nutritionValue });
  return id;
}

describe("P1-13 consumption: eating and drinking", () => {
  it("eating bark/cambium from a tree fully satisfies hunger (plus this same tick's own ordinary decay, applied AFTER consumption) and costs the tree a real amount of health", () => {
    const world = buildFlatWorld();
    const tree = spawnTree(world, { x: 3, z: 3 });
    const id = spawnTestCreature(world, { x: 3, z: 3 }, { hunger: URGENT, thirst: 0, fatigue: 0, thermalComfort: 1 }); // already adjacent

    const result = tickBeaverNeeds(world.grid, world.terrain, world.water, world.materials, world.entities, world.components, id, PROFILE);

    expect(result.intent.kind).toBe("seek-food");
    // Eating resets hunger to 0, but this SAME tick's own ordinary decay
    // still applies on top (tickBeaverNeeds's own documented ordering) --
    // never exactly 0 the instant a meal happens.
    expect(result.needs.hunger).toBeCloseTo(HUNGER_DECAY_PER_TICK, 10);
    expect(getPlant(world.components, tree)!.health).toBeCloseTo(1 - EAT_TREE_HEALTH_COST, 10);
    expect(world.entities.isLive(tree)).toBe(true); // the tree itself survives being eaten from
    expect(getNeedFocus(world.components, id)!.current).toBe("none"); // pursuit concluded -- arrival + consumption, not still traveling
  });

  it("eating a stored food item destroys the real physical entity and restores hunger by exactly its nutritionValue (not necessarily to 0)", () => {
    const world = buildFlatWorld();
    const item = spawnFood(world, { x: 3, z: 3 }, 0.4);
    const id = spawnTestCreature(world, { x: 3, z: 3 }, { hunger: URGENT, thirst: 0, fatigue: 0, thermalComfort: 1 });

    const result = tickBeaverNeeds(world.grid, world.terrain, world.water, world.materials, world.entities, world.components, id, PROFILE);

    expect(result.intent.kind).toBe("seek-food");
    expect(result.needs.hunger).toBeCloseTo(URGENT - 0.4 + HUNGER_DECAY_PER_TICK, 10);
    expect(world.entities.isLive(item)).toBe(false); // consumed -- a real physical resource actually gone
    expect(getFood(world.components, item)).toBeUndefined();
  });

  it("drinking water fully satisfies thirst (plus this same tick's own ordinary decay)", () => {
    const world = buildFlatWorld();
    world.water.setDepth(3, 3, 0.3);
    const id = spawnTestCreature(world, { x: 3, z: 3 }, { hunger: 0, thirst: URGENT, fatigue: 0, thermalComfort: 1 });

    const result = tickBeaverNeeds(world.grid, world.terrain, world.water, world.materials, world.entities, world.components, id, PROFILE);

    expect(result.intent.kind).toBe("seek-water");
    expect(result.needs.thirst).toBeCloseTo(THIRST_DECAY_PER_TICK, 10);
  });

  it("resolveHunger (via decideIntent) picks whichever of the nearest tree or nearest food item is actually closer", () => {
    const world = buildFlatWorld();
    spawnTree(world, { x: 8, z: 8 }); // far
    const item = spawnFood(world, { x: 2, z: 2 }); // near
    const needs = { hunger: URGENT, thirst: 0, fatigue: 0, thermalComfort: 1 };

    const { intent } = decide(world, needs, "none", { x: 1, z: 1 });

    expect(intent.kind).toBe("seek-food");
    expect((intent as { target: number }).target).toBe(item);
  });

  it("a food item already held by a live beaver is not selectable by another hungry beaver", () => {
    const world = buildFlatWorld();
    const holder = world.entities.create("beaver");
    const item = spawnFood(world, { x: 2, z: 2 });
    setHeld(world.components, item, { by: holder });
    world.entities.create("beaver"); // liveness anchor so `holder` genuinely counts as live below
    // Confirm `holder` is live (it is -- entities are live once created, never destroyed here).
    const needs = { hunger: URGENT, thirst: 0, fatigue: 0, thermalComfort: 1 };

    const { intent } = decide(world, needs, "none", { x: 1, z: 1 });

    expect(intent.kind).toBe("idle"); // no tree exists either -- the held item correctly doesn't count as available
  });

  it("a food item reserved by a live entity is not selectable, but a stale (dead reserver's) reservation is no obstacle", () => {
    const world = buildFlatWorld();
    const item = spawnFood(world, { x: 2, z: 2 });
    const deadReserver = world.entities.create("beaver");
    world.entities.destroy(deadReserver);
    setReservation(world.components, item, { by: deadReserver });
    const needs = { hunger: URGENT, thirst: 0, fatigue: 0, thermalComfort: 1 };

    const { intent } = decide(world, needs, "none", { x: 1, z: 1 });

    expect(intent.kind).toBe("seek-food");
    expect((intent as { target: number }).target).toBe(item);
  });

  it("REGRESSION: two simultaneously-hungry beavers both closer to the SAME single food item never crash or double-consume it -- the second beaver correctly finds it already gone", () => {
    const world = buildFlatWorld();
    const item = spawnFood(world, { x: 5, z: 5 });
    const needs = { hunger: URGENT, thirst: 0, fatigue: 0, thermalComfort: 1 };
    const first = spawnTestCreature(world, { x: 5, z: 5 }, needs); // already adjacent -- eats this very tick
    const second = spawnTestCreature(world, { x: 5, z: 5 }, needs); // same column, ticked immediately after

    expect(() =>
      tickBeaverNeeds(world.grid, world.terrain, world.water, world.materials, world.entities, world.components, first, PROFILE),
    ).not.toThrow();
    expect(world.entities.isLive(item)).toBe(false); // consumed exactly once, by `first`

    const secondResult = tickBeaverNeeds(world.grid, world.terrain, world.water, world.materials, world.entities, world.components, second, PROFILE);

    expect(secondResult.intent.kind).toBe("idle"); // re-derived fresh from live state -- the item it might have raced for is simply gone, not double-eaten
  });
});

const URGENT_FATIGUE = { hunger: 0, thirst: 0, fatigue: URGENT, thermalComfort: 1 };

describe("P1-14 sleep and shelter preference", () => {
  it("with no lodge anywhere, an exhausted beaver rests wherever it stands (no target) and fatigue recovers immediately", () => {
    const world = buildFlatWorld();
    const id = spawnTestCreature(world, { x: 5, z: 5 }, URGENT_FATIGUE);

    const { intent } = decide(world, URGENT_FATIGUE, "none", { x: 5, z: 5 });
    expect(intent).toEqual({ kind: "rest" });

    const result = tickBeaverNeeds(world.grid, world.terrain, world.water, world.materials, world.entities, world.components, id, PROFILE);
    expect(result.movement).toBeUndefined(); // no travel -- rests in place
    expect(result.needs.fatigue).toBeLessThan(URGENT_FATIGUE.fatigue); // recovering immediately
  });

  it("with a completed, reachable lodge, an exhausted beaver's rest intent targets it instead of resting in place", () => {
    const world = buildFlatWorld();
    spawnCompletedLodge(world, { x: 8, z: 8 });

    const { intent } = decide(world, URGENT_FATIGUE, "none", { x: 1, z: 1 });

    expect(intent).toEqual({ kind: "rest", target: { x: 8, z: 8 } });
  });

  it("a NOT-YET-COMPLETE lodge is never a valid rest target -- only a genuinely completed one counts", () => {
    const world = buildFlatWorld();
    const designationId = world.entities.create("designation");
    const id = world.entities.create("construction");
    setConstruction(world.components, id, {
      designationId,
      kind: "lodge-segment",
      site: { x: 8, z: 8 },
      requiredMaterialId: "wood",
      requiredMassKg: 40,
      workDone: 5,
      workRequired: 20,
      status: "awaiting-labor",
    });

    const { intent } = decide(world, URGENT_FATIGUE, "none", { x: 1, z: 1 });

    expect(intent).toEqual({ kind: "rest" }); // falls back to resting in place
  });

  it("an unreachable lodge is never chosen -- falls back to resting in place instead of getting stuck", () => {
    const world = buildFlatWorld(10, 8, 10, 2);
    for (let z = 0; z < 10; z++) {
      for (let y = 3; y < 8; y++) world.terrain.setMaterial(5, y, z, "stone");
    }
    spawnCompletedLodge(world, { x: 8, z: 5 }); // beyond the wall

    const { intent } = decide(world, URGENT_FATIGUE, "none", { x: 1, z: 5 });

    expect(intent).toEqual({ kind: "rest" });
  });

  it("traveling toward a distant lodge counts as activity (fatigue does not recover mid-journey), but recovers once genuinely arrived", () => {
    const world = buildFlatWorld(12, 8, 12, 2);
    spawnCompletedLodge(world, { x: 10, z: 10 });
    const id = spawnTestCreature(world, { x: 1, z: 1 }, URGENT_FATIGUE);

    const first = tickBeaverNeeds(world.grid, world.terrain, world.water, world.materials, world.entities, world.components, id, PROFILE);
    expect(first.movement?.outcome).toBe("moved");
    expect(first.needs.fatigue).toBeGreaterThanOrEqual(URGENT_FATIGUE.fatigue); // still traveling -- not yet recovering

    let arrived = false;
    let recovered = false;
    for (let i = 0; i < 40 && !recovered; i++) {
      const result = tickBeaverNeeds(world.grid, world.terrain, world.water, world.materials, world.entities, world.components, id, PROFILE);
      if (result.movement?.outcome === "arrived") arrived = true;
      if (arrived && result.movement?.outcome === "already-there" && result.needs.fatigue < first.needs.fatigue) recovered = true;
    }

    expect(arrived).toBe(true);
    expect(recovered).toBe(true);
  });
});

describe("P1-15 basic temperature exposure", () => {
  it("applyThermalTick leaves a dry beaver's comfort essentially unchanged -- already at the comfortable target", () => {
    const world = buildFlatWorld();
    const id = spawnTestCreature(world, { x: 3, z: 3 });

    applyThermalTick(world.water, world.materials, world.components, id, { x: 3, z: 3 });

    expect(getNeeds(world.components, id)!.thermalComfort).toBe(1);
  });

  it("REGRESSION (P1-15 acceptance): a beaver in real standing water changes thermal state strictly faster than one on real mild dry ground", () => {
    const wet = buildFlatWorld();
    wet.water.setDepth(3, 3, 0.5);
    const wetBeaver = spawnTestCreature(wet, { x: 3, z: 3 });

    const dry = buildFlatWorld();
    const dryBeaver = spawnTestCreature(dry, { x: 3, z: 3 });

    for (let i = 0; i < 10; i++) {
      applyThermalTick(wet.water, wet.materials, wet.components, wetBeaver, { x: 3, z: 3 });
      applyThermalTick(dry.water, dry.materials, dry.components, dryBeaver, { x: 3, z: 3 });
    }

    const wetChange = 1 - getNeeds(wet.components, wetBeaver)!.thermalComfort;
    const dryChange = 1 - getNeeds(dry.components, dryBeaver)!.thermalComfort;
    expect(wetChange).toBeGreaterThan(0); // genuinely got colder in water
    expect(dryChange).toBe(0); // dry ground: no change at all, already at its own comfortable target
    expect(wetChange).toBeGreaterThan(dryChange);
  });

  it("tickBeaverNeeds itself applies thermal exposure every tick, using the beaver's real live position", () => {
    const world = buildFlatWorld();
    world.water.setDepth(3, 3, 0.5);
    const id = spawnTestCreature(world, { x: 3, z: 3 });

    const result = tickBeaverNeeds(world.grid, world.terrain, world.water, world.materials, world.entities, world.components, id, PROFILE);

    expect(result.needs.thermalComfort).toBeLessThan(1); // genuinely cooled from standing in water this tick
    expect(getNeeds(world.components, id)!.thermalComfort).toBe(result.needs.thermalComfort); // persisted, not just returned
  });

  it("a beaver that moves from water onto dry ground stops getting colder and starts warming back up", () => {
    const world = buildFlatWorld();
    world.water.setDepth(3, 3, 0.5);
    const id = spawnTestCreature(world, { x: 3, z: 3 });
    for (let i = 0; i < 15; i++) applyThermalTick(world.water, world.materials, world.components, id, { x: 3, z: 3 });
    const chilled = getNeeds(world.components, id)!.thermalComfort;
    expect(chilled).toBeLessThan(1);

    for (let i = 0; i < 40; i++) applyThermalTick(world.water, world.materials, world.components, id, { x: 6, z: 6 }); // dry column
    expect(getNeeds(world.components, id)!.thermalComfort).toBeGreaterThan(chilled);
  });

  it("throws for an entity with no Needs component", () => {
    const world = buildFlatWorld();
    const bogus = world.entities.create("beaver");
    expect(() => applyThermalTick(world.water, world.materials, world.components, bogus, { x: 3, z: 3 })).toThrow(RangeError);
  });
});
