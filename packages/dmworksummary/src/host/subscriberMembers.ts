import { isFlagOn, subscriberDisplayName } from "@octo/base";
import type { Subscriber } from "wukongimjssdk";
import type { SummaryConversationMember } from "./types";

export function toSummaryConversationMember(
  member: Subscriber
): SummaryConversationMember {
  return {
    uid: member.uid,
    name: subscriberDisplayName(member) || member.uid,
    role: member.role,
    isBot: isFlagOn(member.orgData?.robot) || isFlagOn(member.orgData?.is_bot),
    isDeleted: isFlagOn(member.isDeleted),
    status: member.status,
    avatar: member.avatar,
  };
}
