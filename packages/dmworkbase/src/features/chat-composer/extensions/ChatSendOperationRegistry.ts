import type {
  ChatSendOperation,
  ChatSendOperationForKind,
  ChatSendOperationKind,
  ChatTransportResult,
} from "../domain/sendPlan";
import type { ChatTransportEvents } from "../ports/ChatTransportPort";

export type ChatSendOperationHandler<
  TMessage,
  TOperation extends ChatSendOperation<TMessage> = ChatSendOperation<TMessage>,
> = (
  operation: TOperation,
  events: ChatTransportEvents,
) => Promise<ChatTransportResult>;

type RegisterKind<
  TMessage,
  TKindOrOperation extends
    | ChatSendOperationKind
    | ChatSendOperation<TMessage>,
> = TKindOrOperation extends ChatSendOperation<TMessage>
  ? TKindOrOperation["kind"]
  : TKindOrOperation;

type RegisterOperation<
  TMessage,
  TKindOrOperation extends
    | ChatSendOperationKind
    | ChatSendOperation<TMessage>,
> = TKindOrOperation extends ChatSendOperation<TMessage>
  ? TKindOrOperation
  : ChatSendOperationForKind<
      TMessage,
      Extract<TKindOrOperation, ChatSendOperationKind>
    >;

/** Public operation dispatcher used by transport adapters and app extensions. */
export class ChatSendOperationRegistry<TMessage = unknown> {
  private readonly handlers = new Map<
    string,
    ChatSendOperationHandler<TMessage>
  >();

  register<
    TKindOrOperation extends
      | ChatSendOperationKind
      | ChatSendOperation<TMessage>,
  >(
    kind: RegisterKind<TMessage, TKindOrOperation>,
    handler: ChatSendOperationHandler<
      TMessage,
      RegisterOperation<TMessage, TKindOrOperation>
    >,
  ): () => boolean;
  register<TOperation extends ChatSendOperation<TMessage>>(
    kind: TOperation["kind"],
    handler: ChatSendOperationHandler<TMessage, TOperation>,
  ): () => boolean;
  register(
    kind: ChatSendOperationKind,
    handler: ChatSendOperationHandler<TMessage>,
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

  /** Freeze the current handler set for one send attempt. */
  snapshot(): ChatSendOperationRegistry<TMessage> {
    const snapshot = new ChatSendOperationRegistry<TMessage>();
    this.handlers.forEach((handler, kind) => {
      snapshot.handlers.set(kind, handler);
    });
    return snapshot;
  }

  clear(): void {
    this.handlers.clear();
  }
}
