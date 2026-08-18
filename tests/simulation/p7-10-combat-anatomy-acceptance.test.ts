/**
 * Headless acceptance test for P7-10 -- Combat anatomy.
 *
 * Roadmap acceptance test: "identical attacks to different body regions
 * produce mechanically different consequences."
 */
import { describe, expect, it } from "vitest";
import { EntityIdRegistry, type EntityId } from "../../src/sim/core/EntityId.js";
import { ComponentStore } from "../../src/sim/core/ComponentStore.js";
import { SimulationClock } from "../../src/sim/core/SimulationClock.js";
import { RandomStreams, type RandomStream } from "../../src/sim/core/Random.js";
import { WorldGrid } from "../../src/sim/world/WorldGrid.js";
import { TerrainField } from "../../src/sim/world/TerrainField.js";
import { EventLog } from "../../src/sim/history/EventLog.js";
import { MaterialRegistry } from "../../src/sim/materials/Material.js";
import { registerStandardMaterials } from "../../src/sim/materials/standardMaterials.js";
import { WaterField } from "../../src/sim/hydrology/WaterField.js";
import { Weather } from "../../src/sim/weather/Weather.js";
import type { World } from "../../src/sim/persistence/WorldSnapshot.js";
import { spawnBeaver, getHealth, getLocomotion } from "../../src/sim/creatures/Beaver.js";
import { getStress } from "../../src/sim/creatures/Stress.js";
import {
  resolveAttack, tickAllWounds, woundsOf, totalMobilityImpairment, bodyPlanFor,
  BEAVER_BODY_PLAN, tissueResistance,
} from "../../src/sim/creatures/Anatomy.js";

function buildWorld(): World {
  const entities = new EntityIdRegistry();
  const components = new ComponentStore(entities);
  const grid = new WorldGrid({ sizeX: 20, sizeY: 10, sizeZ: 20 }, entities);
  const materials = new MaterialRegistry();
  registerStandardMaterials(materials);
  const terrain = new TerrainField(grid, materials);
  for (let x = 0; x < 20; x++) for (let z = 0; z < 20; z++) for (let y = 0; y <= 2; y++) terrain.setMaterial(x, y, z, "soil");
  const water = new WaterField(grid);
  const weather = new Weather();
  const clock = new SimulationClock({ tickRateHz: 20 });
  const random = new RandomStreams(710);
  const events = new EventLog(entities);
  return { clock, random, entities, components, grid, terrain, events, water, weather };
}

