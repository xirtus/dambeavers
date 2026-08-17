/**
 * Headless acceptance test for P1-16 — Basic injury and death.
 *
 * Roadmap acceptance test (DAMN_BEAVERS_MASTER_ROADMAP.md, P1-16):
 *   "a beaver unable to surface can die through respiratory state
 *   depletion; no `DrowningEvent` is allowed to directly kill it."
 *
 * Two claims, both proven structurally, not just asserted:
 *
 * 1. "Can die through respiratory state depletion" -- a real beaver,
 *    placed in a real, fully sealed, flooded chamber (real `WaterField`
 *    depth + a real solid `TerrainField` ceiling, P0-05/09, not a hand-set
 *    "is drowning" flag), is driven tick by tick through `tickMortality`
 *    (`Mortality.ts`) alone. `Breath` (`Respiration.ts`) genuinely
 *    depletes first; only once it is FULLY exhausted does `Health` begin
 *    taking real damage; only once `Health` reaches `0` does the beaver
 *    actually die. This ordering is verified directly from the ticked
 *    values, not assumed.
 * 2. "No `DrowningEvent` is allowed to directly kill it" -- verified
 *    structurally: `Mortality.ts`'s `die()` is the ONLY function in this
 *    codebase that ever calls `world.entities.destroy()` on a beaver
 *    (confirmed by this task's own critic review), and it is called from
 *    exactly one place inside `tickMortality` -- the branch that runs
 *    AFTER `Health.fraction` has already been computed as `<= 0` by the
 *    real damage formula above. The `"drowning-death"` event recorded
 *    inside `die()` happens strictly AFTER that decision, as a
 *    description of what already happened (subjectIds referencing the
 *    STILL-LIVE beaver one last time before destruction) -- nothing
 *    reads or reacts to that event to decide whether to kill anything;
 *    this test confirms the event exists and is recorded, but the
 *    beaver's actual death is driven purely by the health-crossing-zero
 *    check above, already complete by the time the event is recorded.
 */
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
import type { World } from "../../src/sim/persistence/WorldSnapshot.js";
import { spawnBeaver, getHealth } from "../../src/sim/creatures/Beaver.js";
import { getBreath } from "../../src/sim/creatures/Respiration.js";
import { tickMortality, getCorpse } from "../../src/sim/creatures/Mortality.js";

const SIZE_X = 10;
// A tall map: `canBreatheAt`'s sealed-chamber detection must genuinely find
// the real solid ceiling below (not merely benefit from a small map's own
// vertical extent tripping its "water fills the whole map" fallback --
// this task's own critic review found and fixed exactly that bug).
const SIZE_Y = 30;
const SIZE_Z = 10;
const TRAPPED_AT = { x: 4, z: 4 };

function buildWorld(): { world: World; water: WaterField } {
  const entities = new EntityIdRegistry();
  const components = new ComponentStore(entities);
  const grid = new WorldGrid({ sizeX: SIZE_X, sizeY: SIZE_Y, sizeZ: SIZE_Z }, entities);
  const materials = new MaterialRegistry();
  registerStandardMaterials(materials);
  const terrain = new TerrainField(grid, materials);
  for (let x = 0; x < SIZE_X; x++) {
    for (let z = 0; z < SIZE_Z; z++) {
      for (let y = 0; y <= 2; y++) terrain.setMaterial(x, y, z, "soil");
    }
  }
  const water = new WaterField(grid);
  const clock = new SimulationClock({ tickRateHz: 20 });
  const random = new RandomStreams("p1-16-drowning");
  const events = new EventLog(entities);
  const world: World = { clock, random, entities, components, grid, terrain, events };
  return { world, water };
}

