import React from "react";
import { useI18n } from "@octo/base";
import type { Matter } from "../../bridge/types";
import "./index.css";

const STATUS_MAP: Record<string, { labelKey: string; colorClass: string }> = {
  open: { labelKey: "todo.status.open", colorClass: "wk-mp-sidebar-card__tag--blue" },
  done: { labelKey: "todo.status.done", colorClass: "wk-mp-sidebar-card__tag--green" },
  archived: { labelKey: "todo.status.archived", colorClass: "wk-mp-sidebar-card__tag--gray" },
};

function formatDdl(deadline?: string): string {
  if (!deadline) return "";
  const d = new Date(deadline);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export interface SidebarCardProps {
  matter: Matter;
  selected: boolean;
  onClick: () => void;
  /** Render an avatar for the given uid at the given pixel size */
  renderAvatar: (uid: string, size: number) => React.ReactNode;
  /** Render a user name inline for the given uid */
  renderUserName: (uid: string) => React.ReactNode;
  /** Pre-resolved source channel name (replaces internal useChannelName call) */
  sourceChannelName?: string;
}

export default function SidebarCard({
  matter,
  selected,
  onClick,
  renderAvatar,
  renderUserName,
  sourceChannelName,
}: SidebarCardProps) {
  const { t } = useI18n();
  const status = STATUS_MAP[matter.status] || STATUS_MAP.open;
  const ddl = formatDdl(matter.deadline);

  return (
    <button
      type="button"
      className={`wk-mp-sidebar-card${selected ? " is-selected" : ""}`}
      onClick={onClick}
    >
      {/* 第一行：状态标签 + 日期 */}
      <div className="wk-mp-sidebar-card__row1">
        <span className={`wk-mp-sidebar-card__tag ${status.colorClass}`}>
          <span className="wk-mp-sidebar-card__tag-label">{t(status.labelKey)}</span>
          {matter.seq_no ? (
            <span className="wk-mp-sidebar-card__tag-no">｜M-{matter.seq_no}</span>
          ) : null}
        </span>
        {ddl && (
          <span className="wk-mp-sidebar-card__ddl">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="wk-mp-sidebar-card__calendar-icon">
              <path
                d="M4 1v1.5M8 1v1.5M1.5 4.5h9M2.5 2.5h7a1 1 0 011 1v6a1 1 0 01-1 1h-7a1 1 0 01-1-1v-6a1 1 0 011-1z"
                stroke="currentColor"
                strokeWidth="1"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {ddl}
          </span>
        )}
      </div>

      {/* 第二行：标题 */}
      <div className="wk-mp-sidebar-card__title">{matter.title}</div>

      {/* 第三行：创建人 + 负责人 */}
      <div className="wk-mp-sidebar-card__meta">
        <div className="wk-mp-sidebar-card__meta-item">
          <span className="wk-mp-sidebar-card__meta-label">{t("todo.label.creator")}</span>
          <span className="wk-mp-sidebar-card__user">
            {renderAvatar(matter.creator_id, 16)}
            <span className="wk-mp-sidebar-card__user-name">{renderUserName(matter.creator_id)}</span>
          </span>
        </div>
        {matter.assignees && matter.assignees.length > 0 && (
          <div className="wk-mp-sidebar-card__meta-item">
            <span className="wk-mp-sidebar-card__meta-label">{t("todo.label.assignee")}</span>
            <span className="wk-mp-sidebar-card__user">
              <span className="wk-mp-sidebar-card__avatar-group">
                {matter.assignees.slice(0, 3).map((a, i) => (
                  <span
                    key={a.user_id}
                    style={{ marginLeft: i > 0 ? -4 : 0, zIndex: 3 - i }}
                  >
                    {renderAvatar(a.user_id, 16)}
                  </span>
                ))}
              </span>
              {matter.assignees.length === 1 && (
                <span className="wk-mp-sidebar-card__user-name">
                  {renderUserName(matter.assignees[0].user_id)}
                </span>
              )}
              {matter.assignees.length > 1 && (
                <span className="wk-mp-sidebar-card__user-name">
                  {renderUserName(matter.assignees[0].user_id)}
                  {t("todo.assignee.moreSuffix", { values: { count: matter.assignees.length } })}
                </span>
              )}
            </span>
          </div>
        )}
      </div>
    </button>
  );
}

export { SidebarCard };
