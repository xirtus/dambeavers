import { describe, expect, it } from "vitest";
import { EntityIdRegistry } from "../../src/sim/core/EntityId.js";
import { ComponentStore } from "../../src/sim/core/ComponentStore.js";
import { setLog, getLog } from "../../src/sim/labor/Log.js";

describe("Log component", () => {
  it("round-trips a valid log", () => {
    const entities = new EntityIdRegistry();
    const components = new ComponentStore(entities);
    const id = entities.create("log");
    setLog(components, id, { materialId: "wood", massKg: 12.5 });
    expect(getLog(components, id)).toEqual({ materialId: "wood", massKg: 12.5 });
  });

  it("rejects an empty materialId", () => {
    const entities = new EntityIdRegistry();
    const components = new ComponentStore(entities);
    const id = entities.create("log");
    expect(() => setLog(components, id, { materialId: "", massKg: 5 })).toThrow(RangeError);
  });

  it("rejects a non-positive or non-finite mass", () => {
    const entities = new EntityIdRegistry();
    const components = new ComponentStore(entities);
    const id = entities.create("log");
    expect(() => setLog(components, id, { materialId: "wood", massKg: 0 })).toThrow(RangeError);
    expect(() => setLog(components, id, { materialId: "wood", massKg: -1 })).toThrow(RangeError);
    expect(() => setLog(components, id, { materialId: "wood", massKg: Infinity })).toThrow(RangeError);
    expect(() => setLog(components, id, { materialId: "wood", massKg: NaN })).toThrow(RangeError);
  });

  it("returns undefined for an entity with no Log", () => {
    const entities = new EntityIdRegistry();
    const components = new ComponentStore(entities);
    const id = entities.create("log");
    expect(getLog(components, id)).toBeUndefined();
  });
});
