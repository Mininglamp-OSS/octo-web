import React from "react";
import classNames from "classnames";
import { Message } from "wukongimjssdk";
import { MessageWrap } from "../../Service/Model";
import Checkbox from "../Checkbox";
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
            onContextMenu={(event) => {
              if (editMode) {
                event.preventDefault();
                return;
              }
              onMessageContextMenu(message.message, event);
            }}
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
                  onChange={(checked) => {
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
              {renderMessageContent(message)}
            </div>
          </div>
        );
      })}
    </>
  );
};

export default FoldSessionExpandedList;
