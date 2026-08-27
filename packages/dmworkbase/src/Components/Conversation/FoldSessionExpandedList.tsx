import React from "react";
import classNames from "classnames";
import { Checkbox } from "@octo/ui";
import { Message } from "wukongimjssdk";
import { MessageWrap } from "../../Service/Model";
import { isMessageSelectable } from "../../Service/messageSelection";
import { formatMessageTimestamp } from "../../Utils/time";

interface FoldSessionExpandedListProps {
  messages: MessageWrap[];
  editMode: boolean;
  renderAvatar: (message: MessageWrap) => React.ReactNode;
  renderMessageContent: (message: MessageWrap) => React.ReactNode;
  onToggleSelect: (message: Message, checked: boolean) => void;
  onMessageContextMenu: (
    message: Message,
    event: React.MouseEvent<HTMLDivElement>
  ) => void;
  getMessageElementId?: (message: MessageWrap) => string;
  onLocateAnimationEnd?: (message: MessageWrap) => void;
}

const FoldSessionExpandedList: React.FC<FoldSessionExpandedListProps> = ({
  messages,
  editMode,
  renderAvatar,
  renderMessageContent,
  onToggleSelect,
  onMessageContextMenu,
  getMessageElementId,
  onLocateAnimationEnd,
}) => {
  return (
    <>
      {messages.map((message) => {
        const senderName = message.from?.title || message.fromUID;
        const timeStr = formatMessageTimestamp(message.timestamp);
        const selectable = isMessageSelectable(message);
        const showMessageHead = !message.revoke;
        return (
          <div
            key={message.clientMsgNo}
            id={getMessageElementId?.(message)}
            data-locate-message-row="true"
            data-message-seq={message.messageSeq > 0 ? message.messageSeq : undefined}
            className={classNames(
              "wk-fold-msg",
              editMode && "wk-fold-msg-check-open",
              selectable && message.checked && "wk-fold-msg-selected",
              message.locateRemind && "wk-message-item-reminder"
            )}
            data-testid={`fold-msg-${message.clientMsgNo}`}
            onAnimationEnd={(event) => {
              if (
                event.target === event.currentTarget &&
                message.locateRemind
              ) {
                onLocateAnimationEnd?.(message);
              }
            }}
            onClick={
              editMode
                ? () => {
                    if (selectable) {
                      onToggleSelect(message.message, !message.checked);
                    }
                  }
                : undefined
            }
            onContextMenu={editMode
              ? (event) => {
                event.preventDefault();
              }
              : undefined}
          >
            {editMode && selectable ? (
              <div
                className="wk-fold-msg-check"
                onClick={(event) => {
                  event.stopPropagation();
                }}
              >
                <Checkbox
                  className="wk-fold-msg-checkbox"
                  checked={!!message.checked}
                  shape="circle"
                  onCheckedChange={(checked) => {
                    onToggleSelect(message.message, checked);
                  }}
                />
              </div>
            ) : null}
            <span className="wk-fold-msg-ava">{renderAvatar(message)}</span>
            <div
              className="wk-fold-msg-body"
              style={{ pointerEvents: editMode ? "none" : undefined }}
            >
              {showMessageHead ? (
                <div className="wk-fold-msg-head">
                  <span className="wk-fold-msg-name">{senderName}</span>
                  <span className="wk-fold-msg-time">{timeStr}</span>
                </div>
              ) : null}
              <div
                className="wk-fold-msg-content"
                tabIndex={editMode ? undefined : 0}
                onContextMenu={(event) => {
                  if (editMode) {
                    event.preventDefault();
                    return;
                  }
                  onMessageContextMenu(message.message, event);
                }}
                onKeyDown={(event) => {
                  if (editMode) return;
                  if ((event.shiftKey && event.key === "F10") || event.key === "ContextMenu") {
                    event.preventDefault();
                    const rect = event.currentTarget.getBoundingClientRect();
                    event.currentTarget.dispatchEvent(new MouseEvent("contextmenu", {
                      bubbles: true,
                      cancelable: true,
                      clientX: rect.left + Math.min(rect.width / 2, 24),
                      clientY: rect.top + Math.min(rect.height / 2, 24),
                    }));
                  }
                }}
              >
                {renderMessageContent(message)}
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
};

export default FoldSessionExpandedList;
