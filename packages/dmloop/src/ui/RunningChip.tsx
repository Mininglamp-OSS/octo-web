import React from "react";
import { Tag } from "@douyinfe/semi-ui";
import { Loader } from "lucide-react";
import { useI18n } from "@octo/base";

/** 「AI 运行中」小徽标:issue 卡片与列表行共用的单一呈现(改色/图标/文案只此一处)。
 *  数据源:工作区 agent-task-snapshot 算出的 running issue-id 集合。 */
export default function RunningChip() {
  const { t } = useI18n();
  return (
    <Tag color="green" size="small" prefixIcon={<Loader size={11} className="loop-spin" />}>
      {t("loop.taskStatus.running")}
    </Tag>
  );
}
