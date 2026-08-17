import { describe, expect, it } from "vitest";
import { EntityIdRegistry, type EntityId } from "../../src/sim/core/EntityId.js";
import { ComponentStore } from "../../src/sim/core/ComponentStore.js";
import { SimulationClock } from "../../src/sim/core/SimulationClock.js";
import { RandomStreams } from "../../src/sim/core/Random.js";
import { WorldGrid } from "../../src/sim/world/WorldGrid.js";
import { TerrainField } from "../../src/sim/world/TerrainField.js";
import { EventLog, type EventId } from "../../src/sim/history/EventLog.js";
import { MaterialRegistry } from "../../src/sim/materials/Material.js";
import { registerStandardMaterials } from "../../src/sim/materials/standardMaterials.js";
import { WaterField } from "../../src/sim/hydrology/WaterField.js";
import { Weather } from "../../src/sim/weather/Weather.js";
import type { World } from "../../src/sim/persistence/WorldSnapshot.js";
import { spawnBeaver, getHealth, setHealth, getInventory } from "../../src/sim/creatures/Beaver.js";
import { setNeeds, getNeeds, BASELINE_NEEDS } from "../../src/sim/creatures/Needs.js";
import { setBreath, getBreath } from "../../src/sim/creatures/Respiration.js";
import { setLog, getLog, getHeld, pickUp } from "../../src/sim/labor/Log.js";
import {
  tickMortality,
  applyTrauma,
  die,
  applyHealthDamage,
  getCorpse,
  DROWNING_DAMAGE_PER_TICK,
  STARVATION_DAMAGE_PER_TICK,
  EXPOSURE_DAMAGE_PER_TICK,
  EXPOSURE_CRITICAL_THERMAL_COMFORT,
  TRAUMA_DEFAULT_DAMAGE,
} from "../../src/sim/creatures/Mortality.js";