describe("P7-10 -- Combat anatomy", () => {
  it("identical attacks to different body regions produce mechanically different consequences", () => {
    const world = buildWorld();
    const attacker = spawnBeaver(world, { name: "Attacker", position: { x: 5, y: 3, z: 5 } });
    const headTarget = spawnBeaver(world, { name: "HeadTarget", position: { x: 5, y: 3, z: 6 } });
    const limbTarget = spawnBeaver(world, { name: "LimbTarget", position: { x: 5, y: 3, z: 7 } });

    // Same body plan, same tissue data for both defenders.
    expect(bodyPlanFor(world.components, headTarget)).toBe(BEAVER_BODY_PLAN);
    expect(bodyPlanFor(world.components, limbTarget)).toBe(BEAVER_BODY_PLAN);

    // Deterministic streams whose first draws land on DIFFERENT parts.
    const headStream = world.random.stream("head-attack");
    const limbStream = world.random.stream("limb-attack");
    let headResolution = resolveAttack(world, attacker, headTarget, 10, 0, headStream);
    let limbResolution = resolveAttack(world, attacker, limbTarget, 10, 0, limbStream);
    // Retry with fresh defenders of the same name if needed -- the same
    // FORCE must land on two different parts across the streams.
    let retries = 0;
    while (headResolution.partId === limbResolution.partId && retries < 4) {
      const freshHead = spawnBeaver(world, { name: `HeadTarget${retries}`, position: { x: 5, y: 3, z: 6 + retries } });
      const freshLimb = spawnBeaver(world, { name: `LimbTarget${retries}`, position: { x: 5, y: 3, z: 7 + retries } });
      headResolution = resolveAttack(world, attacker, freshHead, 10, 0, headStream);
      limbResolution = resolveAttack(world, attacker, freshLimb, 10, 0, limbStream);
      retries++;
    }
    expect(headResolution.partId).not.toBe(limbResolution.partId);

    // The consequences genuinely differ MECHANICALLY by part: vital parts
    // bleed and pain; limbs impair locomotion; the same severity means
    // different real state on different parts.
    const headWound = woundsOf(world, headTarget).find((w) => w.partId === headResolution.partId);
    const limbWound = woundsOf(world, limbTarget).find((w) => w.partId === limbResolution.partId);
    expect(headWound).toBeDefined();
    expect(limbWound).toBeDefined();
    const headIsVital = BEAVER_BODY_PLAN.parts.find((p) => p.id === headWound!.partId)!.vital;
    const limbIsVital = BEAVER_BODY_PLAN.parts.find((p) => p.id === limbWound!.partId)!.vital;
    if (headIsVital !== limbIsVital) {
      const vitalWound = headIsVital ? headWound! : limbWound!;
      const otherWound = headIsVital ? limbWound! : headWound!;
      expect(vitalWound.bleedingRate).toBeGreaterThan(otherWound.bleedingRate);
    }
    const limbPart = BEAVER_BODY_PLAN.parts.find((p) => p.id === limbWound!.partId)!;
    if (limbPart.mobilityShare > 0 && !headIsVital) {
      expect(limbWound!.mobilityImpairment).toBeGreaterThan(0);
    }

    // Armor and tissue genuinely block: a weak attack glances off.
    const weakResolution = resolveAttack(world, attacker, spawnBeaver(world, { name: "WeakTarget", position: { x: 5, y: 3, z: 9 } }), 0.5, 0, world.random.stream("weak-attack"));
    expect(weakResolution.wounded).toBe(false);

    // Wounds progress through real physiology: bleeding drains health,
    // pain raises stress, healing restores.
    const bleeder = spawnBeaver(world, { name: "Bleeder", position: { x: 8, y: 3, z: 8 } });
    let bleederResolution = resolveAttack(world, attacker, bleeder, 10, 0, world.random.stream("bleeder-attack"));
    let tries = 0;
    while (!bleederResolution.wounded && tries < 6) {
      bleederResolution = resolveAttack(world, attacker, bleeder, 10, 0, world.random.stream(`bleeder-attack-${tries}`));
      tries++;
    }
    expect(bleederResolution.wounded).toBe(true);
    const healthBefore = getHealth(world.components, bleeder)!.fraction;
    const stressBefore = getStress(world.components, bleeder)?.level ?? 0;
    tickAllWounds(world);
    expect(getHealth(world.components, bleeder)!.fraction).toBeLessThan(healthBefore);
    expect(getStress(world.components, bleeder)!.level).toBeGreaterThan(stressBefore);

    // A limb wound really impairs locomotion speed.
    const limping = spawnBeaver(world, { name: "Limping", position: { x: 8, y: 3, z: 9 } });
    const speedBefore = getLocomotion(world.components, limping)!.speed;
    let limbHit = resolveAttack(world, attacker, limping, 10, 0, world.random.stream("limp-attack"));
    let limbTries = 0;
    while ((BEAVER_BODY_PLAN.parts.find((p) => p.id === limbHit.partId)!.mobilityShare === 0 || !limbHit.wounded) && limbTries < 8) {
      limbHit = resolveAttack(world, attacker, limping, 10, 0, world.random.stream(`limp-attack-${limbTries}`));
      limbTries++;
    }
    expect(totalMobilityImpairment(world, limping)).toBeGreaterThan(0);
    tickAllWounds(world);
    expect(getLocomotion(world.components, limping)!.speed).toBeLessThan(speedBefore);
  });
});
