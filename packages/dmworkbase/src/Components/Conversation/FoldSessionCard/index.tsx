import classNames from "classnames";
import React, { HTMLProps, ReactNode } from "react";
import Checkbox from "../../Checkbox";
import { useI18n } from "../../../i18n";
import "./index.css";

export interface FoldSessionCardParticipant {
  id: string;
  name: string;
  avatar: ReactNode;
}

export interface FoldSessionCardProps extends HTMLProps<HTMLDivElement> {
  participants: FoldSessionCardParticipant[];
  count: number;
  selectionMode?: boolean;
  isActive?: boolean;
  isExpanded?: boolean;
  appearing?: boolean;
  flash?: boolean;
  tagLabel?: string;
  statusLabel?: string;
  showSummary?: boolean;
  highlightSummary?: boolean;
  summaryId?: string;
  summarySender?: string;
  summaryTime?: string;
  summaryShowMeta?: boolean;
  summaryContent?: ReactNode;
  summaryIcon?: ReactNode;

  expandedContent?: ReactNode;
  onToggle?: () => void;
  summaryChecked?: boolean;
  summarySelectable?: boolean;
  onSummaryToggleSelect?: (checked: boolean) => void;
  onSummaryAnimationEnd?: React.AnimationEventHandler<HTMLDivElement>;
  onSummaryContextMenu?: React.MouseEventHandler<HTMLDivElement>;
}

const FoldSessionCard: React.FC<FoldSessionCardProps> = ({
  className,
  participants,
  count,
  selectionMode = false,
  isActive,
  isExpanded,
  appearing,
  flash,
  tagLabel,
  statusLabel,
  showSummary,
  highlightSummary,
  summaryId,
  summarySender,
  summaryTime,
  summaryShowMeta = true,
  summaryContent,
  summaryIcon,
  expandedContent,
  onToggle,
  summaryChecked = false,
  summarySelectable = false,
  onSummaryToggleSelect,
  onSummaryAnimationEnd,
  onSummaryContextMenu,
  ...rest
}) => {
  const { t } = useI18n();
  const displayTagLabel = tagLabel ?? t("base.foldSessionCard.aiCollaboration");
  const displayStatusLabel = statusLabel ?? t("base.foldSessionCard.inProgress");
  // participantLabel 保留计算,供外层 Conversation 使用
  const participantLabel = participants
    .map((participant) => participant.name)
    .join(" × ");

  return (
    <div
      className={classNames(
        "wk-fold-session-card",
        isActive && "wk-fold-session-card-active",
        appearing && "wk-fold-session-card-appearing",
        flash && "wk-fold-session-card-flash",
        className
      )}
      {...rest}
    >
      {/* 卡片头部:已移除,保留隐藏的 meta 区 */}
      <div className="wk-fold-session-card-head" onClick={onToggle}>
        {/* 注释掉原头像堆叠和名字行,保留代码结构便于回滚
        <div className="wk-fold-session-card-head-left">
          <div className="wk-fold-session-card-avatars" aria-hidden="true">
            {participants.map((participant) => (
              <span
                key={participant.id}
                className="wk-fold-session-card-avatar"
              >
                {participant.avatar}
              </span>
            ))}
          </div>
          <div className="wk-fold-session-card-title-wrap">
            <span className="wk-fold-session-card-title">
              {participantLabel}
            </span>
            <span className="wk-fold-session-card-tag">{tagLabel}</span>
          </div>
        </div>
        */}
        <div className="wk-fold-session-card-meta">
          {isActive ? (
            <span
              className="wk-fold-session-card-live-dot"
              aria-hidden="true"
            />
          ) : null}
          {isActive ? (
            <span className="wk-fold-session-card-status">{displayStatusLabel}</span>
          ) : null}
          <span className="wk-fold-session-card-count">
            {t("base.foldSessionCard.count", { values: { count } })}
          </span>
          <button
            type="button"
            data-testid="fold-session-toggle"
            className={classNames(
              "wk-fold-session-card-toggle",
              isExpanded && "wk-fold-session-card-toggle-open"
            )}
            onClick={(event) => {
              event.stopPropagation();
              if (onToggle) {
                onToggle();
              }
            }}
            aria-expanded={isExpanded}
            aria-label={isExpanded
              ? t("base.foldSessionCard.collapse")
              : t("base.foldSessionCard.expand")}
          >
            <svg viewBox="0 0 24 24">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        </div>
      </div>

      <div
        className={classNames(
          "wk-fold-session-card-expanded",
          isExpanded && "wk-fold-session-card-expanded-show"
        )}
      >
        <div className="wk-fold-session-card-expanded-inner">
          {expandedContent}
        </div>
      </div>

      {showSummary ? (
        <div
          id={summaryId}
          className={classNames(
            "wk-fold-session-card-summary",
            showSummary && "wk-fold-session-card-summary-show",
            highlightSummary && "wk-fold-session-card-summary-highlight"
          )}
          onAnimationEnd={onSummaryAnimationEnd}
          onContextMenu={
            selectionMode
              ? (event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }
              : onSummaryContextMenu
          }
        >
          <div
            className={classNames(
              "wk-fold-session-card-summary-inner",
              selectionMode && "wk-fold-session-card-summary-inner-selection",
              selectionMode &&
                summarySelectable &&
                "wk-fold-session-card-summary-inner-selectable",
              selectionMode &&
                summaryChecked &&
                "wk-fold-session-card-summary-inner-selected"
            )}
            onClick={
              selectionMode && summarySelectable
                ? () => {
                    if (onSummaryToggleSelect) {
                      onSummaryToggleSelect(!summaryChecked);
                    }
                  }
                : undefined
            }
            data-testid={
              summarySelectable ? "fold-session-summary-message" : undefined
            }
          >
            {selectionMode && summarySelectable ? (
              <div
                className="wk-fold-session-card-summary-check"
                onClick={(event) => {
                  event.stopPropagation();
                }}
              >
                <Checkbox
                  className="wk-fold-session-card-summary-checkbox"
                  checked={summaryChecked}
                  onChange={(checked) => {
                    if (onSummaryToggleSelect) {
                      onSummaryToggleSelect(checked);
                    }
                  }}
                />
              </div>
            ) : null}
            <div
              className="wk-fold-session-card-summary-main"
              style={{
                pointerEvents: selectionMode ? "none" : undefined,
              }}
            >
              {/* 折叠状态显示完整消息:姓名tag + 时间 + 内容 */}
              {summaryShowMeta ? (
                <div className="wk-fold-msg-head">
                  <span className="wk-fold-msg-name">{summarySender}</span>
                  <span className="wk-fold-msg-time">{summaryTime}</span>
                </div>
              ) : null}
              {summaryContent ? (
                <div className="wk-fold-msg-text">
                  {summaryContent}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default FoldSessionCard;
export { FoldSessionCard };
