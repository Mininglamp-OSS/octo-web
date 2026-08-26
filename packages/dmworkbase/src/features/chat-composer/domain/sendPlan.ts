import type {
  AttachmentFile,
  ChatMention,
  EditorContentBlock,
  SendTargetSnapshot,
} from "./types";

export type ChatSendOperationKind =
  | "edit_text"
  | "send_text"
  | "send_media"
  | "send_rich_text"
  | `extension:${string}`;

export interface ChatSendOperationBase<TMessage> {
  kind: ChatSendOperationKind;
  partIds: string[];
  sendTarget?: SendTargetSnapshot<TMessage>;
  requiresPreviousEnqueue?: boolean;
}

export type BuiltInChatSendOperation<TMessage = unknown> =
  | (ChatSendOperationBase<TMessage> & {
      kind: "edit_text";
      text: string;
      mention?: ChatMention;
    })
  | (ChatSendOperationBase<TMessage> & {
      kind: "send_text";
      text: string;
      mention?: ChatMention;
    })
  | (ChatSendOperationBase<TMessage> & {
      kind: "send_media";
      attachment: AttachmentFile;
    })
  | (ChatSendOperationBase<TMessage> & {
      kind: "send_rich_text";
      blocks: EditorContentBlock[];
    });

export type ExtensionChatSendOperation<
  TMessage = unknown,
  TPayload = unknown,
> = ChatSendOperationBase<TMessage> & {
  kind: `extension:${string}`;
  payload: TPayload;
};

export type ChatSendOperation<TMessage = unknown> =
  | BuiltInChatSendOperation<TMessage>
  | ExtensionChatSendOperation<TMessage>;

export type ChatSendOperationForKind<
  TMessage,
  TKind extends ChatSendOperationKind,
> = TKind extends `extension:${string}`
  ? ExtensionChatSendOperation<TMessage> & { kind: TKind }
  : Extract<BuiltInChatSendOperation<TMessage>, { kind: TKind }>;

export interface ChatSendPlan<TMessage = unknown> {
  attemptId: string;
  operations: ChatSendOperation<TMessage>[];
}

export interface ChatTransportResult {
  /** Parts that produced a local message/edit bubble. */
  enqueuedPartIds: string[];
  messageId?: string;
}
