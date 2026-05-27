import React from "react";
import { Button, Popconfirm } from "@douyinfe/semi-ui";
import { IconDelete } from "@douyinfe/semi-icons";
import { useI18n } from "@octo/base";
import WKApp from "@octo/base/src/App";
import type { SummaryListItem } from "../types/summary";
import { ParticipantStatus } from "../types/summary";
import TaskStatusBadge from "./TaskStatusBadge";
import OverflowTooltip from "./OverflowTooltip";

interface SummaryCardProps {
    task: SummaryListItem;
    onClick: (taskId: number) => void;
    onDelete: (taskId: number) => void;
    onRespond?: (taskId: number, action: "accept" | "reject") => void;
}

const SummaryCard: React.FC<SummaryCardProps> = ({ task, onClick, onDelete, onRespond }) => {
    const { t } = useI18n();
    const currentUid = WKApp.loginInfo.uid;
    const myParticipant = task.participants?.find((p) => p.user_id === currentUid);
    const isPendingInvite = myParticipant != null && myParticipant.status === ParticipantStatus.PENDING;

    return (
        <div className="summary-card" onClick={() => onClick(task.task_id)}>
            <div className="summary-card-header">
                <OverflowTooltip className="summary-card-title">
                    {task.title || task.task_no}
                </OverflowTooltip>
                <TaskStatusBadge status={task.status} />
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
                <Popconfirm
                    title={t("summary.summaryCard.deleteTitle")}
                    content={t("summary.summaryCard.deleteContent", { values: { title: task.title || task.task_no } })}
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
            </div>
        </div>
    );
};

export default SummaryCard;
