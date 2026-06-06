import React from "react";
import WKApp from "../../App";
import { getRichTextMessageUI } from "../../bridge/message/useRichTextMessageUI";
import { isMessageSelectable } from "../../Service/messageSelection";
import MessageRow from "../../ui/message/MessageRow";
import MixedContent from "../../ui/message/MixedContent";
import ReplyBlock from "../../ui/message/ReplyBlock";
import { downloadFile } from "../../Utils/download";
import { resolveExternalForViewer } from "../../Utils/externalViewer";
import { MessageCell } from "../MessageCell";
import { RichTextContent } from "./RichTextContent";
import "./index.css";

export { RichTextContent } from "./RichTextContent";

function resolveReplySourceSpaceName(reply: any): string {
  if (!reply) return "";
  const { isExternal, sourceSpaceName } = resolveExternalForViewer({
    homeSpaceId: reply.from_home_space_id as string | undefined,
    homeSpaceName: reply.from_home_space_name as string | undefined,
    isExternalLegacy:
      reply.from_is_external === 1 || reply.from_is_external === true ? 1 : 0,
    sourceSpaceNameLegacy: reply.from_source_space_name as string | undefined,
    viewerSpaceId: WKApp.shared.currentSpaceId,
  });
  return isExternal && sourceSpaceName ? sourceSpaceName : "";
}

/**
 * RichText(=14) 图文混排消息。
 *
 * 展示层接入新 MessageRow / bridge / ui/message 体系；发送协议仍保持现状：
 * 当前只发送 text + image RichText，file block 仅作为未来协议的前向兼容渲染。
 *
 * 老端 fallback：未注册 type=14 的旧端落 UnknownCell（已有），本端注册后正常渲染。
 */
export class RichTextCell extends MessageCell {
  render() {
    const { message, context } = this.props;
    const content = message.content as RichTextContent;
    const selectionMode = context.editOn();
    const selectable = isMessageSelectable(message);
    const uiProps = getRichTextMessageUI(message, {
      selectionMode,
      showCheckbox: selectionMode && selectable,
      isSelected: selectable && !!message.checked,
      onSelect: selectable
        ? (selected) => context.checkeMessage(message.message, selected)
        : undefined,
    });

    return (
      <MessageRow
        {...uiProps.row}
        onContextMenu={(event) => context.showContextMenus(message, event)}
        isActive={context.isContextMenuOpen(message.message)}
        onAvatarClick={(e) => context.onTapAvatar(message.fromUID, e)}
        onSenderNameClick={() => context.showUser(message.fromUID)}
      >
        <div className="wk-message-richtext">
          {content.reply && (
            <ReplyBlock
              fromName={content.reply.fromName || ""}
              digest={content.reply.content?.conversationDigest || ""}
              sourceSpaceName={resolveReplySourceSpaceName(content.reply)}
              onClick={() => context.locateMessage(content.reply.messageSeq)}
            />
          )}
          <MixedContent
            {...uiProps.content}
            onMentionClick={(uid) => context.showUser(uid)}
            onFileDownload={(block) => {
              if (block.url) {
                downloadFile(block.url, block.name);
              }
            }}
          />
        </div>
      </MessageRow>
    );
  }
}

export default RichTextCell;
