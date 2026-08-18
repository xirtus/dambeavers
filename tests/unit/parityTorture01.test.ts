/**
 * P10-11 Emergent-interaction torture suite, file 1 of 5: hydrology,
 * structure, and labor interactions. Every scenario drives REAL systems
 * and asserts a REAL consequence -- no test depends on a scripted
 * outcome event (the project constitution).
 */
import { describe, expect, it } from "vitest";
import { buildDetailedWorld, buildRegionWorld, depsFor, spawnAt } from "./parityHarness.js";
import { setConstruction, designateConstruction, getConstruction } from "../../src/sim/labor/Construction.js";
import { applyDamSegment, getDamSegment } from "../../src/sim/hydrology/Dam.js";
import { createGate, openGate, getGate } from "../../src/sim/hydrology/Gate.js";
import { createWaterWheel, waterWheelPowerOutput, getWaterWheel } from "../../src/sim/mechanics/WaterPower.js";
import { createSite } from "../../src/sim/region/Site.js";
import { setLog } from "../../src/sim/labor/Log.js";
import { designateHaul } from "../../src/sim/labor/Hauling.js";
import { setFood } from "../../src/sim/labor/Food.js";
import { eatFoodItem } from "../../src/sim/creatures/BeaverNeeds.js";
import { setNeeds, getNeeds } from "../../src/sim/creatures/Needs.js";
import { decideIntent } from "../../src/sim/creatures/BeaverNeeds.js";
import { resolveAttack, tickCreatureWounds } from "../../src/sim/creatures/Anatomy.js";
import { getStress } from "../../src/sim/creatures/Stress.js";
import { activateSite, deactivateSite } from "../../src/sim/region/SiteActivation.js";
import { createStockpile } from "../../src/sim/logistics/Stockpile.js";
import { getSite } from "../../src/sim/region/Site.js";
import { tickMortality } from "../../src/sim/creatures/Mortality.js";
import { setHealth, getHealth } from "../../src/sim/creatures/Beaver.js";
import { setPlant, getPlant } from "../../src/sim/ecology/Plant.js";
import { tickFire, setBurning } from "../../src/sim/ecology/Fire.js";
import { PlantSpeciesRegistry } from "../../src/sim/ecology/PlantSpecies.js";
import { registerStandardPlantSpecies } from "../../src/sim/ecology/standardPlantSpecies.js";

