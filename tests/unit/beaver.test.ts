import { describe, expect, it } from "vitest";
import { EntityIdRegistry, type EntityId } from "../../src/sim/core/EntityId.js";
import { ComponentStore, type ComponentType } from "../../src/sim/core/ComponentStore.js";
import { SimulationClock } from "../../src/sim/core/SimulationClock.js";
import { RandomStreams } from "../../src/sim/core/Random.js";
import { WorldGrid } from "../../src/sim/world/WorldGrid.js";
import { TerrainField } from "../../src/sim/world/TerrainField.js";
import { EventLog } from "../../src/sim/history/EventLog.js";
import { MaterialRegistry } from "../../src/sim/materials/Material.js";
import { registerStandardMaterials } from "../../src/sim/materials/standardMaterials.js";
import type { World } from "../../src/sim/persistence/WorldSnapshot.js";
import {
  IdentityComponent,
  CreatureBodyComponent,
  LocomotionComponent,
  SwimmerComponent,
  InventoryComponent,
  SkillsComponent,
  HealthComponent,
  setIdentity,
  getIdentity,
  setCreatureBody,
  getCreatureBody,
  setLocomotion,
  getLocomotion,
  setSwimmer,
  getSwimmer,
  setInventory,
  getInventory,
  setSkills,
  getSkills,
  setHealth,
  getHealth,
  spawnBeaver,
  spawnSevenStartingBeavers,
  STARTER_BEAVER_NAMES,
  DEFAULT_BEAVER_MASS_KG,
  DEFAULT_BEAVER_SPEED,
  DEFAULT_BEAVER_MAX_WADING_DEPTH,
} from "../../src/sim/creatures/Beaver.js";
import { NeedsComponent, getNeeds, BASELINE_NEEDS } from "../../src/sim/creatures/Needs.js";
import { NeedFocusComponent } from "../../src/sim/creatures/BeaverNeeds.js";

function buildWorld(seed: number | string = 1): World {
  const entities = new EntityIdRegistry();
  const components = new ComponentStore(entities);
  const grid = new WorldGrid({ sizeX: 8, sizeY: 8, sizeZ: 8 }, entities);
  const materials = new MaterialRegistry();
  registerStandardMaterials(materials);
  const terrain = new TerrainField(grid, materials);
  for (let x = 0; x < 8; x++) {
    for (let z = 0; z < 8; z++) {
      for (let y = 0; y <= 2; y++) terrain.setMaterial(x, y, z, "soil");
    }
  }
  const clock = new SimulationClock({ tickRateHz: 20 });
  const random = new RandomStreams(seed);
  const events = new EventLog(entities);
  return { clock, random, entities, components, grid, terrain, events };
}

describe("Identity component", () => {
  it("round-trips a valid name", () => {
    const world = buildWorld();
    const id = world.entities.create("beaver");
    setIdentity(world.components, id, { name: "Bucktooth" });
    expect(getIdentity(world.components, id)).toEqual({ name: "Bucktooth" });
  });

  it("rejects an empty or whitespace-only name", () => {
    const world = buildWorld();
    const id = world.entities.create("beaver");
    expect(() => setIdentity(world.components, id, { name: "" })).toThrow(RangeError);
    expect(() => setIdentity(world.components, id, { name: "   " })).toThrow(RangeError);
  });

  it("returns undefined for an entity with no Identity", () => {
    const world = buildWorld();
    const id = world.entities.create("beaver");
    expect(getIdentity(world.components, id)).toBeUndefined();
  });
});

