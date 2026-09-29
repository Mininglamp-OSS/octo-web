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
  channels: SummaryWorkbenchChannelScope[],
  mixedSources = false
): {
  scope: SummaryWorkbenchScope;
  participantsCleared: boolean;
  referencesCleared: boolean;
  timeRangeCleared: boolean;
} {
  if (!shouldApplySourceSelection(scope.selectedChannels, channels)) {
    return {
      scope,
      participantsCleared: false,
      referencesCleared: false,
      timeRangeCleared: false,
    };
  }
  // Mixed document+chat (capability ON): selecting chats KEEPS documents.
  // When the capability is OFF the pre-mixed mutual-exclusion is restored —
  // selecting chats clears documents so the UI can never compose a scope the
  // backend rejects. Participants still can't coexist with documents (the
  // chat picker cannot be a team-workspace base while documents are present),
  // so participant bookkeeping below only matters for the pure-chat flow.
  // A reference-summary stack is ALSO incompatible with a mixed scope: adding
  // a chat to a document-bearing scope (capability ON) turns it mixed, so the
  // reference must clear exactly when that transition happens — mirroring the
  // same boundary on the documents writer (replaceSelectedDocuments).
  const becomesMixed =
    mixedSources && (scope.documents ?? []).length > 0 && channels.length > 0;
  const referencesCleared =
    becomesMixed && scope.referencedTaskIds.length > 0;
  const nextScope = mixedSources
    ? {
        ...scope,
        selectedChannels: channels,
        referencedTaskIds: referencesCleared ? [] : scope.referencedTaskIds,
      }
    : { ...scope, selectedChannels: channels, documents: [] };
  // Invariant: the time range scopes the chat side ONLY. If there are no
  // chats left (but documents remain), a picker time range would be sent to a
  // document-only scope that the backend rejects. Clear it here so the state
  // can never represent that illegal shape.
  const scopeAfterChatChange = withChatOnlyTimeRange(nextScope);
  const timeRangeCleared =
    scope.timeRange !== null && scopeAfterChatChange.timeRange === null;
  const nextMemberSource = participantSourceKey(scopeAfterChatChange);
  const participantsCleared =
    scope.participants.length > 0 && !nextMemberSource;
  return {
    scope: {
      ...scopeAfterChatChange,
      participants: participantsCleared ? [] : scope.participants,
    },
    participantsCleared,
    referencesCleared,
    timeRangeCleared,
  };
}

// withChatOnlyTimeRange enforces the invariant that a time range requires at
// least one selected chat when documents are present. It is applied by both
// replaceSelectedDocuments and replaceSelectedChannels so neither path can
// leave a document-only scope carrying a chat time range (which the backend
// contract rejects).
export function withChatOnlyTimeRange(
  scope: SummaryWorkbenchScope
): SummaryWorkbenchScope {
  if (
    scope.selectedChannels.length === 0 &&
    (scope.documents ?? []).length > 0 &&
    scope.timeRange != null
  ) {
    return { ...scope, timeRange: null };
  }
  return scope;
}

export function replaceSelectedDocuments(
  scope: SummaryWorkbenchScope,
  documents: SummaryWorkbenchDocumentScope[],
  mixedSources = false
): {
  scope: SummaryWorkbenchScope;
  participantsCleared: boolean;
  referencesCleared: boolean;
  timeRangeCleared: boolean;
} {
  if (!shouldApplySourceSelection(scope.documents ?? [], documents)) {
    return {
      scope,
      participantsCleared: false,
      referencesCleared: false,
      timeRangeCleared: false,
    };
  }
  // Mixed document+chat (capability ON): selecting documents KEEPS chats and
  // the chat time range (it scopes the chat side only). When the capability
  // is OFF the pre-mixed mutual-exclusion is restored — selecting documents
  // clears chats and the time range so the UI can never compose a scope the
  // backend rejects.
  const becomesMixed =
    mixedSources && scope.selectedChannels.length > 0 && documents.length > 0;
  // A reference-summary stack is incompatible with a MIXED scope (the
  // backend rejects referenced_task_ids on a document+chat scope). A
  // pure-document scope (no chats) accepts a reference, so only clear it when
  // the selection actually turns the scope mixed.
  const referencesCleared =
    becomesMixed && scope.referencedTaskIds.length > 0;
  const withDocuments = mixedSources
    ? {
        ...scope,
        documents,
        participants: [],
        referencedTaskIds: referencesCleared ? [] : scope.referencedTaskIds,
      }
    : {
        ...scope,
        documents,
        selectedChannels: [],
        timeRange: null,
        participants: [],
        referencedTaskIds: scope.referencedTaskIds,
      };
  const scopeAfterDocChange = withChatOnlyTimeRange(withDocuments);
  const timeRangeCleared =
    scope.timeRange !== null && scopeAfterDocChange.timeRange === null;
  return {
    scope: scopeAfterDocChange,
    participantsCleared: scope.participants.length > 0,
    referencesCleared,
    timeRangeCleared,
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
  id: string,
  mixedSources = false
): {
  scope: SummaryWorkbenchScope;
  participantsCleared: boolean;
  referencesCleared: boolean;
  timeRangeCleared: boolean;
} {
  switch (kind) {
    case "chat": {
      const result = replaceSelectedChannels(
        scope,
        scope.selectedChannels.filter((channel) => channel.chatId !== id),
        mixedSources
      );
      return {
        scope: result.scope,
        participantsCleared: result.participantsCleared,
        referencesCleared: result.referencesCleared,
        timeRangeCleared: result.timeRangeCleared,
      };
    }
    case "document": {
      const filtered = {
        ...scope,
        documents: (scope.documents ?? []).filter(
          (document) => document.documentId !== id
        ),
      };
      // Removing a document must still re-assert the chat-only-time-range
      // invariant (a snapshot could hydrate a document-only scope carrying a
      // time range; see withChatOnlyTimeRange).
      const scopeAfterDocRemoval = withChatOnlyTimeRange(filtered);
      const timeRangeCleared =
        scope.timeRange !== null && scopeAfterDocRemoval.timeRange === null;
      return {
        scope: scopeAfterDocRemoval,
        participantsCleared: false,
        referencesCleared: false,
        timeRangeCleared,
      };
    }
    case "participant":
      return {
        scope: {
          ...scope,
          participants: scope.participants.filter(
            (participant) => participant.userId !== id
          ),
        },
        participantsCleared: false,
        referencesCleared: false,
        timeRangeCleared: false,
      };
    case "template":
      return {
        scope: { ...scope, template: null },
        participantsCleared: false,
        referencesCleared: false,
        timeRangeCleared: false,
      };
    case "time_range":
      return {
        scope: { ...scope, timeRange: null },
        participantsCleared: false,
        referencesCleared: false,
        timeRangeCleared: false,
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
        referencesCleared: false,
        timeRangeCleared: false,
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