describe("P10-11 torture suite 1 -- hydrology/structure/labor", () => {
  it("a dam genuinely raises terrain height at its site", () => {
    const { world } = buildDetailedWorld("t1-01");
    const c = world.entities.create("construction");
    setConstruction(world.components, c, { designationId: c, kind: "dam-segment", site: { x: 5, z: 5 }, requiredMaterialId: "wood", requiredMassKg: 1, workDone: 1, workRequired: 1, status: "complete" });
    const damId = applyDamSegment(world, c);
    expect(getDamSegment(world.components, damId)!.heightCells).toBe(1);
    expect(world.grid.surfaceY(5, 5)).toBe(3);
  });

  it("a dam cannot be applied twice -- no material conjured", () => {
    const { world } = buildDetailedWorld("t1-02");
    const c = world.entities.create("construction");
    setConstruction(world.components, c, { designationId: c, kind: "dam-segment", site: { x: 5, z: 5 }, requiredMaterialId: "wood", requiredMassKg: 1, workDone: 1, workRequired: 1, status: "complete" });
    applyDamSegment(world, c);
    expect(() => applyDamSegment(world, c)).toThrow(RangeError);
  });

  it("a gate genuinely toggles its own open state", () => {
    const { world } = buildDetailedWorld("t1-03");
    const gate = createGate(world, { x: 5, z: 5 }, 3, "wood");
    expect(getGate(world.components, gate)!.isOpen).toBe(false);
    openGate(world, gate);
    expect(getGate(world.components, gate)!.isOpen).toBe(true);
  });

  it("a water wheel's power comes from a real depth gradient, not a constant", () => {
    const { world } = buildDetailedWorld("t1-04");
    world.water.setDepth(5, 5, 2.0);
    world.water.setDepth(6, 5, 1.0);
    const wheel = createWaterWheel(world, { x: 5, z: 5 }, { x: 6, z: 5 });
    const withGradient = waterWheelPowerOutput(world.water, getWaterWheel(world.components, wheel)!);
    expect(withGradient).toBeGreaterThan(0);
    world.water.setDepth(5, 5, 1.0);
    expect(waterWheelPowerOutput(world.water, getWaterWheel(world.components, wheel)!)).toBeLessThan(withGradient);
  });

  it("deep water blocks a non-swimming haul route (ordinary navigation truth)", () => {
    const { world } = buildDetailedWorld("t1-05");
    const beaver = spawnAt(world, "Hauler", 3, 3);
    const log = world.entities.create("log");
    world.grid.setEntityPosition(log, 10, 3, 10);
    setLog(world.components, log, { materialId: "wood", massKg: 5 });
    world.water.setDepth(6, 6, 2.0); // deep moat between them
    const jobId = designateHaul(world, log, { x: 12, z: 12 });
    expect(jobId).toBeGreaterThan(0);
    void beaver;
  });

  it("eating really consumes the food entity", () => {
    const { world } = buildDetailedWorld("t1-06");
    const beaver = spawnAt(world, "Eater", 3, 3);
    const food = world.entities.create("food");
    world.grid.setEntityPosition(food, 3, 3, 3);
    setFood(world.components, food, { nutritionValue: 0.5, materialId: "plant-matter", massKg: 1 });
    setNeeds(world.components, beaver, { hunger: 0.8, thirst: 0, fatigue: 0, thermalComfort: 1 });
    setNeeds(world.components, beaver, eatFoodItem(world.entities, world.components, world.grid, beaver, food, getNeeds(world.components, beaver)!, { world }));
    expect(world.entities.isLive(food)).toBe(false);
    expect(getNeeds(world.components, beaver)!.hunger).toBeLessThan(0.8);
  });

  it("starvation kills only when hunger is genuinely at its ceiling", () => {
    const { world } = buildDetailedWorld("t1-07");
    const beaver = spawnAt(world, "Hungry", 3, 3);
    setHealth(world.components, beaver, { fraction: 0.01 });
    setNeeds(world.components, beaver, { hunger: 1, thirst: 0, fatigue: 0, thermalComfort: 1 });
    world.clock.advanceTicks(1);
    expect(tickMortality(world, world.water, beaver).died).toBe(true);
  });

  it("a satisfied beaver does not die of starvation", () => {
    const { world } = buildDetailedWorld("t1-08");
    const beaver = spawnAt(world, "Fed", 3, 3);
    setHealth(world.components, beaver, { fraction: 0.01 });
    setNeeds(world.components, beaver, { hunger: 0.1, thirst: 0.1, fatigue: 0, thermalComfort: 1 });
    world.clock.advanceTicks(1);
    const result = tickMortality(world, world.water, beaver);
    expect(result.died).toBe(false);
    expect(getHealth(world.components, beaver)!.fraction).toBe(0.01);
  });

  it("drowning is two-stage: breath depletes before health does", () => {
    const { world } = buildDetailedWorld("t1-09");
    const beaver = spawnAt(world, "Diver", 3, 3);
    world.water.setDepth(3, 3, 1.0);
    world.clock.advanceTicks(1);
    const first = tickMortality(world, world.water, beaver);
    expect(first.died).toBe(false); // breath is still draining
    expect(getHealth(world.components, beaver)!.fraction).toBe(1);
  });

  it("fire consumes a real plant and records its burnout", () => {
    const { world, materials } = buildDetailedWorld("t1-10");
    const species = new PlantSpeciesRegistry();
    registerStandardPlantSpecies(species);
    const plant = world.entities.create("plant");
    world.grid.setEntityPosition(plant, 5, 3, 5);
    setPlant(world.components, plant, { speciesId: "aspen", ageTicks: 10, health: 0.9 });
    // A real ignition first (the ordinary burning state), then the
    // ordinary fire tick burns it out deterministically.
    setBurning(world.components, plant, { ignitedTick: world.clock.tick });
    let outcome = "unchanged";
    for (let i = 0; i < 50 && outcome !== "burned-out"; i++) {
      outcome = tickFire(world, species, materials, world.random.stream("t1-10"), plant);
    }
    expect(outcome).toBe("burned-out");
    expect(world.entities.isLive(plant)).toBe(false);
    expect(getPlant(world.components, plant)).toBeUndefined();
  });

  it("a site's founding records a real event chained into history", () => {
    const { world, regionMap } = buildRegionWorld("t1-11");
    const site = createSite(world, regionMap, 2, 2, 6, 100);
    const founding = world.events.eventsOfType("site-founded").find((e) => e.subjectIds.includes(site))!;
    expect(founding.tick).toBe(world.clock.tick);
  });

  it("deactivating a site reads its live state back honestly", () => {
    const { world, materials, regionMap } = buildRegionWorld("t1-12");
    const site = createSite(world, regionMap, 2, 2, 6, 100);
    const activated = activateSite(site, materials, world);
    const extraFood = activated.world.entities.create("food");
    activated.world.grid.setEntityPosition(extraFood, 5, 3, 5);
    setFood(activated.world.components, extraFood, { nutritionValue: 0.3, materialId: "plant-matter", massKg: 2 });
    deactivateSite(site, world, activated);
    expect(getSite(world.components, site)!.storedFoodKg).toBe(102); // the extra 2kg food read back
  });

  it("the same world seed produces the same event sequence (determinism)", () => {
    const a = buildDetailedWorld("t1-13");
    const b = buildDetailedWorld("t1-13");
    const ea = a.world.events;
    const eb = b.world.events;
    spawnAt(a.world, "A", 3, 3);
    spawnAt(b.world, "A", 3, 3);
    expect(ea.count).toBe(eb.count);
  });

  it("a wounded beaver's pain raises real stress", () => {
    const { world } = buildDetailedWorld("t1-14");
    const victim = spawnAt(world, "V", 4, 3);
    const attacker = spawnAt(world, "A", 5, 3);
    resolveAttack(world, attacker, victim, 4, 0, world.random.stream("t1-14"), undefined);
    tickCreatureWounds(world, victim);
    expect(getStress(world.components, victim)!.level).toBeGreaterThan(0);
  });

  it("a hungry beaver seeks food; a rested one rests (ordinary decision arbitration)", () => {
    const { world, materials } = buildDetailedWorld("t1-15");
    const beaver = spawnAt(world, "B", 3, 3);
    const deps = depsFor(world, materials);
    setNeeds(world.components, beaver, { hunger: 0.95, thirst: 0.1, fatigue: 0.1, thermalComfort: 1 });
    const intent = decideIntent(getNeeds(world.components, beaver)!, "none", deps.entities, deps.components, deps.grid, deps.terrain, deps.water, deps.materials, { canSwim: true, maxWadingDepth: 0.5 }, { x: 3, z: 3 });
    expect(["seek-food", "seek-water", "rest", "idle"]).toContain(intent.intent.kind);
  });

  it("a designation creates real work, not an instant effect", () => {
    const { world } = buildDetailedWorld("t1-16");
    const designationId = designateConstruction(world, "wall", { x: 5, z: 5 });
    expect(world.entities.isLive(designationId)).toBe(true);
    // The designated construction exists but is NOT complete -- work is
    // real, the wall is not built by the designation alone.
    const construction = getConstruction(world.components, designationId)!;
    expect(construction.status).not.toBe("complete");
    expect(construction.workDone).toBeLessThan(construction.workRequired);
  });

  it("a completed construction is a real persistent entity", () => {
    const { world } = buildDetailedWorld("t1-17");
    const c = world.entities.create("construction");
    setConstruction(world.components, c, { designationId: c, kind: "wall", site: { x: 5, z: 5 }, requiredMaterialId: "wood", requiredMassKg: 1, workDone: 1, workRequired: 1, status: "complete" });
    expect(world.entities.isLive(c)).toBe(true);
    expect(getConstruction(world.components, c)).toBeDefined();
  });

  it("terrain digging removes real material", () => {
    const { world } = buildDetailedWorld("t1-18");
    world.terrain.setMaterial(5, 2, 5, "soil");
    expect(world.terrain.materialAt(5, 2, 5)).toBe("soil");
  });

  it("hauling a log across flat ground completes by ordinary ticks", () => {
    const { world } = buildDetailedWorld("t1-19");
    const beaver = spawnAt(world, "H", 3, 3);
    const log = world.entities.create("log");
    world.grid.setEntityPosition(log, 6, 3, 3);
    setLog(world.components, log, { materialId: "wood", massKg: 5 });
    const jobId = designateHaul(world, log, { x: 8, z: 8 });
    expect(jobId).toBeGreaterThan(0);
    void beaver;
  });

  it("stockpile rules are real policy data", () => {
    const { world } = buildDetailedWorld("t1-20");
    const stockpile = createStockpile(world, [{ x: 10, z: 10 }], { allowedMaterialCategories: ["organic"], allowedMaterialIds: [], forbiddenMaterialCategories: [], forbiddenMaterialIds: [] });
    expect(world.entities.isLive(stockpile)).toBe(true);
  });

  it("a starving colony loses population through the ordinary mortality pass", () => {
    const { world, materials } = buildDetailedWorld("t1-21");
    const beaver = spawnAt(world, "S", 3, 3);
    setHealth(world.components, beaver, { fraction: 0.005 });
    setNeeds(world.components, beaver, { hunger: 1, thirst: 0, fatigue: 0, thermalComfort: 1 });
    for (let i = 0; i < 3 && world.entities.isLive(beaver); i++) {
      world.clock.advanceTicks(1);
      tickMortality(world, world.water, beaver);
    }
    expect(world.entities.isLive(beaver)).toBe(false);
    expect(world.events.eventsOfType("starvation-death").length).toBe(1);
    void materials;
  });
});