describe("CreatureBody component", () => {
  it("round-trips a valid mass", () => {
    const world = buildWorld();
    const id = world.entities.create("beaver");
    setCreatureBody(world.components, id, { massKg: 22 });
    expect(getCreatureBody(world.components, id)).toEqual({ massKg: 22 });
  });

  it("rejects a non-positive or non-finite mass", () => {
    const world = buildWorld();
    const id = world.entities.create("beaver");
    expect(() => setCreatureBody(world.components, id, { massKg: 0 })).toThrow(RangeError);
    expect(() => setCreatureBody(world.components, id, { massKg: -5 })).toThrow(RangeError);
    expect(() => setCreatureBody(world.components, id, { massKg: Infinity })).toThrow(RangeError);
    expect(() => setCreatureBody(world.components, id, { massKg: NaN })).toThrow(RangeError);
  });
});

describe("Locomotion component", () => {
  it("round-trips a valid speed", () => {
    const world = buildWorld();
    const id = world.entities.create("beaver");
    setLocomotion(world.components, id, { speed: 3 });
    expect(getLocomotion(world.components, id)).toEqual({ speed: 3 });
  });

  it("rejects a non-positive or non-finite speed", () => {
    const world = buildWorld();
    const id = world.entities.create("beaver");
    expect(() => setLocomotion(world.components, id, { speed: 0 })).toThrow(RangeError);
    expect(() => setLocomotion(world.components, id, { speed: -1 })).toThrow(RangeError);
    expect(() => setLocomotion(world.components, id, { speed: Infinity })).toThrow(RangeError);
  });
});

describe("Swimmer component", () => {
  it("round-trips valid capability", () => {
    const world = buildWorld();
    const id = world.entities.create("beaver");
    setSwimmer(world.components, id, { canSwim: true, maxWadingDepth: 0.5 });
    expect(getSwimmer(world.components, id)).toEqual({ canSwim: true, maxWadingDepth: 0.5 });
  });

  it("rejects a negative or non-finite maxWadingDepth", () => {
    const world = buildWorld();
    const id = world.entities.create("beaver");
    expect(() => setSwimmer(world.components, id, { canSwim: false, maxWadingDepth: -0.1 })).toThrow(RangeError);
    expect(() => setSwimmer(world.components, id, { canSwim: false, maxWadingDepth: Infinity })).toThrow(RangeError);
  });

  it("accepts maxWadingDepth of exactly 0", () => {
    const world = buildWorld();
    const id = world.entities.create("beaver");
    expect(() => setSwimmer(world.components, id, { canSwim: false, maxWadingDepth: 0 })).not.toThrow();
  });
});

describe("Inventory component", () => {
  it("round-trips an empty inventory", () => {
    const world = buildWorld();
    const id = world.entities.create("beaver");
    setInventory(world.components, id, { itemIds: [] });
    expect(getInventory(world.components, id)).toEqual({ itemIds: [] });
  });

  it("round-trips carried item ids", () => {
    const world = buildWorld();
    const id = world.entities.create("beaver");
    const log = world.entities.create("log");
    setInventory(world.components, id, { itemIds: [log] });
    expect(getInventory(world.components, id)).toEqual({ itemIds: [log] });
  });

  it("rejects duplicate item ids", () => {
    const world = buildWorld();
    const id = world.entities.create("beaver");
    const log = world.entities.create("log");
    expect(() => setInventory(world.components, id, { itemIds: [log, log] })).toThrow(RangeError);
  });

  it("rejects non-positive or non-integer item ids", () => {
    const world = buildWorld();
    const id = world.entities.create("beaver");
    expect(() => setInventory(world.components, id, { itemIds: [0 as never] })).toThrow(RangeError);
    expect(() => setInventory(world.components, id, { itemIds: [1.5 as never] })).toThrow(RangeError);
  });
});

