import React from "react";
import { Button, Popconfirm, Tag } from "@douyinfe/semi-ui";
import { IconDelete, IconExit } from "@douyinfe/semi-icons";
import { useI18n } from "@octo/base";
import WKApp from "@octo/base/src/App";
import type { SummaryListItem } from "../types/summary";
import { ParticipantStatus, TriggerType } from "../types/summary";
import TaskStatusBadge from "./TaskStatusBadge";
import OverflowTooltip from "./OverflowTooltip";

interface SummaryCardProps {
    task: SummaryListItem;
    onClick: (taskId: number) => void;
    onDelete: (taskId: number) => void;
    onRespond?: (taskId: number, action: "accept" | "reject") => void;
    onLeave?: (taskId: number) => void;
}

const SummaryCard: React.FC<SummaryCardProps> = ({ task, onClick, onDelete, onRespond, onLeave }) => {
    const { t } = useI18n();
    const currentUid = WKApp.loginInfo.uid;
    const myParticipant = task.participants?.find((p) => p.user_id === currentUid);
    const isMultiParticipant = (task.participants?.length ?? 0) > 1;
    const isPendingInvite = isMultiParticipant && myParticipant != null && myParticipant.status === ParticipantStatus.PENDING;

    // 是否创建者：以 creator_id 为准。非创建者且是参与者 -> 退出；
    // 创建者 -> 删除。
    // FE-2（fail-safe）：creator_id 缺失（旧后端 / 数据异常）时【不】当 creator——
    // 否则会对任何人露出「删除整个任务」破坏性入口（fail-open 泄漏）。与详情页
    // isCreator 口径一致（creator_id != null && === uid，fail-closed），缺失只显示退出。
    const isCreator = task.creator_id != null && task.creator_id === currentUid;
    const isParticipant = myParticipant != null;

    // 是否定时任务：以 schedule_id 为准，trigger_type===SCHEDULED 作兜底，
    // 以覆盖「绑定了定时但尚未执行过」的任务。
    const isScheduledTask = (task.schedule_id != null && task.schedule_id > 0) || task.trigger_type === TriggerType.SCHEDULED;
    
    // 是否 AI 生成：trigger_type === AGENT
    const isAgentGenerated = task.trigger_type === TriggerType.AGENT;

    return (
        <div className="summary-card" onClick={() => onClick(task.task_id)}>
            {task.needs_attention && <span className="summary-card-attention-dot" aria-label={t("summary.list.needsAttention")} />}
            <div className="summary-card-header">
                <OverflowTooltip className="summary-card-title" title={task.title || task.task_no}>
                    {task.title || task.task_no}
                </OverflowTooltip>
                <div className="summary-card-header-badges">
                    {isAgentGenerated && (
                        <Tag size="small" color="violet">
                            🤖 {t("summary.summaryCard.aiGenerated")}
                        </Tag>
                    )}
                    <TaskStatusBadge status={task.status} />
                </div>
            </div>

            {isPendingInvite && onRespond && (
                <div
                    className="summary-card-respond"
                    style={{ display: "flex", gap: 8, padding: "8px 0 0" }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <Button
                        size="small"
                        theme="solid"
                        onClick={() => onRespond(task.task_id, "accept")}
                    >
                        {t("summary.action.accept")}
                    </Button>
                    <Button
                        size="small"
                        onClick={() => onRespond(task.task_id, "reject")}
                    >
                        {t("summary.action.reject")}
                    </Button>
                </div>
            )}
            <div className="summary-card-footer">
                <span className="summary-card-created">
                    {t("summary.summaryCard.createdBy", { values: { name: task.creator_name || t("summary.common.unknown") } })}
                </span>
                <span className="summary-card-date">{task.created_at?.substring(0, 10) || ''}</span>
                {isCreator ? (
                    <Popconfirm
                        title={t("summary.summaryCard.deleteTitle")}
                        content={
                            isScheduledTask
                                ? t("summary.summaryCard.deleteScheduledContent", { values: { title: task.title || task.task_no } })
                                : t("summary.summaryCard.deleteContent", { values: { title: task.title || task.task_no } })
                        }
                        onConfirm={(e) => {
                            e?.stopPropagation();
                            onDelete(task.task_id);
                        }}
                        onCancel={(e) => e?.stopPropagation()}
                    >
                        <Button
                            theme="borderless"
                            type="danger"
                            size="small"
                            icon={<IconDelete />}
                            onClick={(e) => e.stopPropagation()}
                        />
                    </Popconfirm>
                ) : isParticipant && onLeave ? (
                    <Popconfirm
                        title={t("summary.summaryCard.leaveTitle")}
                        content={t("summary.summaryCard.leaveContent", { values: { title: task.title || task.task_no } })}
                        onConfirm={(e) => {
                            e?.stopPropagation();
                            onLeave(task.task_id);
                        }}
                        onCancel={(e) => e?.stopPropagation()}
                    >
                        <Button
                            theme="borderless"
                            type="danger"
                            size="small"
                            icon={<IconExit />}
                            onClick={(e) => e.stopPropagation()}
                        />
                    </Popconfirm>
                ) : null}
            </div>
        </div>
    );
};

export default SummaryCard;
