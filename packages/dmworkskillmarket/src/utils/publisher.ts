import type { Skill } from "../types/skill";

export function isPlatformPublishedSkill(skill: Pick<Skill, "visibility">): boolean {
  return skill.visibility === "public";
}