describe("Skills component", () => {
  it("round-trips an empty skill set", () => {
    const world = buildWorld();
    const id = world.entities.create("beaver");
    setSkills(world.components, id, { levels: {} });
    expect(getSkills(world.components, id)).toEqual({ levels: {} });
  });

  it("round-trips named skill levels", () => {
    const world = buildWorld();
    const id = world.entities.create("beaver");
    setSkills(world.components, id, { levels: { woodcutting: 3, swimming: 1 } });
    expect(getSkills(world.components, id)).toEqual({ levels: { woodcutting: 3, swimming: 1 } });
  });

  it("rejects a negative or non-finite skill level", () => {
    const world = buildWorld();
    const id = world.entities.create("beaver");
    expect(() => setSkills(world.components, id, { levels: { woodcutting: -1 } })).toThrow(RangeError);
    expect(() => setSkills(world.components, id, { levels: { woodcutting: Infinity } })).toThrow(RangeError);
  });
});

describe("Health component", () => {
  it("round-trips a valid fraction", () => {
    const world = buildWorld();
    const id = world.entities.create("beaver");
    setHealth(world.components, id, { fraction: 0.75 });
    expect(getHealth(world.components, id)).toEqual({ fraction: 0.75 });
  });

  it("rejects a fraction outside [0, 1]", () => {
    const world = buildWorld();
    const id = world.entities.create("beaver");
    expect(() => setHealth(world.components, id, { fraction: -0.01 })).toThrow(RangeError);
    expect(() => setHealth(world.components, id, { fraction: 1.01 })).toThrow(RangeError);
  });
});

describe("spawnBeaver", () => {
  it("creates a live, positioned, fully-componentized beaver entity", () => {
    const world = buildWorld();
    const id = spawnBeaver(world, { name: "Bucktooth", position: { x: 3, y: 3, z: 3 } });

    expect(world.entities.kindOf(id)).toBe("beaver");
    expect(world.entities.isLive(id)).toBe(true);
    expect(world.grid.positionOf(id)).toEqual({ x: 3, y: 3, z: 3 });
    expect(getIdentity(world.components, id)).toEqual({ name: "Bucktooth" });
    expect(getCreatureBody(world.components, id)).toEqual({ massKg: DEFAULT_BEAVER_MASS_KG });
    expect(getLocomotion(world.components, id)).toEqual({ speed: DEFAULT_BEAVER_SPEED });
    expect(getSwimmer(world.components, id)).toEqual({ canSwim: true, maxWadingDepth: DEFAULT_BEAVER_MAX_WADING_DEPTH });
    expect(getInventory(world.components, id)).toEqual({ itemIds: [] });
    expect(getSkills(world.components, id)).toEqual({ levels: {} });
    expect(getHealth(world.components, id)).toEqual({ fraction: 1 });
    expect(getNeeds(world.components, id)).toEqual(BASELINE_NEEDS);
  });

  it("does NOT attach CurrentTask or Relationships components -- those belong to P1-07/P1-19", () => {
    const world = buildWorld();
    const id = spawnBeaver(world, { name: "Bucktooth", position: { x: 3, y: 3, z: 3 } });
    const attachedNames = world.components.typesOf(id).map((t) => t.name);
    expect(attachedNames).not.toContain("current-task");
    expect(attachedNames).not.toContain("relationships");
  });
});

