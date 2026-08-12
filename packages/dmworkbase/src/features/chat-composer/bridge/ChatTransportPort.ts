import type { ChatSendOperation } from "../submission/buildChatSendPlan";

export interface ChatTransportResult {
  /** Parts that produced a local message/edit bubble. */
  enqueuedPartIds: string[];
  messageId?: string;
}

/** SDK-free boundary for executing one planned operation. */
export interface ChatTransportPort<TMessage = unknown> {
  execute(
    operation: ChatSendOperation<TMessage>,
  ): Promise<ChatTransportResult>;
}
