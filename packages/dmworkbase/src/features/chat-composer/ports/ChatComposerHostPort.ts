import type {
  ChatSendOutcome,
  ChatSendRequest,
  ChatSendSettlement,
  SendDraftSnapshot,
  SendTargetSnapshot,
} from "../domain";
import type { ComposeRecoveryRecord } from "../recovery";

/** Host-owned state and side effects used by one composer send transaction. */
export interface ChatComposerHostPort<TMessage = unknown> {
  channelKey(): string;
  isChannelActive(channelKey: string): boolean;
  captureSendTarget(): SendTargetSnapshot<TMessage> | undefined;
  captureSendDraft(): Omit<SendDraftSnapshot, "draftText"> | undefined;
  getExpanded(): boolean;
  setExpanded(expanded: boolean): void;
  send(
    request: ChatSendRequest<TMessage>,
  ): ChatSendOutcome | Promise<ChatSendOutcome>;
  onSendSettled?(
    settlement: ChatSendSettlement,
  ): void | Promise<void>;
  handoffRecovery?(recovery: ComposeRecoveryRecord): boolean;
  notifyRestoreError?(error: unknown, step: string): void;
}
