import { describe, expect, it } from "vitest";
import { EntityIdRegistry } from "../../src/sim/core/EntityId.js";
import { ComponentStore } from "../../src/sim/core/ComponentStore.js";
import { getSkills, setSkills, SkillsComponent } from "../../src/sim/creatures/Beaver.js";
import { getSkillDebugState, practiceSkill, SKILL_LEVELS_PER_WORK, skillLevel } from "../../src/sim/creatures/SkillProgression.js";

function buildStore(): { entities: EntityIdRegistry; components: ComponentStore; beaver: ReturnType<EntityIdRegistry["create"]> } {
  const entities = new EntityIdRegistry();
  const components = new ComponentStore(entities);
  const beaver = entities.create("beaver");
  return { entities, components, beaver };
}

describe("SkillProgression", () => {
  it("creates persistent skill state from real practiced work", () => {
    const { components, beaver } = buildStore();

    const result = practiceSkill(components, beaver, "woodcutting", 5);

    expect(result).toEqual({
      skillName: "woodcutting",
      previousLevel: 0,
      newLevel: 5 * SKILL_LEVELS_PER_WORK,
      workPracticed: 5,
    });
    expect(getSkills(components, beaver)).toEqual({ levels: { woodcutting: 5 * SKILL_LEVELS_PER_WORK } });
    expect(skillLevel(components, beaver, "woodcutting")).toBe(5 * SKILL_LEVELS_PER_WORK);
  });

  it("accumulates only the practiced skill and preserves unrelated levels", () => {
    const { components, beaver } = buildStore();
    setSkills(components, beaver, { levels: { hauling: 2, woodcutting: 1 } });

    practiceSkill(components, beaver, "woodcutting", 10);

    expect(getSkills(components, beaver)).toEqual({
      levels: {
        hauling: 2,
        woodcutting: 1 + 10 * SKILL_LEVELS_PER_WORK,
      },
    });
  });

  it("REGRESSION (P2-03 critic): inherited Object.prototype keys are never read as missing skill levels", () => {
    const { components, beaver } = buildStore();
    setSkills(components, beaver, { levels: {} });

    expect(skillLevel(components, beaver, "constructor")).toBe(0);

    practiceSkill(components, beaver, "constructor", 1);
    expect(getSkills(components, beaver)).toEqual({
      levels: { constructor: SKILL_LEVELS_PER_WORK },
    });
    expect(skillLevel(components, beaver, "constructor")).toBe(SKILL_LEVELS_PER_WORK);
  });

  it("zero practiced work is a no-op and does not fabricate a missing component", () => {
    const { components, beaver } = buildStore();

    const result = practiceSkill(components, beaver, "construction", 0);

    expect(result).toEqual({ skillName: "construction", previousLevel: 0, newLevel: 0, workPracticed: 0 });
    expect(getSkills(components, beaver)).toBeUndefined();
  });

  it("rejects invalid skill names and invalid practice amounts", () => {
    const { components, beaver } = buildStore();

    expect(() => practiceSkill(components, beaver, "Woodcutting", 1)).toThrow(RangeError);
    expect(() => practiceSkill(components, beaver, "wood cutting", 1)).toThrow(RangeError);
    expect(() => practiceSkill(components, beaver, "woodcutting", -1)).toThrow(RangeError);
    expect(() => practiceSkill(components, beaver, "woodcutting", Infinity)).toThrow(RangeError);
  });

  it("reports sorted skill debug state without mutating authoritative state", () => {
    const { components, beaver } = buildStore();
    setSkills(components, beaver, { levels: { woodcutting: 1, construction: 2 } });

    const debug = getSkillDebugState(components, beaver);
    debug.levels[0]!.level = 999;

    expect(debug).toEqual({
      levels: [
        { skillName: "construction", level: 999 },
        { skillName: "woodcutting", level: 1 },
      ],
    });
    expect(getSkills(components, beaver)).toEqual({ levels: { woodcutting: 1, construction: 2 } });
  });

  it("REGRESSION (P2-03): malformed persisted Skills shapes fail loudly at the read boundary", () => {
    const { components, beaver } = buildStore();

    for (const malformed of [null, [], "not-an-object"]) {
      components.set(beaver, SkillsComponent, malformed as never);
      expect(() => getSkills(components, beaver)).toThrow(RangeError);
    }

    for (const malformedLevels of [null, [], "not-an-object"]) {
      components.set(beaver, SkillsComponent, { levels: malformedLevels } as never);
      expect(() => getSkills(components, beaver)).toThrow(RangeError);
    }
  });
});