describe("spawnSevenStartingBeavers", () => {
  it("spawns exactly seven beavers, all at the given position, each with a distinct id and name", () => {
    const world = buildWorld();
    const ids = spawnSevenStartingBeavers(world, { x: 4, y: 3, z: 4 });

    expect(ids).toHaveLength(7);
    expect(new Set(ids).size).toBe(7); // seven distinct EntityIds

    const names = ids.map((id) => getIdentity(world.components, id)!.name);
    expect(new Set(names).size).toBe(7); // seven distinct names
    for (const name of names) expect(STARTER_BEAVER_NAMES).toContain(name);

    for (const id of ids) {
      expect(world.grid.positionOf(id)).toEqual({ x: 4, y: 3, z: 4 });
    }
  });

  it("is deterministic for a given world seed", () => {
    const worldA = buildWorld("colony-seed");
    const worldB = buildWorld("colony-seed");
    const namesA = spawnSevenStartingBeavers(worldA, { x: 1, y: 3, z: 1 }).map(
      (id) => getIdentity(worldA.components, id)!.name,
    );
    const namesB = spawnSevenStartingBeavers(worldB, { x: 1, y: 3, z: 1 }).map(
      (id) => getIdentity(worldB.components, id)!.name,
    );
    expect(namesB).toEqual(namesA);
  });

  it("a different seed can produce a different roster", () => {
    const worldA = buildWorld("seed-one");
    const worldB = buildWorld("seed-two");
    const namesA = spawnSevenStartingBeavers(worldA, { x: 1, y: 3, z: 1 }).map(
      (id) => getIdentity(worldA.components, id)!.name,
    );
    const namesB = spawnSevenStartingBeavers(worldB, { x: 1, y: 3, z: 1 }).map(
      (id) => getIdentity(worldB.components, id)!.name,
    );
    expect(namesB).not.toEqual(namesA);
  });

  it("mutating one beaver's component state never affects another's -- true per-entity isolation, not shared references", () => {
    const world = buildWorld();
    const ids = spawnSevenStartingBeavers(world, { x: 1, y: 3, z: 1 });
    const [first, second] = ids as [EntityId, EntityId];

    const log = world.entities.create("log");
    setInventory(world.components, first, { itemIds: [log] });
    setHealth(world.components, first, { fraction: 0.4 });

    expect(getInventory(world.components, second)).toEqual({ itemIds: [] });
    expect(getHealth(world.components, second)).toEqual({ fraction: 1 });
  });
});

describe("beaver component persistence", () => {
  it("round-trips every beaver component through ComponentStore.toSnapshot/fromSnapshot", () => {
    const world = buildWorld();
    const id = spawnBeaver(world, { name: "Bucktooth", position: { x: 2, y: 3, z: 2 } });
    setInventory(world.components, id, { itemIds: [world.entities.create("log")] });
    setSkills(world.components, id, { levels: { woodcutting: 2 } });

    const snapshot = world.components.toSnapshot();
    const componentTypes = new Map<string, ComponentType<unknown>>([
      ["identity", IdentityComponent],
      ["creature-body", CreatureBodyComponent],
      ["locomotion", LocomotionComponent],
      ["swimmer", SwimmerComponent],
      ["inventory", InventoryComponent],
      ["skills", SkillsComponent],
      ["health", HealthComponent],
      ["needs", NeedsComponent],
      ["need-focus", NeedFocusComponent],
    ]);
    const restoredComponents = ComponentStore.fromSnapshot(snapshot, world.entities, componentTypes);

    expect(getIdentity(restoredComponents, id)).toEqual({ name: "Bucktooth" });
    expect(getSkills(restoredComponents, id)).toEqual({ levels: { woodcutting: 2 } });
    expect(getInventory(restoredComponents, id)!.itemIds).toHaveLength(1);
    expect(getNeeds(restoredComponents, id)).toEqual(BASELINE_NEEDS);
  });

  it("survives a real JSON.stringify/JSON.parse round trip end to end", () => {
    const world = buildWorld();
    const id = spawnBeaver(world, { name: "Bucktooth", position: { x: 2, y: 3, z: 2 } });

    const json = JSON.stringify(world.components.toSnapshot());
    const componentTypes = new Map<string, ComponentType<unknown>>([
      ["identity", IdentityComponent],
      ["creature-body", CreatureBodyComponent],
      ["locomotion", LocomotionComponent],
      ["swimmer", SwimmerComponent],
      ["inventory", InventoryComponent],
      ["skills", SkillsComponent],
      ["health", HealthComponent],
      ["needs", NeedsComponent],
      ["need-focus", NeedFocusComponent],
    ]);
    const restoredComponents = ComponentStore.fromSnapshot(JSON.parse(json), world.entities, componentTypes);

    expect(getIdentity(restoredComponents, id)).toEqual({ name: "Bucktooth" });
  });
});
