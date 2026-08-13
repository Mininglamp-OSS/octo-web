import { createDefaultEditorComposePartRegistry } from "../editor";
import {
  ChatSendOperationRegistry,
  type ChatComposerExtensions,
} from "../extensions";
import {
  createDefaultChatPendingComposeRenderRegistry,
  type ChatPendingAttachmentPreview,
  type ChatPendingComposeItem,
} from "./chatPendingComposeRenderRegistry";

export type DefaultChatComposerExtensions<TMessage = unknown> =
  ChatComposerExtensions<
    TMessage,
    ChatPendingComposeItem,
    ChatPendingAttachmentPreview
  >;

export function createDefaultChatComposerExtensions<
  TMessage = unknown,
>(): DefaultChatComposerExtensions<TMessage> {
  return {
    editor: {
      composeParts: createDefaultEditorComposePartRegistry(),
    },
    send: {
      operations: new ChatSendOperationRegistry<TMessage>(),
    },
    render: {
      pending: createDefaultChatPendingComposeRenderRegistry(),
    },
  };
}
