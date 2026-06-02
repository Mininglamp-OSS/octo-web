import React from "react";
import classNames from "classnames";
import moment from "moment";
import { Message } from "wukongimjssdk";
import { MessageWrap } from "../../Service/Model";
import Checkbox from "../Checkbox";
import { isMessageSelectable } from "../../Service/messageSelection";

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
}

const FoldSessionExpandedList: React.FC<FoldSessionExpandedListProps> = ({
  messages,
  editMode,
  renderAvatar,
  renderMessageContent,
  onToggleSelect,
  onMessageContextMenu,
}) => {
  return (
    <>
      {messages.map((message) => {
        const senderName = message.from?.title || message.fromUID;
        const timeStr = moment(message.timestamp * 1000).format("HH:mm");
        const selectable = isMessageSelectable(message);
        return (
          <div
            key={message.clientMsgNo}
            className={classNames(
              "wk-fold-msg",
              editMode && "wk-fold-msg-check-open",
              selectable && message.checked && "wk-fold-msg-selected"
            )}
            data-testid={`fold-msg-${message.clientMsgNo}`}
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
              <div className="wk-fold-msg-head">
                <span className="wk-fold-msg-name">{senderName}</span>
                <span className="wk-fold-msg-time">{timeStr}</span>
              </div>
              {renderMessageContent(message)}
            </div>
          </div>
        );
      })}
    </>
  );
};

export default FoldSessionExpandedList;