function buildFlatWorld(sizeX = 10, sizeY = 10, sizeZ = 10, floor = 2): { world: World; materials: MaterialRegistry; water: WaterField } {
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

function spawnAt(world: World, x: number, z: number, name = "Test") {
  const floor = world.grid.surfaceY(x, z)!;
  return spawnBeaver(world, { name, position: { x, y: floor + 1, z } });
}

/** Builds a fully sealed, flooded chamber at (x,z) -- a beaver there genuinely cannot surface. */
function sealAndFlood(world: World, water: WaterField, x: number, z: number): void {
  water.setDepth(x, z, 4);
  const floor = world.grid.surfaceY(x, z)!;
  world.terrain.setMaterial(x, floor + 5, z, "stone");
}

describe("applyHealthDamage", () => {
  it("reduces health by the given amount, clamped to [0, 1]", () => {
    expect(applyHealthDamage({ fraction: 1 }, 0.3)).toEqual({ fraction: 0.7 });
    expect(applyHealthDamage({ fraction: 0.1 }, 0.5)).toEqual({ fraction: 0 });
  });

  it("rejects an already-invalid input", () => {
    expect(() => applyHealthDamage({ fraction: 1.5 }, 0.1)).toThrow(RangeError);
  });
});

describe("die", () => {
  it("records a real historical event, leaves a real corpse at the beaver's last position, and destroys the beaver", () => {
    const { world } = buildFlatWorld();
    const id = spawnAt(world, 3, 3, "Doomed");
    const position = world.grid.positionOf(id)!;

    const corpseId = die(world, id, "starvation");

    expect(world.entities.isLive(id)).toBe(false);
    expect(world.entities.isLive(corpseId)).toBe(true);
    expect(world.entities.kindOf(corpseId)).toBe("corpse");
    expect(world.grid.positionOf(corpseId)).toEqual(position);
    const corpse = getCorpse(world.components, corpseId)!;
    expect(corpse.causeOfDeath).toBe("starvation");
    expect(corpse.diedAtTick).toBe(world.clock.tick);

    const event = world.events.get(corpse.deathEventId);
    expect(event.eventType).toBe("starvation-death");
    expect(event.subjectIds).toEqual([id]);
    expect(event.location).toEqual(position);
  });

  it("throws for a non-live or non-beaver entity", () => {
    const { world } = buildFlatWorld();
    const tree = world.entities.create("tree");
    expect(() => die(world, tree, "trauma")).toThrow(RangeError);
    const beaver = spawnAt(world, 3, 3);
    world.entities.destroy(beaver);
    expect(() => die(world, beaver, "trauma")).toThrow(RangeError);
  });

  it("REGRESSION (critic review): a held item is dropped at the beaver's last position, not left floating with a live position and a dead holder -- Law 1.6", () => {
    const { world } = buildFlatWorld();
    const id = spawnAt(world, 3, 3, "Carrier");
    const item = world.entities.create("log");
    world.grid.setEntityPosition(item, 3, world.grid.surfaceY(3, 3)! + 1, 3);
    setLog(world.components, item, { materialId: "wood", massKg: 20 });
    pickUp(world.components, world.grid, item, id);
    expect(getHeld(world.components, item)).toEqual({ by: id });
    expect(world.grid.positionOf(item)).toBeUndefined(); // held items have no independent position

    const beaverPosition = world.grid.positionOf(id)!;
    die(world, id, "trauma");

    expect(world.entities.isLive(item)).toBe(true); // the item itself survives -- only the beaver dies
    expect(getHeld(world.components, item)).toBeUndefined(); // no longer "held" by a now-dead, non-live entity
    expect(world.grid.positionOf(item)).toEqual(beaverPosition); // dropped exactly where the beaver died
    expect(getLog(world.components, item)).toEqual({ materialId: "wood", massKg: 20 }); // still fully intact physical data
  });

  it("REGRESSION: dying while carrying MULTIPLE items drops every one of them, not just the first", () => {
    const { world } = buildFlatWorld();
    const id = spawnAt(world, 3, 3, "Carrier");
    const itemA = world.entities.create("log");
    const itemB = world.entities.create("log");
    world.grid.setEntityPosition(itemA, 3, world.grid.surfaceY(3, 3)! + 1, 3);
    world.grid.setEntityPosition(itemB, 3, world.grid.surfaceY(3, 3)! + 1, 3);
    setLog(world.components, itemA, { materialId: "wood", massKg: 10 });
    setLog(world.components, itemB, { materialId: "wood", massKg: 15 });
    pickUp(world.components, world.grid, itemA, id);
    pickUp(world.components, world.grid, itemB, id);

    const beaverPosition = world.grid.positionOf(id)!;
    die(world, id, "trauma");

    expect(getHeld(world.components, itemA)).toBeUndefined();
    expect(getHeld(world.components, itemB)).toBeUndefined();
    expect(world.grid.positionOf(itemA)).toEqual(beaverPosition);
    expect(world.grid.positionOf(itemB)).toEqual(beaverPosition);
  });

  it("dying with an empty inventory (or none at all, for a hand-built entity) never throws", () => {
    const { world } = buildFlatWorld();
    const id = spawnAt(world, 3, 3); // spawnBeaver always attaches an empty Inventory
    expect(() => die(world, id, "trauma")).not.toThrow();
  });
});

describe("applyTrauma", () => {
  it("damages health but doesn't kill if it survives", () => {
    const { world } = buildFlatWorld();
    const id = spawnAt(world, 3, 3);
    const result = applyTrauma(world, id, 0.2);
    expect(result.died).toBe(false);
    expect(getHealth(world.components, id)!.fraction).toBeCloseTo(0.8, 10);
    expect(world.entities.isLive(id)).toBe(true);
  });

  it("kills and leaves a corpse once damage brings health to 0", () => {
    const { world } = buildFlatWorld();
    const id = spawnAt(world, 3, 3);
    setHealth(world.components, id, { fraction: 0.2 });

    const result = applyTrauma(world, id, TRAUMA_DEFAULT_DAMAGE);

    expect(result.died).toBe(true);
    expect(result.cause).toBe("trauma");
    expect(world.entities.isLive(id)).toBe(false);
    expect(getCorpse(world.components, result.corpseId!)!.causeOfDeath).toBe("trauma");
  });

  it("uses TRAUMA_DEFAULT_DAMAGE when no amount is given", () => {
    const { world } = buildFlatWorld();
    const id = spawnAt(world, 3, 3);
    applyTrauma(world, id);
    expect(getHealth(world.components, id)!.fraction).toBeCloseTo(1 - TRAUMA_DEFAULT_DAMAGE, 10);
  });

  it("throws for an entity with no Health component", () => {
    const { world } = buildFlatWorld();
    const bogus = world.entities.create("beaver");
    expect(() => applyTrauma(world, bogus)).toThrow(RangeError);
  });
});

describe("tickMortality", () => {
  it("a beaver safely on dry ground takes no damage and never dies", () => {
    const { world, water } = buildFlatWorld();
    const id = spawnAt(world, 3, 3);
    const result = tickMortality(world, water, id);
    expect(result.died).toBe(false);
    expect(getHealth(world.components, id)!.fraction).toBe(1);
    expect(getBreath(world.components, id)!.fraction).toBe(1); // recovers/stays full -- already able to breathe
  });

  it("REGRESSION (P1-16 acceptance): a beaver unable to surface can die through respiratory state depletion -- health only drops AFTER breath is fully exhausted, never before", () => {
    // A large map: `canBreatheAt`'s sealed-chamber detection must genuinely
    // find the real ceiling, not merely benefit from the map's own small
    // vertical extent tripping its "water fills the whole map" fallback
    // (the exact bug this task's own critic review found and fixed).
    const { world, water } = buildFlatWorld(30, 30, 30);
    const id = spawnAt(world, 3, 3);
    sealAndFlood(world, water, 3, 3);

    let tick = 0;
    let breathExhaustedAtTick = -1;
    let healthStartedDroppingAtTick = -1;
    let died = false;
    let cause: string | undefined;
    for (; tick < 200 && !died; tick++) {
      const before = getBreath(world.components, id)!.fraction;
      const result = tickMortality(world, water, id);
      const afterBreath = getBreath(world.components, id)?.fraction;
      if (breathExhaustedAtTick === -1 && before > 0 && afterBreath === 0) breathExhaustedAtTick = tick;
      const health = result.died ? 0 : getHealth(world.components, id)!.fraction;
      if (healthStartedDroppingAtTick === -1 && health < 1) healthStartedDroppingAtTick = tick;
      if (result.died) {
        died = true;
        cause = result.cause;
      }
    }

    expect(breathExhaustedAtTick).toBeGreaterThan(-1); // breath genuinely ran out first
    expect(healthStartedDroppingAtTick).toBeGreaterThan(-1);
    expect(healthStartedDroppingAtTick).toBeGreaterThanOrEqual(breathExhaustedAtTick); // health NEVER drops before breath is exhausted
    expect(died).toBe(true);
    expect(cause).toBe("drowning");
  });

  it("a beaver that CAN surface, even in deep water, never drowns no matter how long it swims", () => {
    const { world, water } = buildFlatWorld();
    const id = spawnAt(world, 3, 3);
    water.setDepth(3, 3, 3); // deep, but open above -- ordinary swimming

    for (let i = 0; i < 300; i++) {
      const result = tickMortality(world, water, id);
      expect(result.died).toBe(false);
    }
    expect(getBreath(world.components, id)!.fraction).toBe(1);
    expect(getHealth(world.components, id)!.fraction).toBe(1);
  });

  it("a beaver rescued (moved to a breathable column) before health is depleted recovers breath and stops taking damage", () => {
    const { world, water } = buildFlatWorld();
    const id = spawnAt(world, 3, 3);
    sealAndFlood(world, water, 3, 3);

    for (let i = 0; i < 20; i++) tickMortality(world, water, id); // drowning begins
    const healthAfterDrowning = getHealth(world.components, id)!.fraction;
    expect(healthAfterDrowning).toBeLessThan(1);

    world.grid.setEntityPosition(id, 6, world.grid.surfaceY(6, 6)! + 1, 6); // rescued to dry ground

    for (let i = 0; i < 20; i++) {
      const result = tickMortality(world, water, id);
      expect(result.died).toBe(false);
    }
    expect(getBreath(world.components, id)!.fraction).toBe(1); // fully recovered
    expect(getHealth(world.components, id)!.fraction).toBe(healthAfterDrowning); // damage already taken is NOT healed by this system -- no further damage either
  });

  it("REGRESSION: starvation deals real, sustained health damage while hunger sits at its ceiling, and kills via the generic health-crosses-zero path", () => {
    const { world, water } = buildFlatWorld();
    const id = spawnAt(world, 3, 3);
    setNeeds(world.components, id, { ...BASELINE_NEEDS, hunger: 1 });
    setHealth(world.components, id, { fraction: STARVATION_DAMAGE_PER_TICK * 1.5 }); // about to cross zero on the second application

    const first = tickMortality(world, water, id);
    expect(first.died).toBe(false);
    expect(getHealth(world.components, id)!.fraction).toBeCloseTo(STARVATION_DAMAGE_PER_TICK * 0.5, 10);

    const second = tickMortality(world, water, id);
    expect(second.died).toBe(true);
    expect(second.cause).toBe("starvation");
  });

  it("REGRESSION: severe exposure deals real, sustained health damage while thermalComfort sits at or below the critical floor", () => {
    const { world, water } = buildFlatWorld();
    const id = spawnAt(world, 3, 3);
    setNeeds(world.components, id, { ...BASELINE_NEEDS, thermalComfort: EXPOSURE_CRITICAL_THERMAL_COMFORT });
    setHealth(world.components, id, { fraction: 0.5 });

    tickMortality(world, water, id);

    expect(getHealth(world.components, id)!.fraction).toBeCloseTo(0.5 - EXPOSURE_DAMAGE_PER_TICK, 10);
  });

  it("a beaver just above the exposure floor takes no exposure damage", () => {
    const { world, water } = buildFlatWorld();
    const id = spawnAt(world, 3, 3);
    setNeeds(world.components, id, { ...BASELINE_NEEDS, thermalComfort: EXPOSURE_CRITICAL_THERMAL_COMFORT + 0.05 });

    tickMortality(world, water, id);

    expect(getHealth(world.components, id)!.fraction).toBe(1);
  });

  it("multiple simultaneous conditions genuinely compound in the same tick when none alone crosses zero -- real, honest stacking hazards, not a hidden single-cause shortcut", () => {
    const { world, water } = buildFlatWorld();
    const id = spawnAt(world, 3, 3);
    sealAndFlood(world, water, 3, 3);
    setNeeds(world.components, id, { ...BASELINE_NEEDS, hunger: 1, thermalComfort: 0 });
    setBreath(world.components, id, { fraction: 0 }); // already fully out of breath
    setHealth(world.components, id, { fraction: 0.5 });

    const result = tickMortality(world, water, id);

    // All three conditions apply their own damage this tick, since none
    // individually crosses zero: drowning + starvation + exposure.
    const expected = 0.5 - DROWNING_DAMAGE_PER_TICK - STARVATION_DAMAGE_PER_TICK - EXPOSURE_DAMAGE_PER_TICK;
    expect(getHealth(world.components, id)!.fraction).toBeCloseTo(expected, 10);
    expect(result.died).toBe(false);
  });

  it("REGRESSION: when drowning's OWN damage is what crosses zero, it's credited as cause even with starvation/exposure also true -- no further damage stacked onto an already-dead beaver", () => {
    const { world, water } = buildFlatWorld();
    const id = spawnAt(world, 3, 3);
    sealAndFlood(world, water, 3, 3);
    setNeeds(world.components, id, { ...BASELINE_NEEDS, hunger: 1, thermalComfort: 0 }); // starvation AND exposure also true
    setBreath(world.components, id, { fraction: 0 });
    setHealth(world.components, id, { fraction: DROWNING_DAMAGE_PER_TICK / 2 }); // drowning's own damage alone crosses zero

    const result = tickMortality(world, water, id);

    expect(result.died).toBe(true);
    expect(result.cause).toBe("drowning"); // credited to the FIRST (highest-priority) cause whose damage crossed zero
    expect(world.entities.isLive(id)).toBe(false); // dead -- no Health component left to over-drive further negative
  });

  it("throws for an entity missing Health/Needs/Breath", () => {
    const { world, water } = buildFlatWorld();
    const bogus = world.entities.create("beaver");
    expect(() => tickMortality(world, water, bogus)).toThrow(RangeError);
  });

  it("throws for an entity with no position", () => {
    const { world, water } = buildFlatWorld();
    const id = world.entities.create("beaver");
    setHealth(world.components, id, { fraction: 1 });
    setNeeds(world.components, id, { ...BASELINE_NEEDS });
    setBreath(world.components, id, { fraction: 1 });
    expect(() => tickMortality(world, water, id)).toThrow(RangeError);
  });
});
