import React from "react";
import { CalendarClock } from "lucide-react";
import { useI18n } from "@octo/base";
import type { Issue } from "../api/types";
import { AssigneeBadge } from "./AssigneePicker";
import LabelChips from "./LabelChips";
import RunningChip from "./RunningChip";
import {
  PRIORITY_ICON,
  PRIORITY_HEX,
  ISSUE_STATUS_ICON,
  ISSUE_STATUS_HEX,
  formatShortDate,
  isOverdue,
} from "./meta";
import { formatRelativeTime } from "./time";

export interface IssueCardProps {
  issue: Issue;
  onOpen: (id: string) => void;
  /** 有 agent 正在该 issue 上跑任务(数据源:工作区 agent-task-snapshot)。 */
  running?: boolean;
  /** status 看板的跨列拖拽;分组板不传即普通卡片。 */
  draggable?: boolean;
  dragging?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}

/** issue 卡片:status 看板与分组板复用的单一呈现(running 状态由共享 RunningChip 渲染)。 */
export default function IssueCard({
  issue,
  onOpen,
  running,
  draggable,
  dragging,
  onDragStart,
  onDragEnd,
}: IssueCardProps) {
  const { t, format } = useI18n();
  const PriIcon = PRIORITY_ICON[issue.priority];
  const StatusIcon = ISSUE_STATUS_ICON[issue.status];
  return (
    <div
      className={`loop-card ${dragging ? "is-dragging" : ""}`}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={() => onOpen(issue.id)}
    >
      <div className="loop-card__top">
        <span className="loop-card__icon" title={t(`loop.priority.${issue.priority}`)}>
          <PriIcon size={14} strokeWidth={2} style={{ color: PRIORITY_HEX[issue.priority] }} />
        </span>
        <span className="loop-card__icon" title={t(`loop.status.${issue.status}`)}>
          <StatusIcon size={14} strokeWidth={2} style={{ color: ISSUE_STATUS_HEX[issue.status] }} />
        </span>
        <span className="loop-card__id">{issue.identifier}</span>
        {running && <RunningChip />}
        <time className="loop-card__time">{formatRelativeTime(issue.updated_at ?? issue.created_at, format)}</time>
      </div>

      <div className="loop-card__title">{issue.title}</div>

      {issue.labels && issue.labels.length > 0 && (
        <div className="loop-card__labels"><LabelChips labels={issue.labels} max={3} /></div>
      )}

      <div className="loop-card__foot">
        {issue.project_name && <span className="loop-card__project">{issue.project_name}</span>}
        {issue.due_date && (
          <span
            className="loop-card__due"
            style={{ color: isOverdue(issue.due_date, issue.status) ? "var(--semi-color-danger, #f5222d)" : "var(--semi-color-text-2, #8590a6)" }}
          >
            <CalendarClock size={12} />
            {formatShortDate(issue.due_date)}
          </span>
        )}
        <span className="loop-card__spacer" />
        <AssigneeBadge type={issue.assignee_type} name={issue.assignee_name ?? null} />
      </div>
    </div>
  );
}
