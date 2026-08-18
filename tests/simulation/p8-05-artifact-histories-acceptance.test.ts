/**
 * Headless acceptance test for P8-05 -- Artifact histories.
 *
 * Roadmap acceptance test: "an old object can show maker, owners,
 * locations, use in events, theft, loss, recovery, and current state."
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
import { Weather } from "../../src/sim/weather/Weather.js";
import type { World } from "../../src/sim/persistence/WorldSnapshot.js";
import { snapshotWorld, restoreWorld } from "../../src/sim/persistence/WorldSnapshot.js";
import { ALL_COMPONENT_TYPES } from "../../src/sim/persistence/AllComponentTypes.js";
import { RegionMap } from "../../src/sim/region/RegionMap.js";
import { createSite } from "../../src/sim/region/Site.js";
import { spawnBeaver } from "../../src/sim/creatures/Beaver.js";
import { setGood } from "../../src/sim/economy/Good.js";
import { setOwner } from "../../src/sim/creatures/Ownership.js";
import { bequeathEstate } from "../../src/sim/creatures/Ownership.js";
import { pickUp, drop } from "../../src/sim/labor/Log.js";
import { die } from "../../src/sim/creatures/Mortality.js";
import { createArtwork } from "../../src/sim/creatures/Art.js";
import { RecipeRegistry, registerStandardRecipes } from "../../src/sim/economy/Recipe.js";
import { barterExchange } from "../../src/sim/politics/Market.js";
import { fileAccusation, renderJudgment, applyPunishment } from "../../src/sim/politics/Justice.js";
import { isProhibited } from "../../src/sim/creatures/Law.js";
import { artifactHistory, artifactOwnerChain, describeArtifact } from "../../src/sim/chronicle/ArtifactHistories.js";

function buildWorld(): { world: World; materials: MaterialRegistry; recipes: RecipeRegistry; regionMap: RegionMap } {
  const entities = new EntityIdRegistry();
  const components = new ComponentStore(entities);
  const grid = new WorldGrid({ sizeX: 20, sizeY: 10, sizeZ: 20 }, entities);
  const materials = new MaterialRegistry();
  registerStandardMaterials(materials);
  const recipes = new RecipeRegistry();
  registerStandardRecipes(recipes);
  const terrain = new TerrainField(grid, materials);
  for (let x = 0; x < 20; x++) for (let z = 0; z < 20; z++) for (let y = 0; y <= 2; y++) terrain.setMaterial(x, y, z, "soil");
  const water = new WaterField(grid);
  const weather = new Weather();
  const clock = new SimulationClock({ tickRateHz: 20 });
  const random = new RandomStreams(805);
  const events = new EventLog(entities);
  return {
    world: { clock, random, entities, components, grid, terrain, events, water, weather },
    materials,
    recipes,
    regionMap: new RegionMap(16, 16),
  };
}

describe("P8-05 -- Artifact histories", () => {
  it("an old object shows maker, owners, locations, use in events, theft, loss, recovery, and current state", () => {
    const { world, materials, recipes, regionMap } = buildWorld();
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) regionMap.setElevation(x, z, 0);

    // Real actors.
    const siteX = createSite(world, regionMap, 2, 2, 10, 100);
    const siteY = createSite(world, regionMap, 10, 10, 10, 100);
    const maker = spawnBeaver(world, { name: "Maker", position: { x: 4, y: 3, z: 4 } });
    const alder = spawnBeaver(world, { name: "Alder", position: { x: 5, y: 3, z: 5 } });
    const thief = spawnBeaver(world, { name: "Thief", position: { x: 8, y: 3, z: 8 } });
    const accuser = spawnBeaver(world, { name: "Accuser", position: { x: 7, y: 3, z: 7 } });

    // 1. Made by a real maker, depicting a real person.
    const artwork = createArtwork(world, materials, recipes.get("carve-trinket")!, 4, { kind: "beaver", id: maker }, maker, { x: 6, y: 3, z: 6 });
    world.clock.advanceTicks(5);

    // 2. Held institutionally by siteX, then genuinely bartered to siteY.
    setOwner(world.components, artwork, { ownerType: "institutional", ownerId: siteX });
    const plank = world.entities.create("good");
    world.grid.setEntityPosition(plank, 12, 3, 12);
    setGood(world.components, plank, { goodKind: "plank", materialId: "wood", massKg: 5, makerId: maker });
    setOwner(world.components, plank, { ownerType: "institutional", ownerId: siteY });
    world.clock.advanceTicks(5);
    expect(barterExchange(world, artwork, plank, siteX, siteY, 6, 6)).toBe(true);

    // 3. Passes into Alder's personal possession.
    world.clock.advanceTicks(5);
    setOwner(world.components, artwork, { ownerType: "personal", ownerId: alder });

    // 4. Alder dies with no heir -- the estate's goods fall to the community (a real loss).
    world.clock.advanceTicks(5);
    die(world, alder, "starvation");
    const bequeathed = bequeathEstate(world, alder);
    expect(bequeathed).toContain(artwork);

    // 5. The thief picks it up (a real recovery after the loss).
    world.clock.advanceTicks(5);
    pickUp(world.components, world.grid, artwork, thief, world);

    // 6. The thief claims it, and the theft is really recorded and prosecuted.
    setOwner(world.components, artwork, { ownerType: "personal", ownerId: thief });
    const violation = isProhibited(world, thief, artwork) ?? { action: "theft" as const, actorId: thief, itemId: artwork };
    world.clock.advanceTicks(5);
    // fileAccusation itself records the witnessed violation (the item is
    // named as the violation's object) and validates real evidence.
    const accusationId = fileAccusation(world, accuser, violation, [accuser]);
    renderJudgment(world, accusationId, accuser);
    applyPunishment(world, regionMap, accusationId, "fine", siteX);

    // 7. The confiscated item is physically set down.
    world.clock.advanceTicks(5);
    drop(world.components, world.grid, artwork, { x: 8, z: 8 }, world);

    const history = artifactHistory(world, artwork);

    // Maker.
    expect(history.known).toBe(true);
    expect(history.maker).toBe(maker);
    expect(history.good?.goodKind).toBe("artwork");
    expect(history.depiction?.id).toBe(maker);

    // Owners: the RECORDED chain, oldest first (direct setOwner
    // assignments are live state, not history -- the recorded transfers
    // are the barter, the bequeath, and the confiscation).
    const chain = artifactOwnerChain(world, artwork);
    expect(chain.length).toBe(4); // siteX, siteY, communal, siteX
    expect(chain[0]!.owner).toEqual({ ownerType: "institutional", ownerId: siteX });
    expect(chain[1]!.owner).toEqual({ ownerType: "institutional", ownerId: siteY });
    expect(chain[2]!.owner).toEqual({ ownerType: "communal" });
    expect(chain[3]!.owner).toEqual({ ownerType: "institutional", ownerId: siteX });
    // Chain continuity: each transfer's previous owner is the prior entry's owner.
    for (const entry of history.ownership) {
      expect(entry.previousOwner).toBeDefined();
      expect(entry.newOwner).toBeDefined();
    }
    expect(history.ownership.length).toBe(3); // barter, bequeath, confiscation

    // Locations: real recorded moves.
    expect(history.locations.length).toBe(2); // pickup by thief, drop after confiscation
    expect(history.locations[0]!.from).toEqual({ kind: "cell", x: 6, y: 3, z: 6 });
    expect(history.locations[0]!.to).toEqual({ kind: "carried-by", by: thief });

    // Use in events: the barter and the violation name the item.
    const useTypes = history.uses.map((e) => e.eventType);
    expect(useTypes).toContain("barter-exchange");
    expect(useTypes).toContain("rule-violated");

    // Theft.
    expect(history.thefts.length).toBe(1);
    expect(history.thefts[0]!.eventType).toBe("rule-violated");

    // Loss: the owner died without an heir.
    expect(history.losses.length).toBe(1);
    expect(history.losses[0]!.description).toContain("without an heir");

    // Recovery: picked up again after the loss.
    expect(history.recoveries.length).toBe(1);
    expect(history.recoveries[0]!.description).toContain("Picked up again");

    // Current state.
    expect(history.current.owner).toEqual({ ownerType: "institutional", ownerId: siteX });
    expect(history.current.position).toEqual({ x: 8, y: 3, z: 8 });

    // The one-line description mentions every section.
    const description = describeArtifact(world, artwork);
    expect(description).toContain("made by");
    expect(description).toContain("theft");
    expect(description).toContain("loss");
    expect(description).toContain("recovery");
  });

  it("artifact histories survive save/reload", () => {
    const { world, materials, recipes, regionMap } = buildWorld();
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) regionMap.setElevation(x, z, 0);
    const siteX = createSite(world, regionMap, 2, 2, 10, 100);
    const siteY = createSite(world, regionMap, 10, 10, 10, 100);
    const maker = spawnBeaver(world, { name: "Maker", position: { x: 4, y: 3, z: 4 } });
    const artwork = createArtwork(world, materials, recipes.get("carve-trinket")!, 4, { kind: "beaver", id: maker }, maker, { x: 6, y: 3, z: 6 });
    world.clock.advanceTicks(5);
    setOwner(world.components, artwork, { ownerType: "institutional", ownerId: siteX });
    const plank = world.entities.create("good");
    world.grid.setEntityPosition(plank, 12, 3, 12);
    setGood(world.components, plank, { goodKind: "plank", materialId: "wood", massKg: 5 });
    setOwner(world.components, plank, { ownerType: "institutional", ownerId: siteY });
    barterExchange(world, artwork, plank, siteX, siteY, 6, 6);

    const before = artifactHistory(world, artwork);
    const restored = restoreWorld(snapshotWorld(world), { componentTypes: ALL_COMPONENT_TYPES, materials });
    expect(artifactHistory(restored, artwork)).toEqual(before);
    expect(artifactOwnerChain(restored, artwork)).toEqual(artifactOwnerChain(world, artwork));
    expect(describeArtifact(restored, artwork)).toBe(describeArtifact(world, artwork));
  });
});
