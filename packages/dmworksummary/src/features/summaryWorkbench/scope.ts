import { Channel, ChannelTypeGroup } from "wukongimjssdk";
import type {
  SummaryWorkbenchChannelScope,
  SummaryWorkbenchScope,
} from "../../bridge/summaryWorkbench/protocol";
import type { SummaryWorkbenchContextKind } from "../../ui/SummaryWorkbench";
import type { ChatCandidate, MemberCandidate } from "../../types/summary";

export interface WorkbenchMemberCandidate {
  uid: string;
  name: string;
  avatar?: string;
  is_bot?: boolean;
}

export function emptySummaryWorkbenchScope(): SummaryWorkbenchScope {
  return {
    selectedChannels: [],
    participants: [],
    template: null,
    timeRange: null,
    referencedTaskIds: [],
  };
}

export function chatCandidatesToScope(
  chats: ChatCandidate[]
): SummaryWorkbenchChannelScope[] {
  return chats.map((chat) => ({
    chatId: chat.chat_id,
    chatType: chat.chat_type,
    name: chat.name,
    ...(chat.is_archived === undefined ? {} : { isArchived: chat.is_archived }),
  }));
}

export function scopeChannelsToCandidates(
  channels: SummaryWorkbenchChannelScope[]
): ChatCandidate[] {
  return channels.map((channel) => ({
    chat_id: channel.chatId,
    chat_type: channel.chatType,
    name: channel.name,
    member_count: null,
    ...(channel.isArchived === undefined
      ? {}
      : { is_archived: channel.isArchived }),
  }));
}

export function memberCandidatesToScope(
  members: WorkbenchMemberCandidate[]
): SummaryWorkbenchScope["participants"] {
  return members.map((member) => ({
    userId: member.uid,
    userName: member.name || member.uid,
  }));
}

export function scopeParticipantsToCandidates(
  participants: SummaryWorkbenchScope["participants"]
): WorkbenchMemberCandidate[] {
  return participants.map((participant) => ({
    uid: participant.userId,
    name: participant.userName || participant.userId,
  }));
}

export function canSelectParticipants(scope: SummaryWorkbenchScope): boolean {
  if (scope.selectedChannels.length === 0) return true;
  return (
    scope.selectedChannels.length === 1 &&
    scope.selectedChannels[0]?.chatType === "group"
  );
}

export function participantSourceChannel(
  scope: SummaryWorkbenchScope
): Channel | null {
  if (!canSelectParticipants(scope)) return null;
  const channel = scope.selectedChannels[0];
  if (!channel) return null;
  return new Channel(channel.chatId, ChannelTypeGroup);
}

function participantSourceKey(scope: SummaryWorkbenchScope): string | undefined {
  if (scope.selectedChannels.length === 0) return "space";
  if (!canSelectParticipants(scope)) return undefined;
  return `group:${scope.selectedChannels[0]?.chatId ?? ""}`;
}

export function replaceSelectedChannels(
  scope: SummaryWorkbenchScope,
  channels: SummaryWorkbenchChannelScope[]
): { scope: SummaryWorkbenchScope; participantsCleared: boolean } {
  const nextScope = { ...scope, selectedChannels: channels };
  const previousMemberSource = participantSourceKey(scope);
  const nextMemberSource = participantSourceKey(nextScope);
  const participantsCleared =
    scope.participants.length > 0 &&
    (!nextMemberSource || previousMemberSource !== nextMemberSource);
  return {
    scope: {
      ...nextScope,
      participants: participantsCleared ? [] : scope.participants,
    },
    participantsCleared,
  };
}

export function removeScopeContext(
  scope: SummaryWorkbenchScope,
  kind: SummaryWorkbenchContextKind,
  id: string
): { scope: SummaryWorkbenchScope; participantsCleared: boolean } {
  switch (kind) {
    case "chat":
      return replaceSelectedChannels(
        scope,
        scope.selectedChannels.filter((channel) => channel.chatId !== id)
      );
    case "participant":
      return {
        scope: {
          ...scope,
          participants: scope.participants.filter(
            (participant) => participant.userId !== id
          ),
        },
        participantsCleared: false,
      };
    case "template":
      return {
        scope: { ...scope, template: null },
        participantsCleared: false,
      };
    case "time_range":
      return {
        scope: { ...scope, timeRange: null },
        participantsCleared: false,
      };
    case "reference":
      return {
        scope: {
          ...scope,
          referencedTaskIds: scope.referencedTaskIds.filter(
            (taskId) => String(taskId) !== id
          ),
        },
        participantsCleared: false,
      };
  }
}

export function canGenerateFromScope(
  scope: SummaryWorkbenchScope,
  hasUserInput = false
): boolean {
  if (scope.participants.length > 0) {
    return Boolean(scope.template) || hasUserInput;
  }
  return (
    scope.selectedChannels.length > 0 || Boolean(scope.template) || hasUserInput
  );
}

export function memberCandidateToLegacy(
  member: WorkbenchMemberCandidate
): MemberCandidate {
  return {
    user_id: member.uid,
    name: member.name,
    avatar: member.avatar || "",
    department: "",
  };
}
