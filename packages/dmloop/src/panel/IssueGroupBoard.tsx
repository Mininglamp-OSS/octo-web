import React from "react";
import { useI18n } from "@octo/base";
import type { IssueGroup } from "../api/types";
import IssueCard from "../ui/IssueCard";
import { AssigneeBadge } from "../ui/AssigneePicker";

export interface IssueGroupBoardProps {
  groups: IssueGroup[];
  onOpen: (id: string) => void;
  /** 有 agent 正在跑的 issue-id 集合(渲染 running chip)。 */
  running?: ReadonlySet<string>;
}

/** 按负责人分组板：每个负责人一段(段头 + 卡片行)。数据源 /issues/grouped。
 *  拖拽改派属重交互(Tier3),此处仅浏览 + 点开。 */
export default function IssueGroupBoard({ groups, onOpen, running }: IssueGroupBoardProps) {
  const { t } = useI18n();
  return (
    <div className="loop-groupboard">
      {groups.map((g) => (
        <div key={g.id} className="loop-groupboard__group">
          <div className="loop-groupboard__head">
            {g.assignee_type ? (
              <AssigneeBadge type={g.assignee_type} name={g.assignee_name ?? null} />
            ) : (
              <span className="loop-assignee-empty">{t("loop.assignee.unassigned")}</span>
            )}
            <em>{g.total}</em>
          </div>
          <div className="loop-groupboard__cards">
            {g.issues.map((issue) => (
              <IssueCard key={issue.id} issue={issue} onOpen={onOpen} running={running?.has(issue.id)} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
