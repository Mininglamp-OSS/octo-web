import type { ChatSendOperation } from "../submission";
import type { ChatTransportResult } from "./ChatTransportPort";

export type ChatSendOperationHandler<
  TMessage,
  TOperation extends ChatSendOperation<TMessage> = ChatSendOperation<TMessage>,
> = (operation: TOperation) => Promise<ChatTransportResult>;

/** Public operation dispatcher used by transport adapters and app extensions. */
export class ChatSendOperationRegistry<TMessage = unknown> {
  private readonly handlers = new Map<
    string,
    ChatSendOperationHandler<TMessage>
  >();

  register<TOperation extends ChatSendOperation<TMessage>>(
    kind: TOperation["kind"],
    handler: ChatSendOperationHandler<TMessage, TOperation>,
  ): () => boolean {
    if (this.handlers.has(kind)) {
      throw new Error(`chat send operation already registered: ${kind}`);
    }
    this.handlers.set(kind, handler as ChatSendOperationHandler<TMessage>);
    return () => this.unregister(kind);
  }

  unregister(kind: ChatSendOperation<TMessage>["kind"]): boolean {
    return this.handlers.delete(kind);
  }

  get(
    operation: ChatSendOperation<TMessage>,
  ): ChatSendOperationHandler<TMessage> | undefined {
    return this.handlers.get(operation.kind);
  }

  has(kind: ChatSendOperation<TMessage>["kind"]): boolean {
    return this.handlers.has(kind);
  }

  clear(): void {
    this.handlers.clear();
  }
}
