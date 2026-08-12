import React from "react";
import { LoaderCircle } from "lucide-react";
import type { ComposeAttempt } from "../domain";
import {
  PendingComposeRenderRegistry,
  type PendingComposeRenderContext,
} from "./pendingComposeRenderRegistry";

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

/** App-level registry. Feature packages can register higher-priority renderers. */
export const chatPendingComposeRenderRegistry =
  new PendingComposeRenderRegistry<
    ChatPendingComposeItem,
    ChatPendingAttachmentPreview
  >();

chatPendingComposeRenderRegistry.register({
  id: "attachment",
  priority: 10,
  canRender: (item) => item.attachments.length > 0,
  render: (item, context) => renderPendingCompose(item, context, true),
});

chatPendingComposeRenderRegistry.register({
  id: "default",
  canRender: () => true,
  render: (item, context) => renderPendingCompose(item, context, false),
});
