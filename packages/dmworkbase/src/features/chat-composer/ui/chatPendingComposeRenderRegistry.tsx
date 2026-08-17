import React from "react";
import { LoaderCircle } from "lucide-react";
import type { ComposeAttempt } from "../domain";
import {
  PendingComposeRenderRegistry,
  type PendingComposeRenderContext,
} from "../extensions";

export interface ChatPendingAttachmentPreview {
  id: string;
  name: string;
  type: string;
  previewUrl?: string;
}

export type ChatPendingComposeItem =
  ComposeAttempt<ChatPendingAttachmentPreview>;

type ChatPendingRenderContext =
  PendingComposeRenderContext<ChatPendingAttachmentPreview>;

function renderPendingCompose(
  item: ChatPendingComposeItem,
  context: ChatPendingRenderContext,
  includeAttachments: boolean,
): React.ReactNode {
  return (
    <div className="wk-messageinput-sending-item" key={item.id}>
      <LoaderCircle
        className="wk-messageinput-sending-spinner"
        role="img"
        aria-label={context.sendingLabel}
      />
      {item.previewText && (
        <span
          className="wk-messageinput-sending-text"
          title={item.previewText}
        >
          {item.previewText}
        </span>
      )}
      {includeAttachments && item.attachments.length > 0 && (
        <span className="wk-messageinput-sending-attachments">
          {item.attachments.map((attachment) =>
            context.renderAttachment(attachment),
          )}
        </span>
      )}
    </div>
  );
}

export function registerDefaultChatPendingComposeRenderers(
  registry: PendingComposeRenderRegistry<
    ChatPendingComposeItem,
    ChatPendingAttachmentPreview
  >,
): void {
  registry.register({
    id: "attachment",
    priority: 10,
    canRender: (item) => item.attachments.length > 0,
    render: (item, context) => renderPendingCompose(item, context, true),
  });

  registry.register({
    id: "default",
    canRender: () => true,
    render: (item, context) => renderPendingCompose(item, context, false),
  });
}

export function createDefaultChatPendingComposeRenderRegistry(): PendingComposeRenderRegistry<
  ChatPendingComposeItem,
  ChatPendingAttachmentPreview
> {
  const registry = new PendingComposeRenderRegistry<
    ChatPendingComposeItem,
    ChatPendingAttachmentPreview
  >();
  registerDefaultChatPendingComposeRenderers(registry);
  return registry;
}
