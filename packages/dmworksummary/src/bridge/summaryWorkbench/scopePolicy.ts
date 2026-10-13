import {
  MAX_CHAT_SELECT,
  MAX_DOCUMENT_SELECT,
  MIXED_MAX_TOTAL_SOURCES,
} from "../../constants/limits";
import type { SummaryWorkbenchScope } from "./protocol";

export type SummaryWorkbenchScopeIssue =
  | "mixed_sources_disabled"
  | "mixed_source_limit_exceeded"
  | "documents_with_participants"
  | "document_only_time_range"
  | "mixed_with_reference";

export interface SummaryWorkbenchScopePolicy {
  mixedSources: boolean;
}

function uniqueChannelCount(scope: SummaryWorkbenchScope): number {
  return new Set(scope.selectedChannels.map((channel) => channel.chatId)).size;
}

function uniqueDocumentCount(scope: SummaryWorkbenchScope): number {
  return new Set((scope.documents ?? []).map((document) => document.documentId))
    .size;
}

export function summaryWorkbenchSourceCount(
  scope: SummaryWorkbenchScope
): number {
  return uniqueChannelCount(scope) + uniqueDocumentCount(scope);
}

export function summaryWorkbenchScopeIssues(
  scope: SummaryWorkbenchScope,
  policy: SummaryWorkbenchScopePolicy
): SummaryWorkbenchScopeIssue[] {
  const channelCount = uniqueChannelCount(scope);
  const documentCount = uniqueDocumentCount(scope);
  const isMixed = channelCount > 0 && documentCount > 0;
  const issues: SummaryWorkbenchScopeIssue[] = [];

  if (isMixed && !policy.mixedSources) {
    issues.push("mixed_sources_disabled");
  }
  if (isMixed && channelCount + documentCount > MIXED_MAX_TOTAL_SOURCES) {
    issues.push("mixed_source_limit_exceeded");
  }
  if (documentCount > 0 && scope.participants.length > 0) {
    issues.push("documents_with_participants");
  }
  if (documentCount > 0 && channelCount === 0 && scope.timeRange !== null) {
    issues.push("document_only_time_range");
  }
  if (isMixed && scope.referencedTaskIds.length > 0) {
    issues.push("mixed_with_reference");
  }

  return issues;
}

export function maxSelectableChats(
  scope: SummaryWorkbenchScope,
  policy: SummaryWorkbenchScopePolicy
): number {
  if (!policy.mixedSources) return MAX_CHAT_SELECT;
  return Math.max(
    0,
    Math.min(
      MAX_CHAT_SELECT,
      MIXED_MAX_TOTAL_SOURCES - uniqueDocumentCount(scope)
    )
  );
}

export function maxSelectableDocuments(
  scope: SummaryWorkbenchScope,
  policy: SummaryWorkbenchScopePolicy
): number {
  if (!policy.mixedSources) return MAX_DOCUMENT_SELECT;
  return Math.max(
    0,
    Math.min(
      MAX_DOCUMENT_SELECT,
      MIXED_MAX_TOTAL_SOURCES - uniqueChannelCount(scope)
    )
  );
}
