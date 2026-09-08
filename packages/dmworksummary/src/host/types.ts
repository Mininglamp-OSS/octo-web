import type { SummaryDetail } from "../types/summary";

export interface SummaryConversationTarget {
  channelId: string;
  channelType: number;
  messageSeq?: number;
  openChannelSearch?: boolean;
}

export interface SummaryConversationMember {
  uid: string;
  name: string;
  role?: number;
  isBot?: boolean;
  isDeleted?: boolean;
  status?: number;
  avatar?: string;
}

export interface SummaryCompletionNotice {
  previousStatus?: number;
  detail: SummaryDetail;
}

export interface SummaryForwardOutcome {
  kind: "success" | "partial" | "all-failed";
  failed: number;
  total: number;
}

export interface SummaryForwardRequest {
  isActive?: () => boolean;
  content: string;
  title: string;
  onComplete: (result: SummaryForwardOutcome) => void;
  onError?: (error: unknown) => void;
  onCancel?: () => void;
}

export interface SummaryMessagingPort {
  getCurrentUser(): { uid: string; displayName: string };
  loadConversationMembers(
    target: SummaryConversationTarget
  ): Promise<SummaryConversationMember[]>;
  openConversation(target: SummaryConversationTarget): Promise<void>;
  notifySummaryCompleted(input: SummaryCompletionNotice): Promise<void>;
  requestForward(input: SummaryForwardRequest): void;
  subscribeInvalidation(listener: () => void): () => void;
}
