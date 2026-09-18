import type {
  SummaryWorkbenchChannelScope,
  SummaryWorkbenchDocumentScope,
  SummaryWorkbenchScope,
} from "../../bridge/summaryWorkbench/protocol";
import { MAX_CHAT_SELECT } from "../../constants/limits";
import type { SummaryWorkbenchContextKind } from "../../ui/SummaryWorkbench";
import type { ChatCandidate } from "../../types/summary";
import type { DocSearchItem } from "@octo/base";
import { shouldApplySourceSelection } from "../documentSource/selection";

export interface WorkbenchMemberCandidate {
  uid: string;
  name: string;
  avatar?: string;
  is_bot?: boolean;
}

export function emptySummaryWorkbenchScope(): SummaryWorkbenchScope {
  return {
    selectedChannels: [],
    documents: [],
    participants: [],
    template: null,
    timeRange: null,
    referencedTaskIds: [],
  };
}

export function documentsToScope(
  documents: DocSearchItem[]
): SummaryWorkbenchDocumentScope[] {
  return documents.map((document) => ({
    documentId: document.docId,
    title: document.title || document.docId,
  }));
}

export function scopeDocumentsToItems(
  documents: SummaryWorkbenchDocumentScope[]
): DocSearchItem[] {
  return documents.map((document) => ({
    docId: document.documentId,
    title: document.title || document.documentId,
    docType: "doc",
    updatedAt: null,
  }));
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
  if ((scope.documents ?? []).length > 0) return false;
  if (scope.selectedChannels.length === 0) return true;
  return (
    scope.selectedChannels.length <= MAX_CHAT_SELECT &&
    scope.selectedChannels.every((channel) => channel.chatType === "group")
  );
}

export function participantSourceChannels(
  scope: SummaryWorkbenchScope
): SummaryWorkbenchChannelScope[] | null {
  if (!canSelectParticipants(scope)) return null;
  return scope.selectedChannels;
}

export function participantSourceKey(
  scope: SummaryWorkbenchScope
): string | undefined {
  if (!canSelectParticipants(scope)) return undefined;
  if (scope.selectedChannels.length === 0) return "space";
  return scope.selectedChannels
    .map((channel) => `group:${channel.chatId}`)
    .sort()
    .join("|");
}

export function replaceSelectedChannels(
  scope: SummaryWorkbenchScope,
  channels: SummaryWorkbenchChannelScope[]
): { scope: SummaryWorkbenchScope; participantsCleared: boolean } {
  if (!shouldApplySourceSelection(scope.selectedChannels, channels)) {
    return { scope, participantsCleared: false };
  }
  const nextScope = { ...scope, selectedChannels: channels, documents: [] };
  const nextMemberSource = participantSourceKey(nextScope);
  const participantsCleared =
    scope.participants.length > 0 && !nextMemberSource;
  return {
    scope: {
      ...nextScope,
      participants: participantsCleared ? [] : scope.participants,
    },
    participantsCleared,
  };
}

export function replaceSelectedDocuments(
  scope: SummaryWorkbenchScope,
  documents: SummaryWorkbenchDocumentScope[]
): { scope: SummaryWorkbenchScope; participantsCleared: boolean } {
  if (!shouldApplySourceSelection(scope.documents ?? [], documents)) {
    return { scope, participantsCleared: false };
  }
  return {
    scope: {
      ...scope,
      selectedChannels: [],
      documents,
      participants: [],
      timeRange: null,
    },
    participantsCleared: scope.participants.length > 0,
  };
}

export function retainValidParticipants(
  scope: SummaryWorkbenchScope,
  candidates: WorkbenchMemberCandidate[]
): { scope: SummaryWorkbenchScope; removedCount: number } {
  const validUserIds = new Set(candidates.map((candidate) => candidate.uid));
  const participants = scope.participants.filter((participant) =>
    validUserIds.has(participant.userId)
  );
  return {
    scope: { ...scope, participants },
    removedCount: scope.participants.length - participants.length,
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
    case "document":
      return {
        scope: {
          ...scope,
          documents: (scope.documents ?? []).filter(
            (document) => document.documentId !== id
          ),
        },
        participantsCleared: false,
      };
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
    scope.selectedChannels.length > 0 ||
    (scope.documents ?? []).length > 0 ||
    Boolean(scope.template) ||
    hasUserInput
  );
}
