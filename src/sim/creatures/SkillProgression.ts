import { ComponentStore } from "../core/ComponentStore.js";
import type { EntityId } from "../core/EntityId.js";
import { assertValidSkillName, getSkills, setSkills, type Skills } from "./Beaver.js";

/**
 * P2-03's generic skill progression primitive. Labor systems call this
 * only after real work has actually been performed, passing the same
 * work units their own progress meters advanced by. It mutates only the
 * worker's persistent `Skills` component; it never selects, reserves, or
 * completes a job on its own.
 */
export const SKILL_LEVELS_PER_WORK = 0.02;

export interface SkillPracticeResult {
  skillName: string;
  previousLevel: number;
  newLevel: number;
  workPracticed: number;
}

function sortedSkills(skills: Skills): Skills {
  return {
    levels: Object.fromEntries(Object.entries(skills.levels).sort(([a], [b]) => a.localeCompare(b))),
  };
}

function ownSkillLevel(skills: Skills, skillName: string): number {
  return Object.hasOwn(skills.levels, skillName) ? skills.levels[skillName]! : 0;
}

export function skillLevel(components: ComponentStore, beaverId: EntityId, skillName: string): number {
  assertValidSkillName(skillName);
  const skills = getSkills(components, beaverId);
  return skills === undefined ? 0 : ownSkillLevel(skills, skillName);
}

export function practiceSkill(components: ComponentStore, beaverId: EntityId, skillName: string, workPracticed: number): SkillPracticeResult {
  assertValidSkillName(skillName);
  if (!(Number.isFinite(workPracticed) && workPracticed >= 0)) {
    throw new RangeError(`skill practice workPracticed must be a non-negative finite number, got ${workPracticed}`);
  }
  const previous = getSkills(components, beaverId) ?? { levels: {} };
  const previousLevel = ownSkillLevel(previous, skillName);
  if (workPracticed === 0) {
    return { skillName, previousLevel, newLevel: previousLevel, workPracticed };
  }
  const newLevel = previousLevel + workPracticed * SKILL_LEVELS_PER_WORK;
  setSkills(
    components,
    beaverId,
    sortedSkills({
      levels: {
        ...previous.levels,
        [skillName]: newLevel,
      },
    }),
  );
  return { skillName, previousLevel, newLevel, workPracticed };
}

export function getSkillDebugState(components: ComponentStore, beaverId: EntityId): { levels: Array<{ skillName: string; level: number }> } {
  const skills = getSkills(components, beaverId) ?? { levels: {} };
  return {
    levels: Object.entries(skills.levels)
      .map(([skillName, level]) => ({ skillName, level }))
      .sort((a, b) => a.skillName.localeCompare(b.skillName)),
  };
}
