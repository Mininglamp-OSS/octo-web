import type {
  ChatSendOperation,
  ChatTransportResult,
} from "../domain/sendPlan";

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
    const registered = handler as ChatSendOperationHandler<TMessage>;
    this.handlers.set(kind, registered);
    return () => {
      if (this.handlers.get(kind) !== registered) return false;
      return this.handlers.delete(kind);
    };
  }

  unregister(kind: ChatSendOperation<TMessage>["kind"]): boolean {
    return this.handlers.delete(kind);
  }

  get<TOperation extends ChatSendOperation<TMessage>>(
    operation: TOperation,
  ): ChatSendOperationHandler<TMessage, TOperation> | undefined {
    return this.handlers.get(operation.kind) as
      | ChatSendOperationHandler<TMessage, TOperation>
      | undefined;
  }

  has(kind: ChatSendOperation<TMessage>["kind"]): boolean {
    return this.handlers.has(kind);
  }

  clear(): void {
    this.handlers.clear();
  }
}
