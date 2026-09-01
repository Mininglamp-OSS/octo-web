import type { Skill } from "../types/skill";

/** Whether a skill carries the platform "官方发布" badge. `system` is the
 *  unified backend's official visibility (shared with the connector and expert
 *  markets — see dmworkmcp/utils/publisher.ts); `public` is the skill market's
 *  legacy platform-published scope. Either marks the skill official, so the
 *  card renders the badge instead of a creator name. */
export function isPlatformPublishedSkill(skill: Pick<Skill, "visibility">): boolean {
  return skill.visibility === "public" || skill.visibility === "system";
}
