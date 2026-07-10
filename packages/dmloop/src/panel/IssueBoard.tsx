import React, { useState } from "react";
import { Tag } from "@douyinfe/semi-ui";
import { CalendarClock } from "lucide-react";
import { useI18n } from "@octo/base";
import type { Issue, IssueStatus } from "../api/types";
import { updateIssue } from "../api/issueApi";
import { AssigneeBadge } from "../ui/AssigneePicker";
import LabelChips from "../ui/LabelChips";
import { useRunConfirm } from "../ui/RunConfirmModal";
import {
  ISSUE_STATUS_ORDER,
  ISSUE_STATUS_COLOR,
  PRIORITY_COLOR,
  formatShortDate,
  isOverdue,
} from "../ui/meta";

export interface IssueBoardProps {
  issues: Issue[];
  onOpen: (id: string) => void;
  onChanged: () => void;
}

/** 看板：按 status 分列 + 原生 HTML5 拖拽跨列改状态。 */
export default function IssueBoard({
  issues,
  onOpen,
  onChanged,
}: IssueBoardProps) {
  const { t } = useI18n();
  const { requestStatus, runConfirmModal } = useRunConfirm();
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropCol, setDropCol] = useState<IssueStatus | null>(null);

  const handleDrop = (status: IssueStatus) => {
    setDropCol(null);
    const id = dragId;
    setDragId(null);
    if (!id) return;
    const issue = issues.find((i) => i.id === id);
    if (!issue || issue.status === status) return;
    // 拖到 agent 已指派的 backlog→活跃列会触发 run,先走确认;其余直接落库。
    requestStatus(issue, status, async (extra) => {
      await updateIssue(id, { status, ...extra });
      onChanged();
    });
  };

  return (
    <div className="loop-board">
      {ISSUE_STATUS_ORDER.map((status) => {
        const cards = issues.filter((i) => i.status === status);
        return (
          <div
            key={status}
            className={`loop-board__col ${dropCol === status ? "is-drop" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              if (dropCol !== status) setDropCol(status);
            }}
            onDragLeave={(e) => {
              // 仅当离开整列时清除
              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                setDropCol((c) => (c === status ? null : c));
              }
            }}
            onDrop={() => handleDrop(status)}
          >
            <div className="loop-board__col-head">
              <Tag color={ISSUE_STATUS_COLOR[status]} size="small">
                {t(`loop.status.${status}`)}
              </Tag>
              <em>{cards.length}</em>
            </div>
            <div className="loop-board__cards">
              {cards.map((issue) => (
                <div
                  key={issue.id}
                  className={`loop-card ${dragId === issue.id ? "is-dragging" : ""}`}
                  draggable
                  onDragStart={() => setDragId(issue.id)}
                  onDragEnd={() => {
                    setDragId(null);
                    setDropCol(null);
                  }}
                  onClick={() => onOpen(issue.id)}
                >
                  <div className="loop-card__key">{issue.identifier}</div>
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
                    <AssigneeBadge
                      type={issue.assignee_type}
                      name={issue.assignee_name ?? null}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
      {runConfirmModal}
    </div>
  );
}
