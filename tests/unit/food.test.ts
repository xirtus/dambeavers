import { describe, expect, it } from "vitest";
import { EntityIdRegistry } from "../../src/sim/core/EntityId.js";
import { ComponentStore } from "../../src/sim/core/ComponentStore.js";
import { setFood, getFood, assertValidFood, FoodComponent } from "../../src/sim/labor/Food.js";
import { setHeld, getHeld, setReservation, getReservation, pickUp, drop } from "../../src/sim/labor/Log.js";
import { WorldGrid } from "../../src/sim/world/WorldGrid.js";
import { getInventory, setInventory } from "../../src/sim/creatures/Beaver.js";

function buildStore() {
  const entities = new EntityIdRegistry();
  const components = new ComponentStore(entities);
  return { entities, components };
}

describe("Food", () => {
  it("round-trips through setFood/getFood", () => {
    const { entities, components } = buildStore();
    const id = entities.create("food");
    setFood(components, id, { nutritionValue: 0.4, materialId: "plant-matter", massKg: 1.5 });
    expect(getFood(components, id)).toEqual({ nutritionValue: 0.4, materialId: "plant-matter", massKg: 1.5 });
  });

  it("returns undefined for an entity with no Food component", () => {
    const { entities, components } = buildStore();
    const id = entities.create("food");
    expect(getFood(components, id)).toBeUndefined();
  });

  it("assertValidFood rejects nutritionValue outside (0, 1]", () => {
    expect(() => assertValidFood({ nutritionValue: 0, materialId: "plant-matter", massKg: 1 })).toThrow(RangeError);
    expect(() => assertValidFood({ nutritionValue: -0.1, materialId: "plant-matter", massKg: 1 })).toThrow(RangeError);
    expect(() => assertValidFood({ nutritionValue: 1.1, materialId: "plant-matter", massKg: 1 })).toThrow(RangeError);
    expect(() => assertValidFood({ nutritionValue: NaN, materialId: "plant-matter", massKg: 1 })).toThrow(RangeError);
  });

  it("assertValidFood accepts the full valid range, including exactly 1", () => {
    expect(() => assertValidFood({ nutritionValue: 0.01, materialId: "plant-matter", massKg: 0.1 })).not.toThrow();
    expect(() => assertValidFood({ nutritionValue: 1, materialId: "bark", massKg: 10 })).not.toThrow();
  });

  it("assertValidFood rejects malformed physical item facts", () => {
    expect(() => assertValidFood({ nutritionValue: 0.5, materialId: "Plant Matter", massKg: 1 })).toThrow(RangeError);
    expect(() => assertValidFood({ nutritionValue: 0.5, massKg: 1 } as never)).toThrow(RangeError);
    expect(() => assertValidFood({ nutritionValue: 0.5, materialId: "plant-matter", massKg: 0 })).toThrow(RangeError);
    expect(() => assertValidFood({ nutritionValue: 0.5, materialId: "plant-matter", massKg: Infinity })).toThrow(RangeError);
  });

  it("REGRESSION (P2-07 critic): getFood rejects a restored/corrupted food item with no materialId", () => {
    const { entities, components } = buildStore();
    const id = entities.create("food");
    components.set(id, FoodComponent, { nutritionValue: 0.5, massKg: 1 } as never);

    expect(() => getFood(components, id)).toThrow(RangeError);
  });

  it("setFood rejects invalid data before it ever becomes authoritative state", () => {
    const { entities, components } = buildStore();
    const id = entities.create("food");
    expect(() => setFood(components, id, { nutritionValue: 0, materialId: "plant-matter", massKg: 1 })).toThrow(RangeError);
    expect(getFood(components, id)).toBeUndefined(); // never written
  });

  it("REGRESSION: a food item genuinely reuses Log.ts's generic Held/Reservation/pickUp/drop -- no food-specific reimplementation needed", () => {
    const entities = new EntityIdRegistry();
    const components = new ComponentStore(entities);
    const grid = new WorldGrid({ sizeX: 8, sizeY: 8, sizeZ: 8 }, entities);
    for (let x = 0; x < 8; x++) for (let z = 0; z < 8; z++) grid.setSolid(x, 1, z, true);

    const beaver = entities.create("beaver");
    grid.setEntityPosition(beaver, 2, 2, 2);
    setInventory(components, beaver, { itemIds: [] });

    const item = entities.create("food");
    grid.setEntityPosition(item, 2, 2, 2);
    setFood(components, item, { nutritionValue: 0.5, materialId: "plant-matter", massKg: 1 });

    setReservation(components, item, { by: beaver });
    expect(getReservation(components, item)).toEqual({ by: beaver });

    pickUp(components, grid, item, beaver);
    expect(getHeld(components, item)).toEqual({ by: beaver });
    expect(grid.positionOf(item)).toBeUndefined();
    expect(getInventory(components, beaver)!.itemIds).toContain(item);
    expect(getFood(components, item)).toEqual({ nutritionValue: 0.5, materialId: "plant-matter", massKg: 1 }); // Food data untouched by pickUp

    drop(components, grid, item, { x: 3, z: 3 });
    expect(getHeld(components, item)).toBeUndefined();
    expect(grid.positionOf(item)).toEqual({ x: 3, y: 2, z: 3 });
    expect(getFood(components, item)).toEqual({ nutritionValue: 0.5, materialId: "plant-matter", massKg: 1 }); // still intact after drop
  });
});
