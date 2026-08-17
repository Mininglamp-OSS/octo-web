import type {
  ChatSendOutcome,
  ChatSendRequest,
  ChatSendSettlement,
  SendDraftSnapshot,
  SendTargetSnapshot,
} from "../domain";
import type { ComposeRecoveryRecord } from "../recovery";

/** Immutable host capabilities captured for one compose attempt. */
export interface ChatComposerSendTransaction<TMessage = unknown> {
  channelKey: string;
  captureSendTarget(): SendTargetSnapshot<TMessage> | undefined;
  captureSendDraft(): Omit<SendDraftSnapshot, "draftText"> | undefined;
  send(
    request: ChatSendRequest<TMessage>,
  ): ChatSendOutcome | Promise<ChatSendOutcome>;
  onSendSettled?(
    settlement: ChatSendSettlement,
  ): void | Promise<void>;
}

/** Host-owned state and side effects used by one composer send transaction. */
export interface ChatComposerHostPort<TMessage = unknown> {
  captureSendTransaction(): ChatComposerSendTransaction<TMessage>;
  isChannelActive(channelKey: string): boolean;
  getExpanded(): boolean;
  setExpanded(expanded: boolean): void;
  handoffRecovery?(recovery: ComposeRecoveryRecord): boolean;
  notifyRestoreError?(error: unknown, step: string): void;
}
