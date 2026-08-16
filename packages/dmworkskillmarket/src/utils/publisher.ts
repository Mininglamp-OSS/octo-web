import type { Skill } from "../types/skill";

// Administrator-created Skills are stored as public records in the global
// Marketplace scope. The backend currently represents that scope with an
// empty space_id, so keep the heuristic isolated until an explicit publisher
// type is available in the API contract.
export function isPlatformPublishedSkill(
  skill: Pick<Skill, "creatorName" | "ownerName" | "spaceId" | "visibility">,
): boolean {
  if (skill.visibility !== "public") return false;

  // space_id is intentionally omitted from current public Skill responses, so
  // recognize the administrator role name already returned by the API. Keep
  // the global-scope check for endpoints/fixtures that do expose space_id.
  const publisherName = (skill.creatorName || skill.ownerName).trim();
  return skill.spaceId === "" || publisherName === "超级管理员" || publisherName === "Super Admin";
}
