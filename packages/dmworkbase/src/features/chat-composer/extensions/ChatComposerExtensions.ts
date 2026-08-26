import type { Extensions } from "@tiptap/core";
import type { EditorComposePartRegistry } from "../editor";
import type { PendingComposeRenderRegistry } from "./PendingComposeRenderRegistry";
import type { ChatSendOperationRegistry } from "./ChatSendOperationRegistry";

/** One instance-scoped extension bundle shared by editor, send and pending UI. */
export interface ChatComposerExtensions<
  TMessage = unknown,
  TPendingItem = unknown,
  TPendingAttachment = unknown,
> {
  editor: {
    composeParts: EditorComposePartRegistry;
    tiptap: Extensions;
  };
  send: {
    operations: ChatSendOperationRegistry<TMessage>;
  };
  render: {
    pending: PendingComposeRenderRegistry<TPendingItem, TPendingAttachment>;
  };
}
