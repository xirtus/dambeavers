/**
 * Headless acceptance test for P11-14 -- Multi-scale continuous simulation.
 *
 * Roadmap acceptance test:
 *   "local detailed simulation and world abstraction transition without
 *   duplicating or losing important entities/events."
 *
 * The site's detailed world is PERSISTED at deactivation and RESTORED
 * at the next activation: the same named individual is the SAME entity
 * (same id), their event history continues seamlessly (no duplicate
 * entities, no duplicated or lost events at the seam), and the summary
 * is re-derived from the restored live state so both scales agree.
 * First activation still reconstructs from the summary (there is no
 * prior detailed state to preserve) -- the two honest paths, never a
 * fresh replacement of named individuals.
 */
import { describe, expect, it } from "vitest";
import { buildRegionWorld } from "../unit/parityHarness.js";
import { createSite, getSite } from "../../src/sim/region/Site.js";
import { activateSite, deactivateSite } from "../../src/sim/region/SiteActivation.js";
import { advanceWorldTicks } from "../../src/sim/region/DeepTime.js";
import { nameOf } from "../../src/sim/creatures/Naming.js";
import { BIOMES } from "../unit/parityHarness.js";

describe("P11-14 multi-scale continuity acceptance", () => {
  it("a named individual survives the deactivate-reactivate cycle as the SAME entity with continuous history", () => {
    const { world, materials, regionMap } = buildRegionWorld("p11-14");
    const siteId = createSite(world, regionMap, 2, 2, 3, 60);

    const first = activateSite(siteId, materials, world);
    // The individual: a real named beaver in the detailed world.
    const individualId = first.beaverIds[0]!;
    const individualName = nameOf(first.world, individualId)!;
    expect(individualName).toBeDefined();

    // Real history happens to them in the detailed world.
    const deedEventId = first.world.events.record({
      tick: first.world.clock.tick,
      eventType: "leader-appointed",
      subjectIds: [individualId],
      objectIds: [],
      location: first.world.grid.positionOf(individualId) ?? { x: 0, y: 0, z: 0 },
    });

    deactivateSite(siteId, world, first);
    const deactivated = getSite(world.components, siteId)!;
    expect(deactivated.active).toBe(false);
    expect(deactivated.persistedWorld).toBeDefined();

    // A short offscreen gap (the region's clock moves on).
    advanceWorldTicks(world, 2_000, () => "forest", BIOMES);

    const second = activateSite(siteId, materials, world);
    // THE SAME entity -- same id, same name, no duplicate spawned.
    expect(second.beaverIds).toContain(individualId);
    expect(second.beaverIds.length).toBe(deactivated.populationCount);
    expect(nameOf(second.world, individualId)).toBe(individualName);
    // Continuous history: their recorded deed is still there, and the
    // event log continues with the same id sequence (no duplication or
    // loss at the seam).
    expect(second.world.events.get(deedEventId).eventType).toBe("leader-appointed");
    const eventIds = second.world.events.all().map((e) => e.id);
    expect(new Set(eventIds).size).toBe(eventIds.length); // no duplicates

    // More history AFTER reactivation lands on the SAME entity.
    const postEventId = second.world.events.record({
      tick: second.world.clock.tick,
      eventType: "social-interaction",
      subjectIds: [individualId],
      objectIds: [],
      location: second.world.grid.positionOf(individualId) ?? { x: 0, y: 0, z: 0 },
    });
    expect(second.world.events.get(postEventId).subjectIds).toContain(individualId);

    // And the next deactivation persists the CONTINUED history -- a
    // third activation would still find the same individual with both
    // deeds.
    deactivateSite(siteId, world, second);
    const third = activateSite(siteId, materials, world);
    expect(third.beaverIds).toContain(individualId);
    expect(third.world.events.get(deedEventId).eventType).toBe("leader-appointed");
    expect(third.world.events.get(postEventId).subjectIds).toContain(individualId);
  });

  it("first activation still reconstructs from the summary (there is no prior detailed state)", () => {
    const { world, materials, regionMap } = buildRegionWorld("p11-14b");
    const siteId = createSite(world, regionMap, 5, 5, 5, 100);
    const activated = activateSite(siteId, materials, world);
    // Exactly the summary's population, real fresh entities.
    expect(activated.beaverIds.length).toBe(5);
    expect(getSite(world.components, siteId)!.persistedWorld).toBeUndefined();
  });

  it("the summary is re-derived from the restored live state -- both scales agree", () => {
    const { world, materials, regionMap } = buildRegionWorld("p11-14c");
    const siteId = createSite(world, regionMap, 6, 6, 3, 60);
    const first = activateSite(siteId, materials, world);
    // A real change in the detailed world: an extra food item.
    const extraFood = first.world.entities.create("food");
    first.world.grid.setEntityPosition(extraFood, 5, 3, 5);
    deactivateSite(siteId, world, first);

    // The LOD advanced the summary over the gap; reactivation restores
    // the detailed world and re-derives the summary FROM IT -- the two
    // scales agree on the restored world's own state.
    advanceWorldTicks(world, 3_000, () => "forest", BIOMES);
    const second = activateSite(siteId, materials, world);
    const siteAfter = getSite(world.components, siteId)!;
    expect(siteAfter.populationCount).toBe(second.world.entities.liveIdsOfKind("beaver").length);
    // The extra food item is still there (same entity).
    expect(second.world.entities.isLive(extraFood)).toBe(true);
  });
});
