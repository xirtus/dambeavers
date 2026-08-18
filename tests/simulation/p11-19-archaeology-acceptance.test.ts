/**
 * Headless acceptance test for P11-19 -- Millennia-scale archaeology.
 *
 * Roadmap acceptance test:
 *   "artifacts, ruins, sediment, burials, and altered landscapes can
 *   preserve partial evidence after original records/knowledge
 *   disappear."
 *
 * Knowledge loss is structural: a belief/technology held only by an
 * extinct household lineage has NO holder once the lineage dies out
 * (the heldBy...Ids shapes -- nothing re-grants it). What survives is
 * physical: ruins, artifacts, recorded watershed spans. A new
 * population excavates that evidence and gets a PARTIAL reconstruction
 * -- every step citing a real discovered event, and the gaps stated
 * honestly rather than fabricated away.
 */
import { describe, expect, it } from "vitest";
import { buildDetailedWorld, spawnAt } from "../unit/parityHarness.js";
import { createHousehold, setHouseholdMembership } from "../../src/sim/creatures/Relationships.js";
import { formBelief, getBelief } from "../../src/sim/creatures/Belief.js";
import { grantTech, techKnowledgeOf, knowsRecipe } from "../../src/sim/economy/TechKnowledge.js";
import { materializeRuin } from "../../src/sim/structures/InfrastructureMemory.js";
import { setGood } from "../../src/sim/economy/Good.js";
import { excavateSite, reconstructHistory } from "../../src/sim/chronicle/Archaeology.js";
import { createSite } from "../../src/sim/region/Site.js";
import { buildRegionWorld } from "../unit/parityHarness.js";

describe("P11-19 archaeology acceptance", () => {
  it("after every original holder dies out, knowledge is lost and only partial reconstruction from physical evidence remains", () => {
    const { world } = buildDetailedWorld("p11-19");
    // The original civilization: one household holding a belief and a
    // technology, plus physical remains (a ruin, an artifact, and
    // recorded events).
    const founder = spawnAt(world, "Elder", 3, 3);
    const lineage = createHousehold(world);
    setHouseholdMembership(world.components, founder, { householdId: lineage });
    const originEventId = world.events.record({
      tick: world.clock.tick,
      eventType: "world-disaster",
      subjectIds: [founder],
      objectIds: [],
      location: { x: 3, y: 3, z: 3 },
    });
    const beliefId = formBelief(world, originEventId, lineage);
    grantTech(world, lineage, { recipeIds: ["saw-planks"], understoodKinds: ["dam-segment"] });
    const ruinId = materializeRuin(world, "dam-segment", { x: 6, y: 3, z: 6 });
    const artifactId = world.entities.create("good");
    world.grid.setEntityPosition(artifactId, 6, 3, 5);
    setGood(world.components, artifactId, { goodKind: "trade-good", materialId: "wood", massKg: 1 });
    // A second recorded event the physical evidence does NOT reference.
    world.events.record({
      tick: world.clock.tick,
      eventType: "social-interaction",
      subjectIds: [founder],
      objectIds: [],
      location: { x: 3, y: 3, z: 3 },
    });

    // The lineage dies out: the knowledge it alone held has no holder.
    world.entities.destroy(lineage);
    world.entities.destroy(founder);
    const belief = getBelief(world.components, beliefId)!;
    // Knowledge loss is by LIVENESS, not list rewriting: the holder
    // list still names the dead lineage, but no living household holds
    // it anymore -- and nothing re-grants it.
    expect(belief.heldByHouseholdIds.every((id) => !world.entities.isLive(id))).toBe(true);
    // The later population genuinely does NOT inherit the knowledge --
    // nothing re-grants it to anyone new.
    const laterBeaver = spawnAt(world, "Later", 8, 8);
    const laterHousehold = createHousehold(world);
    setHouseholdMembership(world.components, laterBeaver, { householdId: laterHousehold });
    expect(techKnowledgeOf(world, laterHousehold)).toHaveLength(0);
    expect(knowsRecipe(world, laterHousehold, "saw-planks")).toBe(false);

    // The physical evidence survives. A later population excavates.
    const siteId = createSite(world, buildRegionWorld("p11-19-site").regionMap, 1, 1, 1, 10);
    const discovery = excavateSite(world, siteId);
    expect(discovery.ruinIds).toContain(ruinId);
    expect(discovery.artifactIds).toContain(artifactId);
    expect(discovery.evidenceEventIds.length).toBeGreaterThanOrEqual(1);

    // Partial reconstruction: real cited steps, honest gaps.
    const reconstruction = reconstructHistory(world, discovery);
    expect(reconstruction.steps.length).toBeGreaterThanOrEqual(3);
    for (const step of reconstruction.steps) {
      if (step.eventId !== undefined) {
        expect(world.events.get(step.eventId).eventType).toBeDefined();
      }
    }
    // The unreferenced event is acknowledged as a gap -- never narrated
    // as if the evidence covered it.
    expect(reconstruction.acknowledgedGaps.length).toBeGreaterThanOrEqual(1);
    expect(reconstruction.steps.some((step) => step.description.includes("evidence ends here"))).toBe(true);
  });

  it("excavating a site with no physical evidence recovers honestly: no fabrication", () => {
    const { world } = buildDetailedWorld("p11-19b");
    const { regionMap } = buildRegionWorld("p11-19b-region");
    const siteId = createSite(world, regionMap, 2, 2, 1, 10);
    const discovery = excavateSite(world, siteId);
    const reconstruction = reconstructHistory(world, discovery);
    for (const step of reconstruction.steps) {
      if (step.eventId !== undefined) {
        expect(world.events.get(step.eventId).eventType).toBeDefined();
      }
    }
  });
});
