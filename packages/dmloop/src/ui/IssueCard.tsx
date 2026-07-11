import React from "react";
import { Tag } from "@douyinfe/semi-ui";
import { CalendarClock } from "lucide-react";
import { useI18n } from "@octo/base";
import type { Issue } from "../api/types";
import { AssigneeBadge } from "./AssigneePicker";
import LabelChips from "./LabelChips";
import RunningChip from "./RunningChip";
import { PRIORITY_COLOR, formatShortDate, isOverdue } from "./meta";

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
  const { t } = useI18n();
  return (
    <div
      className={`loop-card ${dragging ? "is-dragging" : ""}`}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={() => onOpen(issue.id)}
    >
      <div className="loop-card__key">
        {issue.identifier}
        {running && <RunningChip />}
      </div>
      <div className="loop-card__title">{issue.title}</div>
      {issue.labels && issue.labels.length > 0 && (
        <div style={{ marginTop: 4 }}><LabelChips labels={issue.labels} max={3} /></div>
      )}
      <div className="loop-card__foot">
        <Tag color={PRIORITY_COLOR[issue.priority]} size="small">
          {t(`loop.priority.${issue.priority}`)}
        </Tag>
        {issue.due_date && (
          <span
            className="loop-card__due"
            style={{ color: isOverdue(issue.due_date, issue.status) ? "var(--semi-color-danger)" : "var(--semi-color-text-2)" }}
          >
            <CalendarClock size={12} />
            {formatShortDate(issue.due_date)}
          </span>
        )}
        <AssigneeBadge type={issue.assignee_type} name={issue.assignee_name ?? null} />
      </div>
    </div>
  );
}
