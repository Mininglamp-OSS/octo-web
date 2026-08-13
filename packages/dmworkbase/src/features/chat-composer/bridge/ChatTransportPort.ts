import type {
  ChatSendOperation,
  ChatTransportResult,
} from "../domain/sendPlan";

export type { ChatTransportResult } from "../domain/sendPlan";

/** SDK-free boundary for executing one planned operation. */
export interface ChatTransportPort<TMessage = unknown> {
  execute(
    operation: ChatSendOperation<TMessage>,
  ): Promise<ChatTransportResult>;
}
