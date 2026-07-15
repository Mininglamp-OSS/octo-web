import React, { useState } from "react";
import { useI18n } from "@octo/base";
import type { Issue, IssueStatus } from "../api/types";
import { updateIssue } from "../api/issueApi";
import IssueCard from "../ui/IssueCard";
import { useRunConfirm } from "../ui/RunConfirmModal";
import { ISSUE_STATUS_ORDER, ISSUE_STATUS_ICON, ISSUE_STATUS_HEX } from "../ui/meta";

export interface IssueBoardProps {
  issues: Issue[];
  onOpen: (id: string) => void;
  onChanged: () => void;
  /** 有 agent 正在跑的 issue-id 集合(渲染 running chip)。 */
  running?: ReadonlySet<string>;
}

/** 看板：按 status 分列 + 原生 HTML5 拖拽跨列改状态。 */
export default function IssueBoard({
  issues,
  onOpen,
  onChanged,
  running,
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
        const StatusIcon = ISSUE_STATUS_ICON[status];
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
              <StatusIcon size={14} strokeWidth={2} style={{ color: ISSUE_STATUS_HEX[status] }} />
              <span className="loop-board__col-name">{t(`loop.status.${status}`)}</span>
              <em>{cards.length}</em>
            </div>
            <div className="loop-board__cards">
              {cards.map((issue) => (
                <IssueCard
                  key={issue.id}
                  issue={issue}
                  onOpen={onOpen}
                  running={running?.has(issue.id)}
                  draggable
                  dragging={dragId === issue.id}
                  onDragStart={() => setDragId(issue.id)}
                  onDragEnd={() => {
                    setDragId(null);
                    setDropCol(null);
                  }}
                />
              ))}
            </div>
          </div>
        );
      })}
      {runConfirmModal}
    </div>
  );
}