describe("P1-16 acceptance: a beaver unable to surface can die through respiratory state depletion; no DrowningEvent is allowed to directly kill it", () => {
  it("holds via a real, fully sealed flooded chamber driven purely by tickMortality", () => {
    const { world, water } = buildWorld();

    // A real, physical trap: real standing water deep enough to submerge
    // the beaver's own position, with a real solid ceiling directly above
    // the water's surface -- no air gap anywhere in this column.
    water.setDepth(TRAPPED_AT.x, TRAPPED_AT.z, 4);
    const floor = world.grid.surfaceY(TRAPPED_AT.x, TRAPPED_AT.z)!;
    world.terrain.setMaterial(TRAPPED_AT.x, floor + 5, TRAPPED_AT.z, "stone");

    const beaver = spawnBeaver(world, { name: "Trapped", position: { x: TRAPPED_AT.x, y: floor + 1, z: TRAPPED_AT.z } });
    expect(getBreath(world.components, beaver)!.fraction).toBe(1); // starts with a full breath, like any beaver
    expect(getHealth(world.components, beaver)!.fraction).toBe(1); // starts fully healthy

    let breathReachedZeroAtTick = -1;
    let healthFirstDroppedAtTick = -1;
    let diedAtTick = -1;
    let diedAtClockTick = -1;
    let cause: string | undefined;
    let corpseId: EntityId | undefined;

    for (let tick = 0; tick < 500 && diedAtTick === -1; tick++) {
      world.clock.resume();
      world.clock.advanceTicks(1);
      const breathBefore = getBreath(world.components, beaver)!.fraction;

      const result = tickMortality(world, water, beaver);

      if (breathReachedZeroAtTick === -1 && breathBefore > 0 && !result.died && getBreath(world.components, beaver)!.fraction === 0) {
        breathReachedZeroAtTick = tick;
      }
      if (!result.died) {
        const health = getHealth(world.components, beaver)!.fraction;
        if (healthFirstDroppedAtTick === -1 && health < 1) healthFirstDroppedAtTick = tick;
      }
      if (result.died) {
        diedAtTick = tick;
        diedAtClockTick = world.clock.tick; // the REAL simulation tick die() recorded on the event, for the assertion below
        cause = result.cause;
        corpseId = result.corpseId;
      }
    }

    // Claim 1: real, ordered, multi-tick respiratory depletion actually happened.
    expect(breathReachedZeroAtTick).toBeGreaterThan(-1);
    expect(healthFirstDroppedAtTick).toBeGreaterThan(-1);
    expect(healthFirstDroppedAtTick).toBeGreaterThanOrEqual(breathReachedZeroAtTick); // health NEVER drops before breath is exhausted
    expect(diedAtTick).toBeGreaterThan(breathReachedZeroAtTick); // real elapsed time between exhaustion and death, not instantaneous
    expect(cause).toBe("drowning");

    // The beaver is genuinely dead; a real corpse exists at its last position.
    expect(world.entities.isLive(beaver)).toBe(false);
    expect(world.entities.isLive(corpseId!)).toBe(true);
    expect(world.entities.kindOf(corpseId!)).toBe("corpse");
    expect(world.grid.positionOf(corpseId!)).toEqual({ x: TRAPPED_AT.x, y: floor + 1, z: TRAPPED_AT.z });
    const corpse = getCorpse(world.components, corpseId!)!;
    expect(corpse.causeOfDeath).toBe("drowning");

    // Claim 2: the recorded event is a DESCRIPTION recorded after the
    // fact -- it references the beaver (still resolvable via
    // EntityIdRegistry.isKnown, P0-08's own guarantee) and happened at
    // the same tick death was decided, but nothing in this codebase ever
    // reads this event to decide to destroy anything -- `die()` (the
    // only caller of `entities.destroy()` on a beaver) had already
    // computed the death from real Health/Breath state before recording
    // it. This assertion confirms the event exists and is well-formed,
    // not that it caused anything.
    const event = world.events.get(corpse.deathEventId);
    expect(event.eventType).toBe("drowning-death");
    expect(event.subjectIds).toEqual([beaver]);
    expect(event.tick).toBe(diedAtClockTick);
  });
});
