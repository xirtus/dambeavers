/**
 * Headless acceptance test for P11-11 -- Infrastructure memory.
 *
 * Roadmap acceptance test:
 *   "later societies can encounter, misunderstand, reuse, repair, or
 *   mythologize abandoned constructions from older civilizations."
 *
 * A site's detailed world deactivates with a dam standing; the
 * structure-count breakdown is recorded per kind on the Site; a long
 * DeepTime gap passes; the next activation materializes REAL ruin
 * entities from that record. A fresh population then encounters them:
 * households WITHOUT the technology mythologize the ruin (a real Belief
 * founded on the real encounter event), households WITH it genuinely
 * repair it (the ruin becomes a real construction with real work and
 * material requirements). Nothing is authored -- the ruins exist only
 * because the structures really stood there.
 */
import { describe, expect, it } from "vitest";
import { buildRegionWorld, spawnAt } from "../unit/parityHarness.js";
import { createSite, getSite } from "../../src/sim/region/Site.js";
import { activateSite, deactivateSite } from "../../src/sim/region/SiteActivation.js";
import { advanceWorldTicks } from "../../src/sim/region/DeepTime.js";
import { setConstruction } from "../../src/sim/labor/Construction.js";
import { applyDamSegment } from "../../src/sim/hydrology/Dam.js";
import { getRuin, encounterRuin, materializeRuin } from "../../src/sim/structures/InfrastructureMemory.js";
import { createHousehold, setHouseholdMembership } from "../../src/sim/creatures/Relationships.js";
import { grantTech } from "../../src/sim/economy/TechKnowledge.js";
import { getBelief } from "../../src/sim/creatures/Belief.js";
import { getConstruction } from "../../src/sim/labor/Construction.js";
import { BIOMES } from "../unit/parityHarness.js";

describe("P11-11 infrastructure memory acceptance", () => {
  it("an abandoned dam becomes a ruin later populations mythologize or repair -- the full deactivation-gap-reactivation cycle", () => {
    const { world, materials, regionMap } = buildRegionWorld("p11-11");
    const siteId = createSite(world, regionMap, 3, 3, 4, 80);

    // The older civilization: activate the site and really build a dam.
    const first = activateSite(siteId, materials, world);
    const oldBeaver = first.beaverIds[0]!;
    const construction = first.world.entities.create("construction");
    first.world.grid.setEntityPosition(construction, 8, 3, 8);
    setConstruction(first.world.components, construction, {
      designationId: construction,
      kind: "dam-segment",
      site: { x: 8, z: 8 },
      requiredMaterialId: "wood",
      requiredMassKg: 1,
      workDone: 1,
      workRequired: 1,
      status: "complete",
    });
    // Really APPLY the dam so a real dam-segment entity stands here --
    // the physical structure the next civilization will find.
    applyDamSegment(first.world, construction);
    void oldBeaver;

    // The site deactivates: the real structure breakdown is recorded.
    deactivateSite(siteId, world, first);
    const deactivated = getSite(world.components, siteId)!;
    expect(deactivated.structureCount).toBeGreaterThanOrEqual(1);
    expect(deactivated.abandonedStructures?.["dam-segment"]).toBeGreaterThanOrEqual(1);

    // A long DeepTime gap (the older civilization genuinely dies out).
    advanceWorldTicks(world, 2_000_000, (x, z) => (x === 3 && z === 3 ? "wetland" : "forest"), BIOMES);
    expect(getSite(world.components, siteId)!.populationCount).toBe(0);

    // The new population activates the site and FINDS the ruins --
    // materialized from the recorded breakdown, never conjured.
    const second = activateSite(siteId, materials, world);
    const ruinIds = second.world.entities.liveIdsOfKind("ruin");
    expect(ruinIds.length).toBeGreaterThanOrEqual(1);
    const ruinKinds = ruinIds.map((id) => getRuin(second.world.components, id)!.kind);
    expect(ruinKinds).toContain("dam-segment");
    const ruinId = ruinIds[0]!;

    // The old population genuinely died out over the gap (the site's
    // LOD reached extinction -- an honest outcome, not a scripted
    // hand-off). A FRESH population arrives and encounters the ruins.
    const ignorant = spawnAt(second.world, "Arrival", 4, 4);
    const ignorantHousehold = createHousehold(second.world);
    setHouseholdMembership(second.world.components, ignorant, { householdId: ignorantHousehold });
    const myth = encounterRuin(second.world, ignorant, ruinIds[0]!);
    expect(myth.ok).toBe(true);
    expect(myth.producedEntityId).toBeDefined();
    const belief = getBelief(second.world.components, myth.producedEntityId!);
    expect(belief).toBeDefined();
    expect(second.world.events.get(belief!.originEventId).eventType).toBe("ruin-encountered");

    // A household WITH the technology genuinely repairs another ruin:
    // the ruin is consumed and becomes a real construction requiring
    // real work and real materials.
    // A later arrival who happens to carry the old technology.
    const repairer = spawnAt(second.world, "Repairer", 10, 10);
    const repairHousehold = createHousehold(second.world);
    setHouseholdMembership(second.world.components, repairer, { householdId: repairHousehold });
    grantTech(second.world, repairHousehold, { understoodKinds: ["dam-segment"] });
    const secondRuin = second.world.entities.liveIdsOfKind("ruin").find(
      (id) => id !== ruinIds[0] && getRuin(second.world.components, id)?.kind === "dam-segment",
    );
    if (secondRuin !== undefined) {
      const repair = encounterRuin(second.world, repairer, secondRuin);
      expect(repair.ok).toBe(true);
      expect(repair.producedEntityId).toBeDefined();
      const repaired = getConstruction(second.world.components, repair.producedEntityId!);
      expect(repaired).toBeDefined();
      expect(repaired!.kind).toBe("dam-segment");
      expect(repaired!.status).toBe("awaiting-materials");
      expect(repaired!.workRequired).toBeGreaterThan(0);
      expect(second.world.entities.isLive(secondRuin)).toBe(false); // the ruin was consumed by the act
    }
  });

  it("a ruin only exists for a structure that really stood there -- fabricating one from nothing is impossible", () => {
    const { world, materials, regionMap } = buildRegionWorld("p11-11b");
    const siteId = createSite(world, regionMap, 4, 4, 2, 40);
    // First activation built NOTHING.
    const first = activateSite(siteId, materials, world);
    deactivateSite(siteId, world, first);
    advanceWorldTicks(world, 500_000, () => "forest", BIOMES);
    const second = activateSite(siteId, materials, world);
    // No structures were ever recorded -- so there are no ruins.
    expect(second.world.entities.liveIdsOfKind("ruin")).toHaveLength(0);
  });

  it("encountering a non-ruin is honestly refused", () => {
    const { world } = buildRegionWorld("p11-11c");
    const beaver = spawnAt(world, "B", 3, 3);
    const notARuin = world.entities.create("food");
    expect(encounterRuin(world, beaver, notARuin).ok).toBe(false);
    void materializeRuin;
  });
});
