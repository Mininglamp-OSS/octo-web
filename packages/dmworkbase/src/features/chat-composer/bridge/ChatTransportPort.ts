import type {
  ChatSendOperation,
  ChatTransportResult,
} from "../domain/sendPlan";

export type { ChatTransportResult } from "../domain/sendPlan";

export interface ChatTransportEvents {
  /** Report local enqueue before waiting for server ack. */
  onEnqueued(partIds: readonly string[]): void;
}

/** SDK-free boundary for executing one planned operation. */
export interface ChatTransportPort<TMessage = unknown> {
  execute(
    operation: ChatSendOperation<TMessage>,
    events: ChatTransportEvents,
  ): Promise<ChatTransportResult>;
}
