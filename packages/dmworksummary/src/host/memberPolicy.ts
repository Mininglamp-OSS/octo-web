import type { SummaryConversationMember } from "./types";

export function isActiveSummaryGroupMember(
  member: Pick<SummaryConversationMember, "isDeleted" | "status">
): boolean {
  return !member.isDeleted && (member.status === undefined || member.status === 1);
}
